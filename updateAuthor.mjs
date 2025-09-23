const start = performance.now()

import { createClient } from '@supabase/supabase-js'
import dotenv from 'dotenv'
dotenv.config()

const SUPABASE_URL = process.env.SUPABASE_URL
const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY
const BASE_URL = process.env.BASE_URL || 'https://services.leadconnectorhq.com'
const API_VERSION = process.env.API_VERSION || '2021-07-28'
const TOKEN = process.env.TOKEN
const LOCATION_ID = process.env.LOCATION_ID
const EMAIL = process.env.SUPABASE_SUPERADMIN_EMAIL
const PASSWORD = process.env.SUPABASE_SUPERADMIN_PASSWORD
const GHL_HEADERS = {
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
console.log('Logged in, Welcome ', EMAIL)

const updateGhlContact = async (payload, contactId) => {
  const URL = `${BASE_URL}/contacts/${contactId}`
  const response = await fetch(URL, {
    body: JSON.stringify(payload),
    headers: GHL_HEADERS,
    method: 'PUT'
  })
  const contactInfo = await response.json()
  return contactInfo
}

const updateSupabaseStatus = async contactId => {
  const { error } = await supabase.rpc('update_author_upserted', {
    p_ghl_contact_id: contactId
  })
  if (error) {
    console.log(error)
    throw error
  }
}

const updateGhlOpportunity = async (payload, opportunityId) => {
  const URL = `${BASE_URL}/opportunities/${opportunityId}`
  const response = await fetch(URL, {
    body: JSON.stringify(payload),
    headers: GHL_HEADERS,
    method: 'PUT'
  })
  const opportunity_info = await response.json()
  return opportunity_info
}

const getAuthors = async () => {
  const { data, error } = await supabase.rpc('get_authors')

  if (error) {
    throw error
  }
  return data
}

const getCurrentAuthors = async () => {
  const { data, error } = await supabase.rpc('get_current_authors')

  if (error) {
    throw error
  }
  return data
}

try {
  const authors = await getAuthors()
  const currentAuthors = await getCurrentAuthors()

  //   for (const author of authors) {
  //     const contact_custom_fields = [
  //       {
  //         id: 'AMgJg4wIu7GKV02OGxD3',
  //         key: 'publisher',
  //         field_value: supabase_contact.publisher
  //       },
  //       {
  //         id: 'IjmRpmQlwHiJjGnTLptG',
  //         key: 'contact_source_detail',
  //         field_value: supabase_contact.lead_source ?? 'Unprovided'
  //       },
  //       {
  //         id: 'JMwy9JsVRTTzg4PDQnhk',
  //         key: 'source_detail_value_c',
  //         field_value: supabase_contact.website_landing_page ?? 'Unprovided'
  //       }
  //     ]
  //     const update_contact_payload = {
  //       assignedTo: supabase_contact.lead_owner,
  //       customFields: contact_custom_fields
  //     }
  //   }

  for (const currentAuthor of currentAuthors) {
    let name = `${currentAuthor.first_name} ${currentAuthor.last_name}`
    try {
      const opportunity_custom_fields = [
        {
          id: '4P0Yd0fLzOfns3opxTGo',
          key: 'active_or_past_author',
          field_value: currentAuthor.current_author
        }
      ]
      const opportunity_update_payload = {
        customFields: opportunity_custom_fields
      }

      const opportunityUpdate = await updateGhlOpportunity(
        opportunity_update_payload,
        currentAuthor.ghl_opportunity_id
      )

      if (!opportunityUpdate?.opportunity?.id) {
        throw new Error(
          `Update failed for ${name}. Response: ${JSON.stringify(
            opportunityUpdate
          )}`
        )
      }
      await updateSupabaseStatus(currentAuthor.ghl_contact_id)
      console.log(
        `Updated ${name}, Opportunity ID:${opportunityUpdate.opportunity.id}`
      )
    } catch (error) {
      console.log('failed to update ', name, ' ', error)
      continue
    }
  }
} catch (error) {
  console.log(error)
}
