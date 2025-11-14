#!/usr/bin/env node
// extractCsv.mjs
// Read a CSV with headers (Lead Intake, first, last, Writing process, Phone, Email, publisher, Zip, Street 1, Street 2, City, State, sourceUrl)
// Normalize columns and output JSON array to stdout or file.

import fs from 'fs'
import path from 'path'
import csv from 'csv-parser'
import dotenv from 'dotenv'
dotenv.config()
import { createClient } from '@supabase/supabase-js'
const tasks = []

const ARGS = process.argv.slice(2)
function getArg (name, fallback) {
  const prefix = `--${name}=`
  const found = ARGS.find(a => a.startsWith(prefix))
  if (found) return found.slice(prefix.length)
  return fallback
}

const SUPABASE_URL = process.env.SUPABASE_URL
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY
const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY
const BASE_URL = process.env.BASE_URL
const API_VERSION = process.env.API_VERSION
const TOKEN = process.env.TOKEN
const LOCATION_ID = process.env.LOCATION_ID

const HEADERS = {
  Authorization: `Bearer ${TOKEN}`,
  Version: API_VERSION,
  'Content-Type': 'application/json'
}

let supabase = null
if (SUPABASE_URL && SUPABASE_SERVICE_ROLE_KEY) {
  supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY)
}

function chunk (arr, size) {
  const out = []
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size))
  return out
}

const CHUNK_SIZE = 100

const INPUT = getArg('input', path.resolve(process.cwd(), 'import.csv'))
const OUTPUT = getArg('output', null) // if null -> stdout
const LIMIT = Number(getArg('limit', '0')) || 0
// When true, don't perform network writes; just log the payloads that would be sent.
const DRY_RUN = String(getArg('dry-run', 'false')).toLowerCase() === 'true'

// canonical header keys we want to extract
const HEADERS_MAP = {
  'lead intake': 'leadIntake',
  lead_intake: 'leadIntake',
  first: 'first',
  last: 'last',
  'writing process': 'writingProcess',
  writing_process: 'writingProcess',
  phone: 'phone',
  email: 'email',
  publisher: 'publisher',
  zip: 'zip',
  'street 1': 'street1',
  street_1: 'street1',
  street1: 'street1',
  'street 2': 'street2',
  street_2: 'street2',
  street2: 'street2',
  city: 'city',
  state: 'state',
  sourceurl: 'sourceUrl',
  'source url': 'sourceUrl',
  source_url: 'sourceUrl',
  sourceUrl: 'sourceUrl'
}

// Exponential backoff retry wrapper for GHL API calls
const retryWithBackoff = async (fn, maxRetries = 5, maxDelay = 30000) => {
  let attempt = 0
  while (attempt < maxRetries) {
    try {
      return await fn()
    } catch (error) {
      attempt++

      // Don't retry on client errors (4xx) - these won't be fixed by retrying
      const isClientError = error.message && /\b4\d{2}\b/.test(error.message)

      if (isClientError || attempt >= maxRetries) {
        if (isClientError) {
          console.warn(
            'Client error detected (4xx), skipping retry:',
            error.message
          )
        }
        throw error
      }

      // Exponential backoff: 1s, 2s, 4s, 8s, 16s (capped at 30s)
      const delay = Math.min(1000 * Math.pow(2, attempt - 1), maxDelay)
      console.warn(
        `GHL API call failed (attempt ${attempt}/${maxRetries}), retrying in ${delay}ms...`,
        error.message || error
      )
      await new Promise(resolve => setTimeout(resolve, delay))
    }
  }
}

const createGhlContact = async payload => {
  return retryWithBackoff(async () => {
    const URL = `${BASE_URL}/contacts`
    const response = await fetch(URL, {
      body: JSON.stringify(payload),
      headers: HEADERS,
      method: 'POST'
    })
    if (!response.ok) {
      console.log(await response.json())
      throw new Error(
        `GHL Contact API error: ${response.status} ${response.statusText}`
      )
    }
    const contactInfo = await response.json()
    if (!contactInfo?.contact?.id) {
      throw new Error('Contact ID missing in GHL response')
    }
    return contactInfo
  })
}

