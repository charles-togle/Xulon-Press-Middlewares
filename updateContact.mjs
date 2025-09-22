const start = performance.now()

import { createClient } from '@supabase/supabase-js'
import dotenv from 'dotenv'
import readline from 'readline'
import fs from 'fs'
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

const updateSupabaseStatus = async fact_id => {
  const { error } = await supabase.rpc('mark_fact_contact_for_update', {
    p_fact_id: fact_id
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

const getUpdateBulkData = async () => {
  const { data, error } = await supabase.rpc('get_contacts_that_needs_update ')

  if (error) {
    throw error
  }
  return data
}

let supabase_needs_update
let contact_update_errors = []
let i = 0
try {
  supabase_needs_update = await getUpdateBulkData()
} catch (err) {
  console.err('Failed Fetching Supabase Data', err)
}

console.log(supabase_needs_update.length)
for (const supabase_contact of supabase_needs_update) {
  try {
    const contact_custom_fields = [
      {
        id: 'AMgJg4wIu7GKV02OGxD3',
        key: 'publisher',
        field_value: supabase_contact.publisher
      },
      {
        id: 'IjmRpmQlwHiJjGnTLptG',
        key: 'contact_source_detail',
        field_value: supabase_contact.lead_source ?? 'Unprovided'
      },
      {
        id: 'JMwy9JsVRTTzg4PDQnhk',
        key: 'source_detail_value_c',
        field_value: supabase_contact.website_landing_page ?? 'Unprovided'
      }
    ]
    const update_contact_payload = {
      assignedTo: supabase_contact.lead_owner,
      customFields: contact_custom_fields
    }
    const updateContact = await updateGhlContact(
      update_contact_payload,
      supabase_contact.ghl_contact_id
    )
    if (!updateContact.succeded) {
      console.error(updateContact)
      throw error
    } else {
      console.log(
        `Success Updating contact for: ${supabase_contact.first_name} ${supabase_contact.last_name}`
      )
    }

    if (supabase_contact.ghl_opportunity_id) {
      const opportunity_custom_fields = [
        {
          id: 'ggsTQrS88hJgLI5J5604',
          key: 'publisher',
          field_value: supabase_contact.publisher ?? 'Unknown'
        },
        {
          id: 'UAjLmcYVz1hdI4sPVKSr',
          key: 'source_detail_value',
          field_value: supabase_contact.website_landing_page ?? 'Unprovided'
        }
      ]
      const opportunity_update_payload = {
        customFields: opportunity_custom_fields,
        assignedTo: supabase_contact.lead_owner
      }

      const opportunityUpdate = await updateGhlOpportunity(
        opportunity_update_payload,
        supabase_contact.ghl_opportunity_id
      )
      if (!opportunityUpdate.opportunity.id) {
        console.log(opportunity_update_payload)
        console.log('Opportunity Error: ', opportunityUpdate)
        throw error
      } else {
        console.log(
          `Success Updating opportunity for: ${supabase_contact.first_name} ${supabase_contact.last_name}`
        )
      }
    }
    console.log(
      `successfully updated detail number ${i++}, name: ${
        supabase_contact.first_name
      } ${supabase_contact.last_name}`
    )
    await updateSupabaseStatus(supabase_contact.fact_id)
  } catch (err) {
    console.log(
      `Error updating contact ${i++}, name: ${supabase_contact.first_name} ${
        supabase_contact.last_name
      }:`,
      err
    )
    contact_update_errors.push(
      `Error Updating Contact ${supabase_contact.fact_id}, Reason: `,
      err
    )
    continue
  }
}

console.log(contact_update_errors)

const end = performance.now()
console.log(`Execution time: ${end - start} ms`)

// try{

// }catch(e){

// }
