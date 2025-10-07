# Edge Function Testing Documentation

## Overview

This document describes testing and sync utilities used to validate and run edge functions and data synchronization between Supabase and GoHighLevel (GHL).

## Data flow

You operate a bi-directional integration between Supabase (the canonical data store) and GHL (the CRM). The common flows are:

- Supabase → GHL: Import scripts read canonical records from Supabase, create or update contacts/opportunities in GHL, then write canonical GHL IDs and sync metadata back into Supabase.
- GHL → Supabase: Sync scripts pull records from GHL and upsert them into Supabase tables for reporting, lookups, and downstream processes.

Most operations are either a "push" (import) or a "pull" (sync). Some imports perform a full round-trip (Supabase → GHL → Supabase) so the system records the GHL IDs and sync status.

## Scripts

Below are the testing utilities you can use to validate edge functions and orchestrators.

### 1. Salem Test (`salem-test.mjs`)

Purpose: Batch process contacts through the `salem_media_webhook` edge function.

Usage:
```bash
node salem-test.mjs
```

Configuration examples:
```javascript
const batchSize = 5          // Contacts per batch
const delayBetweenBatches = 500  // Milliseconds between batches
```

Requirements:
- A `json/formattedEventMessages-simple.json` file with test messages
- Environment variables: `SUPABASE_URL`, `SUPABASE_ANON_KEY`, `SUPABASE_SUPERADMIN_EMAIL`, `SUPABASE_SUPERADMIN_PASSWORD`

Sample output:
```
Processing batch 1/5 (contacts 1-5)
  ✅ Success for john@example.com
  ❌ Error for jane@example.com: timeout

📊 Total contacts processed: 25
✅ Successful calls: 23
❌ Failed calls: 2
📈 Success rate: 92.0%
```

---

### 2. Einstein Sync (`einstein-sync.mjs`)

Purpose: Run and validate the `sync_einstein_orchestrator` edge function.

Usage:
```bash
node einstein-sync.mjs
```

Requirements:
- Environment variables: `SUPABASE_URL`, `SUPABASE_ANON_KEY`

Sample output:
```
Starting orchestrator...
✅ Sync complete!
Total time: 145.67s

Results:
{
  "status": "success",
  "processed_records": 2847,
  "updated_records": 156,
  "new_records": 12
}
```

---

### 3. TDM Test (`ef calls/tdm-test.mjs`)

Purpose: Validate the `tdmdigital_webhook` edge function using sample data.

Usage:
```bash
node "ef calls/tdm-test.mjs"
```

Test data example:
```json
{
  "first_name": "Charles",
  "last_name": "Test",
  "email": "charles@vxlabs.co",
  "phone": "12345678453",
  "christian_publishing": "Yes",
  "writing_process": "My book is ready now",
  "zip_code": "32751",
  "genre": "Business",
  "services": "Cover/Book Design, Editing, Self Publishing"
}
```

Requirements:
- Environment variables: `SUPABASE_URL`, `SUPABASE_ANON_KEY`, `SUPABASE_SUPERADMIN_EMAIL`, `SUPABASE_SUPERADMIN_PASSWORD`

Sample output:
```
{
  "success": true,
  "contact_id": "abc123",
  "ghl_contact_id": "xyz789"
}
```

---

## Import Scripts

These utilities push canonical records from Supabase into GHL and write the canonical GHL IDs back to Supabase (Supabase → GHL → Supabase).

- importBulk.mjs — Full importer: creates GHL contacts, opportunities, notes and updates `fact_contacts`.
  - Usage: `node import/importBulk.mjs`
  - Key environment variables: `SUPABASE_URL`, `SUPABASE_ANON_KEY`, `TOKEN`, `LOCATION_ID`, `SUPABASE_SUPERADMIN_EMAIL`, `SUPABASE_SUPERADMIN_PASSWORD`

  Purpose: Use this for major migrations, backfills, or scheduled large imports. The script creates GHL resources from canonical Supabase data and writes back IDs and status fields to the Supabase tables.

  Role: Seed or re-sync the system from a canonical data source when you need a large-scale import.

  Sample summary (written to the summary JSON file):
  ```json
  {
    "created_contacts": 1200,
    "created_opportunities": 950,
    "updated_contacts": 75,
    "duplicates_skipped": 12,
    "errors": 3,
    "duration_seconds": 342.5
  }
  ```

