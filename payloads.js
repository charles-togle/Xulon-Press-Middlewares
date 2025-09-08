const contact_custom_fields = [
  {
    id: 'AMgJg4wIu7GKV02OGxD3',
    key: 'publisher',
    field_value: supabase_contact.publisher
  },
  {
    id: 'fFWUJ9OFbYBqVJjwjQGP',
    key: 'timezone_c',
    field_value: supabase_contact.time_zone
  },
  {
    id: 'ZXykBROLtnEh5A5vaT2B',
    key: 'active_campaigns_c',
    field_value: []
  },
  {
    id: 'IjmRpmQlwHiJjGnTLptG',
    key: 'contact_source_detail',
    field_value: supabase_contact.lead_source
  },
  {
    id: 'JMwy9JsVRTTzg4PDQnhk',
    key: 'source_detail_value_c',
    field_value: supabase_contact.source
  }
]

const opportunity_custom_fields = [
  ({
    id: 'ggsTQrS88hJgLI5J5604',
    key: 'publisher',
    field_value: supabase_contact.publisher
  },
  {
    id: 'gsFwmLo8XyzCjIoXxXYQ',
    key: 'timezone',
    field_value: supabase_contact.time_zone
  },
  {
    id: '4P0Yd0fLzOfns3opxTGo',
    key: 'active_or_past_author',
    field_value: supabase_contact.is_author ? 'Yes' : 'No'
  },
  {
    id: '5wlgHZzuWLyr918dMh7y',
    key: 'genre',
    field_value: supabase_contact.genre[0]
  },
  {
    id: 'cG5oYGyyKmEWwzn7y8HA',
    key: 'writing_process',
    field_value: supabase_contact.writing_status
  },
  {
    id: 'BOGtp8xLezwurePxIkNE',
    key: 'outreach_attempt',
    field_value: supabase_contact.outreach_attempt.attempt
  },
  {
    id: '5lDyHBJDAukD5YM7M4WG',
    key: 'proposal_link',
    field_value: supabase_contact.einstein_url
  },
  {
    id: 'aOH64ZsyJ5blAZtf9IxK',
    key: 'book_description',
    field_value: supabase_contact.book_description
  },
  {
    id: 'uUEENCZJBnr0mjbuPe98',
    key: 'pipeline_backup',
    field_value: supabase_contact.rating
  },
  {
    id: 'UAjLmcYVz1hdI4sPVKSr',
    key: 'source_detail_value',
    field_value: supabase_contact.source
  })
]
