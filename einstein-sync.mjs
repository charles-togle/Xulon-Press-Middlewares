import { createClient } from '@supabase/supabase-js'
import dotenv from 'dotenv'
dotenv.config()

const SUPABASE_URL = process.env.SUPABASE_URL
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY)
console.log('Starting orchestrator...')
console.log('This may take several minutes for large datasets...')

const startTime = Date.now()

try {
  const { data, error: functionError } = await supabase.functions.invoke(
    'sync-einstein-query-batch',
    {
      body: {
        limit: 2000,
        offset: 0,
        chain: true, // let it auto-chain until done
        max_hops: 50 // safety cap for chaining
        // run_id: 'optional-fixed-run-id'
      }
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