const createGhlOpportunity = async payload => {
  return retryWithBackoff(async () => {
    const URL = `${BASE_URL}/opportunities/`
    const response = await fetch(URL, {
      body: JSON.stringify(payload),
      headers: HEADERS,
      method: 'POST'
    })
    if (!response.ok) {
      throw new Error(
        `GHL Opportunity API error: ${response.status} ${response.statusText}`
      )
    }
    const opportunityInfo = await response.json()
    if (!opportunityInfo?.opportunity?.id) {
      throw new Error('Opportunity ID missing in GHL response')
    }
    return opportunityInfo
  })
}

const createGhlNote = async (payload, contactId) => {
  return retryWithBackoff(async () => {
    const URL = `${BASE_URL}/contacts/${contactId}/notes/`
    const response = await fetch(URL, {
      body: JSON.stringify(payload),
      headers: HEADERS,
      method: 'POST'
    })
    if (!response.ok) {
      throw new Error(
        `GHL Note API error: ${response.status} ${response.statusText}`
      )
    }
    const noteInfo = await response.json()
    return noteInfo
  })
}

const getOpportunityExtraInfo = async ({ rating, stage, publisher }) => {
  const { data, error } = await supabase.rpc(
    'get_pipeline_stage_and_do_round_robin',
    {
      p_rating: rating,
      p_stage: stage,
      p_publisher: publisher
    }
  )
  if (error) {
    throw error
  }
  return data[0]
}

const updateFactContactTable = async ({
  uuid,
  contactId,
  opportunityId,
  assignedUserId
}) => {
  const { error } = await supabase.rpc(
    'update_contact_id_opportunity_id_assigned_at',
    {
      p_assigned_user_id: assignedUserId,
      p_fact_id: uuid,
      p_ghl_contact_id: contactId,
      p_ghl_opportunity_id: opportunityId
    }
  )
  if (error) {
    throw error
  } else {
    return `Successfully imported contact ${uuid} to go high level`
  }
}

function normalizeHeader (h) {
  if (!h) return ''
  return h
    .trim()
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .replace(/[^a-z0-9 ]/g, '')
}

if (!fs.existsSync(INPUT)) {
  console.error(`Input CSV not found: ${INPUT}`)
  process.exit(1)
}

const out = []
let count = 0
let processedCount = 0

// Beautiful logging utility
const logRecord = (recordNum, email, phone, operations) => {
  const date = new Date().toISOString().split('T')[0]
  const separator = '═'.repeat(80)
  const line = '─'.repeat(80)

  console.log(`\n${separator}`)
  console.log(`  RECORD #${recordNum}`)
  console.log(`${line}`)
  console.log(`  Email:        ${email || 'N/A'}`)
  console.log(`  Phone:        ${phone || 'N/A'}`)
  console.log(`  Date:         ${date}`)
  console.log(`${line}`)

  const getStatusSymbol = status => {
    if (status === 'Success') return '✓'
    if (status === 'Error') return '✗'
    return '○'
  }

  const getStatusColor = status => {
    // Using ANSI color codes for terminal
    if (status === 'Success') return '\x1b[32m' // Green
    if (status === 'Error') return '\x1b[31m' // Red
    return '\x1b[33m' // Yellow
  }

  const resetColor = '\x1b[0m'

  Object.entries(operations).forEach(([key, value]) => {
    const symbol = getStatusSymbol(value.status)
    const color = getStatusColor(value.status)
    const statusText = value.status.padEnd(10)
    const message = value.message ? ` (${value.message})` : ''
    console.log(
      `  ${color}${symbol}${resetColor} ${key.padEnd(
        25
      )} ${color}${statusText}${resetColor}${message}`
    )
  })

  console.log(`${separator}\n`)
}

const stream = fs.createReadStream(INPUT).pipe(csv())

