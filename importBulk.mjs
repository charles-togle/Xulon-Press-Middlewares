// analytics
const start = performance.now()

import { createClient } from '@supabase/supabase-js'
import dotenv from 'dotenv'
import readline from 'readline'
import fs from 'fs'
dotenv.config()

// ===== SECRETS =====
const SUPABASE_URL = process.env.SUPABASE_URL
const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY
const BASE_URL = process.env.BASE_URL || 'https://services.leadconnectorhq.com'
const API_VERSION = process.env.API_VERSION || '2021-07-28'
const TOKEN = process.env.TOKEN
const LOCATION_ID = process.env.LOCATION_ID
const EMAIL = process.env.SUPABASE_SUPERADMIN_EMAIL
const PASSWORD = process.env.SUPABASE_SUPERADMIN_PASSWORD
// ===================

const HEADERS = {
  Authorization: `Bearer ${TOKEN}`,
  'Content-Type': 'application/json',
  Accept: 'application/json',
  Version: API_VERSION,
  'User-Agent': 'vertexlabs-ghl-importer/1.0'
}

const VERBOSE_ERRORS = process.env.VERBOSE_ERRORS === '1'
const SUPABASE_CHUNK_SIZE = Number(process.env.SUPABASE_CHUNK_SIZE ?? 5000)
const CONCURRENCY = Number(process.env.CONCURRENCY ?? 12)

const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY)

// ---- Auth ----
console.log('logging in...')
const { error: authError } = await supabase.auth.signInWithPassword({
  email: EMAIL,
  password: PASSWORD
})
if (authError) {
  console.error('Error authenticating user: ', authError)
  process.exit(0)
}

// ===== Burst limiter (100 req / 10s) =====
const BURST_MAX = 100
const BURST_WINDOW = 10_000
let timestamps = []
async function rateLimit() {
  const now = Date.now()
  timestamps = timestamps.filter(t => now - t < BURST_WINDOW)
  if (timestamps.length >= BURST_MAX) {
    const wait = BURST_WINDOW - (now - timestamps[0]) + 5
    await new Promise(r => setTimeout(r, wait))
    return rateLimit()
  }
  timestamps.push(now)
}

// ===== Error sink + CSV =====
const ERRORS = []
function parseStatus(e) {
  const m = String(e?.message || '').match(/\b(\d{3})\b/)
  return m ? Number(m[1]) : ''
}
function csvEscape(v) {
  const s = String(v ?? '')
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
}
function recordError({ ts = new Date().toISOString(), idx, row, kind, error, extra }) {
  ERRORS.push({
    ts,
    idx,
    fact_id: row?.fact_id ?? '',
    email_raw: row?.email ?? '',
    kind,
    status: parseStatus(error),
    message: String(error?.message || error || ''),
    extra: extra ?? ''
  })
}
function writeErrorCsv() {
  const name = `errors_${new Date().toISOString().replace(/[:.]/g, '-')}.csv`
  const headers = ['ts','idx','fact_id','email_raw','kind','status','message','extra']
  const lines = [headers.join(',')]
  for (const o of ERRORS) lines.push(headers.map(h => csvEscape(o[h])).join(','))
  fs.writeFileSync(name, lines.join('\n'))
  console.log(`[ERROR CSV] wrote ${ERRORS.length} rows -> ${name}`)
}
process.on('SIGINT', () => {
  console.log('\n[INTERRUPT] Writing error CSV…')
  try { writeErrorCsv() } catch (e) { console.error(e) } finally { process.exit(1) }
})
process.on('SIGTERM', () => {
  console.log('\n[TERM] Writing error CSV…')
  try { writeErrorCsv() } catch (e) { console.error(e) } finally { process.exit(0) }
})

// ===== Rate headers (updated by ghlFetch) =====
let lastWindowRemaining = null
let lastDailyRemaining = null
let lastDailyLimit = null
function captureRateHeaders(res) {
  lastWindowRemaining = res.headers.get('X-RateLimit-Remaining')
  lastDailyRemaining = res.headers.get('X-RateLimit-Daily-Remaining')
  lastDailyLimit = res.headers.get('X-RateLimit-Limit-Daily')
}

// ===== URL enforcement =====
function assertApiUrl(u) {
  if (!String(u).startsWith(BASE_URL)) {
    throw new Error(`Invalid API url: ${u}`)
  }
}

