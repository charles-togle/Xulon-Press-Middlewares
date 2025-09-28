import { createClient } from '@supabase/supabase-js'
import dotenv from 'dotenv'
dotenv.config()

const SUPABASE_URL = process.env.SUPABASE_URL
const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY
const EMAIL = process.env.SUPABASE_SUPERADMIN_EMAIL
const PASSWORD = process.env.SUPABASE_SUPERADMIN_PASSWORD

const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY)

console.log('logging in...')
const { error } = await supabase.auth.signInWithPassword({
  email: EMAIL,
  password: PASSWORD
})

if (error) {
  console.error('Error authenticating user: ', error)
  process.exit(0)
}

console.log('Authentication successful, calling resend-integration...')

const { data, error: functionError } = await supabase.functions.invoke(
  'resend-integration',
  {
    body: {
      email: 'charles3togle@gmail.com',
      firstName: 'Charles',
      lastName: 'Togle',
      publisher: 'mill city press',
      opt_out_of_email: false,
      type: 'author',
      eventType: 'contact-update'
    },
    method: 'POST'
  }
)

if (functionError) {
  console.log('Function Error:', functionError)
} else {
  console.log('Success! Response data:', data)
}
