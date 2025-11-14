import axios from 'axios'
import fs from 'fs'
import path from 'path'
import csv from 'csv-parser'
import pLimit from 'p-limit'
import { createClient } from '@supabase/supabase-js'
import dotenv from 'dotenv'
dotenv.config()
// ---------- Config from .env ----------
const {
  CSV_PATH = './sync-changes/needs_update.csv',

  // Supabase
  SUPABASE_URL,
  SUPABASE_SERVICE_ROLE_KEY,

  // LeadConnector / GHL (your env names)
  BASE_URL = 'https://services.leadconnectorhq.com',
  API_VERSION = '2021-07-28',
  TOKEN,
  LOCATION_ID,
  SUPABASE_CONTACTS_TABLE = 'ghl_ids_with_email_and_phone',
  SUPABASE_EMAIL_COLUMN = 'email',
  SUPABASE_PHONE_COLUMN = 'phone_number',
  SUPABASE_GHL_ID_COLUMN = 'ghl_contact_id',

  // Controls
  CONCURRENCY = '5',
  DRY_RUN = 'false'
} = process.env

if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
  console.error('Missing Supabase creds in .env')
  process.exit(1)
}
if (!TOKEN) {
  console.error('Missing TOKEN (LeadConnector/GHL token) in .env')
  process.exit(1)
}

const isDryRun = String(DRY_RUN).toLowerCase() === 'true'

// ---------- Logging helpers ----------
const ts = () => new Date().toISOString()
const log = (...args) => console.log(ts(), ...args)
const warn = (...args) => console.warn(ts(), ...args)
const errLog = (...args) => console.error(ts(), ...args)

// ---------- Clients ----------
const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY)
const http = axios.create({
  baseURL: BASE_URL,
  timeout: 30000,
  headers: {
    Authorization: `Bearer ${TOKEN}`,
    Accept: 'application/json',
    'Content-Type': 'application/json',
    Version: API_VERSION,
    ...(LOCATION_ID ? { LocationId: LOCATION_ID } : {})
  }
})

// ---------- Helpers ----------
const onlyFields = row => ({
  email: (row.Email || row.email || '').trim().toLowerCase(),
  phone: (row.Phone || row.phone || '').trim(),
  lead_source: (row.lead_source || '').trim(),
  source: (row.source || '').trim(),
  website_landing_page: (row.website_landing_page || '').trim()
})

async function getGhlContactIdByEmailPhone (email, phone) {
  const { data, error } = await supabase
    .from(SUPABASE_CONTACTS_TABLE)
    .select(`${SUPABASE_GHL_ID_COLUMN}`)
    .eq(SUPABASE_EMAIL_COLUMN, email)
    .limit(1)

  if (error) throw new Error(`Supabase query error: ${error.message}`)
  return data ? data[0][SUPABASE_GHL_ID_COLUMN] : null
}

function buildGhlPayload (row) {
  return {
    source: row.source || undefined,
    customFields: [
      {
        id: 'IjmRpmQlwHiJjGnTLptG',
        key: 'contact_source_detail',
        field_value: row.lead_source ?? ''
      },
      {
        id: 'JMwy9JsVRTTzg4PDQnhk',
        key: 'source_detail_value_c',
        field_value: row.website_landing_page ?? ''
      }
    ]
  }
}

async function patchGhlContact (contactId, payload) {
  const url = `/contacts/${encodeURIComponent(contactId)}`
  const res = await http.put(url, payload)
  return res.data
}

function delay (ms) {
  return new Promise(r => setTimeout(r, ms))
}

async function withRetries (
  fn,
  { retries = 5, baseDelay = 1000, maxDelay = 30000 } = {}
) {
  let attempt = 0
  while (attempt < retries) {
    try {
      return await fn()
    } catch (err) {
      attempt++
      const status = err?.response?.status ?? err?.status ?? null
      // Retry only on 429, 408, and 5xx, or when status is unknown (network)
      const retriable =
        status === 429 ||
        status === 408 ||
        (typeof status === 'number' && status >= 500 && status <= 599) ||
        status == null

      // Base case: stop if not retriable, or we've hit the last attempt
      if (!retriable || attempt >= retries) {
        if (
          typeof status === 'number' &&
          status >= 400 &&
          status < 500 &&
          status !== 429 &&
          status !== 408
        ) {
          warn(`Non-retriable client error (status ${status}) — giving up`)
        }
        throw err
      }

      const sleep = Math.min(baseDelay * Math.pow(2, attempt - 1), maxDelay)
      warn(
        `Transient error (status ${
          status ?? 'n/a'
        }) — retry ${attempt}/${retries} in ${sleep}ms (cap ${maxDelay}ms)`
      )
      await delay(sleep)
    }
  }
  // Should never reach here; throw as safeguard
  throw new Error(
    'withRetries exhausted without returning or throwing original error'
  )
}

function readCsv (filePath) {
  return new Promise((resolve, reject) => {
    const out = []
    fs.createReadStream(filePath)
      .pipe(csv())
      .on('data', row => out.push(row))
      .on('end', () => resolve(out))
      .on('error', reject)
  })
}

