const contact_payload = {
  firstName: supabase_contact.first_name ?? 'Unprovided',
  lastName: supabase_contact.last_name ?? 'Unprovided',
  name:
    `${supabase_contact.first_name} ${supabase_contact.last_name}` ??
    'Unprovided',
  email: supabase_contact.email ?? 'Unprovided',
  locationId: `${LOCATION_ID}`,
  phone: supabase_contact.phone_number ?? 'Unprovided',
  address1: supabase_contact.address_line1 ?? 'Unprovided',
  city: supabase_contact.city ?? 'Unprovided',
  state: supabase_contact.state_region ?? 'Unprovided',
  postalCode: supabase_contact.postalCode ?? 'Unprovided',
  website: supabase_contact.website_landing_page ?? 'Unprovided',
  timezone: supabase_contact.time_zone ?? 'Unprovided',
  dnd: supabase_contact.opt_out_of_email ?? false,
  inboundDndSettings: { all: { status: 'inactive', message: '' } },
  tags: ['client', 'lead', 'test-import'],
  customFields: contact_custom_fields,
  source: supabase_contact.lead_source ?? 'Unprovided',
  country: 'US',
  assignedTo: assigned_user_id
}

const notes_payload = {
  userId: contactResponseData.contact.id,
  body: supabase_contact.notes
}

const opportunity_payload = {
  pipelineId: pipeline_id,
  locationId: `${LOCATION_ID}`,
  name:
    `${supabase_contact.first_name} ${supabase_contact.last_name}` ??
    'Unprovided',
  pipelineStageId: pipeline_stage_id,
  status: 'open',
  contactId: contactResponseData.contact.id,
  assignedTo: assigned_user_id,
  customFields: opportunity_custom_fields
}

// get pipeline stage, pipeline id, and salesperson id
let {
  // pipeline_id,
  // pipeline_stage_id,
  // stage_position,
  assigned_user_id
} = await getOpportunityExtraInfo({
  rating: supabase_contact.rating ?? '1. Hot',
  stage: supabase_contact.pipeline_stage ?? 'Proposal Sent',
  publisher: supabase_contact.publisher ?? ' '
})
