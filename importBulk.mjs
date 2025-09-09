//analytics
const start = performance.now()

import { createClient } from '@supabase/supabase-js'
import dotenv from 'dotenv'
dotenv.config()
import util from 'util'
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

const { error } = await supabase.auth.signInWithPassword({
  email: EMAIL,
  password: PASSWORD
})
console.log('logging in...')
if (error) {
  console.error('Error authenticating user: ', error)
  process.exit(0)
}

//Database Request
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
    // throw so callers can handle this in try/catch
    throw error
  }
  return data[0]
}

const getContactBulkData = async ({ limit }) => {
  const { data, error } = await supabase.rpc('get_unassigned_contact_details', {
    p_limit: limit
  })

  if (error) {
    // throw on error
    throw error
  }
  return data
}

const updateFactContactTable = async ({
  uuid,
  contactId,
  opportunityId,
  assignedUserId,
  number
}) => {
  const { error } = await supabase.rpc('update_last_assigned_at', {
    p_assigned_user_id: assignedUserId,
    p_fact_id: uuid,
    p_contact_id: contactId,
    p_opportunity_id: opportunityId
  })

  if (error) {
    throw error
  } else {
    return `Contact #${i}: Successfully imported contact ${uuid} to go high level`
  }
}

//helper function for custom fields
function combineFieldValues (data) {
  const map = new Map()

  data.forEach(item => {
    const key = `${item.id}:${item.key}`
    if (!map.has(key)) {
      map.set(key, { id: item.id, key: item.key, field_value: [] })
    }
    map.get(key).field_value.push(item.field_value)
  })

  return Array.from(map.values()).map(obj => ({
    id: obj.id,
    key: obj.key,
    field_value:
      obj.field_value.length === 1 ? obj.field_value[0] : obj.field_value
  }))
}

//Custom Fields
const getCustomContactFields = async () => {
  const { data, error } = await supabase.rpc('get_custom_fields_with_options', {
    p_model: 'contact'
  })
  if (error) {
    // allow caller to handle failures
    throw error
  }
  const cleanedData = combineFieldValues(data)
  return cleanedData
}

const getCustomOpportunityFields = async () => {
  const { data, error } = await supabase.rpc('get_custom_fields_with_options', {
    p_model: 'opportunity'
  })
  if (error) {
    throw error
  }
  const cleanedData = combineFieldValues(data)
  return cleanedData
}

//GHL API REQUESTS
const createGhlContact = async payload => {
  const URL = `${BASE_URL}/contacts`

  const response = await fetch(URL, {
    body: JSON.stringify(payload),
    headers: HEADERS,
    method: 'POST'
  })

  console.log(
    'remaining number of requests in the current 10s time interval: ',
    response.headers.get('X-RateLimit-Remaining')
  )
  console.log(
    'Time interval for burst requests: ',
    response.headers.get('X-RateLimit-Interval-Milliseconds')
  )

  const contactInfo = await response.json()
  return contactInfo
}

let dailyRemaining
let dailyLimit

const createGhlOpportunity = async (payload, getResponseHeaders) => {
  const URL = `${BASE_URL}/opportunities/`

  const response = await fetch(URL, {
    body: JSON.stringify(payload),
    headers: HEADERS,
    method: 'POST'
  })

  if (getResponseHeaders) {
    dailyRemaining = response.headers.get('X-RateLimit-Daily-Remaining')
    dailyLimit = response.headers.get('X-RateLimit-Limit-Daily')
  }

  console.log(
    'remaining number of requests in the current 10s time interval: ',
    response.headers.get('X-RateLimit-Remaining')
  )
  console.log(
    'Time interval for burst requests: ',
    response.headers.get('X-RateLimit-Interval-Milliseconds')
  )
  const opportunity_info = await response.json()
  return opportunity_info
}

const createGhlNote = async (payload, contactId) => {
  const URL = `${BASE_URL}/contacts/${contactId}/notes/`

  const response = await fetch(URL, {
    body: JSON.stringify(payload),
    headers: HEADERS,
    method: 'POST'
  })

  console.log(
    'remaining number of requests in the current 10s time interval: ',
    response.headers.get('X-RateLimit-Remaining')
  )
  console.log(
    'Time interval for burst requests: ',
    response.headers.get('X-RateLimit-Interval-Milliseconds')
  )
  const note_info = await response.json()
  return note_info_info
}

