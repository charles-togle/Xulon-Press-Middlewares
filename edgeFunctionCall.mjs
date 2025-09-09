import { createClient } from '@supabase/supabase-js'
import dotenv from 'dotenv'
dotenv.config()

const start = performance.now()
const EMAIL = process.env.SUPABASE_SUPERADMIN_EMAIL
const PASSWORD = process.env.SUPABASE_SUPERADMIN_PASSWORD
const SUPABASE_URL = process.env.SUPABASE_URL
const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY

const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY)

const sampleBody = {
  writing_process: 'I have not started writing my book yet',
  email: 'charlestogle@gmail.com',
  first_name: 'Charles',
  last_name: 'Togle',
  phone: '15419045565',
  zip_code: '12345',
  landing_page_id: 'https://www.salemoffers.com/campaign/ready-to-publish'
}

const { error: loginError } = await supabase.auth.signInWithPassword({
  email: EMAIL,
  password: PASSWORD
})
console.log('logging in...')
if (loginError) {
  console.error('Error authenticating user: ', loginError)
  process.exit(0)
}

const { data, error: functionError } = await supabase.functions.invoke(
  'updated_salem_webhook',
  {
    body: {
      ...sampleBody
    },
    method: 'POST'
  }
)

if (functionError) {
  console.log(functionError)
} else {
  console.log(data)
}

const end = performance.now()
console.log(`Execution time: ${end - start} ms`)