- contactOnly.mjs — Rate-limited contact-only importer optimized for large batches.
  - Usage: `node import/contactOnly.mjs`
  - Key environment variables: tune `SUPABASE_CHUNK_SIZE` and `CONCURRENCY` for performance

  Purpose: Create or update contacts in GHL while minimizing rate-limit issues and Supabase write volume.

  Role: Run this for frequent, incremental contact syncs or when you want to reprocess contacts without creating opportunities or notes.

  Sample summary:
  ```json
  {
    "processed": 500,
    "created": 480,
    "updated": 18,
    "duplicates_skipped": 2,
    "rate_limited_calls": 2,
    "duration_seconds": 58.2
  }
  ```

## Sync Scripts

These utilities pull data from GHL into Supabase to reconcile state (GHL → Supabase).

- globalSyncContact.mjs — Syncs contacts from GHL into `Supabase Star Schema` (upserts and summaries).
  - Usage: `node globalSyncContact.mjs --page-limit=1000 --concurrency=8`
  - Produces summary files in `UpdateContactRecord/` (TXT, JSON, CSV)

  Purpose: Reconcile GHL contact data into Supabase. The script pulls contacts from GHL and upserts them into `fact_contacts` for reporting and downstream workflows.

  Role: Keep Supabase as a read model that reflects the CRM's current contact state.

  Sample summary (example JSON):
  ```json
  {
    "status": "success",
    "processed": 2815,
    "created": 0,
    "updated": 2806,
    "duplicates": 9,
    "errors": 0,
    "duration_s": 145.6
  }
  ```

- globalSyncOpp.mjs — Syncs opportunities from GHL and links them to Supabase contacts.
  - Usage: `node globalSyncOpp.mjs --page-limit=100 --concurrency=8`
  - Produces summary files in `UpdateOppRecord/` (TXT, JSON, CSV)

  Purpose: Pull opportunities from GHL, normalize them, and link them to Supabase contact fact IDs. The script can also flag opportunities as deleted/archived when they no longer appear in GHL.

  Role: Ensure opportunity data in Supabase reflects GHL state and relationships for reporting and automation.

  Sample summary:
  ```json
  {
    "status": "success",
    "processed": 1024,
    "linked": 980,
    "unlinked": 44,
    "deleted_in_ghl": 5,
    "errors": 2,
    "duration_s": 98.4
  }
  ```

---

### Update script: `updateContact.mjs`

Purpose: Push field-level updates from Supabase into GHL and mark the Supabase records as processed (Supabase → GHL → Supabase). The script reads a batch of contacts that need updates, applies PUT requests to GHL for contacts and opportunities, and calls an RPC to flag the Supabase fact record as updated.

Role: Use this script when you need to synchronize owner assignments, custom fields, or source metadata from Supabase into GHL without running a full import.

Usage:
```bash
node updateContact.mjs
```

Key environment variables:
- `SUPABASE_URL`
- `SUPABASE_ANON_KEY`
- `SUPABASE_SUPERADMIN_EMAIL`
- `SUPABASE_SUPERADMIN_PASSWORD`
- `TOKEN` (GHL API token)
- `BASE_URL` (optional, defaults to GHL host)
- `API_VERSION` (optional)
- `LOCATION_ID` (optional)

Sample console output (short):
```
logging in...
Success Updating contact for: John Doe
Success Updating opportunity for: John Doe
successfully updated detail number 12, name: John Doe
Execution time: 3523.394 ms
```

Sample summary (example JSON derived from logs):
```json
{
  "processed": 125,
  "contacts_updated": 125,
  "opportunities_updated": 73,
  "errors": 0,
  "duration_ms": 352339
}
```

Notes & behavior:
- The script authenticates to Supabase using `SUPABASE_SUPERADMIN_EMAIL`/`PASSWORD` and calls the RPC `get_contacts_that_needs_update` to retrieve the batch.
- After each successful update the script calls `mark_fact_contact_for_update` RPC to flag the Supabase record as processed.
- The script collects failures in `contact_update_errors` and prints them at the end; it continues processing remaining items after individual failures.

