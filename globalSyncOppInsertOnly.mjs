import { createClient } from '@supabase/supabase-js'
import { error } from 'console'
import dotenv from 'dotenv'
import fs from 'fs'
dotenv.config()

let processedOpportunities = 0
let errorOpportunities = []
let insertedFactIDS = []
let skippedOpportunities = []
let lastProcessedContact = null
let totalOpportunities = 0
let currPage = 1
let currName, currEmail, currContactID, currOpportunityID

// ===== Pretty logging utilities =====
const ansi = {
  reset: '\x1b[0m',
  bold: (s = '') => `\x1b[1m${s}${'\x1b[0m'}`,
  dim: (s = '') => `\x1b[2m${s}${'\x1b[0m'}`,
  red: (s = '') => `\x1b[31m${s}${'\x1b[0m'}`,
  green: (s = '') => `\x1b[32m${s}${'\x1b[0m'}`,
  yellow: (s = '') => `\x1b[33m${s}${'\x1b[0m'}`,
  blue: (s = '') => `\x1b[34m${s}${'\x1b[0m'}`,
  magenta: (s = '') => `\x1b[35m${s}${'\x1b[0m'}`,
  cyan: (s = '') => `\x1b[36m${s}${'\x1b[0m'}`,
  gray: (s = '') => `\x1b[90m${s}${'\x1b[0m'}`
}

const sym = {
  ok: ansi.green('✓'),
  err: ansi.red('✗'),
  warn: ansi.yellow('●'),
  info: ansi.cyan('ℹ'),
  skip: ansi.yellow('⊘')
}

const hr = (w = 80, ch = '═') => ch.repeat(w)
const subhr = (w = 80, ch = '─') => ch.repeat(w)

const center = (text = '', width = 80) => {
  const len = text.length
  if (len >= width) return text
  const pad = Math.floor((width - len) / 2)
  return ' '.repeat(pad) + text
}

const section = (title = '') => {
  console.log('\n' + hr())
  console.log(center(ansi.bold(title), 80))
  console.log(hr() + '\n')
}

const formatDuration = ms => {
  const s = Math.floor(ms / 1000)
  const h = Math.floor(s / 3600)
  const m = Math.floor((s % 3600) / 60)
  const sec = s % 60
  const msPart = Math.floor(ms % 1000)
  const hh = String(h).padStart(2, '0')
  const mm = String(m).padStart(2, '0')
  const ss = String(sec).padStart(2, '0')
  return `${hh}:${mm}:${ss}.${String(msPart).padStart(3, '0')}`
}

// CLI/config helpers for performance tuning
const getArg = (name, fallback = undefined) => {
  const prefix = `--${name}=`
  const found = process.argv.find(a => a.startsWith(prefix))
  if (found) return found.slice(prefix.length)
  return fallback
}

// Configurable controls (defaults suitable for opp search)
const START_PAGE = Number(getArg('start-page', process.env.START_PAGE || 1))
const PAGE_LIMIT = Number(getArg('page-limit', process.env.PAGE_LIMIT || 100))
const CONCURRENCY = Number(getArg('concurrency', process.env.CONCURRENCY || 8))

