function formatContactString (input) {
  // Find the first "{"
  const jsonPart = input.slice(input.indexOf('{'))

  // Fix single-line objects to be valid JSON:
  // - add quotes around keys
  // - ensure proper nulls
  const fixed = jsonPart
    .replace(/(\w+):/g, '"$1":') // quote keys
    .replace(/: (\w+)\}/g, ': "$1"}') // handle loose values (basic case)

  try {
    const parsed = JSON.parse(fixed)
    return JSON.stringify(parsed, null, 2) // pretty-print
  } catch (e) {
    console.error('Failed to parse:', e)
    return fixed // fallback
  }
}

console.log(
  formatContactString(
    'note-update:  {\n  "Publisher C": "Xulon Press",\n  "Timezone C": "Eastern",\n  "Active Campaigns C": [ "Email Newsletter", "Direct Mail", "SMS" ],\n  "Contact Source Detail": "Contact Update Source Detail",\n  "Source Detail Value C": "Contact Update Source Detail Value C",\n  contact_id: "uO9qGvMT8ylN4Dlxrchq",\n  first_name: "VERTEX",\n  last_name: "TEST",\n  full_name: "VERTEX TEST",\n  email: "email@example.com",\n  phone: "+12345678923",\n  tags: "",\n  address1: "Contact Update Street Address",\n  city: "Contact Update City",\n  state: "Contact Update State",\n  country: "US",\n  timezone: "Etc/GMT+12",\n  date_created: "2025-09-13T07:33:29.049Z",\n  postal_code: "Contact Update Postal Code",\n  company_name: "Opportunity Update Business Name",\n  website: "Contact Update Website",\n  date_of_birth: "2021-02-03T00:00:00.000Z",\n  contact_source: "Contact Update Source",\n  full_address: "Contact Update Street Address, Contact Update City Contact Update State Contact Update Postal Code",\n  contact_type: "lead",\n  location: {\n    name: "Xulon Enterprises",\n    address: "555 Winderley Pl suite 225",\n    city: "Maitland",\n    state: "Florida",\n    country: "US",\n    postalCode: "32751",\n    fullAddress: "555 Winderley Pl suite 225, Maitland Florida 32751",\n    id: "ztC7GrzfpwRrsyIBthNZ"\n  },\n  note: { body: "Editing the second note" },\n  workflow: { id: "f8fa0480-f35c-48d1-8c35-7fd5ba732aa8", name: "Notes Changes" },\n  triggerData: {},\n  contact: {\n    attributionSource: { sessionSource: "CRM UI", medium: "manual", mediumId: null },\n    lastAttributionSource: {}\n  },\n  attributionSource: {},\n  customData: {}\n}\n'
  )
)
