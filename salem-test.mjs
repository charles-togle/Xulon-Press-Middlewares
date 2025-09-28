import { createClient } from '@supabase/supabase-js'
import dotenv from 'dotenv'
import fs from 'fs'
import path from 'path'
dotenv.config()

const SUPABASE_URL = process.env.SUPABASE_URL
const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY
const EMAIL = process.env.SUPABASE_SUPERADMIN_EMAIL
const PASSWORD = process.env.SUPABASE_SUPERADMIN_PASSWORD

const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY)

// Load the formatted event messages
const jsonFilePath = path.join(
  process.cwd(),
  'json/formattedEventMessages-simple.json'
)
const contacts = JSON.parse(fs.readFileSync(jsonFilePath, 'utf8'))

console.log(
  `Loaded ${contacts.length} contacts from formattedEventMessages-simple.json`
)

const { error } = await supabase.auth.signInWithPassword({
  email: EMAIL,
  password: PASSWORD
})

console.log('logging in...')
if (error) {
  console.error('Error authenticating user: ', error)
  process.exit(0)
}

console.log('Authentication successful, starting edge function calls...')

// Track results
let successCount = 0
let errorCount = 0
const errors = []

// Process contacts in batches to avoid overwhelming the edge function
const batchSize = 5 // Adjust as needed
const delayBetweenBatches = 500 // 2 seconds between batches

for (let i = 0; i < contacts.length; i += batchSize) {
  const batch = contacts.slice(i, i + batchSize)
  console.log(
    `\nProcessing batch ${Math.floor(i / batchSize) + 1}/${Math.ceil(
      contacts.length / batchSize
    )} (contacts ${i + 1}-${Math.min(i + batchSize, contacts.length)})`
  )

  // Process each contact in the current batch
  const batchPromises = batch.map(async (contact, batchIndex) => {
    const globalIndex = i + batchIndex + 1
    try {
      console.log(
        `  ${globalIndex}. Processing: ${contact.first_name} ${contact.last_name} (${contact.email})`
      )

      const { data, error: functionError } = await supabase.functions.invoke(
        'salem_media_webhook',
        {
          body: {
            first_name: contact.first_name || '',
            last_name: contact.last_name || '',
            email: contact.email || '',
            phone: contact.phone || '',
            writing_process: contact.writing_process || '',
            zip_code: contact.zip_code || '',
            landing_page_id:
              contact.landing_page_id || 'https://getmyguide.xulonpress.com'
          },
          method: 'POST'
        }
      )

      if (functionError) {
        console.error(
          `  ❌ Error for ${contact.email}:`,
          functionError.message || functionError
        )
        errors.push({
          contact: `${contact.first_name} ${contact.last_name} (${contact.email})`,
          error: functionError.message || functionError
        })
        errorCount++
      } else {
        console.log(`  ✅ Success for ${contact.email}`)
        successCount++
      }

      return { success: !functionError, contact, data, error: functionError }
    } catch (error) {
      console.error(`  💥 Exception for ${contact.email}:`, error.message)
      errors.push({
        contact: `${contact.first_name} ${contact.last_name} (${contact.email})`,
        error: error.message
      })
      errorCount++
      return { success: false, contact, error }
    }
  })

  // Wait for current batch to complete
  await Promise.all(batchPromises)

  // Add delay between batches (except for the last batch)
  if (i + batchSize < contacts.length) {
    console.log(`  ⏳ Waiting ${delayBetweenBatches}ms before next batch...`)
    await new Promise(resolve => setTimeout(resolve, delayBetweenBatches))
  }
}

// Final summary
console.log('\n' + '='.repeat(50))
console.log('🎉 PROCESSING COMPLETE!')
console.log('='.repeat(50))
console.log(`📊 Total contacts processed: ${contacts.length}`)
console.log(`✅ Successful calls: ${successCount}`)
console.log(`❌ Failed calls: ${errorCount}`)
console.log(
  `📈 Success rate: ${((successCount / contacts.length) * 100).toFixed(1)}%`
)

if (errors.length > 0) {
  console.log(`\n❌ ERRORS (${errors.length}):`)
  errors.forEach((err, index) => {
    console.log(`${index + 1}. ${err.contact}: ${err.error}`)
  })
}

console.log('\nDone! 🚀')
