# Xulon Press CSV Importer

A powerful CSV import tool that imports leads from CSV files into Supabase database and GoHighLevel CRM with automatic contact, opportunity, and note creation.

## 📋 Prerequisites

- **Node.js** version 18.0.0 or higher
- **npm** (comes with Node.js)
- Valid Supabase credentials
- Valid GoHighLevel API credentials

## 🚀 Installation

1. **Extract the ZIP file** to your desired location
2. **Open a terminal** in the folder named `import csv`
3. (Optional) If you're elsewhere, navigate into the folder:
  ```powershell
  cd "import csv"
  ```
4. **Install dependencies**:
   ```bash
   npm install
   ```

## 🔧 Environment Setup

Create a `.env` file in the same folder as `extractCsv.mjs` with the following variables:

```env
# Supabase Configuration
SUPABASE_URL=your_supabase_project_url
SUPABASE_SERVICE_ROLE_KEY=your_supabase_service_role_key

# GoHighLevel Configuration
BASE_URL=https://services.leadconnectorhq.com
API_VERSION=2021-07-28
TOKEN=your_ghl_api_token
LOCATION_ID=your_ghl_location_id
```

## 📖 Command-Line Flags

### `--input=<path>`
**Required:** Path to the CSV file to import  
**Default:** `import.csv` (in current directory)

**Examples:**
```bash
# Simple filename
--input=leads.csv

# Filename with spaces (use quotes)
--input="Xulon Leads - Sheet6.csv"

# Full path
--input="C:/Users/YourName/Documents/Xulon Leads - Sheet6.csv"
```

### `--output=<path>`
**Optional:** Path to save normalized JSON output  
**Default:** `null` (outputs to console only)

**Examples:**
```bash
--output=output.json
--output="processed-leads.json"
```

### `--write=<true|false>`
**Optional:** Enable database write operations  
**Default:** `false`

**When `true`, the script will:**
- Insert contacts into Supabase star schema
- Create GHL contacts with custom fields
- Create GHL opportunities
- Add Einstein proposal notes
- Update Supabase with GHL IDs

**Examples:**
```bash
--write=false   # Read-only mode (just parse CSV)
--write=true    # Perform all database operations
```

### `--dry-run=<true|false>`
**Optional:** Preview mode - logs all payloads without making API calls  
**Default:** `false`

**Perfect for:**
- Testing data mapping
- Debugging payload structures
- Validating transformations before actual import

**Examples:**
```bash
--dry-run=false  # Normal mode (makes API calls)
--dry-run=true   # Preview mode (no API calls)
```

### `--limit=<number>`
**Optional:** Limit the number of rows to process  
**Default:** `0` (process all rows)

**Examples:**
```bash
--limit=0    # Process all rows
--limit=10   # Process only first 10 rows
--limit=100  # Process only first 100 rows
```

## 📝 CSV File Format

Your CSV file should have these columns (case-insensitive, spaces allowed):

| Column Name | Required | Description |
|-------------|----------|-------------|
| `First` or `first` | Yes | First name |
| `Last` or `last` | Yes | Last name |
| `Email` or `email` | Yes* | Email address |
| `Phone` or `phone` | Yes* | Phone number |
| `Writing Process` | No | Writing status |
| `Publisher` | No | Publisher name |
| `Zip` | No | Postal code |
| `Street 1` | No | Address line 1 |
| `Street 2` | No | Address line 2 |
| `City` | No | City |
| `State` | No | State/Region |
| `Source URL` | No | Lead source URL |
| `Lead Intake` | No | Lead intake date |

*At least one identifier (email, phone, first name, or last name) is required.

## 💻 Usage Examples

### Quick start with npm scripts (recommended)

Run from inside the `import csv` folder:

```powershell
# Dry run a small sample
npm run import:dry-run

# Full import (pass flags after --)
npm run import -- --input="Xulon Leads - Sheet6.csv" --write=true
```

### 1. **Preview what will be imported (Dry Run)**
```bash
node extractCsv.mjs --input="Xulon Leads - Sheet6.csv" --write=true --dry-run=true --limit=5
```
This will show you the formatted output for the first 5 records without making any API calls.

### 2. **Test import with small batch**
```bash
node extractCsv.mjs --input="Xulon Leads - Sheet6.csv" --write=true --limit=10
```
This will process and import only the first 10 rows to test your setup.

