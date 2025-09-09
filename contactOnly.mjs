//analytics
const start = performance.now()

import { createClient } from '@supabase/supabase-js'
import dotenv from 'dotenv'
import readline from 'readline'
import util from 'util'
dotenv.config()

//=====SECRETS===============================================================
const SUPABASE_URL = process.env.SUPABASE_URL
const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY
const BASE_URL = process.env.BASE_URL
const API_VERSION = process.env.API_VERSION
const TOKEN = process.env.TOKEN
const LOCATION_ID = process.env.LOCATION_ID
const EMAIL = process.env.SUPABASE_SUPERADMIN_EMAIL
const PASSWORD = process.env.SUPABASE_SUPERADMIN_PASSWORD
// ==========================================================================

const HEADERS = {
  Authorization: `Bearer ${TOKEN}`,
  'Content-Type': 'application/json',
  Accept: 'application/json',
  Version: API_VERSION
}

const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY)

// sign in
const { error } = await supabase.auth.signInWithPassword({
  email: EMAIL,
  password: PASSWORD
})
console.log('logging in...')
if (error) {
  console.error('Error authenticating user: ', error)
  process.exit(0)
}

// ===== Burst limiter =====
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

// ===== Helpers =====
async function askLimit() {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout })
  const question = (q) => new Promise(res => rl.question(q, res))
  const answer = await question(`How many contacts to fetch? (Enter a number or "all"): `)
  rl.close()
  if (answer.trim().toLowerCase() === 'all') return null
  const n = parseInt(answer, 10)
  return Number.isFinite(n) && n > 0 ? n : 1000
}

// ===== Database Request =====
const getOpportunityExtraInfo = async ({ rating, stage, publisher }) => {
  const { data, error } = await supabase.rpc(
    'get_pipeline_stage_and_do_round_robin',
    { p_rating: rating, p_stage: stage, p_publisher: publisher }
  )
  if (error) throw error
  return data[0]
}

const getContactBulkData = async ({ limit }) => {
  let q = supabase.rpc('get_unassigned_contact_details', {
    p_limit: limit ?? 1000000
  })
  if (limit) q = q.range(0, limit - 1)
  const { data, error } = await q
  if (error) throw error
  return data
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

// ===== GHL API =====
let dailyRemaining
let dailyLimit

const createGhlContact = async payload => {
  const URL = `${BASE_URL}/contacts`
  const response = await ghlFetch(URL, {
    body: JSON.stringify(payload),
    headers: HEADERS,
    method: 'POST'
  })
  console.log(`[RateLimit] Window remaining: ${response.headers.get('X-RateLimit-Remaining')}`)
  const contactInfo = await response.json()
  return contactInfo
}

const createGhlNote = async (payload, contactId) => {
  const URL = `${BASE_URL}/contacts/${contactId}/notes/`
  const response = await ghlFetch(URL, {
    body: JSON.stringify(payload),
    headers: HEADERS,
    method: 'POST'
  })
  dailyRemaining = response.headers.get('X-RateLimit-Daily-Remaining')
  dailyLimit = response.headers.get('X-RateLimit-Limit-Daily')
  console.log(`[RateLimit] Window remaining: ${response.headers.get('X-RateLimit-Remaining')}`)
  const note_info = await response.json()
  return note_info
}

// ===== PROCESS =====
const chosenLimit = await askLimit()
let supabase_bulk_data
try {
  supabase_bulk_data = await getContactBulkData({ limit: chosenLimit })
} catch (err) {
  console.error('Error fetching bulk contact data from Supabase:', err)
  process.exit(1)
}

if (!Array.isArray(supabase_bulk_data) || supabase_bulk_data.length === 0) {
  console.log('No eligible records — every record already imported. Ending process.')
  process.exit(0)
}

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
      console.log(`Contact #${i} is a duplicate: ${supabase_contact.first_name} ${supabase_contact.last_name}`)
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
      { id: 'fFWUJ9OFbYBqVJjwjQGP', key: 'timezone_c', field_value: supabase_contact.time_zone ?? 'Unprovided' },
      { id: 'ZXykBROLtnEh5A5vaT2B', key: 'active_campaigns_c', field_value: [] },
      { id: 'IjmRpmQlwHiJjGnTLptG', key: 'contact_source_detail', field_value: supabase_contact.lead_source || 'Unprovided' },
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
    if (supabase_contact.phone_number && supabase_contact.phone_number !== 'Unprovided') contact_payload['phone'] = supabase_contact.phone_number

    let contact_id = supabase_contact.contact_id
    if (!contact_id) {
      const contactResponseData = await createGhlContact(contact_payload)
      contact_response = contactResponseData
      contact_id = contactResponseData.contact.id
    }

    const einstein_notes_payload = { userId: 'JERtBepiajyLX1Pghv3T', body: `Proposal Link: \n\n ${supabase_contact.einstein_url}` }
    if (!supabase_contact.notes || supabase_contact.notes === 'Unprovided') {
      const notes_payload = { userId: 'JERtBepiajyLX1Pghv3T', body: supabase_contact.notes }
      await createGhlNote(notes_payload, contact_id)
    }
    await createGhlNote(einstein_notes_payload, contact_id)

    console.log(await updateFactContactTable({
      uuid: supabase_contact.fact_id,
      assignedUserId: assigned_user_id,
      contactId: contact_id,
      number: i
    }))
    processedOk++
  } catch (err) {
    processedFail++
    console.error(`Contact #${i}: Error processing ${supabase_contact?.fact_id ?? 'unknown'}:`, err)
    console.log(contact_payload_error)
    if (contact_response?.message === 'This location does not allow duplicated contacts.') {
      await supabase.rpc('contact_only_mark_fact_contact_duplicate', { p_fact_id: current_fact_id })
    }
  } finally {
    if (i % 100 === 0) {
      console.log(`[Progress] ${i}/${supabase_bulk_data.length} | OK=${processedOk} FAIL=${processedFail}`)
      console.log(`Daily Remaining: ${dailyRemaining}/${dailyLimit}`)
    }
    i++
  }
}

// ===== End =====
await supabase.auth.signOut?.()
const end = performance.now()
console.log(`Finished: ${supabase_bulk_data.length} total | OK=${processedOk} | Failed=${processedFail}`)
console.log(`Execution time: ${Math.round(end - start)} ms`)