// ---------- Main ----------
async function run () {
  log('🚀 Starting CSV → Supabase → GHL sync')
  log(`Settings: DRY_RUN=${isDryRun} | CONCURRENCY=${CONCURRENCY}`)
  const inputPath = path.resolve(CSV_PATH)
  log(`Looking for CSV at: ${inputPath}`)

  if (!fs.existsSync(inputPath)) {
    errLog(`CSV not found: ${inputPath}`)
    process.exit(1)
  }

  log('📥 Reading CSV...')
  const rows = await readCsv(inputPath)
  log(`CSV read complete. Raw rows: ${rows.length}`)

  const items = rows.map(onlyFields).filter(r => r.email || r.phone)
  log(`Filtered rows with email or phone: ${items.length}`)

  const limit = pLimit(parseInt(CONCURRENCY, 10) || 5)

  const results = []
  const preview = []
  let successCount = 0
  let processedCount = 0
  const total = items.length

  log('⚙️ Processing begins...')

  await Promise.all(
    items.map((row, idx) =>
      limit(async () => {
        const ordinal = idx + 1
        const reportItem = {
          index: idx,
          email: row.email,
          phone: row.phone,
          status: 'pending'
        }

        log(
          `[${ordinal}/${total}] 🔎 Lookup in Supabase for (email="${row.email}", phone="${row.phone}")`
        )

        try {
          // 1) Lookup GHL contact id from Supabase
          const ghlId = await withRetries(
            () => getGhlContactIdByEmailPhone(row.email, row.phone),
            { retries: 5, baseDelay: 1000, maxDelay: 30000 }[0]
          )

          if (!ghlId) {
            log(`[${ordinal}/${total}] ⚠️ No ghl_contact_id found — skipping`)
            reportItem.status = 'skipped'
            reportItem.reason = 'No matching ghl_contact_id found in Supabase'
            results.push(reportItem)
            processedCount++
            return
          }

          log(`[${ordinal}/${total}] ✅ Match found → contactId=${ghlId}`)

          // 2) Build payload
          const payload = buildGhlPayload(row)

          // --- PRINT FIRST (always) ---
          const previewItem = {
            index: idx,
            email: row.email,
            phone: row.phone,
            contactId: ghlId,
            will_update: payload
          }
          preview.push(previewItem)
          if (isDryRun) {
            log(`[${ordinal}/${total}] 📝 Preview payload (no API call yet):`)
            console.log(JSON.stringify(previewItem, null, 2))
          }

          // 3) Optionally send
          if (!isDryRun) {
            log(`[${ordinal}/${total}] 🔄 Updating GHL contact ${ghlId}...`)
            await withRetries(() => patchGhlContact(ghlId, payload), {
              retries: 5,
              baseDelay: 1000,
              maxDelay: 30000
            })
            log(
              `[${ordinal}/${total}] 🎯 Update SUCCESS for contactId=${ghlId}`
            )
            // Extra post-update confirmation per request
            log(
              `[${ordinal}/${total}] 📬 Contact updated: email=${
                row.email || 'n/a'
              }, phone=${row.phone || 'n/a'}
              }`
            )
            reportItem.status = 'updated'
            reportItem.contactId = ghlId
            successCount++
          } else {
            log(
              `[${ordinal}/${total}] 🧪 DRY-RUN: Skipping API call for contactId=${ghlId}`
            )
            reportItem.status = 'dry-run'
            reportItem.contactId = ghlId
          }

          results.push(reportItem)
        } catch (err) {
          const httpStatus = err?.response?.status
          const msg =
            err?.response?.data?.message ||
            err?.response?.data ||
            err?.message ||
            String(err)
          errLog(
            `[${ordinal}/${total}] ❌ ERROR (status ${
              httpStatus ?? 'n/a'
            }): ${msg}`
          )
          reportItem.status = 'error'
          reportItem.error = msg
          reportItem.httpStatus = httpStatus
          results.push(reportItem)
        } finally {
          processedCount++
          if (processedCount % 10 === 0 || processedCount === total) {
            log(`Progress: ${processedCount}/${total} processed`)
          }
        }
      })
    )
  )

  const summary = {
    total_rows_in_csv: rows.length,
    processed_with_email_or_phone: items.length,
    updated_successfully: successCount,
    failed: results.filter(r => r.status === 'error').length,
    skipped_no_match: results.filter(r => r.status === 'skipped').length,
    dry_run: isDryRun
  }

  const nowIso = new Date().toISOString()
  const previewPath = path.resolve('./preview.json')
  const reportPath = path.resolve('./report.json')

  fs.writeFileSync(
    previewPath,
    JSON.stringify({ preview, generated_at: nowIso }, null, 2)
  )
  fs.writeFileSync(
    reportPath,
    JSON.stringify({ summary, results, generated_at: nowIso }, null, 2)
  )

  log('📦 Artifacts written:')
  log(`  • preview.json -> ${previewPath}`)
  log(`  • report.json  -> ${reportPath}`)

  log('📊 SUMMARY')
  console.log(summary)

  log('✅ Done.')
}

run().catch(e => {
  errLog('Fatal error:', e)
  process.exit(1)
})
