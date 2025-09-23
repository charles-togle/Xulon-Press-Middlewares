import fs from 'fs/promises'

const oppJSON = JSON.parse(await fs.readFile('./json/searchopp.json', 'utf-8'))
const contactJSON = JSON.parse(
  await fs.readFile('./json/searchcontact.json', 'utf-8')
)

const contacts = contactJSON.contacts
const opportunities = oppJSON.opportunities

for (let index = 0; index < 1; index++) {
  const { data, error } = await supabase.rpc(
    'update_contact_in_star_schema_using_contact_id',
    {
      p_contact_id_matcher: '12345', 

      p_first_name: null,
      p_last_name: null,
      p_email: null,
      p_phone_number: null,
      p_full_address: null,
      p_address_line1: null,
      p_address_line2: null,
      p_city: null,
      p_state_region: null,
      p_postal_code: null,
      p_country: null,
      p_time_zone: null,
      p_source: null,
      p_website_landing_page: null,
      p_lead_source: null,
      p_lead_owner: null,
      p_lead_value: null,
      p_is_author: null,
      p_current_author: null,
      p_publisher: null,
      p_publishing_writing_process_stage: null,
      p_genre: null, 
      p_book_description: null,
      p_writing_status: null,
      p_rating: null,
      p_pipeline_stage: null,
      p_stage_id: null,
      p_pipeline_id: null,
      p_create_date: null,
      p_alternate_create_date: null,
      p_lead_conversion_date: null,
      p_lead_id: null,
      p_last_modified_date: null,
      p_opt_out_of_emails: null,
      p_outreach_attempt: null,
      p_notes: null
    }
  )

  if (error) {
    console.error(error)
  } else {
    console.log(data)
  }
}
