// analytics
const start = performance.now()

import { createClient } from '@supabase/supabase-js'
import dotenv from 'dotenv'
import readline from 'readline'
dotenv.config()

// ===== SECRETS =====
const SUPABASE_URL = process.env.SUPABASE_URL
const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY
const BASE_URL = process.env.BASE_URL
const API_VERSION = process.env.API_VERSION
const TOKEN = process.env.TOKEN
const LOCATION_ID = process.env.LOCATION_ID
const EMAIL = process.env.SUPABASE_SUPERADMIN_EMAIL
const PASSWORD = process.env.SUPABASE_SUPERADMIN_PASSWORD
// ===================

const HEADERS = {
  Authorization: `Bearer ${TOKEN}`,
  'Content-Type': 'application/json',
  Accept: 'application/json',
  Version: API_VERSION
}

const VERBOSE_ERRORS = process.env.VERBOSE_ERRORS === '1'
const SUPABASE_CHUNK_SIZE = Number(process.env.SUPABASE_CHUNK_SIZE ?? 5000) // per-page rows

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
async function ghlFetch(url, opts) {
  await rateLimit()
  return fetch(url, opts)
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

// ===== DB helpers =====
const getOpportunityExtraInfo = async ({ rating, stage, publisher }) => {
  const { data, error } = await supabase.rpc(
    'get_pipeline_stage_and_do_round_robin',
    { p_rating: rating, p_stage: stage, p_publisher: publisher }
  )
  if (error) throw error
  return data[0]
}

// ===== Server-side paginated fetch via new RPC =====
// Expects: public.get_unassigned_contact_details_page(p_offset integer, p_limit integer)
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

const updateFactContactTable = async ({ uuid, contactId, assignedUserId, number }) => {
  const { error } = await supabase.rpc('contact_only_update_last_assigned_at', {
    p_assigned_user_id: assignedUserId,
    p_fact_id: uuid,
    p_contact_id: contactId
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
// CHANGED: skip optional notes when null/empty/"Unprovided"
function buildOptionalNoteBody(notes) {
  const s = toSafeString(notes)
  if (!s || /^unprovided$/i.test(s)) return ''
  return truncateNote(s)
}

// ===== GHL API with hardened error handling =====
let lastWindowRemaining = null
let lastDailyRemaining = null
let lastDailyLimit = null

function captureRateHeaders(res) {
  lastWindowRemaining = res.headers.get('X-RateLimit-Remaining')
  lastDailyRemaining = res.headers.get('X-RateLimit-Daily-Remaining')
  lastDailyLimit = res.headers.get('X-RateLimit-Limit-Daily')
}

const createGhlContact = async payload => {
  const URL = `${BASE_URL}/contacts`
  const res = await ghlFetch(URL, {
    body: JSON.stringify(payload),
    headers: HEADERS,
    method: 'POST'
  })
  const bodyText = await res.text()
  captureRateHeaders(res)
  if (!res.ok) throw new Error(`Create contact failed ${res.status} ${res.statusText}: ${bodyText}`)
  let json
  try { json = JSON.parse(bodyText) } catch { throw new Error(`Create contact returned non-JSON: ${bodyText}`) }
  if (!json?.contact?.id) throw new Error(`Create contact missing id: ${bodyText}`)
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
  captureRateHeaders(res)
  if (!res.ok) throw new Error(`Create note failed ${res.status} ${res.statusText}: ${bodyText}`)
  try { return JSON.parse(bodyText) } catch { throw new Error(`Create note returned non-JSON: ${bodyText}`) }
}

// ---- Logging helpers (logging only) ----
function briefErrorMessage(e, max = 180) {
  const m = String(e?.message || e || '')
  const one = m.replace(/\s+/g, ' ').trim()
  return one.length > max ? one.slice(0, max) + '…' : one
}
function isDuplicateError(e) {
  return /\bduplicated contacts\b/i.test(String(e?.message || e || ''))
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
let i = 1
let processedOk = 0
let processedFail = 0
let contact_response
let contact_payload_error
let current_fact_id

for (const supabase_contact of supabase_bulk_data) {
  try {
    current_fact_id = supabase_contact.fact_id
    if (
      supabase_contact.ghl_contact_id === 'DUPLICATE' &&
      supabase_contact.ghl_opportunity_id === 'DUPLICATE'
    ) {
      const left = total - i
      console.log(`[SKIP] #${i}/${total} duplicate fact_id=${supabase_contact.fact_id} left=${left}`)
      i++
      continue
    }

    let { assigned_user_id } = await getOpportunityExtraInfo({
      rating: '1. Hot',
      stage: 'Proposal Sent',
      publisher: supabase_contact.publisher ?? ' '
    })
    assigned_user_id = supabase_contact.lead_owner || assigned_user_id

    const contact_custom_fields = [
      { id: 'AMgJg4wIu7GKV02OGxD3', key: 'publisher', field_value: supabase_contact.publisher },
      { id: 'fFWUJ9OFbYqVJjwjQGP', key: 'timezone_c', field_value: supabase_contact.time_zone ?? 'Unprovided' },
      { id: 'ZXykBROLtnEh5A5vaT2B', key: 'active_campaigns_c', field_value: [] },
      { id: 'IjmRpmQlwHiJjGnTLptG', key: 'contact_source_detail', field_value: supabase_contact.lead_source === '' ? 'Unprovided' : supabase_contact.lead_source },
      { id: 'JMwy9JsVRTTzg4PDQnhk', key: 'source_detail_value_c', field_value: supabase_contact.website_landing_page ?? 'Unprovided' }
    ]

    let contact_payload = {
      firstName: supabase_contact.first_name ?? 'Unprovided',
      lastName: supabase_contact.last_name ?? 'Unprovided',
      name: `${supabase_contact.first_name} ${supabase_contact.last_name}` ?? 'Unprovided',
      locationId: `${LOCATION_ID}`,
      address1: supabase_contact.address_line1 ?? 'Unprovided',
      city: supabase_contact.city ?? 'Unprovided',
      state: supabase_contact.state_region ?? 'Unprovided',
      postalCode: supabase_contact.postal_code ?? 'Unprovided',
      website: supabase_contact.website_landing_page ?? 'Unprovided',
      timezone: supabase_contact.time_zone ?? 'Unprovided',
      dnd: supabase_contact.opt_out_of_email ?? false,
      customFields: contact_custom_fields,
      source: supabase_contact.source ?? 'Unprovided',
      country: (!supabase_contact.country || supabase_contact.country === 'Unprovided') ? 'US' : supabase_contact.country,
      assignedTo: assigned_user_id
    }
    contact_payload_error = contact_payload

    contact_payload['dndSettings'] = {
      Email: { status: supabase_contact.opt_out_of_email ? 'active' : 'inactive', message: '', code: '' }
    }
    if (supabase_contact.email && supabase_contact.email !== 'Unprovided') contact_payload['email'] = supabase_contact.email
    if (supabase_contact.phone_number && supabase_contact.phone_number !== 'Unprovided') {
      contact_payload['phone'] = String(supabase_contact.phone_number).replace(/[^\d+]/g, '')
    }

    let contact_id = supabase_contact.contact_id
    if (!contact_id) {
      const contactResponseData = await createGhlContact(contact_payload)
      contact_response = contactResponseData
      contact_id = contactResponseData.contact.id
    }

    // --- Notes ---
    const einsteinBody = buildEinsteinBody(supabase_contact.einstein_url)
    await createGhlNote({ userId: 'JERtBepiajyLX1Pghv3T', body: einsteinBody }, contact_id)

    const optionalBody = buildOptionalNoteBody(supabase_contact.notes)
    if (optionalBody) {
      await createGhlNote({ userId: 'JERtBepiajyLX1Pghv3T', body: optionalBody }, contact_id)
    }

    // success log
    processedOk++
    const left = total - i
    console.log(
      `[OK] #${i}/${total} fact_id=${supabase_contact.fact_id} left=${left} ` +
      `window_rem=${lastWindowRemaining} daily=${lastDailyRemaining ?? 'n/a'}/${lastDailyLimit ?? 'n/a'}`
    )

    // Supabase update
    console.log(
      await updateFactContactTable({
        uuid: supabase_contact.fact_id,
        assignedUserId: assigned_user_id,
        contactId: contact_id,
        number: i
      })
    )

  } catch (error) {
    processedFail++
    const left = total - i
    if (isDuplicateError(error)) {
      console.warn(
        `[DUP] #${i}/${total} left=${left} :: duplicate found: ${supabase_contact.first_name} ${supabase_contact.last_name} (${supabase_contact.email}), skipping`
      )
    } else {
      console.error(
        `[ERR] #${i}/${total} fact_id=${supabase_contact?.fact_id ?? 'unknown'} left=${left} :: ${briefErrorMessage(error)}`
      )
      if (VERBOSE_ERRORS) console.log('payload=', contact_payload_error)
    }
    if (contact_response?.message === 'This location does not allow duplicated contacts.') {
      try {
        await supabase.rpc('contact_only_mark_fact_contact_duplicate', { p_fact_id: current_fact_id })
      } catch (e) {
        console.error('[ERR] failed to mark duplicate in Supabase:', e?.message || e)
      }
    }
  } finally {
    if (i % 100 === 0) {
      console.log(`[PROG] ${i}/${total} processed | ok=${processedOk} fail=${processedFail} ` +
                  `window_rem=${lastWindowRemaining} daily=${lastDailyRemaining ?? 'n/a'}/${lastDailyLimit ?? 'n/a'}`)
    }
    i++
  }
}

await supabase.auth.signOut?.()
const end = performance.now()
console.log(
  `[DONE] total=${total} ok=${processedOk} fail=${processedFail} ` +
  `elapsed_ms=${Math.round(end - start)} window_rem=${lastWindowRemaining} ` +
  `daily=${lastDailyRemaining ?? 'n/a'}/${lastDailyLimit ?? 'n/a'}`
)