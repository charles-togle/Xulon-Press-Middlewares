{
  "contacts": [
    {
      "id": "kPUcQ7Y9WEjuM85hIdo1",
      "phoneLabel": null,
      "country": "US",
      "address": "street address",
      "source": "Salem Media Group",
      "type": "lead",
      "locationId": "ztC7GrzfpwRrsyIBthNZ",
      "website": "website.com",
      "dnd": false,
      "state": "state",
      "businessName": null,
      "customFields": [
        {
          "id": "AMgJg4wIu7GKV02OGxD3",
          "value": "Xulon Press"
        },
        {
          "id": "fFWUJ9OFbYBqVJjwjQGP",
          "value": "Eastern"
        },
        {
          "id": "IjmRpmQlwHiJjGnTLptG",
          "value": "Radiant"
        },
        {
          "id": "JMwy9JsVRTTzg4PDQnhk",
          "value": "www.findpublishinghelp.com"
        }
      ],
      "tags": [],
      "dateAdded": "2025-09-22T04:08:40.348Z",
      "additionalEmails": [],
      "phone": "+12345678345",
      "companyName": "business name",
      "additionalPhones": [],
      "dateUpdated": "2025-09-22T04:11:15.992Z",
      "city": "city",
      "dateOfBirth": null,
      "firstNameLowerCase": "charles",
      "lastNameLowerCase": "test",
      "firstName": "Charles",
      "lastName": "Test",
      "email": "charles@vxlabs.co",
      "assignedTo": null,
      "followers": [
        "JERtBepiajyLX1Pghv3T"
      ],
      "validEmail": null,
      "opportunities": [
        {
          "pipelineId": "j7luVqP7W92h8E9AWaSe",
          "id": "HzVTQDdZXT0Yzwr33A9r",
          "monetaryValue": 0,
          "pipelineStageId": "b9ccd7f2-2d77-43a2-9e0c-a59388fd5c3e",
          "status": "open"
        }
      ],
      "postalCode": "12345",
      "businessId": null,
      "searchAfter": [
        1758514120348,
        "kPUcQ7Y9WEjuM85hIdo1"
      ]
    }
  ],
  "total": 1,
  "traceId": "21119bb7-f01a-4a2c-93d0-6ab938d68931"
}


    const contact_custom_fields = [
      {
        id: 'AMgJg4wIu7GKV02OGxD3',
        key: 'publisher',
        field_value: supabase_contact.publisher
      },
      {
        id: 'fFWUJ9OFbYBqVJjwjQGP',
        key: 'timezone_c',
        field_value: supabase_contact.time_zone ?? 'Unprovided'
      },
      {
        id: 'ZXykBROLtnEh5A5vaT2B',
        key: 'active_campaigns_c',
        field_value: []
      },
      {
        id: 'IjmRpmQlwHiJjGnTLptG',
        key: 'contact_source_detail',
        field_value:
          supabase_contact.lead_source === ''
            ? 'Unprovided'
            : supabase_contact.lead_source
      },
      {
        id: 'JMwy9JsVRTTzg4PDQnhk',
        key: 'source_detail_value_c',
        field_value: supabase_contact.website_landing_page ?? 'Unprovided'
      }
    ]

    const opportunity_custom_fields = [
      {
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
        field_value: `${supabase_contact.outreach_attempt}`
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
        field_value: supabase_contact.website_landing_page ?? 'Unprovided'
      }
    ]

    let contact_payload = {
      firstName: supabase_contact.first_name ?? 'Unprovided',
      lastName: supabase_contact.last_name ?? 'Unprovided',
      name:
        `${supabase_contact.first_name} ${supabase_contact.last_name}` ??
        'Unprovided',
      locationId: `${LOCATION_ID}`,
      address1: supabase_contact.address_line1 ?? 'Unprovided',
      city: supabase_contact.city ?? 'Unprovided',
      state: supabase_contact.state_region ?? 'Unprovided',
      postalCode: supabase_contact.postal_code ?? 'Unprovided',
      website: supabase_contact.website_landing_page ?? 'Unprovided',
      timezone: supabase_contact.time_zone ?? 'Unprovided',
      dnd: supabase_contact.opt_out_of_email ?? false,
      customFields: contact_custom_fields,
      source: supabase_contact.source ?? 'Unprovided',
      country:
        supabase_contact.country === 'Unprovided' || !supabase_contact.country
          ? 'US'
          : supabase_contact.country,
      assignedTo: assigned_user_id
    }

    const opportunity_payload = {
      pipelineId: supabase_contact.pipeline_id,
      locationId: `${LOCATION_ID}`,
      name:
        `${supabase_contact.first_name} ${supabase_contact.last_name}` ??
        'Unprovided',
      pipelineStageId: supabase_contact.stage_id,
      status: 'open',
      contactId: contact_id,
      assignedTo: assigned_user_id,
      customFields: opportunity_custom_fields,
      source: supabase_contact.source ?? 'Unprovided'
    }


Need to check in update

Publisher C Custom Field 
AMgJg4wIu7GKV02OGxD3
timezone_c
fFWUJ9OFbYBqVJjwjQGP
source detail value
JMwy9JsVRTTzg4PDQnhk


name?
source
phone
Source Detail Value

checks for contact updating opportunity
contact.source detail value c = opportunity.source detail value
contact.publisher c = opportunity.publisher
contact.timezone c = opportunity.timezone
contact.source = opportunity.source
contact.email = opportunity.email
contact.phone number = opportunity.phone


checks for opportunity updating contact
opportunity.source detail value = contact.source detail value c
opportunity.publisher = contact.publisher c 
opportunity.timezone = contact.timezone c 
opportunity.source = contact.source 
opportunity.email = contact.email
opportunity.phone = contact.phone number 