// ===== 429/5xx-aware fetch with HTML guard =====
async function ghlFetch(url, opts, attempt = 0) {
  assertApiUrl(url)
  await rateLimit()

  const res = await fetch(url, {
    ...opts,
    headers: { ...HEADERS, ...(opts?.headers || {}) },
    redirect: 'manual',
    keepalive: true
  })
  captureRateHeaders(res)

  const ct = res.headers.get('content-type') || ''
  const isHtml = ct.includes('text/html')
  if (isHtml) {
    const body = await res.text()
    const err = new Error(`Non-JSON HTML response ${res.status}; probable redirect/Cloudflare`)
    recordError({ idx: -1, row: {}, kind: 'html_response', error: err, extra: body.slice(0, 200) })
    throw err
  }

  const transient = res.status === 429 || (res.status >= 500 && res.status <= 599)
  if (!res.ok && transient && attempt < 5) {
    const ra = Number(res.headers.get('retry-after')) || 2
    const backoff = Math.min(15, ra * Math.pow(2, attempt)) * 1000
    const jitter = Math.floor(Math.random() * 400)
    await new Promise(r => setTimeout(r, backoff + jitter))
    return ghlFetch(url, opts, attempt + 1)
  }

  return res
}

// ===== Prompt for limit (number or "all") =====
async function askLimit() {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout })
  const question = (q) => new Promise(res => rl.question(q, res))
  const answer = await question(`How many contacts to fetch? (Enter a number or "all"): `)
  rl.close()
  if (answer.trim().toLowerCase() === 'all') return null
  const n = parseInt(answer, 10)
  return Number.isFinite(n) && n > 0 ? n : 1000
}

// ===== Database helpers =====
const getOpportunityExtraInfo = async ({ rating, stage, publisher }) => {
  const { data, error } = await supabase.rpc(
    'get_pipeline_stage_and_do_round_robin',
    { p_rating: rating, p_stage: stage, p_publisher: publisher }
  )
  if (error) throw error
  return data[0]
}

// Keyset or paginated fetch to avoid huge payloads
const getContactBulkData = async ({ limit }) => {
  const rows = []
  let offset = 0
  let remaining = Number.isFinite(limit) ? limit : Infinity

  for (;;) {
    const take = Math.min(SUPABASE_CHUNK_SIZE, remaining)
    console.log(`[FETCH] rpc offset=${offset} limit=${take}`)
    const { data, error } = await supabase.rpc(
      'get_unassigned_contact_details_page',
      { p_offset: offset, p_limit: take }
    )
    if (error) throw error
    if (!data?.length) break

    rows.push(...data)
    if (Number.isFinite(limit) && rows.length >= limit) break

    offset += data.length
    remaining = Number.isFinite(limit) ? (limit - rows.length) : Infinity
  }

  return Number.isFinite(limit) ? rows.slice(0, limit) : rows
}

const updateFactContactTable = async ({ uuid, contactId, opportunityId, assignedUserId, number }) => {
  const { error } = await supabase.rpc('update_last_assigned_at', {
    p_assigned_user_id: assignedUserId,
    p_fact_id: uuid,
    p_contact_id: contactId,
    p_opportunity_id: opportunityId
  })
  if (error) throw error
  return `Contact #${number}: Successfully imported contact ${uuid} to go high level`
}


// ===== Note sanitizers =====
const NOTE_MAX = 65000
function toSafeString(x) {
  if (typeof x !== 'string') return ''
  return x.replace(/\0/g, '').trim()
}
function truncateNote(s) {
  return s.length > NOTE_MAX ? s.slice(0, NOTE_MAX - 1) : s
}
function buildEinsteinBody(url) {
  const base = 'Proposal Link:'
  const val = toSafeString(url)
  return truncateNote(val ? `${base}\n\n${val}` : `${base} N/A`)
}
function buildOptionalNoteBody(notes) {
  const s = toSafeString(notes)
  if (!s || /^unprovided$/i.test(s)) return ''
  return truncateNote(s)
}

