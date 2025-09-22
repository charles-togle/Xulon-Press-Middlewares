import { createClient } from '@supabase/supabase-js'
import dotenv from 'dotenv'
import readline from 'readline'
import fs from 'fs'
dotenv.config()

const SUPABASE_URL = process.env.SUPABASE_URL
const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY
const EMAIL = process.env.SUPABASE_SUPERADMIN_EMAIL
const PASSWORD = process.env.SUPABASE_SUPERADMIN_PASSWORD

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

const { data, error: functionError } = await supabase.functions.invoke(
  'tdmdigital_webhook',
  {
    body: {
      first_name: 'Charles',
      last_name: 'Test',
      email: 'charles@vxlabs.co',
      phone: '12345678453',
      christian_publishing: 'Yes',
      writing_process: 'My book is ready now',
      zip_code: '32751',
      genre: 'Business',
      salutation: 'Mr.',
      services:
        'Cover/Book Design and Illustration, Editing and Proofreading, Self Publishing, ',
      address: '555 Winderley Pl suite 225',
      city: 'Maitland',
      state: 'FL',
      over18: 'Yes'
    },
    method: 'POST'
  }
)

if (functionError) {
  console.log(functionError)
}
console.log(data)