//PROCESS

//get contact in supabase

const SUPABASE_RETURN_LIMIT = 10 //how many bulk data will be returned
let supabase_bulk_data
try {
  supabase_bulk_data = await getContactBulkData({
    limit: SUPABASE_RETURN_LIMIT
  })
} catch (error) {
  console.error('Error fetching bulk contact data from Supabase:', error)
  process.exit(1)
}

// if no data returned, inform and skip processing
if (!Array.isArray(supabase_bulk_data) || supabase_bulk_data.length === 0) {
  console.log(
    'No records returned from Supabase — every record already imported. Ending process.'
  )
  process.exit(0)
}
let i = 1
let contact_response
let opportunity_response
let contact_payload_error
let current_fact_id

for (const supabase_contact of supabase_bulk_data) {
  try {
    current_fact_id = supabase_contact.fact_id
    if (
      supabase_contact.ghl_contact_id === 'DUPLICATE' &&
      supabase_contact.ghl_opportunity_id === 'DUPLICATE'
    ) {
      console.log(
        `Contact #${i} is a duplicate, name: ${supabase_contact.first_name} ${supabase_contact.last_name}`
      )
      continue
    }

    let { assigned_user_id } = await getOpportunityExtraInfo({
      rating: '1. Hot',
      stage: 'Proposal Sent',
      publisher: supabase_contact.publisher ?? ' '
    })

    //if the contact is already assigned use their assigned id, else use round robin
    assigned_user_id = supabase_contact.lead_owner
      ? supabase_contact.lead_owner
      : assigned_user_id
    //custom fields
    const contact_custom_fields = [
      {
        id: 'AMgJg4wIu7GKV02OGxD3',
        key: 'publisher',
        field_value: supabase_contact.publisher
      },
      {
        id: 'fFWUJ9OFbYBqVJjwjQGP',
        key: 'timezone_c',
        field_value: supabase_contact.time_zone ?? 'Unprovided'
      },
      {
        id: 'ZXykBROLtnEh5A5vaT2B',
        key: 'active_campaigns_c',
        field_value: []
      },
      {
        id: 'IjmRpmQlwHiJjGnTLptG',
        key: 'contact_source_detail',
        field_value:
          supabase_contact.lead_source === ''
            ? 'Unprovided'
            : supabase_contact.lead_source
      },
      {
        id: 'JMwy9JsVRTTzg4PDQnhk',
        key: 'source_detail_value_c',
        field_value: supabase_contact.website_landing_page ?? 'Unprovided'
      }
    ]

    const opportunity_custom_fields = [
      {
        id: 'ggsTQrS88hJgLI5J5604',
        key: 'publisher',
        field_value: supabase_contact.publisher
      },
      {
        id: 'gsFwmLo8XyzCjIoXxXYQ',
        key: 'timezone',
        field_value: supabase_contact.time_zone
      },
      {
        id: '4P0Yd0fLzOfns3opxTGo',
        key: 'active_or_past_author',
        field_value: supabase_contact.is_author ? 'Yes' : 'No'
      },
      {
        id: '5wlgHZzuWLyr918dMh7y',
        key: 'genre',
        field_value: supabase_contact.genre[0]
      },
      {
        id: 'cG5oYGyyKmEWwzn7y8HA',
        key: 'writing_process',
        field_value: supabase_contact.writing_status
      },
      {
        id: 'BOGtp8xLezwurePxIkNE',
        key: 'outreach_attempt',
        field_value: `${supabase_contact.outreach_attempt}`
      },
      {
        id: '5lDyHBJDAukD5YM7M4WG',
        key: 'proposal_link',
        field_value: supabase_contact.einstein_url
      },
      {
        id: 'aOH64ZsyJ5blAZtf9IxK',
        key: 'book_description',
        field_value: supabase_contact.book_description
      },
      {
        id: 'uUEENCZJBnr0mjbuPe98',
        key: 'pipeline_backup',
        field_value: supabase_contact.rating
      },
      {
        id: 'UAjLmcYVz1hdI4sPVKSr',
        key: 'source_detail_value',
        field_value: supabase_contact.website_landing_page ?? 'Unprovided'
      }
    ]

    // construct contact payload
    let contact_payload = {
      firstName: supabase_contact.first_name ?? 'Unprovided',
      lastName: supabase_contact.last_name ?? 'Unprovided',
      name:
        `${supabase_contact.first_name} ${supabase_contact.last_name}` ??
        'Unprovided',
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
      country:
        supabase_contact.country === 'Unprovided' || !supabase_contact.country
          ? 'US'
          : supabase_contact.country,
      assignedTo: assigned_user_id
    }
    contact_payload_error = contact_payload

    console.log(util.inspect(contact_payload, false, null, true))
    //check the values
    if (supabase_contact.opt_out_of_email) {
      contact_payload['dndSettings'] = {
        Email: { status: 'active', message: '', code: '' }
      }
    } else {
      contact_payload['dndSettings'] = {
        Email: { status: 'inactive', message: '', code: '' }
      }
    }

    if (supabase_contact.email && supabase_contact.email !== 'Unprovided') {
      contact_payload['email'] = supabase_contact.email
    }

    if (
      supabase_contact.phone_number &&
      supabase_contact.phone_number !== 'Unprovided'
    ) {
      contact_payload['phone'] = supabase_contact.phone_number
    }

    let contact_id = supabase_contact.ghl_contact_id
    if (!contact_id) {
      const contactResponseData = await createGhlContact(contact_payload)
      contact_response = contactResponseData
      contact_id = contactResponseData.contact.id
    }

    const einstein_notes_payload = {
      userId: 'JERtBepiajyLX1Pghv3T',
      body: `Proposal Link: \n\n ${supabase_contact.einstein_url}`
    }

    if (!supabase_contact.notes || supabase_contact.notes === 'Unprovided') {
      const notes_payload = {
        userId: 'JERtBepiajyLX1Pghv3T',
        body: supabase_contact.notes
      }

      const defNotes = await createGhlNote(notes_payload, contact_id)
    }

    const einsteinNotes = await createGhlNote(
      einstein_notes_payload,
      contact_id
    )

    const opportunity_payload = {
      pipelineId: supabase_contact.pipeline_id,
      locationId: `${LOCATION_ID}`,
      name:
        `${supabase_contact.first_name} ${supabase_contact.last_name}` ??
        'Unprovided',
      pipelineStageId: supabase_contact.stage_id,
      status: 'open',
      contactId: contact_id,
      assignedTo: assigned_user_id,
      customFields: opportunity_custom_fields,
      source: supabase_contact.source ?? 'Unprovided'
    }

    const opportunityData = await createGhlOpportunity(
      opportunity_payload,
      i >= supabase_bulk_data.length
    )
    opportunity_response = opportunityData

    const opportunityId = opportunityData.opportunity.id

    console.log(
      await updateFactContactTable({
        uuid: supabase_contact.fact_id,
        assignedUserId: assigned_user_id,
        contactId: contact_id,
        opportunityId: opportunityId,
        number: i
      })
    )
    i++
  } catch (error) {
    console.error(
      `Contact #${i}: Error processing contact ${
        supabase_contact?.fact_id ?? 'unknown'
      }:`,
      error
    )
    console.log(contact_payload_error)
    console.error(console.error('Error creating contact: ', contact_response))
    if (
      (contact_response.message =
        'This location does not allow duplicated contacts.')
    ) {
      await supabase.rpc('mark_fact_contact_duplicate', {
        p_fact_id: current_fact_id
      })
    }

    if (opportunity_response) {
      console.error('Error creating opportunity: ', opportunity_response)
    }
    i++
    continue
  } finally {
    supabase.auth.signOut
    console.log(`Daily Remaining Limit: ${dailyRemaining}/${dailyLimit}`)
  }
}

const end = performance.now()
console.log(`Execution time: ${end - start} ms`)
