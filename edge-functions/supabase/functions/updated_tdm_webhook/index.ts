// Setup type definitions for built-in Supabase Runtime APIs
import 'jsr:@supabase/functions-js/edge-runtime.d.ts'
import { createClient } from 'npm:@supabase/supabase-js@2.39.3'
const SUPABASE_URL = Deno.env.get('SUPABASE_URL') ?? ''
const SUPABASE_SERVICE_ROLE_KEY =
  Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''

function capitalize (str: string | null): string | null {
  if (!str || typeof str !== 'string') return str
  return str.charAt(0).toUpperCase() + str.slice(1).toLowerCase()
}
Deno.serve(async req => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', {
      status: 200,
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'POST, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type, Authorization'
      }
    })
  }
  if (req.method !== 'POST') {
    return new Response('Method Not Allowed', {
      status: 405,
      headers: {
        'Access-Control-Allow-Origin': '*'
      }
    })
  }
  try {
    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY)
    const payload = await req.json()
    const {
      first_name = null,
      last_name = null,
      email = null,
      phone = null,
      christian_publishing = null,
      writing_process = null,
      zip_code = null,
      genre = null,
      address = null,
      city = null,
      state = null
    } = payload

    const normalized_first_name = capitalize(first_name)
    const normalized_last_name = capitalize(last_name)

    const requiredFields = {
      first_name: normalized_first_name,
      last_name: normalized_last_name,
      email,
      writing_process,
      zip_code
    }
    const missing = Object.entries(requiredFields).filter(
      ([, value]) => !value || !value.toString().trim()
    )
    if (missing.length > 0) {
      console.log('Payload missing fields: ', payload)
      return new Response(
        JSON.stringify({
          error: 'Missing required fields or empty values'
        }),
        {
          status: 400,
          headers: {
            'Content-Type': 'application/json',
            'Access-Control-Allow-Origin': '*'
          }
        }
      )
    }

    const writingProcessMap = {
      'My book is ready now': 'I have finished writing my book',
      'In 1-3 months': 'I will be finished writing in 90 days',
      'In 4-6 months': 'I will be finished writing in 6 months',
      'In 6-12 months': 'I have not started writing my book yet',
      'Over a year from now': 'I have not started writing my book yet'
    }
    let writing_status = writingProcessMap[writing_process]

    const warmConditions = [
      'I will be finished writing in 90 days',
      'I will be finished writing in 60 days',
      'I will be finished writing in 30 days',
      'I will be finished writing in 6 months',
      'I have not started writing my book yet',
      'Unknown',
      'I would like a FREE publishing consultation',
      'I would just like to hear about special offers'
    ]

    let pipeline = '1. Hot'
    if (warmConditions.includes(writing_status)) {
      pipeline = '2. Warm'
    }
    const getOpportunityExtraInfo = async ({ rating, stage, publisher }) => {
      const { data, error } = await supabase.rpc(
        'get_pipeline_stage_and_do_round_robin',
        {
          p_rating: rating,
          p_stage: stage,
          p_publisher: publisher
        }
      )
      if (error) {
        throw error
      }
      return data[0]
    }
    const publisher =
      christian_publishing === 'Yes' ? 'Xulon Press' : 'Mill City Press'
    const { pipeline_id, pipeline_stage_id, assigned_user_id } =
      await getOpportunityExtraInfo({
        rating: pipeline,
        stage: 'New',
        publisher: publisher
      })

    const { data: stagingData, error: stagingError } = await supabase.rpc(
      'insert_lead_staging',
      {
        p_first_name: normalized_first_name,
        p_last_name: normalized_last_name,
        p_email: email ?? '',
        p_phone: phone ?? '',
        p_postal_code: zip_code ?? 'Unprovided',
        p_address_line1: address ?? 'Unprovided',
        p_address_line2: 'Unprovided',
        p_city: city ?? 'Unprovided',
        p_state_region: state ?? 'Unprovided',
        p_country: 'United States',
        p_source: 'TDM Digital',
        p_website: 'www.findpublishinghelp.com',
        p_lead_source: 'Landing Page',
        p_lead_owner: assigned_user_id,
        p_lead_value: 'Unknown',
        p_is_author: 'No',
        p_current_author: false,
        p_publisher: publisher,
        p_book_description: 'Unprovided',
        p_writing_status: writing_status ?? 'Unknown',
        p_rating: pipeline.split('. ')[1],
        p_genre: genre ? [genre] : [],
        p_pipeline_stage: 'New',
        p_stage_id: pipeline_stage_id,
        p_pipeline_id: pipeline_id,
        p_lead_id: null,
        p_alternate_create_date: null,
        p_lead_conversion_date: null,
        p_time_zone: 'Unknown',
        p_opt_out_of_emails: false,
        p_outreach_attempt: 0,
        p_notes: null
      }
    )
    console.log(stagingData)
    console.log(stagingError)
    if (stagingError) {
      return new Response(
        JSON.stringify({
          error: `Error staging entity ${stagingError.message}`
        }),
        {
          status: 400,
          headers: {
            'Content-Type': 'application/json',
            'Access-Control-Allow-Origin': '*'
          }
        }
      )
    }
    const { data: createGHLData, error: createGHLError } =
      await supabase.functions.invoke('create-contact-note-opportunity', {
        body: {
          contact_uuid: stagingData
        },
        method: 'POST'
      })
    if (createGHLError) {
      return new Response(
        JSON.stringify({
          error: `Error creating Go High Level Entity ${createGHLError.message}`
        }),
        {
          status: 400,
          headers: {
            'Content-Type': 'application/json',
            'Access-Control-Allow-Origin': '*'
          }
        }
      )
    }
    if (createGHLData.status === 500) {
      throw createGHLData
    }
    if (createGHLData.success === false) {
      throw createGHLData.error.message
    }
    return new Response(
      JSON.stringify({
        success: true,
        message: `contact and opportunity for ${first_name} ${last_name} with the email of ${email} was created successfully`
      }),
      {
        status: 200,
        headers: {
          'Content-Type': 'application/json',
          'Access-Control-Allow-Origin': '*'
        }
      }
    )
  } catch (err) {
    return new Response(
      JSON.stringify({
        message: `Internal Server Error: ${err}`,
        status: 500
      }),
      {
        headers: {
          'Content-Type': 'application/json',
          'Access-Control-Allow-Origin': '*',
          Connection: 'keep-alive'
        }
      }
    )
  }
})
