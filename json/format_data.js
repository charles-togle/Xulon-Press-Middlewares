// Script to format the unformatted event messages into proper JSON
import fs from 'fs'
import path from 'path'

// Read the unformatted file
const inputFile =
  'c:\\Users\\charl\\Documents\\Projects\\Commisions\\Xulon Press\\json\\unformattedEventMessage.js'
const content = fs.readFileSync(inputFile, 'utf8')

console.log('Starting data formatting...')

// Function to clean and extract value from a field
function extractValue (text, fieldName) {
  const pattern = new RegExp(`${fieldName}\\s*:\\s*([^,}]+)`, 'i')
  const match = text.match(pattern)
  if (match) {
    return match[1].trim().replace(/["']/g, '') // Remove quotes
  }
  return null
}

// Function to clean phone numbers
function cleanPhone (phone) {
  if (!phone) return null
  return phone.replace(/[^\d]/g, '') // Keep only digits
}

// Function to clean zip codes
function cleanZipCode (zip) {
  if (!zip) return null
  return zip.replace(/[^\d]/g, '').substring(0, 5) // Keep only first 5 digits
}

// Split content into individual records
const recordBlocks = content.split(/\s*{\s*/).slice(1) // Remove empty first element

const formattedRecords = []
let recordNumber = 0

recordBlocks.forEach((block, index) => {
  // Only process blocks that contain email (valid records)
  if (block.includes('email')) {
    recordNumber++

    try {
      // Extract all fields
      const email = extractValue(block, 'email')
      const firstName = extractValue(block, 'first_name')
      const lastName = extractValue(block, 'last_name')
      const phone = extractValue(block, 'phone')
      const zipCode = extractValue(block, 'zip_code')
      const writingProcess = extractValue(block, 'writing_process')
      const landingPageId = extractValue(block, 'landing_page_id')

      // Create formatted record
      const record = {
        email: email || '',
        first_name: firstName || '',
        last_name: lastName || '',
        phone: cleanPhone(phone),
        zip_code: cleanZipCode(zipCode),
        writing_process: writingProcess || '',
        landing_page_id: landingPageId || ''
      }

      // Only add records that have at least email and first name
      if (record.email && record.first_name) {
        formattedRecords.push(record)
      } else {
        console.log(
          `Warning: Skipping incomplete record ${recordNumber} - missing email or first_name`
        )
      }
    } catch (error) {
      console.error(`Error processing record ${recordNumber}:`, error)
      console.log(`Block content: ${block.substring(0, 200)}...`)
    }
  }
})

console.log(`\\nProcessing complete!`)
console.log(`Total records processed: ${formattedRecords.length}`)

// Create output object
const outputData = {
  metadata: {
    source_file: 'unformattedEventMessage.js',
    processed_at: new Date().toISOString(),
    total_records: formattedRecords.length,
    unique_emails: [...new Set(formattedRecords.map(r => r.email))].length,
    processing_notes: [
      'Phone numbers cleaned to digits only',
      'Zip codes limited to 5 digits',
      'Records without email or first_name were skipped'
    ]
  },
  records: formattedRecords
}

// Write formatted JSON file
const outputDir =
  'c:\\Users\\charl\\Documents\\Projects\\Commisions\\Xulon Press\\json'
const outputFile = path.join(outputDir, 'formattedEventMessages.json')

try {
  fs.writeFileSync(outputFile, JSON.stringify(outputData, null, 2), 'utf8')
  console.log(`\\n✅ Successfully created formatted JSON file:`)
  console.log(`📁 ${outputFile}`)
  console.log(`📊 ${formattedRecords.length} records saved`)

  // Also create a simplified version with just the records array
  const simpleOutputFile = path.join(
    outputDir,
    'formattedEventMessages-simple.json'
  )
  fs.writeFileSync(
    simpleOutputFile,
    JSON.stringify(formattedRecords, null, 2),
    'utf8'
  )
  console.log(`📁 ${simpleOutputFile} (simple array format)`)
} catch (error) {
  console.error('❌ Error writing output file:', error)
}

// Generate summary report
console.log(`\\n=== FORMATTING SUMMARY ===`)
console.log(`📧 Total emails: ${formattedRecords.length}`)
console.log(
  `🏷️  Unique emails: ${
    [...new Set(formattedRecords.map(r => r.email))].length
  }`
)
console.log(
  `📱 Records with phone: ${formattedRecords.filter(r => r.phone).length}`
)
console.log(
  `📮 Records with zip_code: ${formattedRecords.filter(r => r.zip_code).length}`
)

// Check for duplicates
const emailCounts = {}
formattedRecords.forEach(record => {
  emailCounts[record.email] = (emailCounts[record.email] || 0) + 1
})

const duplicates = Object.entries(emailCounts).filter(
  ([email, count]) => count > 1
)
if (duplicates.length > 0) {
  console.log(`\\n⚠️  DUPLICATE EMAILS FOUND:`)
  duplicates.forEach(([email, count]) => {
    console.log(`   ${email}: ${count} times`)
  })
}

// Sample of writing processes
const writingProcesses = [
  ...new Set(formattedRecords.map(r => r.writing_process))
]
console.log(
  `\\n📝 Writing process categories (${writingProcesses.length} unique):`
)
writingProcesses.slice(0, 5).forEach(process => {
  console.log(`   • ${process}`)
})
if (writingProcesses.length > 5) {
  console.log(`   ... and ${writingProcesses.length - 5} more`)
}

console.log(`\\n🎉 Formatting complete! Check the output files.`)
