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

const getNotesFromSupabase = async () => {
  const { data, error } = await supabase.rpc('get_contact_and_notes')
  if (error) {
    console.log(`Error fetching data: `, error)
    return
  }
  if (data.length === 0) {
    console.log('Supabase returned no records')
  }
  return data
}

const updateNoteStatus = async ({ ghl_contact_id }) => {
  const { error } = await supabase.rpc('update_notes_upserted', {
    p_ghl_contact_id: ghl_contact_id
  })
  if (error) {
    console.log(`Error fetching data: `, error)
    return
  }
}

const createGhlNote = async ({ note, contactId }) => {
  const notes_payload = {
    userId: 'JERtBepiajyLX1Pghv3T',
    body: note
  }

  const URL = `${BASE_URL}/contacts/${contactId}/notes/`

  const response = await fetch(URL, {
    body: JSON.stringify(notes_payload),
    headers: HEADERS,
    method: 'POST'
  })
  return response
}

const supabaseNotes = await getNotesFromSupabase()
let i = 1
for (const note of supabaseNotes) {
  try {
    console.log(`Processing note #${i}`)
    const noteResponse = createGhlNote({
      contactId: note.ghl_contact_id,
      note: note.notes
    })
    if ((noteResponse.statusText = 'Create')) {
      console.log(`Note ${i} has been created`)
      await updateNoteStatus({ ghl_contact_id: note.ghl_contact_id })
    }
    i++
  } catch (err) {
    console.log(err)
    break
  }
}

supabase.auth.signOut
const end = performance.now()
console.log(`Execution time: ${end - start} ms`)