stream.on('data', row => {
  // map row keys to canonical keys
  const normalized = {}
  for (const rawKey of Object.keys(row)) {
    const norm = normalizeHeader(rawKey)
    const mapped = HEADERS_MAP[norm]
    const value = (row[rawKey] ?? '').toString().trim()
    if (mapped) {
      normalized[mapped] = value === '' ? null : value
    } else {
      // keep unknown keys under their raw name (trimmed)
      const safeKey = rawKey.trim().replace(/\s+/g, '_')
      normalized[safeKey] = value === '' ? null : value
    }
  }

  // Optional: ensure at least one identifying field exists
  const hasIdentifier =
    normalized.email || normalized.phone || normalized.first || normalized.last
  if (!hasIdentifier) return

  out.push(normalized)
  count++

  const doWrite = String(getArg('write', 'false')).toLowerCase() === 'true'
  if (doWrite) {
    if (!supabase && !DRY_RUN) {
      console.error(
        'Supabase SERVICE_ROLE_KEY not provided in env; cannot write to DB (unless --dry-run=true)'
      )
      process.exit(1)
    }

    const dbRow = {
      first_name: normalized.first ?? null,
      last_name: normalized.last ?? null,
      email: normalized.email ?? null,
      phone_number: normalized.phone ?? null,
      address_line1: normalized.street1 ?? null,
      address_line2: normalized.street2 ?? null,
      city: normalized.city ?? null,
      state_region: normalized.state ?? null,
      postal_code: normalized.zip ?? null,
      publisher: normalized.publisher ?? null,
      website_landing_page: normalized.sourceUrl ?? null,
      writing_status: normalized.writingProcess ?? null,
      lead_intake: normalized.leadIntake ?? null
    }

    // Also call the stored procedure to insert into the star schema
    const constructedAddress = [
      dbRow.address_line1,
      dbRow.address_line2,
      dbRow.city,
      dbRow.state_region,
      dbRow.postal_code
    ]
      .filter(Boolean)
      .join(', ')

    const ghlBody = {
      first_name: dbRow.first_name,
      last_name: dbRow.last_name,
      email: dbRow.email,
      phone: dbRow.phone_number,
      contact_id: null
    }

    const normalizedFullAddress =
      normalized.full_address ??
      (constructedAddress === '' ? null : constructedAddress)

    const pipelineId = '99sfn2ftucg0pdoBr2RR'
    const pipelineStageId = 'b8ffd318-8a79-45c8-97b2-a61667ddc9c0'
    const rating = '1. Hot' // ito
    const stage_name = 'New'
    const writing_process =
      dbRow.writing_status === 'ready-to-publish'
        ? 'I have finished writing my book'
        : 'Unknown'

    tasks.push(async () => {
      const recordId = ++processedCount
      const operations = {
        'Insert Supabase': { status: 'Pending', message: '' },
        'Create Contact': { status: 'Pending', message: '' },
        'Add Note': { status: 'Pending', message: '' },
        'Create Opportunity': { status: 'Pending', message: '' },
        'Update Supabase': { status: 'Pending', message: '' }
      }

      try {
        // Get opportunity extra info inside the async task
        if (DRY_RUN) {
          console.log(
            'DRY RUN getOpportunityExtraInfo params:',
            JSON.stringify(
              {
                rating: rating,
                stage: stage_name,
                publisher: dbRow.publisher
              },
              null,
              2
            )
          )
        }

        const { assigned_user_id } = DRY_RUN
          ? { assigned_user_id: 'DRY_RUN_USER_ID' }
          : await getOpportunityExtraInfo({
              rating: rating,
              stage: stage_name,
              publisher: dbRow.publisher
            })

        const rpcPayload = {
          p_first_name: dbRow.first_name,
          p_last_name: dbRow.last_name,
          p_email: dbRow.email,
          p_phone_number: dbRow.phone_number,
          p_full_address: normalizedFullAddress,
          p_address_line1: dbRow.address_line1 ?? '',
          p_address_line2: dbRow.address_line2 ?? null,
          p_city: dbRow.city ?? null,
          p_state_region: dbRow.state_region ?? null,
          p_postal_code: dbRow.postal_code ?? null,
          p_country: dbRow.country ?? null,
          p_time_zone: dbRow.time_zone ?? null,
          // Acquisition
          p_source: 'Ridge Media',
          p_website_landing_page: dbRow.website_landing_page ?? 'Unprovided',
          p_lead_source: 'Landing Page',
          p_data_source: 'direct',
          // Opportunity
          p_lead_owner: assigned_user_id,
          p_lead_value: '0',
          p_is_author: false,
          p_current_author: false,
          p_publisher: dbRow.publisher ?? 'Xulon Press',
          p_genre: 'Unprovided',
          p_book_description: 'Unprovided',
          p_writing_status: writing_process,
          p_rating: rating,
          p_pipeline_stage: stage_name,
          p_stage_id: pipelineStageId,
          p_pipeline_id: pipelineId,
          // Metadata
          p_opt_out_of_emails: false,
          p_outreach_attempt: 0,
          p_notes: null,
          // Optional GHL / Einstein IDs
          p_ghl_contact_id: null,
          p_ghl_opportunity_id: null,
          p_einstein_contact_id: null
        }

        let supabase_contact
        if (DRY_RUN) {
          console.log(
            'DRY RUN supabase.rpc payload:',
            JSON.stringify(rpcPayload, null, 2)
          )
          operations['Insert Supabase'].status = 'Success'
          operations['Insert Supabase'].message = 'DRY RUN'
          // Mock Supabase RPC output for downstream usage
          supabase_contact = [
            {
              out_fact_id: 'DRY_RUN_FACT_ID',
              out_einstein_url: 'DRY_RUN_EINSTEIN_URL'
            }
          ]
        } else {
          const { data, error } = await supabase.rpc(
            'insert_contact_to_star_schema',
            rpcPayload
          )

          if (error) {
            operations['Insert Supabase'].status = 'Error'
            operations['Insert Supabase'].message =
              error.message || 'Unknown error'
            logRecord(recordId, dbRow.email, dbRow.phone_number, operations)
            return { data: null, error }
          }

          supabase_contact = data
          operations['Insert Supabase'].status = 'Success'
          operations['Insert Supabase'].message = `ID: ${
            supabase_contact[0]?.out_fact_id || 'N/A'
          }`
        }

        // CREATE GHL CONTACT
        try {
          const contact_custom_fields = [
            {
              id: 'AMgJg4wIu7GKV02OGxD3',
              key: 'publisher',
              field_value: dbRow.publisher
            },
            {
              id: '5wlgHZzuWLyr918dMh7y',
              key: 'genre',
              field_value: 'Unprovided'
            },
            {
              id: 'IjmRpmQlwHiJjGnTLptG',
              key: 'contact_source_detail',
              field_value: 'Landing Page'
            },
            {
              id: 'JMwy9JsVRTTzg4PDQnhk',
              key: 'source_detail_value_c',
              field_value: dbRow.website_landing_page ?? 'Unprovided'
            }
          ]

          const opportunity_custom_fields = [
            {
              id: 'ggsTQrS88hJgLI5J5604',
              key: 'publisher',
              field_value: dbRow.publisher ?? 'Xulon Press'
            },
            {
              id: 'cG5oYGyyKmEWwzn7y8HA',
              key: 'writing_process',
              field_value: writing_process
            },
            {
              id: '5lDyHBJDAukD5YM7M4WG',
              key: 'proposal_link',
              field_value: supabase_contact[0]?.out_einstein_url ?? ''
            },
            {
              id: 'aOH64ZsyJ5blAZtf9IxK',
              key: 'book_description',
              field_value: 'Unprovided'
            },
            {
              id: 'UAjLmcYVz1hdI4sPVKSr',
              key: 'source_detail_value',
              field_value: dbRow.website_landing_page ?? 'Unprovided'
            }
          ]

          const contact_payload = {
            firstName: dbRow.first_name ?? 'Unprovided',
            lastName: dbRow.last_name ?? 'Unprovided',
            name:
              `${dbRow.first_name ?? ''} ${dbRow.last_name ?? ''}`.trim() ||
              'Unprovided',
            locationId: LOCATION_ID,
            address1: dbRow.address_line1 ?? 'Unprovided',
            city: dbRow.city ?? 'Unprovided',
            state: dbRow.state_region ?? 'Unprovided',
            postalCode: dbRow.postal_code ?? 'Unprovided',
            website: dbRow.website_landing_page ?? 'Unprovided',
            timezone: dbRow.time_zone ?? 'Unprovided',
            dnd: dbRow.opt_out_of_email ?? false,
            customFields: contact_custom_fields,
            source: 'Ridge Media',
            country: dbRow.country ?? 'US',
            assignedTo: assigned_user_id
          }

          // Add email and phone if they exist
          if (dbRow.email && dbRow.email.trim()) {
            contact_payload.email = dbRow.email.trim()
          }

          if (dbRow.phone_number && dbRow.phone_number.trim()) {
            contact_payload.phone = dbRow.phone_number.trim()
          }

          if (DRY_RUN) {
            console.log(
              'DRY RUN GHL contact payload:',
              JSON.stringify(contact_payload, null, 2)
            )
            operations['Create Contact'].status = 'Success'
            operations['Create Contact'].message = 'DRY RUN'
            operations['Add Note'].status = 'Success'
            operations['Add Note'].message = 'DRY RUN'
            operations['Create Opportunity'].status = 'Success'
            operations['Create Opportunity'].message = 'DRY RUN'
            operations['Update Supabase'].status = 'Success'
            operations['Update Supabase'].message = 'DRY RUN'
            logRecord(recordId, dbRow.email, dbRow.phone_number, operations)
            // Return mock data for dry run
            return {
              data: supabase_contact,
              error: null,
              ghl_contact_id: 'DRY_RUN_CONTACT_ID',
              ghl_opportunity_id: 'DRY_RUN_OPPORTUNITY_ID'
            }
          }

          const contact_response = await createGhlContact(contact_payload)
          const contact_id = contact_response.contact.id
          operations['Create Contact'].status = 'Success'
          operations['Create Contact'].message = `ID: ${contact_id}`

          const einstein_notes_payload = {
            userId: 'JERtBepiajyLX1Pghv3T',
            body: `Proposal Link: \n\n ${
              supabase_contact[0]?.out_einstein_url ?? 'N/A'
            }`
          }

          const einsteinNotes = await createGhlNote(
            einstein_notes_payload,
            contact_id
          )
          operations['Add Note'].status = 'Success'
          operations['Add Note'].message = 'Einstein URL added'

          const opportunity_payload = {
            pipelineId: pipelineId,
            locationId: `${LOCATION_ID}`,
            name:
              `${dbRow.first_name ?? ''} ${dbRow.last_name ?? ''}`.trim() ||
              'Unprovided',
            pipelineStageId: pipelineStageId,
            status: 'open',
            contactId: contact_id,
            assignedTo: assigned_user_id,
            customFields: opportunity_custom_fields,
            source: 'Ridge Media'
          }

          const opportunityData = await createGhlOpportunity(
            opportunity_payload
          )
          const opportunityId = opportunityData.opportunity.id
          operations['Create Opportunity'].status = 'Success'
          operations['Create Opportunity'].message = `ID: ${opportunityId}`

          // Update fact table
          const updatePayload = {
            uuid: supabase_contact[0]?.out_fact_id,
            assignedUserId: assigned_user_id,
            contactId: contact_id,
            opportunityId: opportunityId
          }

          await updateFactContactTable(updatePayload)
          operations['Update Supabase'].status = 'Success'
          operations['Update Supabase'].message = 'GHL IDs synced'

          // Log successful completion
          logRecord(recordId, dbRow.email, dbRow.phone_number, operations)

          return {
            data: supabase_contact,
            error: null,
            ghl_contact_id: contact_id,
            ghl_opportunity_id: opportunityId
          }
        } catch (ghlError) {
          // Determine which step failed
          if (operations['Create Contact'].status === 'Pending') {
            operations['Create Contact'].status = 'Error'
            operations['Create Contact'].message = ghlError.message || 'Failed'
          } else if (operations['Add Note'].status === 'Pending') {
            operations['Add Note'].status = 'Error'
            operations['Add Note'].message = ghlError.message || 'Failed'
          } else if (operations['Create Opportunity'].status === 'Pending') {
            operations['Create Opportunity'].status = 'Error'
            operations['Create Opportunity'].message =
              ghlError.message || 'Failed'
          } else if (operations['Update Supabase'].status === 'Pending') {
            operations['Update Supabase'].status = 'Error'
            operations['Update Supabase'].message = ghlError.message || 'Failed'
          }

          logRecord(recordId, dbRow.email, dbRow.phone_number, operations)
          return { data: supabase_contact, error: ghlError }
        }
      } catch (e) {
        operations['Insert Supabase'].status = 'Error'
        operations['Insert Supabase'].message = e.message || 'Unknown error'
        logRecord(recordId, dbRow.email, dbRow.phone_number, operations)
        return { error: e }
      }
    })
  }

  if (LIMIT && count >= LIMIT) {
    stream.destroy()
  }
})

