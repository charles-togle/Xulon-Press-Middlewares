import { getOpportunityExtraInfo, updateFactContactTable, updateGhlContact, searchGhlContact } from "./utils.ts";
const handleUpdateOpportunity = async ({ ghlBody, supabase })=>{
  const { pipeline_stage_id } = await getOpportunityExtraInfo({
    rating: ghlBody.pipeline_name,
    stage: ghlBody.pipleline_stage,
    publisher: "",
    supabaseClient: supabase
  });
  const { data: supabase_contact, error: supabase_contact_error } = await supabase.rpc("update_contact_in_star_schema_using_contact_id", {
    p_contact_id_matcher: ghlBody.contact_id,
    // Person
    p_first_name: ghlBody.first_name ?? "",
    p_last_name: ghlBody.last_name ?? "",
    p_email: ghlBody.email,
    p_phone_number: ghlBody.phone,
    p_full_address: ghlBody.full_address ?? null,
    // Address
    p_address_line1: ghlBody.address1 ?? null,
    p_address_line2: null,
    p_city: ghlBody.city ?? null,
    p_state_region: ghlBody.state ?? null,
    p_postal_code: ghlBody.postalCode ?? null,
    p_country: ghlBody.country,
    p_time_zone: ghlBody["Timezone C"] ?? null,
    // Acquisition
    p_source: "Unknown",
    p_website_landing_page: ghlBody["Source Detail Value C"] ?? "Unprovided",
    p_lead_source: ghlBody["Contact Source Detail"] ?? "Unknown",
    p_lead_owner: ghlBody.customData?.owner || "",
    p_lead_value: ghlBody.monetary_value ?? 0,
    // Opportunity
    p_is_author: ghlBody.customData?.active_or_past_author === "true",
    p_current_author: ghlBody.customData?.active_or_past_author === "true",
    p_publisher: ghlBody.customData?.publisher ?? "Unknown",
    p_publishing_writing_process_stage: "Unprovided",
    p_genre: ghlBody.customData?.genre ? [
      ghlBody.customData?.genre
    ] : [],
    p_book_description: ghlBody.customData?.book_description ?? "Unprovided",
    p_writing_status: ghlBody.customData?.writing_process ?? "Unknown",
    p_rating: ghlBody.pipeline_name,
    p_pipeline_stage: ghlBody.pipeline_stage,
    p_stage_id: pipeline_stage_id,
    p_pipeline_id: ghlBody.pipeline_id,
    // Dates
    p_create_date: ghlBody.date_created ?? new Date().toISOString(),
    p_alternate_create_date: null,
    p_lead_conversion_date: null,
    p_lead_id: null,
    p_last_modified_date: new Date().toISOString(),
    // Metadata
    p_opt_out_of_emails: false,
    p_outreach_attempt: ghlBody.customData?.outreach_attempt || 0,
    p_notes: null
  });
  if (supabase_contact_error) {
    console.error("Error updating opportunity info:", supabase_contact_error);
    return new Response(JSON.stringify({
      error: "Error updating opportunity info"
    }), {
      status: 500,
      headers: {
        "Content-Type": "application/json"
      }
    });
  } else {
    console.log("Updated opportunity fact_id:", supabase_contact);
  }
  //verify if ghl contact needs updating
  const existingContact = await searchGhlContact(ghlBody.contact_id);
  console.log(existingContact);
  //update contact
  const contact_custom_fields = [
    {
      id: "AMgJg4wIu7GKV02OGxD3",
      key: "publisher",
      field_value: supabase_contact.publisher
    },
    {
      id: "fFWUJ9OFbYBqVJjwjQGP",
      key: "timezone_c",
      field_value: ghlBody.customData?.timezone ?? "Unprovided"
    },
    {
      id: "IjmRpmQlwHiJjGnTLptG",
      key: "contact_source_detail",
      field_value: ghlBody["Contact Source Detail"] || "Unprovided"
    },
    {
      id: "JMwy9JsVRTTzg4PDQnhk",
      key: "source_detail_value_c",
      field_value: ghlBody["Source Detail Value C"] || "Unprovided"
    }
  ];
  const contact_payload = {
    firstName: ghlBody.first_name ?? "Unprovided",
    lastName: ghlBody.last_name ?? "Unprovided",
    name: ghlBody.full_name ?? "Unprovided",
    address1: ghlBody.address1 ?? "Unprovided",
    city: ghlBody.city ?? "Unprovided",
    state: ghlBody.state ?? "Unprovided",
    postalCode: ghlBody.postalCode ?? "Unprovided",
    website: ghlBody["Source Detail Value C"] || "Unprovided",
    timezone: ghlBody.customData?.timezone ?? "Unprovided",
    customFields: contact_custom_fields,
    source: "Unknown",
    country: ghlBody.country,
    assignedTo: ghlBody.customData?.owner || "",
    ...ghlBody.email ? {
      email: ghlBody.email
    } : {},
    ...ghlBody.phone ? typeof ghlBody.phone === "object" && "phone_number" in ghlBody.phone ? {
      phone: ghlBody.phone.phone_number
    } : {
      phone: ghlBody.phone
    } : {}
  };
  const updateContact = await updateGhlContact(contact_payload, ghlBody.contact_id);
  if (!updateContact.succeeded) {
    console.error("Error updating opportunity info from ghl:", updateContact);
    return new Response(JSON.stringify({
      error: "Error updating opportunity info"
    }), {
      status: 500,
      headers: {
        "Content-Type": "application/json"
      }
    });
  }
  await updateFactContactTable({
    uuid: supabase_contact[0].out_fact_id,
    assignedUserId: ghlBody.customData?.owner ?? null,
    contactId: ghlBody.contact_id,
    opportunityId: ghlBody.id,
    supabaseClient: supabase
  });
};
export { handleUpdateOpportunity };
