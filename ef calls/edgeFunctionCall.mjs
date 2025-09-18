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
  first_name: 'Chef',
  last_name: 'Matt',
  email: 'chefmatt@cookbooks.com',
  phone: '7084792074',
  christian_publishing: 'Yes',
  writing_process: 'My book is ready now',
  zip_code: '60004',
  genre: 'Cooking',
  salutation: 'Mr.',
  services:
    'Book Printing, Book Review Services, Coaching/Consulting, Cover/Book Design and Illustration, eBook Services, Editing and Proofreading, Ghostwriting, Literary Agent, Query Letter Services, Self Publishing, Traditional Publishing, Website/Web Design, Writing Tools/Apps, ',
  address: '14 Elm St',
  city: 'Arlington',
  state: 'IL',
  over18: 'Yes'
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

console.log(`Log In Sucess: "Welcome Super ${EMAIL}`)

const { data, error: functionError } = await supabase.functions.invoke(
  'updated_tdm_webhook',
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