// Live anchor status line and API limit tracking
let apiLimitErrors = 0
let lastStatus = ''
const renderStatus = () => {
  const lastSummary =
    typeof lastProcessedContact === 'string' && lastProcessedContact.length > 0
      ? lastProcessedContact.replace(/\n/g, ' ').slice(0, 80)
      : 'N/A'
  const line =
    `${ansi.blue('[Page ')}${ansi.bold(String(currPage))}${ansi.blue(
      ' | Limit '
    )}${ansi.bold(String(PAGE_LIMIT))}${ansi.blue(']')} ` +
    `${ansi.green('Processed:')} ${ansi.bold(
      String(processedOpportunities)
    )} ` +
    `| ${ansi.cyan('Inserted:')} ${ansi.bold(
      String(insertedFactIDS.length)
    )} ` +
    `| ${ansi.yellow('Skipped:')} ${ansi.bold(
      String(skippedOpportunities.length)
    )} ` +
    `| ${ansi.red('Errors:')} ${ansi.bold(
      String(errorOpportunities.length)
    )} ` +
    `(${ansi.yellow('API:')} ${ansi.bold(String(apiLimitErrors))}) ` +
    `| ${ansi.cyan('Last:')} ${ansi.gray(lastSummary)}`
  const pad = ' '.repeat(
    Math.max(0, Math.max(lastStatus.length - line.length, 0) + 5)
  )
  lastStatus = line
  process.stdout.write(`\r${line}${pad}`)
}
const noteApiLimit = (where = 'unknown') => {
  apiLimitErrors++
  process.stdout.write(
    `\n${sym.warn} ${ansi.yellow('Rate limit (HTTP 429)')} at ${ansi.bold(
      where
    )} — ` + `${ansi.yellow('pausing and retrying as needed')}\n`
  )
  renderStatus()
}

// Simple promise pool for per-page parallelism
async function promisePool (items, worker, concurrency) {
  let i = 0
  const runners = Array.from({ length: Math.max(1, concurrency) }, async () => {
    while (true) {
      const idx = i++
      if (idx >= items.length) break
      const item = items[idx]
      await worker(item, idx)
    }
  })
  await Promise.all(runners)
}

// Exit handlers
process.on('exit', code => {
  const end = performance.now()
  console.log('\n' + hr())
  console.log(center(ansi.bold('SCRIPT EXIT SUMMARY'), 80))
  console.log(hr())
  console.log(`${ansi.cyan('Exit code:')} ${ansi.bold(String(code))}`)
  console.log(
    `${ansi.cyan('Total time:')} ${ansi.bold(formatDuration(end - start))}`
  )
  console.log(
    `${ansi.green('Processed:')} ${ansi.bold(String(processedOpportunities))}`
  )
  console.log(`${ansi.cyan('Inserted IDs:')} ${insertedFactIDS.length}`)
  console.log(
    `${ansi.yellow('Skipped (Existing):')} ${skippedOpportunities.length}`
  )
  console.log(
    `${ansi.red('Errors:')} ${ansi.bold(String(errorOpportunities.length))}`
  )
  console.log(
    `${ansi.cyan('Last:')} ${ansi.gray(String(lastProcessedContact))}`
  )
  console.log(hr() + '\n')
})

