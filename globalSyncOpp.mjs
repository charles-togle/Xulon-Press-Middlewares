import { createClient } from '@supabase/supabase-js'
import dotenv from 'dotenv'
import fs from 'fs'
dotenv.config()

let processedOpportunities = 0
let errorOpportunities = []
let updatedFactIDs = []
let insertedFactIDS = []
let lastProcessedContact = null
let totalOpportunities = 0
let currPage = 1
let currName, currEmail, currContactID, currOpportunityID

// CLI/config helpers for performance tuning
const getArg = (name, fallback = undefined) => {
  const prefix = `--${name}=`
  const found = process.argv.find(a => a.startsWith(prefix))
  if (found) return found.slice(prefix.length)
  return fallback
}

// Configurable controls (defaults suitable for opp search)
const START_PAGE = Number(getArg('start-page', process.env.START_PAGE || 1))
const PAGE_LIMIT = Number(getArg('page-limit', process.env.PAGE_LIMIT || 100))
const CONCURRENCY = Number(getArg('concurrency', process.env.CONCURRENCY || 8))

// Live anchor status line and API limit tracking
let apiLimitErrors = 0
let lastStatus = ''
const renderStatus = () => {
  const lastSummary =
    typeof lastProcessedContact === 'string' && lastProcessedContact.length > 0
      ? lastProcessedContact.replace(/\n/g, ' ').slice(0, 80)
      : 'N/A'
  const line = `[Page ${currPage} | Limit ${PAGE_LIMIT}] Processed: ${processedOpportunities} | Errors: ${errorOpportunities.length} (API: ${apiLimitErrors}) | Last: ${lastSummary}`
  const pad = ' '.repeat(
    Math.max(0, Math.max(lastStatus.length - line.length, 0) + 5)
  )
  lastStatus = line
  process.stdout.write(`\r${line}${pad}`)
}
const noteApiLimit = (where = 'unknown') => {
  apiLimitErrors++
  process.stdout.write(
    `\n(${processedOpportunities}/?) API Limit Count Error Found (HTTP 429) at ${where}\n`
  )
  renderStatus()
}

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

// Exit handlers
process.on('exit', code => {
  const end = performance.now()
  console.log('\n=== SCRIPT EXIT SUMMARY ===')
  console.log(`Exit code: ${code}`)
  console.log(`Total execution time: ${(end - start) / 1000} seconds`)
  console.log(`Contacts processed: ${processedOpportunities}`)
  console.log(`Error Contacts: `, errorOpportunities)
  console.log(`Updated Fact IDS: `, updatedFactIDs)
  console.log(`Inserted Fact IDs: `, insertedFactIDS)
  console.log(`Last Proccessed Contact: `, lastProcessedContact)
  console.log('===========================\n')
})

