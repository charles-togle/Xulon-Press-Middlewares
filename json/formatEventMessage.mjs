import fs from 'fs'

function extractPayloadsToJson (inputFile, outputFile = 'payloads.json') {
  const rawData = fs.readFileSync(inputFile, 'utf-8')
  const data = JSON.parse(rawData)

  const cleaned = []
  const failed = []

  for (let i = 0; i < data.length; i++) {
    const entry = data[i]
    let objStr = entry.event_message || ''

    if (!objStr.trim().startsWith('{')) {
      failed.push({
        index: i,
        reason: 'not_json',
        preview: objStr.substring(0, 50)
      })
      continue
    }

    // Check if truncated (contains ... or ends abruptly)
    if (
      objStr.includes('...') ||
      objStr.includes('htt...') ||
      objStr.includes('https://ww...')
    ) {
      failed.push({
        index: i,
        reason: 'truncated',
        preview: objStr.substring(0, 100)
      })
      continue
    }

    try {
      // Clean up newlines and extra whitespace
      objStr = objStr.replace(/\n/g, '').replace(/\s+/g, ' ')

      // Fix unquoted keys (only if they're not already quoted)
      objStr = objStr.replace(
        /(\s|{)\s*([a-zA-Z_][a-zA-Z0-9_]*)\s*:/g,
        '$1"$2":'
      )

      // Remove any trailing commas before closing braces
      objStr = objStr.replace(/,(\s*})/g, '$1')

      const payload = JSON.parse(objStr)
      cleaned.push(payload)
      console.log(`Entry ${i}: ✓ Successfully parsed`)
    } catch (err) {
      failed.push({
        index: i,
        reason: err.message,
        preview: objStr.substring(0, 100),
        processed: objStr.substring(0, 200)
      })
      console.log(`Entry ${i}: ✗ Failed - ${err.message}`)
    }
  }

  console.log(`\n=== SUMMARY ===`)
  console.log(`Total entries: ${data.length}`)
  console.log(`Successfully extracted: ${cleaned.length}`)
  console.log(`Failed: ${failed.length}`)

  // Breakdown of failures
  if (failed.length > 0) {
    const failureTypes = failed.reduce((acc, f) => {
      const reason = f.reason.includes('truncated')
        ? 'truncated'
        : f.reason.includes('not_json')
        ? 'not_json'
        : 'parse_error'
      acc[reason] = (acc[reason] || 0) + 1
      return acc
    }, {})

    console.log('\nFailure breakdown:')
    Object.entries(failureTypes).forEach(([type, count]) => {
      console.log(`- ${type}: ${count}`)
    })
  }

  // Save results
  fs.writeFileSync(outputFile, JSON.stringify(cleaned, null, 2), 'utf-8')
  console.log(`\nCleaned data saved to: ${outputFile}`)

  if (failed.length > 0) {
    const failedFile = outputFile.replace('.json', '_failed.json')
    fs.writeFileSync(failedFile, JSON.stringify(failed, null, 2), 'utf-8')
    console.log(`Failed entries saved to: ${failedFile}`)
  }

  return { cleaned, failed }
}

// Advanced version that tries to salvage truncated data
function extractWithRecovery (
  inputFile,
  outputFile = 'payloads_recovered.json'
) {
  const rawData = fs.readFileSync(inputFile, 'utf-8')
  const data = JSON.parse(rawData)

  const cleaned = []
  const recovered = []
  const failed = []

  for (let i = 0; i < data.length; i++) {
    const entry = data[i]
    let objStr = entry.event_message || ''

    if (!objStr.trim().startsWith('{')) {
      failed.push({ index: i, reason: 'not_json' })
      continue
    }

    // Attempt to recover truncated data
    if (
      objStr.includes('...') ||
      objStr.includes('htt...') ||
      objStr.includes('https://ww...')
    ) {
      console.log(`Entry ${i}: Attempting recovery of truncated data...`)

      // Remove truncation indicators
      objStr = objStr.replace(/\.{3,}.*$/, '')
      objStr = objStr.replace(
        /htt\.{3,}.*$/,
        '"https://www.salemoffers.com/campaign/ready-to-publish"'
      )
      objStr = objStr.replace(
        /https:\/\/ww\.{3,}.*$/,
        '"https://www.salemoffers.com/campaign/ready-to-publish"'
      )

      // Try to close the object properly
      if (!objStr.endsWith('}')) {
        objStr += '}'
      }
    }

    try {
      // Clean up newlines and whitespace
      objStr = objStr.replace(/\n/g, '').replace(/\s+/g, ' ')

      // Fix unquoted keys
      objStr = objStr.replace(
        /(\s|{)\s*([a-zA-Z_][a-zA-Z0-9_]*)\s*:/g,
        '$1"$2":'
      )

      // Remove trailing commas
      objStr = objStr.replace(/,(\s*})/g, '$1')

      const payload = JSON.parse(objStr)

      // Check if this was recovered data
      const wasRecovered = entry.event_message.includes('...')
      if (wasRecovered) {
        recovered.push({ index: i, payload })
        console.log(`Entry ${i}: ✓ Recovered truncated data`)
      } else {
        console.log(`Entry ${i}: ✓ Successfully parsed`)
      }

      cleaned.push(payload)
    } catch (err) {
      failed.push({
        index: i,
        reason: err.message,
        original: entry.event_message.substring(0, 100)
      })
      console.log(`Entry ${i}: ✗ Failed - ${err.message}`)
    }
  }

  console.log(`\n=== RECOVERY SUMMARY ===`)
  console.log(`Total entries: ${data.length}`)
  console.log(`Successfully extracted: ${cleaned.length}`)
  console.log(`Recovered from truncation: ${recovered.length}`)
  console.log(`Failed: ${failed.length}`)

  // Save all results
  fs.writeFileSync(outputFile, JSON.stringify(cleaned, null, 2), 'utf-8')
  console.log(`\nAll extracted data saved to: ${outputFile}`)

  if (recovered.length > 0) {
    const recoveredFile = outputFile.replace('.json', '_recovered_only.json')
    fs.writeFileSync(
      recoveredFile,
      JSON.stringify(
        recovered.map(r => r.payload),
        null,
        2
      ),
      'utf-8'
    )
    console.log(`Recovered entries saved to: ${recoveredFile}`)
  }

  return { cleaned, recovered: recovered.map(r => r.payload), failed }
}

// Usage examples
console.log('=== STANDARD EXTRACTION ===')
const standardResult = extractPayloadsToJson(
  'unformattedEventMessage.json',
  'formatted_standard.json'
)

console.log('\n=== EXTRACTION WITH RECOVERY ===')
const recoveryResult = extractWithRecovery(
  'unformattedEventMessage.json',
  'formatted_with_recovery.json'
)

console.log('\n=== SAMPLE OUTPUT ===')
if (standardResult.cleaned.length > 0) {
  console.log('First successfully parsed entry:')
  console.log(JSON.stringify(standardResult.cleaned[0], null, 2))
}
