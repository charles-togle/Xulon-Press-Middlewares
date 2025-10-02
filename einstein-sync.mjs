import { createClient } from '@supabase/supabase-js'
import dotenv from 'dotenv'
dotenv.config()

const SUPABASE_URL = process.env.SUPABASE_URL
const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY

const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY)

console.log('Starting orchestrator...')
console.log('This may take several minutes for large datasets...')

const startTime = Date.now()

try {
  const { data, error: functionError } = await supabase.functions.invoke(
    'sync_einstein_orchestrator', // Fix the function name
    {
      body: {} // Optional: can pass page_size here if needed
    }
  )

  if (functionError) {
    console.error('Function error:', functionError)
    process.exit(1)
  }

  const elapsed = ((Date.now() - startTime) / 1000).toFixed(2)
  console.log('\n✅ Sync complete!')
  console.log(`Total time: ${elapsed}s`)
  console.log('\nResults:')
  console.log(data)
} catch (err) {
  console.error('Unexpected error:', err)
  process.exit(1)
}
