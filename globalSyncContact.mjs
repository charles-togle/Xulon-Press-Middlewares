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
process.on('exit', code => {
  const end = performance.now()

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

    // Write text summary
    fs.writeFileSync(txtFile, textSummary)

    // Write JSON data for programmatic use
    fs.writeFileSync(jsonFile, JSON.stringify(summaryData, null, 2))

    console.log(`\nSummary files created:`)
    console.log(`Text: ${txtFile}`)
    console.log(`JSON: ${jsonFile}`)
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
  process.exit(0)
}
console.log(`Log In Success: "Welcome ${EMAIL}"`)

const searchGhlContact = async (page, searchAfter) => {
  const body = {
    locationId: LOCATION_ID,
    page: page,
    pageLimit: 500
  }
  if (searchAfter) {
    body['searchAfter'] = searchAfter
  }

  const response = await fetch(`${BASE_URL}/contacts/search`, {
    method: 'POST',
    headers: HEADERS,
    body: JSON.stringify(body)
  })
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

let currPage = 1
let currNumber = 0
let currContactPage
let totalContacts = 0
do {
  try {
    const { contacts } = await searchGhlContact(currPage, searchAfter)
    currContactPage = contacts
    console.log(`Page ${currPage}: Found ${contacts.length} Contacts`)
    totalContacts += contacts.length
    for (
      let currContactIndex = 0;
      currContactIndex < contacts.length;
      currContactIndex++
    ) {
      try {
        const currContact = contacts[currContactIndex]
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

        const { data: checkExist, error: checkExistError } = await supabase
          .from('fact_contacts')
          .select('ghl_contact_id')
          .eq('ghl_contact_id', currContact.id)
        if (checkExistError) {
          throw new Error(
            `Error checking for contact existence in supabase reason: ${JSON.stringify(
              checkExistError
            )}, ${currContact.id}`
          )
        }
        let contactExists
        if (checkExist[0]?.ghl_contact_id) {
          contactExists = true
        } else {
          console.log(checkExistError)
          contactExists = false
        }

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
        searchAfter = currContact.searchAfter
        processedContacts++
        if (contactExists) {
          console.log('Update')
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
          console.log('Insert')
          const { data: insertData, error: insertError } = await supabase.rpc(
            'insert_contact_to_star_schema',
            {
              p_first_name: currContact.firstName ?? null,
              p_last_name: currContact.lastName ?? null,
              p_email: currContact.email ?? null,
              p_phone_number: currContact.phone ?? null,
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
              p_genre: null,
              p_book_description: null,
              p_writing_status: null,
              p_rating: null,
              p_pipeline_stage: null,
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
      } catch (error) {
        console.error(
          `Error processing page ${currPage}, #${currNumber}, ${currName}`,
          error
        )

        errorContacts.push(
          `Name: ${currName}, Email ${currEmail}, ContactID: ${currContactID}, Reason: ${error} `
        )
      }
    }
    currPage++
  } catch (error) {
    console.error(
      `Error processing page ${currPage}, #${currNumber}, ${currName}`,
      error
    )

    errorContacts.push(
      `Name: ${currName}, Email ${currEmail}, ContactID: ${currContactID}, Reason: ${error} `
    )
    currPage++
    continue
  }
} while (currContactPage.length !== 0)

const end = performance.now()
console.log(`Execution time: ${end - start} ms`)
