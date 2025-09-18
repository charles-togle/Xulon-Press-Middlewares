import { createClient } from '@supabase/supabase-js'
import dotenv from 'dotenv'
import fs from 'fs/promises'
dotenv.config()

const start = performance.now()
const EMAIL = process.env.SUPABASE_SUPERADMIN_EMAIL
const PASSWORD = process.env.SUPABASE_SUPERADMIN_PASSWORD
const SUPABASE_URL = process.env.SUPABASE_URL
const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY

const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY)

const { error: loginError } = await supabase.auth.signInWithPassword({
  email: EMAIL,
  password: PASSWORD
})

console.log('logging in...')
if (loginError) {
  console.error('Error authenticating user: ', loginError)
  process.exit(0)
}
console.log(`Log In Success: "Welcome Super ${EMAIL}"`)

// Read and parse the JSON file
const bodies = JSON.parse(await fs.readFile('./preformattedTdm.json', 'utf-8'))

for (const [i, body] of bodies.entries()) {
  try {
    const { data, error: functionError } = await supabase.functions.invoke(
      'updated_tdm_webhook',
      {
        body,
        method: 'POST'
      }
    )
    if (functionError) {
      console.error(`Error on record ${i + 1}:`, functionError)
    } else {
      console.log(`Success on record ${i + 1}:`, data)
    }
  } catch (err) {
    console.error(`Exception on record ${i + 1}:`, err)
  }
}

const end = performance.now()
console.log(`Execution time: ${end - start} ms`)