process.on('exit', code => {
  const end = performance.now()

  const summaryData = {
    timestamp: new Date().toISOString(),
    exitCode: code,
    executionTime: (end - start) / 1000,
    opportunitiesProcessed: processedOpportunities,
    totalOpportunities: totalOpportunities,
    currentPage: currPage,
    errorOpportunities: errorOpportunities,
    insertedFactIDs: insertedFactIDS,
    skippedOpportunities: skippedOpportunities,
    lastProcessedContact: {
      name: currName,
      contactID: currContactID,
      email: currEmail,
      opportunityID: currOpportunityID
    }
  }

  // Create readable text summary
  const textSummary = `
${'═'.repeat(80)}
${center('GHL OPPORTUNITY INSERT-ONLY SYNC SUMMARY', 80)}
${'═'.repeat(80)}
Timestamp: ${summaryData.timestamp}
Exit Code: ${summaryData.exitCode}
Total Execution Time: ${formatDuration(summaryData.executionTime * 1000)}
Opportunities Processed: ${summaryData.opportunitiesProcessed}
Total Opportunities: ${summaryData.totalOpportunities}
Pages Processed: ${summaryData.currentPage - 1}
Last Processed Contact: ${
    summaryData.lastProcessedContact
      ? JSON.stringify(summaryData.lastProcessedContact)
      : 'N/A'
  }

ERROR OPPORTUNITIES (${errorOpportunities.length}):
${(errorOpportunities || [])
  .map((error, index) => `${index + 1}. ${error}`)
  .join('\n')}

INSERTED FACT IDs (${insertedFactIDS.length}):
${(insertedFactIDS || []).map((id, index) => `${index + 1}. ${id}`).join('\n')}

SKIPPED OPPORTUNITIES (Already Exist) (${skippedOpportunities.length}):
${(skippedOpportunities || [])
  .map((id, index) => `${index + 1}. ${id}`)
  .join('\n')}

${'═'.repeat(80)}
`

  // Write to console
  console.log(textSummary)

  try {
    // Create filename with timestamp
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-')
    const folderName = 'InsertOppOnlyRecord'
    if (!fs.existsSync(folderName)) {
      fs.mkdirSync(folderName)
    }

    const txtFile = `${folderName}/insert-only-sync-summary-${timestamp}.txt`
    const jsonFile = `${folderName}/insert-only-sync-data-${timestamp}.json`
    const csvFile = `${folderName}/insert-only-sync-errors-${timestamp}.csv`

    // Write text summary
    fs.writeFileSync(txtFile, textSummary)

    // Write JSON data for programmatic use
    fs.writeFileSync(jsonFile, JSON.stringify(summaryData, null, 2))

    // Write CSV for error opportunities
    const escapeCsv = v => {
      if (v === null || v === undefined) return ''
      const s = String(v)
      if (/[",\n]/.test(s)) return '"' + s.replace(/"/g, '""') + '"'
      return s
    }
    const parseErrorLine = line => {
      let name = '',
        email = '',
        contactId = '',
        opportunityId = '',
        reason = ''
      try {
        const nameMatch = line.match(/Name:\s*([^,]+)/)
        const emailMatch = line.match(/Email\s+([^,]+)/)
        const cidMatch = line.match(/ContactID:\s*([^,]+)/)
        const oppMatch = line.match(/Opportunity ID:\s*([^,]+)/)
        const reasonMatch = line.match(/Reason:\s*(.*)$/)
        name = nameMatch ? nameMatch[1].trim() : ''
        email = emailMatch ? emailMatch[1].trim() : ''
        contactId = cidMatch ? cidMatch[1].trim() : ''
        opportunityId = oppMatch ? oppMatch[1].trim() : ''
        reason = reasonMatch ? reasonMatch[1].trim() : ''
      } catch (e) {
        reason = line
      }
      return { name, email, contactId, opportunityId, reason }
    }
    const header = ['name', 'email', 'contact_id', 'opportunity_id', 'reason']
    const rows = (errorOpportunities || []).map(l => parseErrorLine(l))
    const csv = [header.join(',')]
      .concat(
        rows.map(r =>
          [
            escapeCsv(r.name),
            escapeCsv(r.email),
            escapeCsv(r.contactId),
            escapeCsv(r.opportunityId),
            escapeCsv(r.reason)
          ].join(',')
        )
      )
      .join('\n')
    fs.writeFileSync(csvFile, csv)

    console.log(`\n${sym.ok} ${ansi.green('Summary files created')}`)
    console.log(`${ansi.cyan('  Text:')} ${txtFile}`)
    console.log(`${ansi.cyan('  JSON:')} ${jsonFile}`)
    console.log(`${ansi.cyan('  CSV: ')} ${csvFile}`)
  } catch (error) {
    console.error(
      `${sym.err} ${ansi.red('Error writing summary files:')}`,
      error
    )
  }
})

process.on('SIGINT', () => {
  console.log('\n\nReceived SIGINT (Ctrl+C). Gracefully shutting down...')
  process.exit(0)
})

process.on('SIGTERM', () => {
  console.log('\n\nReceived SIGTERM. Gracefully shutting down...')
  process.exit(0)
})

process.on('uncaughtException', error => {
  console.error('\n\nUncaught Exception:', error)
  process.exit(1)
})

process.on('unhandledRejection', (reason, promise) => {
  console.error('\n\nUnhandled Rejection at:', promise, 'reason:', reason)
  process.exit(1)
})

const start = performance.now()
const EMAIL = process.env.SUPABASE_SUPERADMIN_EMAIL
const PASSWORD = process.env.SUPABASE_SUPERADMIN_PASSWORD
const SUPABASE_URL = process.env.SUPABASE_URL
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY
const API_VERSION = process.env.API_VERSION || '2021-07-28'
const TOKEN = process.env.TOKEN
const BASE_URL = process.env.BASE_URL
const LOCATION_ID = process.env.LOCATION_ID

const HEADERS = {
  Authorization: `Bearer ${TOKEN}`,
  'Content-Type': 'application/json',
  Accept: 'application/json',
  Version: API_VERSION,
  'User-Agent': 'vertexlabs-ghl-importer-insert-only/1.0'
}

// Small helper: delay for backoff
function delay (ms) {
  return new Promise(resolve => setTimeout(resolve, ms))
}

// Retry helper for transient errors (exponential backoff)
async function withRetries (fn, { retries = 3, baseDelay = 500 } = {}) {
  let attempt = 0
  for (;;) {
    try {
      return await fn()
    } catch (err) {
      attempt++
      const status = err?.response?.status || err?.status || null
      const errMsg = err?.message || String(err)

      const isStatementTimeout =
        errMsg.includes('statement timeout') ||
        errMsg.includes('canceling statement due to statement timeout') ||
        errMsg.includes('57014')

      const isDeadlock =
        errMsg.includes('deadlock detected') || errMsg.includes('40P01')

      const is500Error =
        status === 500 ||
        errMsg.includes('Internal server error') ||
        errMsg.includes('500: Internal server error') ||
        errMsg.includes('<!DOCTYPE html>')

      const retriable =
        status === 429 ||
        status === 408 ||
        (status >= 500 && status <= 599) ||
        status === 404 ||
        isStatementTimeout ||
        isDeadlock ||
        is500Error ||
        !status

      if (!retriable || attempt > retries) throw err

      const sleep = baseDelay * Math.pow(2, attempt - 1)
      let reason = `status ${status ?? 'n/a'}`
      if (isStatementTimeout) reason = 'statement timeout'
      if (isDeadlock) reason = 'deadlock detected'
      if (is500Error) reason = '500 internal server error'

      console.warn(
        `${new Date().toISOString()} Transient error (${reason}) — retry ${attempt}/${retries} in ${sleep}ms`
      )
      await delay(sleep)
    }
  }
}

// fetch wrapper that retries on transient failures and returns parsed json
async function fetchWithRetries (
  url,
  options = {},
  opts = { retries: 3, baseDelay: 500 }
) {
  return withRetries(async () => {
    const res = await fetch(url, options)
    if (!res.ok) {
      const text = await res.text().catch(() => '')
      const err = new Error(
        `HTTP ${res.status} ${res.statusText} - ${text ? text : 'no body'}`
      )
      err.status = res.status
      err.response = { status: res.status, data: text }
      throw err
    }
    const text = await res.text().catch(() => '')
    if (!text) return null
    try {
      return JSON.parse(text)
    } catch (e) {
      return text
    }
  }, opts)
}

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY)

const getGhlOpportunties = async page => {
  const url = `${BASE_URL}/opportunities/search?location_id=${LOCATION_ID}&page=${page}&limit=${PAGE_LIMIT}`
  try {
    const opportunity_info = await fetchWithRetries(
      url,
      { method: 'GET', headers: HEADERS },
      { retries: 3, baseDelay: 500 }
    )
    return opportunity_info
  } catch (e) {
    if (e?.status === 429) noteApiLimit('opportunities/search')
    throw e
  }
}

const getGhlContact = async contactId => {
  const URL = `${BASE_URL}/contacts/${contactId}`
  try {
    const contact = await fetchWithRetries(
      URL,
      { method: 'GET', headers: HEADERS },
      { retries: 3, baseDelay: 500 }
    )
    return contact
  } catch (error) {
    if (error?.status === 404) {
      return null
    }
    if (error?.status === 429) {
      noteApiLimit(`contacts/${contactId}`)
      return null
    }
    console.error(
      `Error fetching contact ${contactId}:`,
      error.message || error
    )
    return null
  }
}

const getCustomFieldValue = (customFields, fieldId) => {
  return customFields?.find(field => field.id === fieldId)?.value || null
}

const getOpportunityCustomFieldValue = (customFields, fieldId) => {
  return (
    customFields?.find(field => field.id === fieldId)?.fieldValueString || null
  )
}

const addEinsteinURLToOpportunity = async (
  ghl_opportunity_id,
  einstein_url
) => {
  const oppCustomField = [
    {
      id: '5lDyHBJDAukD5YM7M4WG',
      key: 'proposal_link',
      field_value: einstein_url
    }
  ]

  const updateOppPayload = {
    customFields: oppCustomField
  }

  const URL = `${BASE_URL}/opportunities/${ghl_opportunity_id}`
  try {
    const opportunity_info = await fetchWithRetries(
      URL,
      {
        body: JSON.stringify(updateOppPayload),
        headers: HEADERS,
        method: 'PUT'
      },
      { retries: 3, baseDelay: 500 }
    )
    return opportunity_info
  } catch (e) {
    if (e?.status === 429) noteApiLimit(`opportunities/${ghl_opportunity_id}`)
    throw e
  }
}

const addEinsteinURLToNotes = async (ghl_contact_id, einstein_url) => {
  const payload = {
    userId: 'JERtBepiajyLX1Pghv3T',
    body: `Proposal Link: \n\n ${einstein_url}`
  }
  const URL = `${BASE_URL}/contacts/${ghl_contact_id}/notes/`
  try {
    const note_info = await fetchWithRetries(
      URL,
      { body: JSON.stringify(payload), headers: HEADERS, method: 'POST' },
      { retries: 3, baseDelay: 500 }
    )
    return note_info
  } catch (e) {
    if (e?.status === 429) noteApiLimit(`contacts/${ghl_contact_id}/notes`)
    throw e
  }
}

const addEinsteinURL = async ({
  ghl_opportunity_id,
  ghl_contact_id,
  einstein_url
}) => {
  let updateEinsteinUrlError = []

  const opportunityEinsteinData = await addEinsteinURLToOpportunity(
    ghl_opportunity_id,
    einstein_url
  )

  if (!opportunityEinsteinData?.opportunity?.id) {
    console.error(
      'Error Updating Proposal Link',
      opportunityEinsteinData?.message
    )
    updateEinsteinUrlError.push(opportunityEinsteinData?.message)
  }

  const noteEinsteinData = await addEinsteinURLToNotes(
    ghl_contact_id,
    einstein_url
  )
  if (!noteEinsteinData?.note?.id) {
    console.error('Error Updating Einstein URL', noteEinsteinData?.message)
    updateEinsteinUrlError.push(noteEinsteinData?.message)
  }

  if (updateEinsteinUrlError.length !== 0) {
    throw new Error(
      `Error Updating the Einstein URL of ${ghl_contact_id} ${updateEinsteinUrlError}`
    )
  } else {
    console.log(`Successfully Updated Einstein URL for ${ghl_contact_id}`)
  }
}

// Contact Custom Field IDs
const PUBLISHER_C = 'AMgJg4wIu7GKV02OGxD3'
const TIMEZONE_C = 'fFWUJ9OFbYBqVJjwjQGP'
const CONTACT_SOURCE_DETAIL = 'IjmRpmQlwHiJjGnTLptG'
const SOURCE_DETAIL_VALUE_C = 'JMwy9JsVRTTzg4PDQnhk'

// Opportunity Custom Field IDs
const OPP_PUBLISHER = 'ggsTQrS88hJgLI5J5604'
const OPP_TIMEZONE = 'gsFwmLo8XyzCjIoXxXYQ'
const OPP_ACTIVE_OR_PAST_AUTHOR = '4P0Yd0fLzOfns3opxTGo'
const OPP_GENRE = '5wlgHZzuWLyr918dMh7y'
const OPP_WRITING_PROCESS = 'cG5oYGyyKmEWwzn7y8HA'
const OPP_BOOK_DESCRIPTION = 'aOH64ZsyJ5blAZtf9IxK'
const OPP_OUTREACH_ATTEMPT = 'BOGtp8xLezwurePxIkNE'
const OPP_EINSTEIN_URL = '5lDyHBJDAukD5YM7M4WG'
const OPP_PIPELINE_BACKUP = 'uUEENCZJBnr0mjbuPe98'
const OPP_SOURCE_DETAIL_VALUE = 'UAjLmcYVz1hdI4sPVKSr'

let currNumber = 0
let currOpportunityPage

do {
  try {
    const { opportunities } = await getGhlOpportunties(currPage)
    currOpportunityPage = opportunities
    section(`PAGE ${currPage} — Found ${opportunities.length} opportunities`)
    renderStatus()
    totalOpportunities += opportunities.length

    // Batch existence check for OPPORTUNITIES on this page (checking ghl_opportunity_id)
    const pageOpportunityIds = opportunities.map(o => o.id).filter(Boolean)
    let existingOppIds = []
    if (pageOpportunityIds.length > 0) {
      const { data: existingRows, error: existingErr } = await supabase
        .from('fact_contacts')
        .select('ghl_opportunity_id')
        .in('ghl_opportunity_id', pageOpportunityIds)
      if (existingErr) {
        throw new Error(
          `Error checking opportunities existence: ${JSON.stringify(
            existingErr
          )}`
        )
      }
      existingOppIds = (existingRows || []).map(r => r.ghl_opportunity_id)
    }
    const existingOppSet = new Set(existingOppIds)

    // Process opportunities concurrently
    await promisePool(
      opportunities,
      async (currOpportunity, currOppIndex) => {
        try {
          const fetchedContact = await getGhlContact(currOpportunity.contact.id)
          const { contact: currContact } = fetchedContact || { contact: {} }

          currNumber = currOppIndex + 1
          currName = `\n      ${currContact.firstName} ${currContact.lastName}`
          currEmail = currContact.email
          currContactID = currContact.id
          currOpportunityID = currOpportunity.id

          const { data: pipelineNames, error: pipelineNamesError } =
            await supabase.rpc('get_pipeline_and_stage_names', {
              p_pipeline_id: currOpportunity.pipelineId,
              p_pipeline_stage_id: currOpportunity.pipelineStageId
            })
          if (pipelineNamesError) {
            throw new Error(
              `Error getting pipeline names: ${JSON.stringify(
                pipelineNamesError
              )}`
            )
          }

          const pipelineName = pipelineNames?.[0]?.pipeline_name ?? null
          const pipelineStageName = pipelineNames?.[0]?.stage_name ?? null

          const opportunityExists = existingOppSet.has(currOpportunity.id)

          // Check if opportunity exists - if yes, SKIP, if no, INSERT
          if (opportunityExists) {
            console.log(
              `${sym.skip} Opportunity ${currOpportunity.id} (${currContact.firstName} ${currContact.lastName}) already EXISTS in Supabase - SKIPPING`
            )
            skippedOpportunities.push(
              `OpportunityID: ${currOpportunity.id}, Contact: ${currContact.firstName} ${currContact.lastName} (${currContact.id})`
            )
            processedOpportunities++
            lastProcessedContact = `Contact Name: ${currName}, ContactID: ${currContactID}, OpportunityID: ${currOpportunityID} - SKIPPED`
            renderStatus()
            return // Skip this opportunity
          }

          console.log(
            `${sym.info} Opportunity ${currOpportunity.id} (${currContact.firstName} ${currContact.lastName}) NOT found in Supabase - will INSERT`
          )

          const publisher = getCustomFieldValue(
            currContact.customFields,
            PUBLISHER_C
          )
          const timezone = getCustomFieldValue(
            currContact.customFields,
            TIMEZONE_C
          )
          const contactSource = getCustomFieldValue(
            currContact.customFields,
            CONTACT_SOURCE_DETAIL
          )
          const sourceDetailValue = getCustomFieldValue(
            currContact.customFields,
            SOURCE_DETAIL_VALUE_C
          )

          // Extract Opportunity Custom Fields
          const oppPublisher = getOpportunityCustomFieldValue(
            currOpportunity.customFields,
            OPP_PUBLISHER
          )
          const oppTimezone = getOpportunityCustomFieldValue(
            currOpportunity.customFields,
            OPP_TIMEZONE
          )
          const oppActiveOrPastAuthor = getOpportunityCustomFieldValue(
            currOpportunity.customFields,
            OPP_ACTIVE_OR_PAST_AUTHOR
          )
          const oppGenre = getOpportunityCustomFieldValue(
            currOpportunity.customFields,
            OPP_GENRE
          )
          const oppWritingProcess = getOpportunityCustomFieldValue(
            currOpportunity.customFields,
            OPP_WRITING_PROCESS
          )
          const oppBookDescription = getOpportunityCustomFieldValue(
            currOpportunity.customFields,
            OPP_BOOK_DESCRIPTION
          )
          const oppOutreachAttempt = getOpportunityCustomFieldValue(
            currOpportunity.customFields,
            OPP_OUTREACH_ATTEMPT
          )
          const oppEinsteinUrl = getOpportunityCustomFieldValue(
            currOpportunity.customFields,
            OPP_EINSTEIN_URL
          )
          const oppPipelineBackup = getOpportunityCustomFieldValue(
            currOpportunity.customFields,
            OPP_PIPELINE_BACKUP
          )
          const oppSourceDetailValue = getOpportunityCustomFieldValue(
            currOpportunity.customFields,
            OPP_SOURCE_DETAIL_VALUE
          )

          const fullAddress =
            [
              currContact.address1 || '',
              currContact.city || '',
              currContact.state || '',
              currContact.postalCode || ''
            ]
              .filter(part => part.trim() !== '')
              .join(', ') || ''

          processedOpportunities++
          lastProcessedContact = `Contact Name: ${currName}, ContactID: ${currContactID}, OpportunityID: ${currOpportunityID} - INSERTING`
          renderStatus()

          // INSERT NEW OPPORTUNITY
          const insertPayload = {
            p_first_name: currContact.firstName ?? null,
            p_last_name: currContact.lastName ?? null,
            p_email: currContact.email ?? null,
            p_phone_number: currContact.phone ?? null,
            p_full_address: fullAddress ?? null,

            p_address_line1: currContact.address1 ?? 'Unprovided',
            p_address_line2: null,
            p_city: currContact.city ?? null,
            p_state_region: currContact.state ?? null,
            p_postal_code: currContact.postalCode ?? null,
            p_country: currContact.country ?? null,
            p_time_zone: timezone ?? oppTimezone ?? null,

            p_source: currContact.source ?? currOpportunity.source ?? null,
            p_website_landing_page:
              sourceDetailValue ?? oppSourceDetailValue ?? null,
            p_lead_source: contactSource ?? 'Unprovided',
            p_data_source: 'direct',
            p_lead_owner: currContact.assignedTo ?? null,
            p_lead_value: currOpportunity.monetaryValue
              ? String(currOpportunity.monetaryValue)
              : null,

            p_is_author: currContact.type === 'author',
            p_current_author: oppActiveOrPastAuthor === 'yes',
            p_publisher: publisher ?? oppPublisher ?? null,
            p_genre: oppGenre ? oppGenre : null,
            p_book_description: oppBookDescription ?? null,
            p_writing_status: oppWritingProcess ?? null,
            p_rating: pipelineName ?? oppPipelineBackup ?? null,
            p_pipeline_stage: pipelineStageName ?? null,
            p_stage_id: currOpportunity.pipelineStageId ?? null,
            p_pipeline_id: currOpportunity.pipelineId ?? null,

            p_opt_out_of_emails: currContact.dnd ?? false,
            p_outreach_attempt: oppOutreachAttempt ?? 0,
            p_notes: null,

            p_ghl_contact_id: currContact.id ?? null,
            p_ghl_opportunity_id: currOpportunity.id
          }

          const insertData = await withRetries(
            async () => {
              const { data, error } = await supabase.rpc(
                'insert_contact_to_star_schema',
                insertPayload
              )
              if (error) {
                const err = new Error(
                  `RPC insert_contact_to_star_schema failed: ${
                    error.message || JSON.stringify(error)
                  }`
                )
                err.status = error?.code || error?.status || null
                err.response = { status: err.status, data: error }
                throw err
              }
              if (!data || data.length === 0) {
                throw new Error(
                  `RPC insert_contact_to_star_schema returned empty result for opportunity ${currOpportunity.id} (${currContact.firstName} ${currContact.lastName}). This usually means the stored procedure failed silently or returned nothing.`
                )
              }
              return data
            },
            { retries: 3, baseDelay: 500 }
          )

          const { out_einstein_url, out_fact_id, out_ghl_contact_id } =
            insertData[0]

          await addEinsteinURL({
            ghl_opportunity_id: currOpportunity.id,
            ghl_contact_id: out_ghl_contact_id,
            einstein_url: out_einstein_url
          })

          insertedFactIDS.push(out_fact_id)
          console.log(
            `${sym.ok} ${ansi.green('Successfully inserted')} Opportunity ${
              currOpportunity.id
            } with fact_id: ${out_fact_id}`
          )
        } catch (error) {
          console.error(
            `${sym.err} ${ansi.red(
              'Error processing opportunity'
            )}: ${ansi.yellow(`page ${currPage}, #${currNumber}`)} ${ansi.gray(
              String(currName)
            )}\n  ${ansi.dim(String(error))}`
          )
          errorOpportunities.push(
            `Name: ${currName}, Email ${currEmail}, ContactID: ${currContactID}, Opportunity ID: ${currOpportunityID} Reason: ${error} `
          )
        }
      },
      CONCURRENCY
    )

    currPage++
  } catch (error) {
    console.error(
      `${sym.err} ${ansi.red('Page error')}: ${ansi.yellow(
        `page ${currPage}, #${currNumber}`
      )} ${ansi.gray(String(currName))}\n  ${ansi.dim(String(error))}`
    )
    errorOpportunities.push(
      `Name: ${currName}, Email ${currEmail}, ContactID: ${currContactID}, Opportunity ID: ${currOpportunityID} Reason: ${error} `
    )
    currPage++
    continue
  }
} while ((currOpportunityPage?.length ?? 0) !== 0)

const end = performance.now()
console.log(`\n\n${ansi.green('✓')} Script completed successfully`)
console.log(`${ansi.cyan('Execution time:')} ${formatDuration(end - start)}`)
console.log(
  `${ansi.cyan('Total Opportunities Processed:')} ${processedOpportunities}`
)
console.log(`${ansi.green('Inserted:')} ${insertedFactIDS.length}`)
console.log(
  `${ansi.yellow('Skipped (Already Exist):')} ${skippedOpportunities.length}`
)
console.log(`${ansi.red('Errors:')} ${errorOpportunities.length}`)
