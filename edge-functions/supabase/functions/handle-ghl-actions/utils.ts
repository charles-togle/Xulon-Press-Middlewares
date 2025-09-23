const BASE_URL = "https://services.leadconnectorhq.com";
const API_VERSION = "2021-07-28";
const TOKEN = Deno.env.get("GHL_TOKEN");
const LOCATION_ID = Deno.env.get("GHL_LOCATION_ID");
const GHL_HEADERS = {
  Authorization: `Bearer ${TOKEN}`,
  "Content-Type": "application/json",
  Accept: "application/json",
  Version: API_VERSION
};
const createGhlOpportunity = async (payload)=>{
  const URL = `${BASE_URL}/opportunities/`;
  const response = await fetch(URL, {
    body: JSON.stringify(payload),
    headers: GHL_HEADERS,
    method: "POST"
  });
  const opportunity_info = await response.json();
  return opportunity_info;
};
const updateGhlOpportunity = async (payload, opportunityId)=>{
  const URL = `${BASE_URL}/opportunities/${opportunityId}`;
  const response = await fetch(URL, {
    body: JSON.stringify(payload),
    headers: GHL_HEADERS,
    method: "PUT"
  });
  const opportunity_info = await response.json();
  return opportunity_info;
};
const searchGhlOpportunity = async (contactId)=>{
  const URL = `${BASE_URL}/opportunities/search?location_id=${LOCATION_ID}&contact_id=${contactId}`;
  const response = await fetch(URL, {
    method: "GET",
    headers: GHL_HEADERS
  });
  const opportunity_info = await response.json();
  return opportunity_info;
};
const createGhlNote = async (payload, contactId)=>{
  const URL = `${BASE_URL}/contacts/${contactId}/notes/`;
  const response = await fetch(URL, {
    body: JSON.stringify(payload),
    headers: GHL_HEADERS,
    method: "POST"
  });
  const note_info = await response.json();
  return note_info;
};
const updateGhlContact = async (payload, contactId)=>{
  const URL = `${BASE_URL}/contacts/${contactId}`;
  const response = await fetch(URL, {
    body: JSON.stringify(payload),
    headers: GHL_HEADERS,
    method: "PUT"
  });
  const contactInfo = await response.json();
  return contactInfo;
};
const updateFactContactTable = async ({ uuid, contactId, opportunityId, assignedUserId, supabaseClient })=>{
  const { error } = await supabaseClient.rpc("update_last_assigned_at", {
    p_assigned_user_id: assignedUserId ?? null,
    p_fact_id: uuid,
    p_contact_id: contactId,
    p_opportunity_id: opportunityId
  });
  if (error) {
    console.error(error);
    throw error;
  } else {
    return `Successfully Updated Contact ${uuid}`;
  }
};
const searchGhlContact = async (contactId)=>{
  const URL = `${BASE_URL}/contacts/${contactId}`;
  const response = await fetch(URL, {
    method: "GET",
    headers: GHL_HEADERS
  });
  const contact = await response.json();
  return contact;
};
const getOpportunityExtraInfo = async ({ rating, stage, publisher, supabaseClient })=>{
  const { data, error } = await supabaseClient.rpc("get_pipeline_stage_and_do_round_robin", {
    p_rating: rating,
    p_stage: stage,
    p_publisher: publisher
  });
  if (error) {
    throw error;
  }
  return data[0];
};
function compareObjects(objA, objB, objKeys) {
  for (const key of objKeys){
    if (objA[key] !== objB[key]) {
      return false;
    }
  }
  return true;
}
export { compareObjects, createGhlNote, createGhlOpportunity, getOpportunityExtraInfo, searchGhlOpportunity, searchGhlContact, updateFactContactTable, updateGhlContact, updateGhlOpportunity };
