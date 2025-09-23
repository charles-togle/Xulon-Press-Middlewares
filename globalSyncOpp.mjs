import { createClient } from '@supabase/supabase-js'
import dotenv from 'dotenv'
dotenv.config()

let processedOpportunities = 0
let errorOpportunities = []
// Exit handlers
process.on('exit', code => {
  const end = performance.now()
  console.log('\n=== SCRIPT EXIT SUMMARY ===')
  console.log(`Exit code: ${code}`)
  console.log(`Total execution time: ${(end - start) / 1000} seconds`)
  console.log(`Contacts processed: ${processedOpportunities}`)
  console.log(`Error Contacts: `, errorOpportunities)
  console.log('===========================\n')
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

const getGhlOpportunties = async page => {
  const response = await fetch(
    `https://services.leadconnectorhq.com/opportunities/search?location_id=ztC7GrzfpwRrsyIBthNZ&page=${page}&limit=100`,
    {
      method: 'GET',
      headers: HEADERS
    }
  )
  const opportunity_info = await response.json()
  return opportunity_info
}

const getGhlContact = async contactId => {
  const URL = `https://services.leadconnectorhq.com/contacts/${contactId}`
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

let currPage = 1
let currNumber = 0
let currName
let currEmail
let currContactID
let currOpportunityID
let currOpportunityPage
let totalOpportunities = 0
do {
  try {
    const { opportunities } = await getGhlOpportunties(currPage, startAfter)
    currOpportunityPage = opportunities
    console.log(`Page ${currPage}: Found ${opportunities.length} opportunities`)
    totalOpportunities += opportunities.length

    for (
      let currOppIndex = 0;
      currOppIndex < opportunities.length;
      currOppIndex++
    ) {
      const currOpportunity = opportunities[currOppIndex]
      const fetchedContact = await getGhlContact(currOpportunity.contact.id)
      const { contact: currContact } = fetchedContact
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
      currName = `
      ${currContact.firstName} ${currContact.lastName}`
      currEmail = currContact.email
      currContactID = currContact.id
      currOpportunityID = currOpportunity.id

      const { data: pipelineNames, error: pipelineNamesError } =
        await supabase.rpc('get_pipeline_and_stage_names', {
          p_pipeline_id: currOpportunity.pipelineId,
          p_pipeline_stage_id: currOpportunity.pipelineStageId
        })
      if (pipelineNamesError) {
        throw new Error('Error getting pipeline names: ', pipelineNamesError)
      }

      const pipelineName = pipelineNames[0].pipeline_name
      const pipelineStageName = pipelineNames[0].stage_name

      const { data: checkExist, error: checkExistError } = await supabase
        .from('fact_contacts')
        .select('ghl_contact_id')
        .eq('ghl_contact_id', currContact.id)
        .maybeSingle()
      if (checkExistError) {
        throw new Error('Error checking for contact existence in supabase')
      }

      let contactExists
      if (checkExist?.ghl_contact_id) {
        contactExists = true
      } else {
        contactExists = false
      }

      const publisher = getCustomFieldValue(
        currContact.customFields,
        PUBLISHER_C
      )
      const timezone = getCustomFieldValue(currContact.customFields, TIMEZONE_C)
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
      if (contactExists) {
        console.log('Update')
        const { error: updateError } = await supabase.rpc(
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
            `Error updating supabase contact ${currContact.firstName} ${currContact.lastName}`,
            updateError
          )
        }
        const { error: updateOppIdError } = await supabase
          .from('fact_contacts')
          .update({
            ghl_opportunity_id: currOpportunity.id
          })
          .eq('ghl_contact_id', currContact.id)

        if (updateOppIdError) {
          throw new Error('Error updating opportunity id', updateOppIdError)
        }
      } else {
        console.log('Insert')
        const { error: insertError } = await supabase.rpc(
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
              currContact.createdBy.timestamp ?? new Date().toISOString(),
            p_alternate_create_date: null,
            p_lead_conversion_date: null,
            p_lead_id: null,
            p_last_modified_date: new Date().toISOString(),

            p_opt_out_of_emails: currContact.dnd ?? false,
            p_outreach_attempt: oppOutreachAttempt ?? null,
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
            `Error updating contact ${currContact.firstName} ${currContact.lastName}: ${updateError.message}`
          )
        }
      }
      processedOpportunities++
    }
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
} while (currOpportunityPage.length !== 0)

const end = performance.now()
console.log(`Execution time: ${end - start} ms`)
