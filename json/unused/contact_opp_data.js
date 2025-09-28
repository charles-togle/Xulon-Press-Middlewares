const currOpportunity = {
  id: 'TmngLdfolRwTW6NAMuv8',
  name: 'Brad Thompson',
  monetaryValue: 0,
  pipelineId: 'j7luVqP7W92h8E9AWaSe',
  pipelineStageId: 'b9ccd7f2-2d77-43a2-9e0c-a59388fd5c3e',
  pipelineStageUId: 'b9ccd7f2-2d77-43a2-9e0c-a59388fd5c3e',
  assignedTo: 'kJNPperWVjPkxCfYIU3c',
  status: 'open',
  source: 'TDM Digital',
  lastStatusChangeAt: '2025-09-23T04:00:24.442Z',
  lastStageChangeAt: '2025-09-23T04:00:24.442Z',
  createdAt: '2025-09-23T04:00:24.442Z',
  updatedAt: '2025-09-23T04:00:24.442Z',
  contactId: 'DZNJn4QeybLlqCWnr9al',
  locationId: 'ztC7GrzfpwRrsyIBthNZ',
  customFields: [
    {
      id: 'ggsTQrS88hJgLI5J5604',
      type: 'string',
      fieldValueString: 'Xulon Press'
    },
    {
      id: 'gsFwmLo8XyzCjIoXxXYQ',
      type: 'string',
      fieldValueString: 'Unknown'
    },
    {
      id: '4P0Yd0fLzOfns3opxTGo',
      type: 'string',
      fieldValueString: 'No'
    },
    {
      id: '5wlgHZzuWLyr918dMh7y',
      type: 'string',
      fieldValueString: 'Hobby/Special Interest'
    },
    {
      id: 'cG5oYGyyKmEWwzn7y8HA',
      type: 'string',
      fieldValueString: 'I will be finished writing in 90 days'
    },
    {
      id: 'aOH64ZsyJ5blAZtf9IxK',
      type: 'string',
      fieldValueString: 'Unprovided'
    },
    {
      id: 'BOGtp8xLezwurePxIkNE',
      type: 'string',
      fieldValueString: '0'
    },
    {
      id: '5lDyHBJDAukD5YM7M4WG',
      type: 'string',
      fieldValueString:
        'https://www.salemauthorcenter.com/ghl/index.php?ContactID=2c140077-9d61-4df2-a42a-37d872cad6f6'
    },
    {
      id: 'uUEENCZJBnr0mjbuPe98',
      type: 'string',
      fieldValueString: 'Warm'
    },
    {
      id: 'UAjLmcYVz1hdI4sPVKSr',
      type: 'string',
      fieldValueString: 'www.findpublishinghelp.com'
    }
  ],
  lostReasonId: null,
  followers: [],
  relations: [
    {
      associationId: 'OPPORTUNITIES_CONTACTS_ASSOCIATION',
      relationId: 'TmngLdfolRwTW6NAMuv8',
      primary: true,
      objectKey: 'contact',
      recordId: 'DZNJn4QeybLlqCWnr9al',
      fullName: 'Brad Thompson',
      contactName: 'Brad Thompson',
      companyName: null,
      email: 'bradleythompson659@gmail.com',
      phone: '+12563088227',
      tags: [],
      attributed: null
    }
  ],
  contact: {
    id: 'DZNJn4QeybLlqCWnr9al',
    name: 'Brad Thompson',
    companyName: null,
    email: 'bradleythompson659@gmail.com',
    phone: '+12563088227',
    tags: [],
    score: []
  },
  sort: [1758600024442, 'DZNJn4QeybLlqCWnr9al'],
  attributions: []
}

