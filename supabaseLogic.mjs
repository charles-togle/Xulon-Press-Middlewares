//analytics
const start = performance.now()

import dotenv from 'dotenv'
dotenv.config()
import { createClient } from '@supabase/supabase-js'
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
    console.log('Error getting opportunity info', error)
    return null
  }
  return data[0]
}

const getContactData = async ({ uuid }) => {
  const { data, error } = await supabase.rpc('get_contact_details', {
    p_fact_id: uuid
  })

  if (error) {
    return error
  } else {
    return data
  }
}

const updateFactContactTable = async ({
  uuid,
  contactId,
  opportunityId,
  assignedUserId
}) => {
  const { data, error } = await supabase.rpc('update_last_assigned_at', {
    p_assigned_user_id: assignedUserId,
    p_fact_id: uuid,
    p_contact_id: contactId,
    p_opportunity_id: opportunityId
  })

  if (error) {
    return error
  } else {
    return `Successfully imported contact ${p_fact_id} to go high level`
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
    console.log('Error getting custom fields', error)
    return null
  }
  const cleanedData = combineFieldValues(data)
  return cleanedData
}

const getCustomOpportunityFields = async () => {
  const { data, error } = await supabase.rpc('get_custom_fields_with_options', {
    p_model: 'opportunity'
  })
  if (error) {
    console.log('Error getting custom fields', error)
    return null
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

//PROCESS

//get contact in supabase

const UUID = '6ccef93b-55fe-4c43-939e-01ff02e567a8'

const supabase_data = await getContactData({
  uuid: UUID
})

const supabase_contact = supabase_data[0]

//get pipeline stage, pipeline id, and salesperson id
let { pipeline_id, pipeline_stage_id, stage_position, assigned_user_id } =
  await getOpportunityExtraInfo({
    rating: '1. Hot', //get from supabase_contact.rating
    stage: 'Proposal Sent',
    publisher: '' //supabase_contact.publisher
  })

//get contacts custom fields
const contact_custom_fields = await getCustomContactFields()
const opportunity_custom_fields = await getCustomOpportunityFields()

// construct contact payload
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
const opportunity_payload = {
  pipelineId: pipeline_id,
  locationId: `${LOCATION_ID}`,
  name: 'First Opps',
  pipelineStageId: pipeline_stage_id,
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
    uuid: UUID,
    assignedUserId: assigned_user_id,
    contactId: contactId,
    opportunityId: opportunityId
  })
)

//analytics
const end = performance.now()
console.log(`Execution time: ${end - start} ms`)
