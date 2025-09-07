//analytics
const start = performance.now()

import { createClient } from '@supabase/supabase-js'
import dotenv from 'dotenv'
dotenv.config()
//=====SECRETS===============================================================
const SUPABASE_URL = process.env.SUPABASE_URL
const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY
const BASE_URL = process.env.BASE_URL
const API_VERSION = process.env.API_VERSION
const TOKEN = process.env.TOKEN
const LOCATION_ID = process.env.LOCATION_ID
// ==========================================================================

const HEADERS = {
  Authorization: `Bearer ${TOKEN}`,
  'Content-Type': 'application/json',
  Accept: 'application/json',
  Version: API_VERSION
}

const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY)

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
  assignedUserId
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
    return `Successfully imported contact ${uuid} to go high level`
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

  const contactInfo = await response.json()
  return contactInfo
}

const createGhlOpportunity = async payload => {
  const URL = `${BASE_URL}/opportunities/`

  const response = await fetch(URL, {
    body: JSON.stringify(payload),
    headers: HEADERS,
    method: 'POST'
  })

  const opportunity_info = await response.json()
  return opportunity_info
}

const createGhlNote = async payload => {
  const URL = `${BASE_URL}/contacts/:contactId/notes/`

  const response = await fetch(URL, {
    body: JSON.stringify(payload),
    headers: HEADERS,
    method: 'POST'
  })

  const opportunity_info = await response.json()
  return opportunity_info
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

for (const supabase_contact of supabase_bulk_data) {
  try {
    // get pipeline stage, pipeline id, and salesperson id
    let { pipeline_id, pipeline_stage_id, stage_position, assigned_user_id } =
      await getOpportunityExtraInfo({
        rating: supabase_contact.rating ?? '1. Hot',
        stage: supabase_contact.rating ?? 'Proposal Sent',
        publisher: supabase_contact.publisher ?? ' '
      })

    // get contacts custom fields
    const contact_custom_fields = await getCustomContactFields()
    const opportunity_custom_fields = await getCustomOpportunityFields()

    // construct contact payload (null coalescence preserved)
    const contact_payload = {
      firstName: supabase_contact.first_name ?? 'Unprovided',
      lastName: supabase_contact.last_name ?? 'Unprovided',
      name:
        `${supabase_contact.first_name} ${supabase_contact.last_name}` ??
        'Unprovided',
      email: supabase_contact.email ?? 'Unprovided',
      locationId: `${LOCATION_ID}`,
      phone: supabase_contact.phone_number ?? 'Unprovided',
      address1: supabase_contact.address_line1 ?? 'Unprovided',
      city: supabase_contact.city ?? 'Unprovided',
      state: supabase_contact.state_region ?? 'Unprovided',
      postalCode: supabase_contact.postalCode ?? 'Unprovided',
      website: supabase_contact.website_landing_page ?? 'Unprovided',
      timezone: supabase_contact.time_zone ?? 'Unprovided',
      dnd: supabase_contact.opt_out_of_email ?? false,
      inboundDndSettings: { all: { status: 'inactive', message: '' } },
      tags: ['client', 'lead', 'test-import'],
      customFields: contact_custom_fields,
      source: supabase_contact.lead_source ?? 'Unprovided',
      country: 'US',
      assignedTo: assigned_user_id
    }

    const contactResponseData = await createGhlContact(contact_payload)

    const notes_payload = {
      userId: contactResponseData.contact.id,
      body: supabase_contact.notes
    }

    await createGhlNote(notes_payload)

    const opportunity_payload = {
      pipelineId: supabase_contact.pipeline_id,
      locationId: `${LOCATION_ID}`,
      name:
        `${supabase_contact.first_name} ${supabase_contact.last_name}` ??
        'Unprovided',
      pipelineStageId: supabase_contact.stage_id,
      status: 'open',
      contactId: contactResponseData.contact.id,
      assignedTo: assigned_user_id,
      customFields: opportunity_custom_fields
    }

    const opportunityData = await createGhlOpportunity(opportunity_payload)

    const contactId = contactResponseData.contact.id
    const opportunityId = opportunityData.opportunity.id

    console.log(
      await updateFactContactTable({
        uuid: supabase_contact.fact_id,
        assignedUserId: assigned_user_id,
        contactId: contactId,
        opportunityId: opportunityId
      })
    )
  } catch (error) {
    console.error(
      `Error processing contact ${supabase_contact?.fact_id ?? 'unknown'}:`,
      error
    )
    // continue to next contact
    continue
  }
}

const end = performance.now()
console.log(`Execution time: ${end - start} ms`)