stream.on('end', async () => {
  const json = JSON.stringify(out, null, 2)

  const doWrite = String(getArg('write', 'false')).toLowerCase() === 'true'
  if (doWrite && !DRY_RUN) {
    if (!supabase) {
      console.error(
        'Supabase SERVICE_ROLE_KEY not provided in env; cannot write to DB'
      )
      process.exit(1)
    }

    console.log('\n\n' + '═'.repeat(80))
    console.log('  PROCESSING BATCH')
    console.log('═'.repeat(80))
    console.log(`  Total Records: ${tasks.length}`)
    console.log('═'.repeat(80) + '\n')

    // Run tasks sequentially (no concurrency)
    const results = []
    for (const task of tasks) {
      try {
        const value = await task()
        results.push({ status: 'fulfilled', value })
      } catch (reason) {
        results.push({ status: 'rejected', reason })
      }
    }
    const failures = results.filter(
      r =>
        r.status === 'rejected' ||
        (r.status === 'fulfilled' && r.value && r.value.error)
    )

    console.log('\n' + '═'.repeat(80))
    console.log('  BATCH SUMMARY')
    console.log('═'.repeat(80))
    console.log(`  ✓ Successful: ${results.length - failures.length}`)
    console.log(`  ✗ Failed:     ${failures.length}`)
    console.log(`  ○ Total:      ${results.length}`)
    console.log('═'.repeat(80) + '\n')
  } else if (doWrite && DRY_RUN) {
    console.log('\n\n' + '═'.repeat(80))
    console.log('  PROCESSING BATCH (DRY RUN)')
    console.log('═'.repeat(80))
    console.log(`  Total Records: ${tasks.length}`)
    console.log('═'.repeat(80) + '\n')

    // Run tasks sequentially in DRY RUN too, so per-record logs are shown
    const results = []
    for (const task of tasks) {
      try {
        const value = await task()
        results.push({ status: 'fulfilled', value })
      } catch (reason) {
        results.push({ status: 'rejected', reason })
      }
    }

    const failures = results.filter(
      r =>
        r.status === 'rejected' ||
        (r.status === 'fulfilled' && r.value && r.value.error)
    )

    console.log('\n' + '═'.repeat(80))
    console.log('  BATCH SUMMARY (DRY RUN)')
    console.log('═'.repeat(80))
    console.log(`  ✓ Successful: ${results.length - failures.length}`)
    console.log(`  ✗ Failed:     ${failures.length}`)
    console.log(`  ○ Total:      ${results.length}`)
    console.log('═'.repeat(80) + '\n')
  }

  if (OUTPUT) {
    try {
      fs.writeFileSync(OUTPUT, json)
      console.log(`Wrote ${out.length} rows to ${OUTPUT}`)
    } catch (e) {
      console.error('Error writing output file:', e.message || e)
      process.exit(1)
    }
  } else if (!doWrite) {
    console.log(json)
  }
})

stream.on('error', err => {
  console.error('CSV read error:', err.message || err)
  process.exit(1)
})

// make script executable on *nix; on Windows it can still be run with `node`.
try {
  fs.chmodSync(new URL(import.meta.url).pathname, 0o755)
} catch (e) {}
