#!/usr/bin/env node
/* eslint-disable no-console */
import { argv, env } from 'node:process'
import { setTimeout as sleep } from 'node:timers/promises'
import { writeFileSync } from 'node:fs'
import { resolve as resolvePath } from 'node:path'

import dotenv from 'dotenv'
dotenv.config()

const opt = {
  csvPathArg: getArg('--csv'),
  dryRun: argv.includes('--dry-run'),
  fromView: argv.includes('--fromView'),
  contactId: getArg('--contactId'),
  einsteinUrl: getArg('--einsteinUrl'),
  concurrency: parseInt(process.env.CONCURRENCY || '5', 10),
  ghl: {
    base: 'https://services.leadconnectorhq.com',
    key: process.env.TOKEN,
    version: process.env.GHL_API_VERSION || '2021-07-28'
  },
  supabase: {
    url: process.env.SUPABASE_URL,
    key: process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY,
    schema: process.env.SUPABASE_SCHEMA || 'public',
    view:
      process.env.SUPABASE_VIEW || 'v_contacts_created_2025_10_19_to_2025_10_28'
  }
}

function getArg (flag) {
  const i = argv.indexOf(flag)
  return i >= 0 ? argv[i + 1] : undefined
}

// --- HTTP helpers -----------------------------------------------------------
// ---- robust HTTP with 429 handling (ESM) -----------------------------------
let lastRequestAt = 0 // simple global throttle

function ms (maybe) {
  const n = Number(maybe)
  return Number.isFinite(n) ? n : undefined
}

const RL = {
  // tune via env vars
  maxRetries429: parseInt(env.MAX_RETRIES_429 || '6', 10), // total tries = maxRetries429 + 1
  maxRetries5xx: parseInt(env.MAX_RETRIES_5XX || '3', 10),
  baseDelayMs: ms(env.BACKOFF_BASE_MS) ?? 400, // exponential backoff base
  minInterval: ms(env.MIN_INTERVAL_MS) ?? 150, // min gap between any two requests
  maxDelayMs: ms(env.BACKOFF_MAX_MS) ?? 15_000 // cap backoff growth
}

async function globalThrottle () {
  const now = Date.now()
  const wait = Math.max(0, lastRequestAt + RL.minInterval - now)
  if (wait > 0) await new Promise(r => setTimeout(r, wait))
  lastRequestAt = Date.now()
}

/**
 * HTTP with retry/backoff
 * - Retries 429 with Retry-After support (or exponential backoff)
 * - Retries 5xx with exponential backoff
 * - Does NOT retry other 4xx (except 429)
 */
async function http (method, url, { headers = {}, json } = {}) {
  const h = { ...headers }
  let body
  if (json !== undefined) {
    h['content-type'] = 'application/json'
    body = JSON.stringify(json)
  }

  // separate counters so a run can escalate through 429s and 5xx reasonably
  let tries429 = 0
  let tries5xx = 0

  // we loop until we return or throw
  for (;;) {
    await globalThrottle()

    const res = await fetch(url, { method, headers: h, body })

    if (res.ok) return res

    const status = res.status
    // Read body once for logging/errors (safe for non-2xx)
    let text = ''
    try {
      text = await res.text()
    } catch {}

    // 429 Too Many Requests
    if (status === 429) {
      if (tries429 >= RL.maxRetries429) {
        throw new Error(
          `${method} ${url} → 429 Too Many Requests (exhausted ${RL.maxRetries429} retries) ${text}`
        )
      }
      tries429++

      // Retry-After header (seconds or HTTP-date)
      const ra = res.headers.get('retry-after')
      let delayMs
      if (ra) {
        const sec = Number(ra)
        if (Number.isFinite(sec)) {
          delayMs = Math.max(0, sec * 1000)
        } else {
          // HTTP-date fallback
          const when = Date.parse(ra)
          if (!Number.isNaN(when)) delayMs = Math.max(0, when - Date.now())
        }
      }
      // Exponential backoff if no Retry-After
      if (delayMs === undefined) {
        const backoff = RL.baseDelayMs * 2 ** (tries429 - 1)
        const jitter = Math.floor(Math.random() * 250)
        delayMs = Math.min(RL.maxDelayMs, backoff + jitter)
      }

      console.warn(
        `[429] retry ${tries429}/${RL.maxRetries429} in ${delayMs}ms → ${method} ${url}`
      )
      await new Promise(r => setTimeout(r, delayMs))
      // Next loop iteration
      continue
    }

    // 5xx — transient server errors
    if (status >= 500 && status <= 599) {
      if (tries5xx >= RL.maxRetries5xx) {
        throw new Error(
          `${method} ${url} → ${status} (exhausted ${RL.maxRetries5xx} retries) ${text}`
        )
      }
      tries5xx++
      const backoff = RL.baseDelayMs * 2 ** (tries5xx - 1)
      const jitter = Math.floor(Math.random() * 250)
      const delayMs = Math.min(RL.maxDelayMs, backoff + jitter)
      console.warn(
        `[${status}] retry ${tries5xx}/${RL.maxRetries5xx} in ${delayMs}ms → ${method} ${url}`
      )
      await new Promise(r => setTimeout(r, delayMs))
      continue
    }

    // Other 4xx — do not retry
    throw new Error(`${method} ${url} → ${status} ${res.statusText} ${text}`)
  }
}

