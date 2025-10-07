import { createClient } from '@supabase/supabase-js'
import dotenv from 'dotenv'
import fs from 'fs'
dotenv.config()

let processedContacts = 0
let errorContacts = []
let lastProcessedContact = null
let searchAfter = null
let currName, currEmail, currContactID
let updatedFactIDs = []
let insertedFactIDS = []
let apiLimitErrors = 0

// Live anchor status line (Option C)
let lastStatus = ''
const renderStatus = () => {
  const lastSummary =
    typeof lastProcessedContact === 'string' && lastProcessedContact.length > 0
      ? lastProcessedContact.replace(/\n/g, ' ').slice(0, 80)
      : 'N/A'
  const line = `[Page ${currPage} | Limit ${PAGE_LIMIT}] Processed: ${processedContacts} | Errors: ${errorContacts.length} (API: ${apiLimitErrors}) | Last: ${lastSummary}`
  const pad = ' '.repeat(
    Math.max(0, Math.max(lastStatus.length - line.length, 0) + 5)
  )
  lastStatus = line
  // carriage return without newline to keep a single live line
  process.stdout.write(`\r${line}${pad}`)
}
const noteApiLimit = (where = 'unknown') => {
  apiLimitErrors++
  // Print a short alert, then re-render the status line
  process.stdout.write(
    `\n(${processedContacts}/?) API Limit Count Error Found (HTTP 429) at ${where}\n`
  )
  renderStatus()
}

// CLI/config helpers for performance tuning
const getArg = (name, fallback = undefined) => {
  const prefix = `--${name}=`
  const found = process.argv.find(a => a.startsWith(prefix))
  if (found) return found.slice(prefix.length)
  return fallback
}

// Configurable controls
const START_PAGE = Number(getArg('start-page', process.env.START_PAGE || 1))
const PAGE_LIMIT = Number(getArg('page-limit', process.env.PAGE_LIMIT || 500))
// Safe concurrency to avoid API rate limits; tune as needed
const CONCURRENCY = Number(
  getArg('concurrency', process.env.CONCURRENCY || 100)
)

