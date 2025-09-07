# Import Scripts — README

Quick guide: how to run the scripts in this repo and what each script does.

## Checklist
- [x] Provide steps to install Node and dependencies
- [x] Show commands to run the scripts (`importBulk.mjs` and `supabaseLogic.mjs`)
- [x] Document how `.env` is used and what variables are required
- [x] Explain how each major code block works for both scripts
- [x] Add a troubleshooting note about 401 errors

---

## Prerequisites
- Node.js installed (v16+ recommended; v18+ has built-in fetch). Verify with:

```powershell
node -v
```

- From the project root run:

```powershell
npm install
```

(If you haven't added a package.json yet, run `npm init -y` first.)

## Environment variables (.env)
Create a `.env` file in the project root with the following keys (example values removed):

```
SUPABASE_URL=
SUPABASE_ANON_KEY=
BASE_URL=https://services.leadconnectorhq.com
API_VERSION=2021-07-28
TOKEN=
LOCATION_ID=
```

- `SUPABASE_URL` and `SUPABASE_ANON_KEY` — your Supabase project URL and anon key.
- `BASE_URL`, `API_VERSION`, `TOKEN`, `LOCATION_ID` — LeadConnector / GoHighLevel API base URL, API version string, API token (pit-...), and location id.

The scripts use `dotenv`, so they read these values via `process.env`.

## Install dependencies

From the project root run:

```powershell
npm install
```

This reads `package.json` and installs all required dependencies in one step. If you're on an older Node that lacks `fetch`, the project already lists `node-fetch` as a dependency; otherwise you can add it manually with `npm install node-fetch`.

## Run the scripts
From the repository root run one of the following:

```powershell
node importBulk.mjs
# or
node supabaseLogic.mjs
```

Notes:
- These scripts are ESM (`.mjs`) and use `import` statements. Node must be invoked as shown.
- Both scripts expect a valid `.env` in the project root.

---

## What each script does (high level)

### `supabaseLogic.mjs`
Purpose: Import a single contact from Supabase into GoHighLevel (GHL), then create an opportunity and update Supabase with the assigned IDs.

Major blocks and how they work:
- Imports & dotenv
  - `import dotenv from 'dotenv'; dotenv.config()` loads `.env` values into `process.env` so secrets aren't hard-coded.
- Supabase client
  - `createClient(SUPABASE_URL, SUPABASE_ANON_KEY)` initializes the Supabase client used to call stored procedures (RPCs).
- RPC wrappers
  - `getOpportunityExtraInfo`, `getContactData`, `updateFactContactTable` — call Supabase RPC functions (stored procedures) and return data or errors.
- Custom fields helpers
  - `combineFieldValues` — consolidates custom field rows (multiple option rows) into the shape expected by the API.
  - `getCustomContactFields` and `getCustomOpportunityFields` — fetch custom fields from Supabase and run `combineFieldValues`.
- GHL API wrappers
  - `createGhlContact` and `createGhlOpportunity` — call the GoHighLevel API using `fetch`, send JSON payload, and return parsed JSON responses.
- Process flow
  - Fetch a contact from Supabase (by `UUID`), look up pipeline stage/salesperson via `getOpportunityExtraInfo`, assemble `contact_payload` using values from Supabase (falling back to `Unprovided` where needed), post to GHL, create an opportunity, then call `updateFactContactTable` to record the IDs back in Supabase.

### `importBulk.mjs`
Purpose: Batch process multiple unassigned Supabase contacts and import them into GHL (contact + opportunity) and update Supabase for each contact.

Major blocks and how they work:
- Setup & dotenv
  - Same dotenv + Supabase client setup as `supabaseLogic.mjs`.
- RPC wrappers
  - `getContactBulkData` calls a Supabase RPC that returns multiple unassigned contacts (with a limit parameter).
- Loop for bulk processing
  - The code fetches custom fields and then iterates over `supabase_bulk_data`.
  - For each contact it: gets pipeline/opportunity info, builds `contact_payload`, posts to GHL, creates an opportunity, and updates Supabase with assigned IDs using `updateFactContactTable`.
  - Uses `forEach(async ...)` in the current file — be aware this does not wait for each async operation to finish before moving on. If you need sequential processing or to wait for all promises, consider using a `for`..`of` loop or `Promise.all` depending on desired behavior.

Important note about concurrency:
- `supabase_bulk_data.forEach(async contact => { ... })` launches async tasks in parallel but won't allow you to await the whole batch. If you want to process sequentially do:

```javascript
for (const contact of supabase_bulk_data) {
  // await inside loop
}
```

or to process in parallel and wait for all:

```javascript
await Promise.all(supabase_bulk_data.map(async contact => { /* ... */ }))
```

---

## Field mapping and custom fields
- `customFields` in the contact payload is filled by `getCustomContactFields()` which returns an array of objects shaped like `{ id, key, field_value }`. That matches the GoHighLevel API's expected custom field structure.
- The helper `combineFieldValues` collapses multiple rows of the same custom field into a single entry with an array value where appropriate.

## Common issues / troubleshooting
- 401 / "The token is not authorized for this scope." — This comes from the GHL API. Check that:
  - `TOKEN` in your `.env` matches the token used successfully in `Test.mjs`.
  - The token hasn't expired and has the correct scope/permissions.
- `fetch` not found error — Use Node 18+, or install `node-fetch` and import it for older Node versions.
- `.mjs` ESM issues — If you see module/import errors, ensure Node is recent and you're running the file with `node filename.mjs`.
- Duplicate custom fields, missing commas or syntax errors — edit the file and ensure valid JavaScript object syntax.

## Quick example: create a `.env` and run
1. Create `.env` with required variables (see above).
2. Install dependencies:

```powershell
npm install dotenv @supabase/supabase-js
```

3. Run one script:

```powershell
node importBulk.mjs
# or
node supabaseLogic.mjs
```

## Final notes
- Keep tokens out of source control — `.gitignore` already includes `.env`.
- If you want me to convert the scripts to use TypeScript, add logging, or change the concurrency model, tell me which script and I'll implement it.

---

If you'd like, I can also:
- Add a `package.json` with scripts (e.g., `npm run import-bulk`).
- Add a basic test or dry-run mode that prints payloads instead of posting to GHL.