const currContact = {
  id: 'DZNJn4QeybLlqCWnr9al',
  dateAdded: '2025-09-23T04:00:23.089Z',
  tags: [],
  type: 'lead',
  locationId: 'ztC7GrzfpwRrsyIBthNZ',
  firstName: 'Brad',
  firstNameLowerCase: 'brad',
  fullNameLowerCase: 'brad thompson',
  lastName: 'Thompson',
  lastNameLowerCase: 'thompson',
  email: 'bradleythompson659@gmail.com',
  emailLowerCase: 'bradleythompson659@gmail.com',
  phone: '+12563088227',
  address1: '2204 Cleveland aven southwest',
  city: 'Decatur',
  state: 'AL',
  country: 'US',
  postalCode: '35601',
  website: 'www.findpublishinghelp.com',
  source: 'TDM Digital',
  dnd: false,
  dndSettings: { Email: { status: 'inactive', message: '', code: '' } },
  assignedTo: 'kJNPperWVjPkxCfYIU3c',
  createdBy: {
    source: 'INTEGRATION',
    channel: 'OAUTH',
    sourceId: '68be0b246a0a6c3761be69a4',
    timestamp: '2025-09-23T04:00:23.089Z'
  },
  dateUpdated: '2025-09-23T04:00:23.693Z',
  timezone: 'US/Eastern',
  customFields: [
    { id: 'AMgJg4wIu7GKV02OGxD3', value: 'Xulon Press' },
    { id: 'fFWUJ9OFbYBqVJjwjQGP', value: 'Unknown' },
    { id: 'ZXykBROLtnEh5A5vaT2B', value: [] },
    { id: 'IjmRpmQlwHiJjGnTLptG', value: 'Landing Page' },
    { id: 'JMwy9JsVRTTzg4PDQnhk', value: 'www.findpublishinghelp.com' }
  ],
  additionalEmails: [],
  additionalPhones: []
}

const fullAddress =
  [
    currContact.address1 || '',
    currContact.city || '',
    currContact.state || '',
    currContact.postalCode || ''
  ]
    .filter(part => part.trim() !== '')
    .join(', ') || ''

const getCustomFieldValue = (customFields, fieldId) => {
  return customFields?.find(field => field.id === fieldId)?.value || null
}

const getOpportunityCustomFieldValue = (customFields, fieldId) => {
  return (
    customFields?.find(field => field.id === fieldId)?.fieldValueString || null
  )
}

// Contact Custom Field IDs
const PUBLISHER_C = 'AMgJg4wIu7GKV02OGxD3'
const TIMEZONE_C = 'fFWUJ9OFbYBqVJjwjQGP'
const CONTACT_SOURCE_DETAIL = 'IjmRpmQlwHiJjGnTLptG'
const SOURCE_DETAIL_VALUE_C = 'JMwy9JsVRTTzg4PDQnhk'

// Opportunity Custom Field IDs (based on your data)
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

// Extract Contact Custom Fields
const publisher = getCustomFieldValue(currContact.customFields, PUBLISHER_C)
const timezone = getCustomFieldValue(currContact.customFields, TIMEZONE_C)
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

const { data: pipelineNames, error: pipelineNamesError } = await supabase.rpc(
  'get_pipeline_and_stage_names',
  {
    p_pipeline_id: currOpportunity.pipelineId,
    p_pipeline_stage_id: currOpportunity.pipelineStageId
  }
)

const { error: updaterError } = await supabase.rpc(
  'update_contact_in_star_schema_using_contact_id',
  {
    p_contact_id_matcher: currContact.id,
    p_first_name: currContact.firstName ?? null,
    p_last_name: currContact.lastName ?? null,
    p_email: currContact.email ?? null,
    p_phone_number: currContact.phone ?? null,
    p_full_address: fullAddress,
    p_address_line1: currContact.address1,
    p_address_line2: null,
    p_city: currContact.city ?? null,
    p_state_region: currContact.state ?? null,
    p_postal_code: currContact.postalCode ?? null,
    p_country: currContact.country ?? null,
    p_time_zone: timezone ? oppTimezone ?? null : null,

    p_source: currContact.source ? currOpportunity.source ?? null : null,
    p_website_landing_page: sourceDetailValue,
    p_lead_source: contactSource,
    p_lead_owner: currContact.assignedTo ?? null,
    p_lead_value: currOpportunity.monetaryValue ?? 0,

    p_is_author: currContact.type === 'author',
    p_current_author: true,
    p_publisher: publisher ? oppPublisher ?? null : null,
    p_publishing_writing_process_stage: 'Unprovided',
    p_genre: oppGenre ? [oppGenre] : null,
    p_book_description: 'Unprovided',
    p_writing_status: oppWritingProcess ?? null,
    p_rating: oppPipelineBackup,
    p_pipeline_stage: '',
    p_stage_id: currOpportunity.pipelineStageId ?? null,
    p_pipeline_id: currOpportunity.pipelineId ?? null,

    p_create_date: null,
    p_alternate_create_date: null,
    p_lead_conversion_date: null,
    p_lead_id: null,
    p_last_modified_date: new Date().toISOString(),

    p_opt_out_of_emails: currContact.dnd ?? false,
    p_outreach_attempt: oppOutreachAttempt ?? 0,
    p_notes: null
  }
)