// Simple promise pool for per-page parallelism
async function promisePool (items, worker, concurrency) {
  let i = 0
  const runners = Array.from({ length: Math.max(1, concurrency) }, async () => {
    while (true) {
      const idx = i++
      if (idx >= items.length) break
      const item = items[idx]
      await worker(item, idx)
    }
  })
  await Promise.all(runners)
}
process.on('exit', code => {
  const end = performance.now()
  // ensure the live status line does not interfere with the summary
  process.stdout.write('\n')

  const summaryData = {
    timestamp: new Date().toISOString(),
    exitCode: code,
    executionTime: (end - start) / 1000,
    contactsProcessed: processedContacts,
    searchAfter: searchAfter,
    errorContacts: errorContacts,
    updatedFactIDs: updatedFactIDs,
    insertedFactIDS: insertedFactIDS,
    lastProcessedContact: {
      name: currName,
      contactID: currContactID,
      email: currEmail
    }
  }

  // Create readable text summary
  const textSummary = `
=== GHL CONTACT SYNC SUMMARY ===
Timestamp: ${summaryData.timestamp}
Exit Code: ${summaryData.exitCode}
Total Execution Time: ${summaryData.executionTime} seconds
Contacts Processed: ${summaryData.contactsProcessed}
Search After: ${summaryData.searchAfter || 'N/A'}
Last Processed Contact: ${summaryData.lastProcessedContact}
Updated Fact IDs: ${summaryData.updatedFactIDs}
Inserted Fact IDs: ${summaryData.insertedFactIDS}


ERROR CONTACTS (${errorContacts.length}):
${errorContacts.map((error, index) => `${index + 1}. ${error}`).join('\n')}

=====================================
`

  // Write to console
  console.log('\n=== SCRIPT EXIT SUMMARY ===')
  console.log(`Exit code: ${code}`)
  console.log(`Total execution time: ${(end - start) / 1000} seconds`)
  console.log(`Contacts processed: ${processedContacts}`)
  console.log(`Search After: ${searchAfter || 'N/A'}`)
  console.log(`Error Contacts: `, errorContacts)
  console.log(`Last Processed Contact: `, lastProcessedContact)
  console.log('===========================\n')

  try {
    // Create filename with timestamp
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-')
    const folderName = 'UpdateContactRecord'
    if (!fs.existsSync(folderName)) {
      fs.mkdirSync(folderName)
    }

    const txtFile = `${folderName}/contact-sync-summary-${timestamp}.txt`
    const jsonFile = `${folderName}/contact-sync-data-${timestamp}.json`
    const csvFile = `${folderName}/contact-sync-errors-${timestamp}.csv`

    // Write text summary
    fs.writeFileSync(txtFile, textSummary)

    // Write JSON data for programmatic use
    fs.writeFileSync(jsonFile, JSON.stringify(summaryData, null, 2))

    // Write CSV for error contacts
    const escapeCsv = v => {
      if (v === null || v === undefined) return ''
      const s = String(v)
      if (/[",\n]/.test(s)) {
        return '"' + s.replace(/"/g, '""') + '"'
      }
      return s
    }
    const parseErrorLine = line => {
      // Expected format:
      // Name: <name>, Email <email>, ContactID: <id>, Reason: <reason>
      let name = '',
        email = '',
        contactId = '',
        reason = ''
      try {
        const nameMatch = line.match(/Name:\s*([^,]+)/)
        const emailMatch = line.match(/Email\s+([^,]+)/)
        const idMatch = line.match(/ContactID:\s*([^,]+)/)
        const reasonMatch = line.match(/Reason:\s*(.*)$/)
        name = nameMatch ? nameMatch[1].trim() : ''
        email = emailMatch ? emailMatch[1].trim() : ''
        contactId = idMatch ? idMatch[1].trim() : ''
        reason = reasonMatch ? reasonMatch[1].trim() : ''
      } catch (e) {
        reason = line
      }
      return { name, email, contactId, reason }
    }
    const header = ['name', 'email', 'contact_id', 'reason']
    const rows = (errorContacts || []).map(l => parseErrorLine(l))
    const csv = [header.join(',')]
      .concat(
        rows.map(r =>
          [
            escapeCsv(r.name),
            escapeCsv(r.email),
            escapeCsv(r.contactId),
            escapeCsv(r.reason)
          ].join(',')
        )
      )
      .join('\n')
    fs.writeFileSync(csvFile, csv)

    console.log(`\nSummary files created:`)
    console.log(`Text: ${txtFile}`)
    console.log(`JSON: ${jsonFile}`)
    console.log(`CSV (errors): ${csvFile}`)
  } catch (error) {
    console.error('Error writing summary files:', error)
  }
})

process.on('SIGINT', () => {
  console.log('\n\nReceived SIGINT (Ctrl+C). Gracefully shutting down...')
  process.exit(0)
})

process.on('SIGTERM', () => {
  console.log('\n\nReceived SIGTERM. Gracefully shutting down...')
  process.exit(0)
})

process.on('uncaughtException', error => {
  console.error('\n\nUncaught Exception:', error)
  process.exit(1)
})

process.on('unhandledRejection', (reason, promise) => {
  console.error('\n\nUnhandled Rejection at:', promise, 'reason:', reason)
  process.exit(1)
})

const start = performance.now()
const EMAIL = process.env.SUPABASE_SUPERADMIN_EMAIL
const PASSWORD = process.env.SUPABASE_SUPERADMIN_PASSWORD
const SUPABASE_URL = process.env.SUPABASE_URL
const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY
const API_VERSION = process.env.API_VERSION || '2021-07-28'
const TOKEN = process.env.TOKEN
const BASE_URL = process.env.BASE_URL
const LOCATION_ID = process.env.LOCATION_ID
const HEADERS = {
  Authorization: `Bearer ${TOKEN}`,
  'Content-Type': 'application/json',
  Accept: 'application/json',
  Version: API_VERSION,
  'User-Agent': 'vertexlabs-ghl-importer/1.0'
}

const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY)

const { error: loginError } = await supabase.auth.signInWithPassword({
  email: EMAIL,
  password: PASSWORD
})

console.log('logging in...')
if (loginError) {
  console.error('Error authenticating user: ', loginError)
  process.exit(1)
}
console.log(`Log In Success: "Welcome ${EMAIL}"`)

const searchGhlContact = async (page, searchAfter) => {
  const body = {
    locationId: LOCATION_ID,
    page: page,
    pageLimit: PAGE_LIMIT
  }
  if (searchAfter) {
    body['searchAfter'] = searchAfter
  }

  const response = await fetch(`${BASE_URL}/contacts/search`, {
    method: 'POST',
    headers: HEADERS,
    body: JSON.stringify(body)
  })
  if (response.status === 429) {
    noteApiLimit('contacts/search')
  }
  const contact_info = await response.json()
  return contact_info
}

const getCustomFieldValue = (customFields, fieldId) => {
  return customFields?.find(field => field.id === fieldId)?.value || null
}

const addEinsteinURLToNotes = async (ghl_contact_id, einstein_url) => {
  const payload = {
    userId: 'JERtBepiajyLX1Pghv3T',
    body: `Proposal Link: \n\n ${einstein_url}`
  }
  const URL = `${BASE_URL}/contacts/${ghl_contact_id}/notes/`

  const response = await fetch(URL, {
    body: JSON.stringify(payload),
    headers: HEADERS,
    method: 'POST'
  })

  const note_info = await response.json()
  return note_info
}

const addEinsteinURL = async ({ ghl_contact_id, einstein_url }) => {
  let updateEinsteinUrlError = []

  const noteEinsteinData = await addEinsteinURLToNotes(
    ghl_contact_id,
    einstein_url
  )
  if (!noteEinsteinData?.note?.id) {
    console.error('Error Updating Einstein URL', noteEinsteinData?.message)

    updateEinsteinUrlError.push(noteEinsteinData?.message)
  }

  if (updateEinsteinUrlError.length !== 0) {
    throw new Error(
      `Error Updating the Einstein URL of ${ghl_contact_id} ${updateEinsteinUrlError}`
    )
  } else {
    console.log(`Successfully Updated Einstein URL for ${ghl_contact_id}`)
  }
}

// Contact Custom Field IDs
const PUBLISHER_C = 'AMgJg4wIu7GKV02OGxD3'
const TIMEZONE_C = 'fFWUJ9OFbYBqVJjwjQGP'
const CONTACT_SOURCE_DETAIL = 'IjmRpmQlwHiJjGnTLptG'
const SOURCE_DETAIL_VALUE_C = 'JMwy9JsVRTTzg4PDQnhk'

let currPage = START_PAGE
let currNumber = 0
let currContactPage
let totalContacts = 0
do {
  try {
    const { contacts } = await searchGhlContact(currPage, searchAfter)
    currContactPage = contacts
    console.log(
      `Page ${currPage}: Found ${contacts.length} Contacts (limit=${PAGE_LIMIT})`
    )
    renderStatus()
    totalContacts += contacts.length

    // Batch existence check for the entire page
    const pageContactIds = contacts.map(c => c.id)
    let existingIds = []
    if (pageContactIds.length > 0) {
      const { data: existingRows, error: existingErr } = await supabase
        .from('fact_contacts')
        .select('ghl_contact_id')
        .in('ghl_contact_id', pageContactIds)
      if (existingErr) {
        throw new Error(
          `Error checking contacts existence in supabase: ${JSON.stringify(
            existingErr
          )}`
        )
      }
      existingIds = (existingRows || []).map(r => r.ghl_contact_id)
    }
    const existingSet = new Set(existingIds)

    // Preserve pagination cursor deterministically (last contact on the page)
    const lastContact = contacts[contacts.length - 1]
    if (lastContact) {
      searchAfter = lastContact.searchAfter
    }

    // Per-contact worker with concurrency limit
    await promisePool(
      contacts,
      async (currContact, currContactIndex) => {
        try {
          currNumber = currContactIndex + 1
          currName = `
      ${currContact.firstName} ${currContact.lastName}`
          currContactID = currContact.id
          currEmail = currContact.email
          console.log(
            `Processing Contact Number ${
              currContactIndex + 1
            } of Page ${currPage} name ${currContact.firstName} ${
              currContact.lastName
            }`
          )

          const contactExists = existingSet.has(currContact.id)

          const publisher = getCustomFieldValue(
            currContact.customFields,
            PUBLISHER_C
          )
          const timezone = getCustomFieldValue(
            currContact.customFields,
            TIMEZONE_C
          )
          const contactSource = getCustomFieldValue(
            currContact.customFields,
            CONTACT_SOURCE_DETAIL
          )
          const sourceDetailValue = getCustomFieldValue(
            currContact.customFields,
            SOURCE_DETAIL_VALUE_C
          )

          const fullAddress =
            [
              currContact.address1 || '',
              currContact.city || '',
              currContact.state || '',
              currContact.postalCode || ''
            ]
              .filter(part => part.trim() !== '')
              .join(', ') || ''
          processedContacts++
          renderStatus()
          if (contactExists) {
            // Update
            const { data: updateData, error: updateError } = await supabase.rpc(
              'update_contact_in_star_schema_using_contact_id',
              {
                p_contact_id_matcher: currContact.id,
                p_first_name: currContact.firstName ?? null,
                p_last_name: currContact.lastName ?? null,
                p_email: currContact.email ?? null,
                p_phone_number: currContact.phone
                  ? currContact.phone.trim()
                  : null,
                p_full_address: fullAddress,
                p_address_line1: currContact.address1 ?? null,
                p_address_line2: null,
                p_city: currContact.city ?? null,
                p_state_region: currContact.state ?? null,
                p_postal_code: currContact.postalCode ?? null,
                p_country: currContact.country ?? null,
                p_time_zone: timezone ?? null,

                p_source: currContact.source ?? null,
                p_website_landing_page: sourceDetailValue ?? null,
                p_lead_source: contactSource,
                p_lead_owner: currContact.assignedTo ?? null,
                p_lead_value: null,

                p_is_author: currContact.type === 'author',
                p_current_author: null,
                p_publisher: publisher,
                p_publishing_writing_process_stage: 'Unprovided',
                p_genre: null,
                p_book_description: null,
                p_writing_status: null,
                p_rating: null,
                p_pipeline_stage: null,
                p_stage_id: null,
                p_pipeline_id: null,

                p_create_date: null,
                p_alternate_create_date: null,
                p_lead_conversion_date: null,
                p_lead_id: null,
                p_last_modified_date: new Date().toISOString(),

                p_opt_out_of_emails: currContact.dnd ?? false,
                p_outreach_attempt: null,
                p_notes: null
              }
            )
            if (updateError) {
              throw new Error(
                `Error updating supabase contact ${currContact.firstName} ${
                  currContact.lastName
                } Reason: ${JSON.stringify(updateError)}`
              )
            }
            updatedFactIDs.push(updateData[0].out_fact_id)
          } else {
            // Insert
            const { data: insertData, error: insertError } = await supabase.rpc(
              'insert_contact_to_star_schema',
              {
                p_first_name: currContact.firstName ?? null,
                p_last_name: currContact.lastName ?? null,
                p_email: currContact.email ?? null,
                p_phone_number: currContact.phone
                  ? currContact.phone.trim()
                  : null,
                p_full_address: fullAddress,
                p_address_line1: currContact.address1 ?? 'Unprovided',
                p_address_line2: null,
                p_city: currContact.city ?? null,
                p_state_region: currContact.state ?? null,
                p_postal_code: currContact.postalCode ?? null,
                p_country: currContact.country ?? null,
                p_time_zone: timezone ?? null,

                p_source: currContact.source ?? null,
                p_website_landing_page: sourceDetailValue ?? null,
                p_lead_source: contactSource ?? 'Unprovided',
                p_lead_owner: currContact.assignedTo ?? null,
                p_lead_value: null,

                p_is_author: currContact.type === 'author',
                p_current_author: false,
                p_publisher: publisher,
                p_publishing_writing_process_stage: 'Unprovided',
                p_genre: [],
                p_book_description: null,
                p_writing_status: null,
                p_rating: 'Unknown',
                p_pipeline_stage: 'Unknown',
                p_stage_id: null,
                p_pipeline_id: null,

                p_create_date:
                  currContact.createdBy?.timestamp ?? new Date().toISOString(),
                p_alternate_create_date: null,
                p_lead_conversion_date: null,
                p_lead_id: null,
                p_last_modified_date: new Date().toISOString(),

                p_opt_out_of_emails: currContact.dnd ?? false,
                p_outreach_attempt: 0,
                p_notes: null,

                p_ghl_contact_id: currContact.id ?? null
              }
            )
            if (insertError) {
              console.error('Supabase insert error details:', insertError)
              throw new Error(
                `Error inserting contact ${currContact.firstName} ${currContact.lastName}: ${insertError.message}`
              )
            }

            const { einstein_url, fact_id, ghl_contact_id } = insertData[0]
            await addEinsteinURL({
              ghl_contact_id: ghl_contact_id,
              einstein_url: einstein_url
            })

            insertedFactIDS.push(fact_id)
          }

          lastProcessedContact = `Name: ${currName}, Contact ID: ${currContactID}, Email: ${currEmail}, Search After: [${currContact.searchAfter}]`
          if (processedContacts % 100 === 0) {
            console.log(`Progress: ${processedContacts} contacts processed...`)
          }
          renderStatus()
        } catch (error) {
          console.error(
            `Error processing page ${currPage}, #${currNumber}, ${currName}`,
            error
          )
          errorContacts.push(
            `Name: ${currName}, Email ${currEmail}, ContactID: ${currContactID}, Reason: ${error} `
          )
          renderStatus()
        }
      },
      CONCURRENCY
    )
    currPage++
    renderStatus()
  } catch (error) {
    console.error(
      `Error processing page ${currPage}, #${currNumber}, ${currName}`,
      error
    )

    errorContacts.push(
      `Name: ${currName}, Email ${currEmail}, ContactID: ${currContactID}, Reason: ${error} `
    )
    currPage++
    renderStatus()
    continue
  }
} while ((currContactPage?.length ?? 0) !== 0)

const end = performance.now()
console.log(`Execution time: ${end - start} ms`)
