import { searchGhlOpportunity, updateFactContactTable, updateGhlOpportunity } from "./utils.ts";
const handleUpdateContact = async ({ supabase, ghlBody })=>{
  const { error } = await supabase.from("fact_contacts").select("ghl_opportunity_id").eq("ghl_contact_id", ghlBody.contact_id);
  if (error) {
    console.error("Error checking opportunity:", error);
    return new Response(JSON.stringify({
      error: "Error searching if opportunity exist"
    }), {
      status: 500,
      headers: {
        "Content-Type": "application/json"
      }
    });
  }
  let opportunityId = null;
  let pipelineId = null;
  let pipelineStageId = null;
  const existingOpportunityData = await searchGhlOpportunity(ghlBody.contact_id);
  if (existingOpportunityData.opportunities.length > 0) {
    const opportunity = existingOpportunityData.opportunities[0];
    opportunityId = opportunity.id ?? null;
    pipelineId = opportunity.pipelineId ?? null;
    pipelineStageId = opportunity.pipelineStageId ?? null;
  }
  let pipelineName = null;
  let pipelineStageName = null;
  const { data: pipelineNames, error: pipelineError } = await supabase.rpc("get_pipeline_and_stage_names", {
    p_pipeline_id: pipelineId,
    p_pipeline_stage_id: pipelineStageId
  });
  if (pipelineError) {
    console.error("Error searching for pipeline name: ", pipelineError);
    return new Response(JSON.stringify({
      error: "Error updating contact"
    }), {
      status: 500,
      headers: {
        "Content-Type": "application/json"
      }
    });
  } else {
    pipelineName = pipelineNames[0].pipeline_name;
    pipelineStageName = pipelineNames[0].stage_name;
  }
  console.log(pipelineNames);
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
    p_lead_owner: ghlBody.assigned_to ?? null,
    p_lead_value: "Unprovided",
    // Opportunity
    p_is_author: ghlBody.contact_type === "author",
    p_current_author: ghlBody.contact_type === "author",
    p_publisher: ghlBody["Publisher C"] ?? "Unknown",
    p_publishing_writing_process_stage: "Unprovided",
    p_genre: [],
    p_book_description: "Unprovided",
    p_writing_status: "Unknown",
    p_rating: pipelineName ?? "Warm",
    p_pipeline_stage: pipelineStageName ?? "New",
    p_stage_id: pipelineStageId ?? "b9ccd7f2-2d77-43a2-9e0c-a59388fd5c3e",
    p_pipeline_id: pipelineId ?? "j7luVqP7W92h8E9AWaSe",
    // Dates
    p_create_date: ghlBody.date_created ?? new Date().toISOString(),
    p_alternate_create_date: null,
    p_lead_conversion_date: null,
    p_lead_id: null,
    p_last_modified_date: new Date().toISOString(),
    // Metadata
    p_opt_out_of_emails: false,
    p_outreach_attempt: 0,
    p_notes: null
  });
  if (supabase_contact_error) {
    console.error("Error inserting contact:", supabase_contact_error);
    return new Response(JSON.stringify({
      error: "Error updating contact"
    }), {
      status: 500,
      headers: {
        "Content-Type": "application/json"
      }
    });
  } else {
    console.log("Updated contact fact_id:", supabase_contact);
  }
  //create opportunity
  const opportunity_custom_fields = [
    {
      id: "ggsTQrS88hJgLI5J5604",
      key: "publisher",
      field_value: ghlBody["Publisher C"] ?? "Unknown"
    },
    {
      id: "gsFwmLo8XyzCjIoXxXYQ",
      key: "timezone",
      field_value: ghlBody["Timezone C"] ?? null
    },
    {
      id: "4P0Yd0fLzOfns3opxTGo",
      key: "active_or_past_author",
      field_value: ghlBody.contact_type === "author"
    },
    {
      id: "5wlgHZzuWLyr918dMh7y",
      key: "genre",
      field_value: []
    },
    {
      id: "cG5oYGyyKmEWwzn7y8HA",
      key: "writing_process",
      field_value: ""
    },
    {
      id: "BOGtp8xLezwurePxIkNE",
      key: "outreach_attempt",
      field_value: `0`
    },
    {
      id: "5lDyHBJDAukD5YM7M4WG",
      key: "proposal_link",
      field_value: supabase_contact[0].einstein_url
    },
    {
      id: "aOH64ZsyJ5blAZtf9IxK",
      key: "book_description",
      field_value: ""
    },
    {
      id: "uUEENCZJBnr0mjbuPe98",
      key: "pipeline_backup",
      field_value: pipelineName ?? "Warm"
    },
    {
      id: "UAjLmcYVz1hdI4sPVKSr",
      key: "source_detail_value",
      field_value: ghlBody["Source Detail Value C"] ?? "Unprovided"
    }
  ];
  const opportunity_update_payload = {
    pipelineId: "j7luVqP7W92h8E9AWaSe",
    name: `${ghlBody.first_name} ${ghlBody.last_name}`,
    pipelineStageId: "b9ccd7f2-2d77-43a2-9e0c-a59388fd5c3e",
    status: "open",
    customFields: opportunity_custom_fields
  };
  const opportunityInfo = await updateGhlOpportunity(opportunity_update_payload, opportunityId);
  console.info("opp info: ", opportunityInfo);
  await updateFactContactTable({
    uuid: supabase_contact[0].out_fact_id,
    assignedUserId: null,
    contactId: ghlBody.contact_id,
    opportunityId: opportunityId,
    supabaseClient: supabase
  });
};
export { handleUpdateContact };