// ===== Country & email normalization =====
function normCountry(v) {
  const s = String(v ?? '').trim()
  if (!s || /^unprovided$/i.test(s)) return 'US'
  const map = {
    'usa': 'US', 'u.s.a.': 'US', 'u.s.': 'US', 'us': 'US',
    'united states': 'US', 'united states of america': 'US', 'america': 'US'
  }
  const hit = map[s.toLowerCase()]
  if (hit) return hit
  if (/^[A-Za-z]{2}$/.test(s)) return s.toUpperCase()
  return 'US'
}
function normalizeEmail(raw) {
  if (typeof raw !== 'string') return null
  let s = raw.trim().replace(/^"+|"+$/g, '').replace(/\s+/g, '')
  s = s.replace(/\.@/, '@')
  const m = s.match(/^([^@]+)@([^@]+)$/)
  if (!m) return null
  const local = m[1], domain = m[2]
  if (local.startsWith('.') || local.endsWith('.')) return null
  if (local.includes('..')) return null
  if (!/^[A-Za-z0-9.!#$%&'*+/=?^_`{|}~-]+$/.test(local)) return null
  if (!/^[A-Za-z0-9-]+(\.[A-Za-z0-9-]+)+$/.test(domain)) return null
  return s.toLowerCase()
}

// ===== GHL API REQUESTS (with retry and rate capture) =====
const createGhlContact = async payload => {
  const URL = `${BASE_URL}/contacts/`
  const res = await ghlFetch(URL, {
    body: JSON.stringify(payload),
    headers: HEADERS,
    method: 'POST'
  })
  const bodyText = await res.text()
  let json
  try { json = JSON.parse(bodyText) } catch { json = null }

  if (!res.ok) {
    // Duplicate handling: if API returns duplicate with meta.contactId
    if (res.status === 400 && json?.message && /duplicated contacts/i.test(json.message) && json?.meta?.contactId) {
      return { duplicate: true, contact: { id: json.meta.contactId } }
    }
    throw new Error(`Create contact failed ${res.status} ${res.statusText}: ${bodyText}`)
  }
  if (!json?.contact?.id) throw new Error(`Create contact missing id: ${bodyText}`)
  return json
}

async function createGhlContactSafe(payload) {
  try {
    return await createGhlContact(payload)
  } catch (e) {
    if (/country must be valid/i.test(String(e?.message || e || '')) && payload.country !== 'US') {
      return await createGhlContact({ ...payload, country: 'US' })
    }
    throw e
  }
}

const createGhlOpportunity = async (payload) => {
  const URL = `${BASE_URL}/opportunities/`
  const res = await ghlFetch(URL, {
    body: JSON.stringify(payload),
    headers: HEADERS,
    method: 'POST'
  })
  const bodyText = await res.text()
  let json
  try { json = JSON.parse(bodyText) } catch { json = null }
  if (!res.ok) throw new Error(`Create opportunity failed ${res.status} ${res.statusText}: ${bodyText}`)
  if (!json?.opportunity?.id) throw new Error(`Create opportunity missing id: ${bodyText}`)
  return json
}

const createGhlNote = async (payload, contactId) => {
  const URL = `${BASE_URL}/contacts/${contactId}/notes/`
  const res = await ghlFetch(URL, {
    body: JSON.stringify(payload),
    headers: HEADERS,
    method: 'POST'
  })
  const bodyText = await res.text()
  let json
  try { json = JSON.parse(bodyText) } catch { json = null }
  if (!res.ok) throw new Error(`Create note failed ${res.status} ${res.statusText}: ${bodyText}`)
  return json
}

// ---- Logging helpers ----
function briefErrorMessage(e, max = 180) {
  const m = String(e?.message || e || '')
  const one = m.replace(/\s+/g, ' ').trim()
  return one.length > max ? one.slice(0, max) + '…' : one
}
function isDuplicateError(e) {
  return /\bduplicated contacts\b/i.test(String(e?.message || e || ''))
}

// ===== Concurrency semaphore =====
function createSemaphore(max) {
  let active = 0, queue = []
  const run = () => {
    if (active >= max || !queue.length) return
    active++
    const { fn, resolve, reject } = queue.shift()
    Promise.resolve()
      .then(fn)
      .then(v => { active--; resolve(v); run() },
            e => { active--; reject(e); run() })
  }
  return fn => new Promise((resolve, reject) => { queue.push({ fn, resolve, reject }); run() })
}
const schedule = createSemaphore(CONCURRENCY)

// ===== Per-contact task (full flow) =====
async function processOneRow(row, idx, total) {
  let { assigned_user_id } = await getOpportunityExtraInfo({
    rating: '1. Hot',
    stage: 'Proposal Sent',
    publisher: row.publisher ?? ' '
  })
  assigned_user_id = row.lead_owner || assigned_user_id

  // Contact custom fields
  const contact_custom_fields = [
    { id: 'AMgJg4wIu7GKV02OGxD3', key: 'publisher', field_value: row.publisher },
    { id: 'fFWUJ9OFbYBqVJjwjQGP', key: 'timezone_c', field_value: row.time_zone ?? 'Unprovided' },
    { id: 'ZXykBROLtnEh5A5vaT2B', key: 'active_campaigns_c', field_value: [] },
    { id: 'IjmRpmQlwHiJjGnTLptG', key: 'contact_source_detail', field_value: row.lead_source === '' ? 'Unprovided' : row.lead_source },
    { id: 'JMwy9JsVRTTzg4PDQnhk', key: 'source_detail_value_c', field_value: row.website_landing_page ?? 'Unprovided' }
  ]

  // Opportunity custom fields
  const opportunity_custom_fields = [
    { id: 'ggsTQrS88hJgLI5J5604', key: 'publisher', field_value: row.publisher },
    { id: 'gsFwmLo8XyzCjIoXxXYQ', key: 'timezone', field_value: row.time_zone },
    { id: '4P0Yd0fLzOfns3opxTGo', key: 'active_or_past_author', field_value: row.is_author ? 'Yes' : 'No' },
    { id: '5wlgHZzuWLyr918dMh7y', key: 'genre', field_value: Array.isArray(row.genre) ? (row.genre?.[0] ?? 'Unprovided') : (row.genre ?? 'Unprovided') },
    { id: 'cG5oYGyyKmEWwzn7y8HA', key: 'writing_process', field_value: row.writing_status },
    { id: 'BOGtp8xLezwurePxIkNE', key: 'outreach_attempt', field_value: String(row.outreach_attempt) },
    { id: '5lDyHBJDAukD5YM7M4WG', key: 'proposal_link', field_value: row.einstein_url },
    { id: 'aOH64ZsyJ5blAZtf9IxK', key: 'book_description', field_value: row.book_description },
    { id: 'uUEENCZJBnr0mjbuPe98', key: 'pipeline_backup', field_value: row.rating },
    { id: 'UAjLmcYVz1hdI4sPVKSr', key: 'source_detail_value', field_value: row.website_landing_page ?? 'Unprovided' }
  ]

  // Build contact payload
  const payload = {
    firstName: row.first_name ?? 'Unprovided',
    lastName: row.last_name ?? 'Unprovided',
    name: `${row.first_name ?? ''} ${row.last_name ?? ''}`.trim() || 'Unprovided',
    locationId: `${LOCATION_ID}`,
    address1: row.address_line1 ?? 'Unprovided',
    city: row.city ?? 'Unprovided',
    state: row.state_region ?? 'Unprovided',
    postalCode: row.postal_code ?? 'Unprovided',
    website: row.website_landing_page ?? 'Unprovided',
    timezone: row.time_zone ?? 'Unprovided',
    dnd: row.opt_out_of_email ?? false,
    customFields: contact_custom_fields,
    source: row.source ?? 'Unprovided',
    country: normCountry(row.country),
    assignedTo: assigned_user_id,
    dndSettings: {
      Email: { status: row.opt_out_of_email ? 'active' : 'inactive', message: '', code: '' }
    }
  }

  const cleanedEmail = normalizeEmail(row.email)
  if (cleanedEmail) payload.email = cleanedEmail
  else if (row.email && row.email !== 'Unprovided') {
    recordError({ idx, row, kind: 'invalid_email', error: new Error('Invalid email syntax'), extra: row.email })
  }

  if (row.phone_number && row.phone_number !== 'Unprovided') {
    payload.phone = String(row.phone_number).replace(/[^\d+]/g, '')
  }

  // Create or reuse contact
  let contact_id = row.ghl_contact_id || row.contact_id
  if (!contact_id) {
    const createRes = await createGhlContactSafe(payload)
    contact_id = createRes.contact.id  // handles duplicate meta.contactId as well
  }

  // Notes
  const einsteinBody = buildEinsteinBody(row.einstein_url)
  await createGhlNote({ userId: 'JERtBepiajyLX1Pghv3T', body: einsteinBody }, contact_id)
  const optionalBody = buildOptionalNoteBody(row.notes)
  if (optionalBody) {
    await createGhlNote({ userId: 'JERtBepiajyLX1Pghv3T', body: optionalBody }, contact_id)
  }

  // Opportunity
  const oppPayload = {
    pipelineId: row.pipeline_id,
    locationId: `${LOCATION_ID}`,
    name: `${row.first_name ?? ''} ${row.last_name ?? ''}`.trim() || 'Unprovided',
    pipelineStageId: row.stage_id,
    status: 'open',
    contactId: contact_id,
    assignedTo: assigned_user_id,
    customFields: opportunity_custom_fields,
    source: row.source ?? 'Unprovided'
  }

  const oppRes = await createGhlOpportunity(oppPayload)
  const opportunityId = oppRes.opportunity.id

  // Update fact record
  console.log(
    await updateFactContactTable({
      uuid: row.fact_id,
      assignedUserId: assigned_user_id,
      contactId: contact_id,
      opportunityId,
      number: idx
    })
  )

  const left = total - idx
  console.log(
    `[OK] #${idx}/${total} fact_id=${row.fact_id} left=${left} ` +
    `window_rem=${lastWindowRemaining} daily=${lastDailyRemaining ?? 'n/a'}/${lastDailyLimit ?? 'n/a'}`
  )
}

// ===== PROCESS =====
const chosenLimit = await askLimit()

console.log('starting bulk fetch…')
let supabase_bulk_data
try {
  supabase_bulk_data = await getContactBulkData({ limit: chosenLimit })
} catch (error) {
  console.error('Error fetching bulk contact data from Supabase:', error)
  process.exit(1)
}
console.log(`fetched ${supabase_bulk_data.length} records`)

if (!Array.isArray(supabase_bulk_data) || supabase_bulk_data.length === 0) {
  console.log('No eligible records — every record already imported. Ending process.')
  process.exit(0)
}

const total = supabase_bulk_data.length
let ok = 0, fail = 0, dup = 0

await Promise.allSettled(
  supabase_bulk_data.map((row, i) =>
    schedule(async () => {
      try {
        if (row.ghl_contact_id === 'DUPLICATE' && row.ghl_opportunity_id === 'DUPLICATE') {
          dup++
          if ((ok + fail + dup) % 10 === 0) {
            console.log(`[SKIP] #${i + 1}/${total} duplicate fact_id=${row.fact_id}`)
          }
          return
        }
        await processOneRow(row, i + 1, total)
        ok++
      } catch (error) {
        if (isDuplicateError(error)) {
          dup++
          console.warn(`[DUP] #${i + 1}/${total} :: duplicate ${row.first_name} ${row.last_name} (${row.email})`)
          try { await supabase.rpc('mark_fact_contact_duplicate', { p_fact_id: row.fact_id }) } catch {}
        } else {
          fail++
          recordError({ idx: i + 1, row, kind: 'api_error', error })
          console.error(`[ERR] #${i + 1}/${total} fact_id=${row?.fact_id ?? 'unknown'} :: ${briefErrorMessage(error)}`)
          if (VERBOSE_ERRORS) console.log('payload_fact_id=', row.fact_id)
        }
      } finally {
        const processed = ok + fail + dup
        if (processed % 100 === 0) {
          console.log(`[PROG] ${processed}/${total} processed | ok=${ok} fail=${fail} dup=${dup} ` +
                      `window_rem=${lastWindowRemaining} daily=${lastDailyRemaining ?? 'n/a'}/${lastDailyLimit ?? 'n/a'}`)
        }
      }
    })
  )
)

await supabase.auth.signOut?.()
writeErrorCsv()
const end = performance.now()
console.log(
  `[DONE] total=${total} ok=${ok} fail=${fail} dup=${dup} ` +
  `elapsed_ms=${Math.round(end - start)} window_rem=${lastWindowRemaining} ` +
  `daily=${lastDailyRemaining ?? 'n/a'}/${lastDailyLimit ?? 'n/a'}`
)