process.on('exit', code => {
  const end = performance.now()

  const summaryData = {
    timestamp: new Date().toISOString(),
    exitCode: code,
    executionTime: (end - start) / 1000,
    contactsProcessed: processedOpportunities,
    totalOpportunities: totalOpportunities,
    currentPage: currPage,
    errorContacts: errorOpportunities,
    updatedFactIDs: updatedFactIDs,
    insertedFactIDs: insertedFactIDS,
    lastProcessedContact: {
      name: currName,
      contactID: currContactID,
      email: currEmail,
      opportunityID: currOpportunityID
    }
  }

  // Create readable text summary
  const textSummary = `
=== GHL OPPORTUNITY SYNC SUMMARY ===
Timestamp: ${summaryData.timestamp}
Exit Code: ${summaryData.exitCode}
Total Execution Time: ${summaryData.executionTime} seconds
Contacts Processed: ${summaryData.contactsProcessed}
Total Opportunities: ${summaryData.totalOpportunities}
Pages Processed: ${summaryData.currentPage - 1}
Last Processed Contact: ${summaryData.lastProcessedContact || 'N/A'}

ERROR CONTACTS (${errorOpportunities.length}):
${errorOpportunities.map((error, index) => `${index + 1}. ${error}`).join('\n')}

UPDATED FACT IDs (${updatedFactIDs.length}):
${updatedFactIDs.map((id, index) => `${index + 1}. ${id}`).join('\n')}

INSERTED FACT IDs (${insertedFactIDS.length}):
${insertedFactIDS.map((id, index) => `${index + 1}. ${id}`).join('\n')}

=====================================
`

  // Write to console
  console.log(textSummary)

  try {
    // Create filename with timestamp
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-')
    const folderName = 'UpdateOppRecord'
    if (!fs.existsSync(folderName)) {
      fs.mkdirSync(folderName)
    }

    const txtFile = `${folderName}/sync-summary-${timestamp}.txt`
    const jsonFile = `${folderName}/sync-data-${timestamp}.json`
    const csvFile = `${folderName}/sync-errors-${timestamp}.csv`

    // Write text summary
    fs.writeFileSync(txtFile, textSummary)

    // Write JSON data for programmatic use
    fs.writeFileSync(jsonFile, JSON.stringify(summaryData, null, 2))

    // Write CSV for error opportunities
    const escapeCsv = v => {
      if (v === null || v === undefined) return ''
      const s = String(v)
      if (/[",\n]/.test(s)) return '"' + s.replace(/"/g, '""') + '"'
      return s
    }
    const parseErrorLine = line => {
      // Expected: Name: <name>, Email <email>, ContactID: <contactId>, Opportunity ID: <oppId> Reason: <reason>
      let name = '',
        email = '',
        contactId = '',
        opportunityId = '',
        reason = ''
      try {
        const nameMatch = line.match(/Name:\s*([^,]+)/)
        const emailMatch = line.match(/Email\s+([^,]+)/)
        const cidMatch = line.match(/ContactID:\s*([^,]+)/)
        const oppMatch = line.match(/Opportunity ID:\s*([^,]+)/)
        const reasonMatch = line.match(/Reason:\s*(.*)$/)
        name = nameMatch ? nameMatch[1].trim() : ''
        email = emailMatch ? emailMatch[1].trim() : ''
        contactId = cidMatch ? cidMatch[1].trim() : ''
        opportunityId = oppMatch ? oppMatch[1].trim() : ''
        reason = reasonMatch ? reasonMatch[1].trim() : ''
      } catch (e) {
        reason = line
      }
      return { name, email, contactId, opportunityId, reason }
    }
    const header = ['name', 'email', 'contact_id', 'opportunity_id', 'reason']
    const rows = (errorOpportunities || []).map(l => parseErrorLine(l))
    const csv = [header.join(',')]
      .concat(
        rows.map(r =>
          [
            escapeCsv(r.name),
            escapeCsv(r.email),
            escapeCsv(r.contactId),
            escapeCsv(r.opportunityId),
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

const getGhlOpportunties = async page => {
  const response = await fetch(
    `${BASE_URL}/opportunities/search?location_id=${LOCATION_ID}&page=${page}&limit=${PAGE_LIMIT}`,
    {
      method: 'GET',
      headers: HEADERS
    }
  )
  if (response.status === 429) {
    noteApiLimit('opportunities/search')
  }
  const opportunity_info = await response.json()
  return opportunity_info
}

const getGhlContact = async contactId => {
  const URL = `${BASE_URL}/contacts/${contactId}`
  try {
    const response = await fetch(URL, {
      method: 'GET',
      headers: HEADERS
    })
    if (!response.ok) {
      console.error(`HTTP error ${response.status} for contact ${contactId}`)
      return null
    }
    const responseText = await response.text()
    if (!responseText) {
      console.error(`Empty response for contact ${contactId}`)
      return null
    }
    const contact = JSON.parse(responseText)
    return contact
  } catch (error) {
    console.error(`Error fetching contact ${contactId}:`, error.message)
    return null
  }
}

const getCustomFieldValue = (customFields, fieldId) => {
  return customFields?.find(field => field.id === fieldId)?.value || null
}

const getOpportunityCustomFieldValue = (customFields, fieldId) => {
  return (
    customFields?.find(field => field.id === fieldId)?.fieldValueString || null
  )
}

const addEinsteinURLToOpportunity = async (
  ghl_opportunity_id,
  einstein_url
) => {
  const oppCustomField = [
    {
      id: '5lDyHBJDAukD5YM7M4WG',
      key: 'proposal_link',
      field_value: einstein_url
    }
  ]

  const updateOppPayload = {
    customFields: oppCustomField
  }

  const URL = `${BASE_URL}/opportunities/${ghl_opportunity_id}`
  const response = await fetch(URL, {
    body: JSON.stringify(updateOppPayload),
    headers: HEADERS,
    method: 'PUT'
  })
  const opportunity_info = await response.json()
  return opportunity_info
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

const addEinsteinURL = async ({
  ghl_opportunity_id,
  ghl_contact_id,
  einstein_url
}) => {
  let updateEinsteinUrlError = []

  const opportunityEinsteinData = await addEinsteinURLToOpportunity(
    ghl_opportunity_id,
    einstein_url
  )

  if (!opportunityEinsteinData?.opportunity?.id) {
    console.error(
      'Error Updating Proposal Link',
      opportunityEinsteinData?.message
    )

    updateEinsteinUrlError.push(opportunityEinsteinData?.message)
  }

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

// Opportunity Custom Field IDs (based on your data)
const OPP_PUBLISHER = 'ggsTQrS88hJgLI5J5604'
const OPP_TIMEZONE = 'gsFwmLo8XyzCjIoXxXYQ'
const OPP_ACTIVE_OR_PAST_AUTHOR = '4P0Yd0fLzOfns3opxTGo'
const OPP_GENRE = '5wlgHZzuWLyr918dMh7y'
const OPP_WRITING_PROCESS = 'cG5oYGyyKmEWwzn7y8HA'
const OPP_BOOK_DESCRIPTION = 'aOH64ZsyJ5blAZtf9IxK'
const OPP_OUTREACH_ATTEMPT = 'BOGtp8xLezwurePxIkNE'
const OPP_EINSTEIN_URL = '5lDyHBJDAukD5YM7M4WG'
const OPP_PIPELINE_BACKUP = 'uUEENCZJBnr0mjbuPe98'
const OPP_SOURCE_DETAIL_VALUE = 'UAjLmcYVz1hdI4sPVKSr'

let currNumber = 0
let currOpportunityPage

do {
  try {
    const { opportunities } = await getGhlOpportunties(currPage)
    currOpportunityPage = opportunities
    console.log(`Page ${currPage}: Found ${opportunities.length} opportunities`)
    renderStatus()
    totalOpportunities += opportunities.length
    // Batch existence check for contacts on this opportunity page
    const pageContactIds = opportunities.map(o => o.contact?.id).filter(Boolean)
    let existingIds = []
    if (pageContactIds.length > 0) {
      const { data: existingRows, error: existingErr } = await supabase
        .from('fact_contacts')
        .select('ghl_contact_id')
        .in('ghl_contact_id', pageContactIds)
      if (existingErr) {
        throw new Error(
          `Error checking contacts existence: ${JSON.stringify(existingErr)}`
        )
      }
      existingIds = (existingRows || []).map(r => r.ghl_contact_id)
    }
    const existingSet = new Set(existingIds)

    // Process opportunities concurrently
    await promisePool(
      opportunities,
      async (currOpportunity, currOppIndex) => {
        try {
          const fetchedContact = await getGhlContact(currOpportunity.contact.id)
          const { contact: currContact } = fetchedContact || { contact: {} }
          console.log(
            `Processing Contact Number ${
              currOppIndex + 1
            } of Page ${currPage} name ${currContact.firstName} ${
              currContact.lastName
            }`
          )
          console.log(
            `Processing Opportunity Number ${
              currOppIndex + 1
            } of Page ${currPage} name ${currOpportunity.name}`
          )

          currNumber = currOppIndex + 1
          currName = `\n      ${currContact.firstName} ${currContact.lastName}`
          currEmail = currContact.email
          currContactID = currContact.id
          currOpportunityID = currOpportunity.id

          const { data: pipelineNames, error: pipelineNamesError } =
            await supabase.rpc('get_pipeline_and_stage_names', {
              p_pipeline_id: currOpportunity.pipelineId,
              p_pipeline_stage_id: currOpportunity.pipelineStageId
            })
          if (pipelineNamesError) {
            throw new Error(
              `Error getting pipeline names: ${JSON.stringify(
                pipelineNamesError
              )}`
            )
          }

          const pipelineName = pipelineNames?.[0]?.pipeline_name ?? null
          const pipelineStageName = pipelineNames?.[0]?.stage_name ?? null

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

          // Extract Opportunity Custom Fields
          const oppPublisher = getOpportunityCustomFieldValue(
            currOpportunity.customFields,
            OPP_PUBLISHER
          )
          const oppTimezone = getOpportunityCustomFieldValue(
            currOpportunity.customFields,
            OPP_TIMEZONE
          )
          const oppActiveOrPastAuthor = getOpportunityCustomFieldValue(
            currOpportunity.customFields,
            OPP_ACTIVE_OR_PAST_AUTHOR
          )
          const oppGenre = getOpportunityCustomFieldValue(
            currOpportunity.customFields,
            OPP_GENRE
          )
          const oppWritingProcess = getOpportunityCustomFieldValue(
            currOpportunity.customFields,
            OPP_WRITING_PROCESS
          )
          const oppBookDescription = getOpportunityCustomFieldValue(
            currOpportunity.customFields,
            OPP_BOOK_DESCRIPTION
          )
          const oppOutreachAttempt = getOpportunityCustomFieldValue(
            currOpportunity.customFields,
            OPP_OUTREACH_ATTEMPT
          )
          const oppEinsteinUrl = getOpportunityCustomFieldValue(
            currOpportunity.customFields,
            OPP_EINSTEIN_URL
          )
          const oppPipelineBackup = getOpportunityCustomFieldValue(
            currOpportunity.customFields,
            OPP_PIPELINE_BACKUP
          )
          const oppSourceDetailValue = getOpportunityCustomFieldValue(
            currOpportunity.customFields,
            OPP_SOURCE_DETAIL_VALUE
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
          processedOpportunities++
          lastProcessedContact = `Contact Name: ${currName}, ContactID: ${currContactID}`
          renderStatus()

          if (contactExists) {
            const { data: updateData, error: updateError } = await supabase.rpc(
              'update_contact_in_star_schema_using_contact_id',
              {
                p_contact_id_matcher: currContact.id,
                p_first_name: currContact.firstName ?? null,
                p_last_name: currContact.lastName ?? null,
                p_email: currContact.email ?? null,
                p_phone_number: currContact.phone ?? null,
                p_full_address: fullAddress,
                p_address_line1: currContact.address1 ?? null,
                p_address_line2: null,
                p_city: currContact.city ?? null,
                p_state_region: currContact.state ?? null,
                p_postal_code: currContact.postalCode ?? null,
                p_country: currContact.country ?? null,
                p_time_zone: timezone ? timezone : oppTimezone ?? null,

                p_source: currContact.source
                  ? currContact.source
                  : currOpportunity.source ?? null,
                p_website_landing_page: sourceDetailValue
                  ? sourceDetailValue
                  : oppSourceDetailValue ?? null,
                p_lead_source: contactSource,
                p_lead_owner: currContact.assignedTo ?? null,
                p_lead_value: currOpportunity.monetaryValue ?? '0',

                p_is_author: currContact.type === 'author',
                p_current_author: oppActiveOrPastAuthor === 'yes',
                p_publisher: publisher ? publisher : oppPublisher ?? null,
                p_publishing_writing_process_stage: 'Unprovided',
                p_genre: oppGenre ? [oppGenre] : null,
                p_book_description: oppBookDescription,
                p_writing_status: oppWritingProcess ?? null,
                p_rating: pipelineName ?? oppPipelineBackup,
                p_pipeline_stage: pipelineStageName ?? null,
                p_stage_id: currOpportunity.pipelineStageId ?? null,
                p_pipeline_id: currOpportunity.pipelineId ?? null,

                p_create_date: null,
                p_alternate_create_date: null,
                p_lead_conversion_date: null,
                p_lead_id: null,
                p_last_modified_date: new Date().toISOString(),

                p_opt_out_of_emails: currContact.dnd ?? false,
                p_outreach_attempt: oppOutreachAttempt ?? '0',
                p_notes: null
              }
            )

            if (updateError) {
              throw new Error(
                `Error updating supabase contact ${currContact.firstName} ${
                  currContact.lastName
                }: ${JSON.stringify(updateError)}`
              )
            }

            updatedFactIDs.push(updateData[0].out_fact_id)

            const { error: updateOppIdError } = await supabase
              .from('fact_contacts')
              .update({
                ghl_opportunity_id: currOpportunity.id
              })
              .eq('ghl_contact_id', currContact.id)

            if (updateOppIdError) {
              throw new Error(
                `Error updating opportunity id: ${JSON.stringify(
                  updateOppIdError
                )}`
              )
            }
          } else {
            const { data: insertData, error: insertError } = await supabase.rpc(
              'insert_contact_to_star_schema',
              {
                p_first_name: currContact.firstName ?? null,
                p_last_name: currContact.lastName ?? null,
                p_email: currContact.email ?? null,
                p_phone_number: currContact.phone ?? null,
                p_full_address: fullAddress ?? null,

                p_address_line1: currContact.address1 ?? 'Unprovided',
                p_address_line2: null,
                p_city: currContact.city ?? null,
                p_state_region: currContact.state ?? null,
                p_postal_code: currContact.postalCode ?? null,
                p_country: currContact.country ?? null,
                p_time_zone: timezone ?? oppTimezone ?? null,

                p_source: currContact.source ?? currOpportunity.source ?? null,
                p_website_landing_page:
                  sourceDetailValue ?? oppSourceDetailValue ?? null,
                p_lead_source: contactSource ?? 'Unprovided',
                p_lead_owner: currContact.assignedTo ?? null,
                p_lead_value: currOpportunity.monetaryValue
                  ? String(currOpportunity.monetaryValue)
                  : null,

                p_is_author: currContact.type === 'author',
                p_current_author: oppActiveOrPastAuthor === 'yes',
                p_publisher: publisher ?? oppPublisher ?? null,
                p_publishing_writing_process_stage: 'Unprovided',
                p_genre: oppGenre ? [oppGenre] : [],
                p_book_description: oppBookDescription ?? null,
                p_writing_status: oppWritingProcess ?? null,
                p_rating: pipelineName ?? oppPipelineBackup ?? null,
                p_pipeline_stage: pipelineStageName ?? null,
                p_stage_id: currOpportunity.pipelineStageId ?? null,
                p_pipeline_id: currOpportunity.pipelineId ?? null,

                p_create_date:
                  currContact.createdBy?.timestamp ?? new Date().toISOString(),
                p_alternate_create_date: null,
                p_lead_conversion_date: null,
                p_lead_id: null,
                p_last_modified_date: new Date().toISOString(),

                p_opt_out_of_emails: currContact.dnd ?? false,
                p_outreach_attempt: oppOutreachAttempt ?? 0,
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

            const { error: updateOppIdError } = await supabase
              .from('fact_contacts')
              .update({
                ghl_opportunity_id: currOpportunity.id
              })
              .eq('ghl_contact_id', currContact.id)

            if (updateOppIdError) {
              console.error('Supabase update error details:', updateOppIdError)
              throw new Error(
                `Error updating contact ${currContact.firstName} ${currContact.lastName}: ${updateOppIdError.message}`
              )
            }

            const { einstein_url, fact_id, ghl_contact_id } = insertData[0]
            await addEinsteinURL({
              ghl_opportunity_id: currOpportunity.id,
              ghl_contact_id: ghl_contact_id,
              einstein_url: einstein_url
            })

            insertedFactIDS.push(fact_id)
          }
        } catch (error) {
          console.error(
            `Error processing page ${currPage}, #${currNumber}, ${currName}`,
            error
          )
          errorOpportunities.push(
            `Name: ${currName}, Email ${currEmail}, ContactID: ${currContactID}, Opportunity ID: ${currOpportunityID} Reason: ${error} `
          )
        }
      },
      CONCURRENCY
    )

    currPage++
  } catch (error) {
    console.error(
      `Error processing page ${currPage}, #${currNumber}, ${currName}`,
      error
    )
    errorOpportunities.push(
      `Name: ${currName}, Email ${currEmail}, ContactID: ${currContactID}, Opportunity ID: ${currOpportunityID} Reason: ${error} `
    )
    currPage++
    continue
  }
} while ((currOpportunityPage?.length ?? 0) !== 0)

const end = performance.now()
console.log(`Execution time: ${end - start} ms`)
