import {
    createGhlNote,
    createGhlOpportunity,
    updateFactContactTable,
} from "./utils.ts";
import { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.56.1";

interface GhlBody {
    first_name?: string;
    last_name?: string;
    email?: string;
    phone?: string;
    full_address?: string;
    city?: string;
    state?: string;
    postalCode?: string;
    country?: string;
    timezone?: string;
    contact_type?: string;
    date_created?: string;
    contact_id?: string;
    [key: string]: unknown;
}
interface createContactInterface {
    ghlBody: GhlBody;
    LOCATION_ID: string | undefined;
    supabase: SupabaseClient;
}
const handleCreateContact = async (
    { ghlBody, LOCATION_ID, supabase }: createContactInterface,
) => {
    const { data: supabase_contact, error: supabase_contact_error } =
        await supabase.rpc("insert_contact_to_star_schema", {
            // Person
            p_first_name: ghlBody.first_name,
            p_last_name: ghlBody.last_name,
            p_email: ghlBody.email,
            p_phone_number: ghlBody.phone,
            p_full_address: ghlBody.full_address ?? null,
            // Address
            p_address_line1: "",
            p_address_line2: null,
            p_city: ghlBody.city ?? null,
            p_state_region: ghlBody.state ?? null,
            p_postal_code: ghlBody.postalCode ?? null,
            p_country: ghlBody.country,
            p_time_zone: ghlBody.timezone ?? null,
            // Acquisition
            p_source: "Unknown",
            p_website_landing_page: "Unprovided",
            p_lead_source: "Unknown",
            p_lead_owner: null,
            p_lead_value: "Unprovided",
            // Opportunity
            p_is_author: ghlBody.contact_type === "author",
            p_current_author: ghlBody.contact_type === "author",
            p_publisher: "Unknown",
            p_publishing_writing_process_stage: "Unprovided",
            p_genre: [],
            p_book_description: "Unprovided",
            p_writing_status: "Unknown",
            p_rating: "Warm",
            p_pipeline_stage: "Unprovided",
            p_stage_id: "b9ccd7f2-2d77-43a2-9e0c-a59388fd5c3e",
            p_pipeline_id: "j7luVqP7W92h8E9AWaSe",
            // Dates
            p_create_date: ghlBody.date_created ?? new Date().toISOString(),
            p_alternate_create_date: null,
            p_lead_conversion_date: null,
            p_lead_id: null,
            p_last_modified_date: new Date().toISOString(),
            // Metadata
            p_opt_out_of_emails: false,
            p_outreach_attempt: 0,
            p_notes: null,
            p_ghl_contact_id: ghlBody.contact_id,
        });
    if (supabase_contact_error) {
        console.error("Error inserting contact:", supabase_contact_error);
        return new Response(
            JSON.stringify({
                error: "Error inserting contact",
            }),
            {
                status: 500,
                headers: {
                    "Content-Type": "application/json",
                },
            },
        );
    } else {
        console.log("Inserted contact fact_id:", supabase_contact);
    }
    //create opportunity
    const einstein_notes_payload = {
        userId: "JERtBepiajyLX1Pghv3T",
        body: `Proposal Link: \n\n ${supabase_contact[0].einstein_url}`,
    };
    await createGhlNote(
        einstein_notes_payload,
        ghlBody.contact_id,
    );
    const opportunity_custom_fields = [
        {
            id: "ggsTQrS88hJgLI5J5604",
            key: "publisher",
            field_value: "",
        },
        {
            id: "gsFwmLo8XyzCjIoXxXYQ",
            key: "timezone",
            field_value: ghlBody.timezone,
        },
        {
            id: "4P0Yd0fLzOfns3opxTGo",
            key: "active_or_past_author",
            field_value: ghlBody.contact_type === "author",
        },
        {
            id: "5wlgHZzuWLyr918dMh7y",
            key: "genre",
            field_value: [],
        },
        {
            id: "cG5oYGyyKmEWwzn7y8HA",
            key: "writing_process",
            field_value: "",
        },
        {
            id: "BOGtp8xLezwurePxIkNE",
            key: "outreach_attempt",
            field_value: `0`,
        },
        {
            id: "5lDyHBJDAukD5YM7M4WG",
            key: "proposal_link",
            field_value: supabase_contact[0].einstein_url,
        },
        {
            id: "aOH64ZsyJ5blAZtf9IxK",
            key: "book_description",
            field_value: "",
        },
        {
            id: "uUEENCZJBnr0mjbuPe98",
            key: "pipeline_backup",
            field_value: "Warm",
        },
        {
            id: "UAjLmcYVz1hdI4sPVKSr",
            key: "source_detail_value",
            field_value: "Unprovided",
        },
    ];
    const opportunity_payload = {
        pipelineId: "j7luVqP7W92h8E9AWaSe",
        locationId: `${LOCATION_ID}`,
        name: `${ghlBody.first_name} ${ghlBody.last_name}`,
        pipelineStageId: "b9ccd7f2-2d77-43a2-9e0c-a59388fd5c3e",
        status: "open",
        contactId: ghlBody.contact_id,
        customFields: opportunity_custom_fields,
        source: "Unprovided",
    };
    const opportunityInfo = await createGhlOpportunity(opportunity_payload);
    console.info("Opportunity Created");

    await updateFactContactTable({
        uuid: supabase_contact[0].fact_id,
        assignedUserId: null,
        contactId: ghlBody.contact_id,
        opportunityId: opportunityInfo.opportunity.id,
        supabaseClient: supabase,
    });
};

export { handleCreateContact };
