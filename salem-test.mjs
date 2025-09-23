import { createClient } from '@supabase/supabase-js'
import dotenv from 'dotenv'
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
      first_name: 'John',
      last_name: 'Doe',
      email: 'john.doe@example.com',
      phone: '555-123-4567',
      writing_process: 'I have finished writing my book',
      zip_code: '90210',
      source_detail_value: 'https://getmyguide.xulonpress.com'
    },
    method: 'POST'
  }
)

if (functionError) {
  console.log(functionError)
}
console.log(data)