function ghlHeaders () {
  if (!opt.ghl.key) throw new Error('Missing TOKEN')
  return {
    Authorization: `Bearer ${opt.ghl.key}`,
    Version: opt.ghl.version,
    Accept: 'application/json'
  }
}

// --- GHL note ops -----------------------------------------------------------
async function listNotes (contactId) {
  const url = `${opt.ghl.base}/contacts/${encodeURIComponent(contactId)}/notes`
  const res = await http('GET', url, { headers: ghlHeaders() })
  return res.json()
}

async function deleteNote (contactId, noteId) {
  const url = `${opt.ghl.base}/contacts/${encodeURIComponent(
    contactId
  )}/notes/${encodeURIComponent(noteId)}`
  if (opt.dryRun) {
    console.log(`[dry-run] DELETE ${url}`)
    return { dryRun: true }
  }
  const res = await http('DELETE', url, { headers: ghlHeaders() })
  return res.status === 204 ? { ok: true } : res.json()
}

async function createNote (contactId, body) {
  const url = `${opt.ghl.base}/contacts/${encodeURIComponent(contactId)}/notes`
  const payload = { body }
  if (opt.dryRun) {
    console.log(`[dry-run] POST ${url}\n  body:\n${body}`)
    return { dryRun: true }
  }
  const res = await http('POST', url, { headers: ghlHeaders(), json: payload })
  return res.json()
}

// exact matcher requested
const TARGET_BAD_BODY = 'Proposal Link:\n\nnull'

function buildNewBody (einsteinUrl) {
  return `Proposal Link:\n\n ${einsteinUrl}`
}

function extractProposalUrl (body) {
  if (typeof body !== 'string') return null
  // Normalize line endings and match "Proposal Link:" followed by a blank line, then a URL
  const text = body.replace(/\r/g, '')
  const m = text.match(/^Proposal Link\s*:\s*\n\s*\n\s*(\S+)/i)
  return m ? m[1].trim() : null
}

function normalizeUrl (u) {
  if (!u) return ''
  // Trim, drop trailing slash, collapse multiple slashes in protocol delimiter edge cases
  let x = u.trim()
  // keep protocol+host as-is; just trim a single trailing slash on the full string
  if (x.length > 1 && x.endsWith('/')) x = x.slice(0, -1)
  return x
}

// --- Supabase view loader (optional) ----------------------------------------
async function loadRowsFromView () {
  if (!opt.supabase.url || !opt.supabase.key) {
    throw new Error(
      'To use --fromView, set SUPABASE_URL and SUPABASE_SERVICE_ROLE (or anon) env vars.'
    )
  }
  // Use PostgREST directly
  const url = `${opt.supabase.url}/rest/v1/${opt.supabase.view}?select=einstein_url,ghl_contact_id,ghl_opportunity_id,fact_id`
  const res = await fetch(url, {
    headers: {
      apikey: opt.supabase.key,
      Authorization: `Bearer ${opt.supabase.key}`,
      Accept: 'application/json'
    }
  })
  if (!res.ok)
    throw new Error(
      `Supabase view fetch failed: ${res.status} ${await res.text()}`
    )
  const data = await res.json()
  // Filter only rows with ghl_contact_id present
  return data.filter(r => r.ghl_contact_id)
}

