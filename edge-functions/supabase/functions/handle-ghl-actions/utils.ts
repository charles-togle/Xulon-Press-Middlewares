import { SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2.56.1'

const BASE_URL = 'https://services.leadconnectorhq.com'
const API_VERSION = '2021-07-28'
const TOKEN = Deno.env.get('GHL_TOKEN')
const LOCATION_ID = Deno.env.get('GHL_LOCATION_ID')
const GHL_HEADERS = {
  Authorization: `Bearer ${TOKEN}`,
  'Content-Type': 'application/json',
  Accept: 'application/json',
  Version: API_VERSION
}
const createGhlOpportunity = async (payload: {}) => {
  const URL = `${BASE_URL}/opportunities/`
  const response = await fetch(URL, {
    body: JSON.stringify(payload),
    headers: GHL_HEADERS,
    method: 'POST'
  })
  const opportunity_info = await response.json()
  return opportunity_info
}
const updateGhlOpportunity = async (
  payload: {},
  opportunityId: string | undefined
) => {
  const URL = `${BASE_URL}/opportunities/${opportunityId}`
  const response = await fetch(URL, {
    body: JSON.stringify(payload),
    headers: GHL_HEADERS,
    method: 'PUT'
  })
  const opportunity_info = await response.json()
  return opportunity_info
}
const searchGhlOpportunity = async (contactId: string | undefined) => {
  const URL = `${BASE_URL}/opportunities/search?location_id=${LOCATION_ID}&contact_id=${contactId}`
  const response = await fetch(URL, {
    method: 'GET',
    headers: GHL_HEADERS
  })
  const opportunity_info = await response.json()
  return opportunity_info
}
const createGhlNote = async (payload: {}, contactId: string | undefined) => {
  const URL = `${BASE_URL}/contacts/${contactId}/notes/`
  const response = await fetch(URL, {
    body: JSON.stringify(payload),
    headers: GHL_HEADERS,
    method: 'POST'
  })
  const note_info = await response.json()
  return note_info
}

const updateGhlContact = async (payload: {}, contactId: string | undefined) => {
  const URL = `${BASE_URL}/contacts/${contactId}`
  const response = await fetch(URL, {
    body: JSON.stringify(payload),
    headers: GHL_HEADERS,
    method: 'PUT'
  })
  const contactInfo = await response.json()
  return contactInfo
}
interface UpdateFactContactTableParams {
  uuid: string | undefined
  contactId: string | undefined
  opportunityId: string | undefined
  assignedUserId: string | null
  supabaseClient: SupabaseClient
}

const updateFactContactTable = async ({
  uuid,
  contactId,
  opportunityId,
  assignedUserId,
  supabaseClient
}: UpdateFactContactTableParams) => {
  const { error } = await supabaseClient.rpc('update_last_assigned_at', {
    p_assigned_user_id: assignedUserId ?? null,
    p_fact_id: uuid,
    p_contact_id: contactId,
    p_opportunity_id: opportunityId
  })
  if (error) {
    console.error(error)
    throw error
  } else {
    return `Successfully Updated Contact ${uuid}`
  }
}

const searchGhlContact = async (contactId: string | undefined) => {
  const filters = {
    locationId: LOCATION_ID,
    page: 1,
    pageLimit: 20,
    filters: [
      {
        field: 'id',
        operator: 'eq',
        value: contactId
      }
    ]
  }

  const URL = `${BASE_URL}/contacts/search`
  const response = await fetch(URL, {
    method: 'POST',
    headers: GHL_HEADERS,
    body: JSON.stringify(filters)
  })
  const contact = await response.json()
  return contact
}

interface OpportunityExtraInfoParams {
  rating: string | undefined
  stage: string | undefined
  publisher: string | undefined
  supabaseClient: SupabaseClient
}
const getOpportunityExtraInfo = async ({
  rating,
  stage,
  publisher,
  supabaseClient
}: OpportunityExtraInfoParams) => {
  const { data, error } = await supabaseClient.rpc(
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

function compareObjects (
  objA: Record<string, unknown>,
  objB: Record<string, unknown>,
  objKeys: string[]
): boolean {
  for (const key of objKeys) {
    if (objA[key] !== objB[key]) {
      return false
    }
  }
  return true
}

export {
  compareObjects,
  createGhlNote,
  createGhlOpportunity,
  getOpportunityExtraInfo,
  searchGhlContact,
  searchGhlOpportunity,
  updateFactContactTable,
  updateGhlContact,
  updateGhlOpportunity
}
