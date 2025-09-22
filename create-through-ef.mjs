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
  'salem_media_webhook',
  {
    body: {
      email: 'charles@vxlabs.co',
      first_name: 'Charles',
      last_name: 'Test',
      writing_process: 'I will be finished writing in 90 days',
      zip_code: '12345'
    },
    method: 'POST'
  }
)

if (functionError) {
  console.log(functionError)
}
console.log(data)