// --- Worker for a single contact -------------------------------------------
async function processOne ({
  contactId,
  einsteinUrl,
  fact_id,
  ghl_opportunity_id
}) {
  const tag = `[contact:${contactId} fact:${fact_id ?? 'n/a'} opp:${
    ghl_opportunity_id ?? 'n/a'
  }]`
  try {
    const list = await listNotes(contactId)
    const notes = Array.isArray(list?.notes)
      ? list.notes
      : list?.notes?.data || list?.data || []
    const bad = notes.find(n => n?.bodyText === TARGET_BAD_BODY)
    console.log(notes)

    if (bad) {
      console.log(`${tag} Found bad note → id=${bad.id}`)
      await deleteNote(contactId, bad.id)
      console.log(`${tag} Deleted bad note → id=${bad.id}`)
    } else {
      console.log(`${tag} Bad note not found (skipping delete)`)
    }

    if (notes.length === 0) {
      console.log(`${tag} No notes found for this contact. (creating new note)`)
    }

    if (!einsteinUrl) {
      console.log(`${tag} No einstein_url → skipping create`)
      return { ok: true, created: false, code: 'skipped_missing_einstein_url' }
    }

    const newBody = buildNewBody(einsteinUrl)
    const dup = notes.find(n => {
      const url = extractProposalUrl(n?.body)
      if (!url) return false
      return normalizeUrl(url) === normalizeUrl(einsteinUrl)
    })
    if (dup) {
      console.log(
        `${tag} Proper proposal link already exists (skipping create)   `
      )
      return { ok: true, created: false, code: 'already_exists' }
    }

    const created = await createNote(contactId, newBody)
    console.log(
      `${tag} Created replacement note`,
      created?.id ? `id=${created.id}` : ''
    )
    return { ok: true, created: true, code: 'created' }
  } catch (e) {
    console.error(`${tag} ERROR:`, e.message)
    return { ok: false, created: false, code: 'failed', error: e.message }
  }
}

// --- Simple concurrency limiter --------------------------------------------
function pLimit (n) {
  let active = 0
  const queue = []
  const next = () => {
    active--
    if (queue.length) queue.shift()()
  }
  return fn =>
    new Promise((resolve, reject) => {
      const run = async () => {
        active++
        try {
          resolve(await fn())
        } catch (e) {
          reject(e)
        } finally {
          next()
        }
      }
      if (active < n) run()
      else queue.push(run)
    })
}

// --- Main -------------------------------------------------------------------
;(async function main () {
  // Single-contact test mode
  if (!opt.fromView) {
    if (!opt.contactId) {
      console.error('Provide --contactId for single test, or use --fromView.')
      process.exit(1)
    }
    const payload = {
      contactId: opt.contactId,
      einsteinUrl: opt.einsteinUrl // optional but recommended
    }
    const res = await processOne(payload)
    if (!res.ok) process.exit(2)
    return
  }

  // Batch mode from the view
  const rows = await loadRowsFromView()
  console.log(`Loaded ${rows.length} contacts from view.`)
  const limit = pLimit(opt.concurrency)
  const tasks = rows.map(r =>
    limit(() =>
      processOne({
        contactId: r.ghl_contact_id,
        einsteinUrl: r.einstein_url,
        fact_id: r.fact_id,
        ghl_opportunity_id: r.ghl_opportunity_id
      })
    )
  )
  const results = await Promise.allSettled(tasks)

  const stats = {
    total_processed: 0,
    new_proposal_links: 0, // created
    succeeded: 0, // ok true (created or already exists or other ok)
    failed: 0, // ok false
    not_given_new_proper_one: 0 // already_exists
  }

  for (const r of results) {
    if (r.status !== 'fulfilled') {
      stats.failed++
      continue
    }
    const v = r.value
    stats.total_processed++
    if (v.ok) {
      stats.succeeded++
      if (v.code === 'created') stats.new_proposal_links++
      if (v.code === 'already_exists') stats.not_given_new_proper_one++
    } else {
      stats.failed++
    }
  }

  console.log(
    `Done. ok=${stats.succeeded} created=${stats.new_proposal_links} already_have_proper=${stats.not_given_new_proper_one} fail=${stats.failed}`
  )

  // write CSV
  const headers = [
    'total_processed',
    'new_proposal_links',
    'succeeded',
    'failed',
    'not_given_new_proper_one'
  ]

  const row = [
    stats.total_processed,
    stats.new_proposal_links,
    stats.succeeded,
    stats.failed,
    stats.not_given_new_proper_one
  ]

  const csv = `${headers.join(',')}\n${row.join(',')}\n`

  const defaultName = `notes_fix_summary_${new Date()
    .toISOString()
    .replace(/[:.]/g, '-')}.csv`
  const outPath = resolvePath(opt.csvPathArg || env.CSV_PATH || defaultName)
  writeFileSync(outPath, csv, 'utf8')
  console.log(`CSV summary written to: ${outPath}`)
})()