### 3. **Full production import**
```bash
node extractCsv.mjs --input="Xulon Leads - Sheet6.csv" --write=true
```
This will process and import ALL rows from the CSV file.

### 4. **Import and save normalized JSON**
```bash
node extractCsv.mjs --input="Xulon Leads - Sheet6.csv" --write=true --output="imported-leads.json"
```
This will import all leads AND save the normalized data to a JSON file.

### 5. **Parse CSV without importing (read-only)**
```bash
node extractCsv.mjs --input="Xulon Leads - Sheet6.csv" --output="normalized.json"
```
This will only parse the CSV and save normalized JSON without any database operations.

## 🎨 Output Format

The script provides beautiful, color-coded console output for each record:

```
════════════════════════════════════════════════════════════════════════════════
  RECORD #1
────────────────────────────────────────────────────────────────────────────────
  Email:        john.doe@example.com
  Phone:        +1-555-0123
  Date:         2025-10-28
────────────────────────────────────────────────────────────────────────────────
  ✓ Insert Supabase            Success    (ID: abc-123-def)
  ✓ Create Contact             Success    (ID: ghl_contact_xyz)
  ✓ Add Note                   Success    (Einstein URL added)
  ✓ Create Opportunity         Success    (ID: ghl_opp_456)
  ✓ Update Supabase            Success    (GHL IDs synced)
════════════════════════════════════════════════════════════════════════════════
```

### Status Indicators:
- **✓ (Green)** - Success
- **✗ (Red)** - Error
- **○ (Yellow)** - Pending/Skipped

At the end, you'll see a summary:
```
════════════════════════════════════════════════════════════════════════════════
  BATCH SUMMARY
════════════════════════════════════════════════════════════════════════════════
  ✓ Successful: 148
  ✗ Failed:     2
  ○ Total:      150
════════════════════════════════════════════════════════════════════════════════
```

## 🔄 Retry Logic

The script includes intelligent retry logic for API calls:

- **Automatic retry** on server errors (5xx) and network issues
- **Exponential backoff**: 1s → 2s → 4s → 8s → 16s (max 30s)
- **Max 5 retry attempts** per API call
- **No retry** on client errors (4xx - bad data, auth issues, etc.)

## ⚠️ Important Notes

### File Names with Spaces
When your CSV filename contains spaces, **always use quotes**:

**✅ Correct:**
```bash
node extractCsv.mjs --input="Xulon Leads - Sheet6.csv"
```

**❌ Incorrect:**
```bash
node extractCsv.mjs --input=Xulon Leads - Sheet6.csv
```

### Windows Paths
Use forward slashes `/` or escape backslashes `\\`:

**✅ Correct:**
```bash
--input="C:/Users/YourName/Documents/Xulon Leads - Sheet6.csv"
--input="C:\\Users\\YourName\\Documents\\Xulon Leads - Sheet6.csv"
```

**❌ Incorrect:**
```bash
--input="C:\Users\YourName\Documents\Xulon Leads - Sheet6.csv"
```

### Testing First
Always test with `--limit=5` or `--dry-run=true` before running a full import!

## 🐛 Troubleshooting

### "Input CSV not found"
- Check that the filename is correct
- Use quotes around filenames with spaces
- Verify the file exists in the specified path

### "Supabase SERVICE_ROLE_KEY not provided"
- Check your `.env` file exists in the same folder
- Verify all required environment variables are set
- Make sure `.env` file is not named `.env.txt`

### "GHL API call failed"
- Verify your GHL API token is valid
- Check your LOCATION_ID is correct
- Ensure you have proper permissions in GHL

### Import hangs or is slow
- The script processes 8 records concurrently by default
- Large CSV files may take time
- Check your internet connection
- Monitor the console for retry warnings

## 📊 Data Flow

1. **CSV Parsing** → Reads and normalizes CSV data
2. **Supabase Insert** → Creates contact in star schema database
3. **GHL Contact** → Creates contact in GoHighLevel CRM
4. **Einstein Note** → Adds proposal link note to contact
5. **GHL Opportunity** → Creates sales opportunity
6. **Supabase Update** → Syncs GHL IDs back to database

## 📞 Support

For issues or questions:
1. Check this README first
2. Review the console output for error messages
3. Try with `--dry-run=true` to debug data issues
4. Contact your system administrator

## 📜 License

ISC License - Copyright (c) Xulon Press
