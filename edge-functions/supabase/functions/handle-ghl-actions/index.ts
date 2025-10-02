import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.56.1'
import { handleContactCreate } from './handleContactCreate.ts'
import { handleContactUpdate } from './handleContactUpdate.ts'
import { handleOpportunityUpdate } from './handleOpportunityUpdate.ts'
const SUPABASE_URL = Deno.env.get('SUPABASE_URL') ?? ''
const SUPABASE_SERVICE_ROLE_KEY =
  Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
const LOCATION_ID = Deno.env.get('GHL_LOCATION_ID')
//PUT IN SECRETS
Deno.serve(async req => {
  // Predefine CORS headers
  const corsHeaders = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers':
      'authorization, x-client-info, apikey, content-type'
  }
  try {
    const { method } = req
    // Handle CORS preflight
    if (method === 'OPTIONS') {
      return new Response(null, {
        status: 204,
        headers: corsHeaders
      })
    }
    // Guard: allow only POST
    if (method !== 'POST') {
      return new Response(
        JSON.stringify({
          error: 'Method not allowed. Use POST or OPTIONS.'
        }),
        {
          status: 405,
          headers: {
            ...corsHeaders,
            'Content-Type': 'application/json'
          }
        }
      )
    }
    // Parse payload based on content type
    const contentType = req.headers.get('content-type') || ''
    let payload
    if (contentType.includes('application/json')) {
      payload = await req.json()
    } else {
      // Fallback: attempt text; if empty, keep as null
      const text = await req.text()
      payload = text || null
    }
    const eventType = req.headers.get('event-type') || ''
    const allowedEventTypes = [
      'contact-creation',
      'contact-update',
      'opportunity-creation',
      'opportunity-update',
      'note-creation',
      'note-update'
    ]
    if (!allowedEventTypes.includes(eventType)) {
      return new Response(
        JSON.stringify({
          ok: false,
          error: 'Bad Request: Invalid Event'
        }),
        {
          status: 500,
          headers: {
            ...corsHeaders,
            'Content-Type': 'application/json'
          }
        }
      )
    }
    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY)
    const ghlBody = await payload
    console.log(eventType, ': ', ghlBody)
    await new Promise(resolve => setTimeout(resolve, 2000))
    const { data, error: checkExistError } = await supabase
      .from('fact_contacts')
      .select('ghl_contact_id')
      .eq('ghl_contact_id', ghlBody.contact_id)
    if (checkExistError) {
      console.error(
        `Error checking for contact existence in supabase reason: ${JSON.stringify(
          checkExistError
        )}`
      )
      return new Response(
        JSON.stringify({
          ok: false,
          message: 'Error checking existence in supabase'
        }),
        {
          status: 200,
          headers: {
            ...corsHeaders,
            'Content-Type': 'application/json'
          }
        }
      )
    }
    let contactExists
    if (data[0]?.ghl_contact_id) {
      contactExists = true
    } else {
      contactExists = false
    }
    if (eventType === 'contact-creation') {
      if (contactExists) {
        console.info('Supabase Duplicate: ', ghlBody.contact_id)
        return new Response(
          JSON.stringify({
            ok: false,
            message: 'Supabase Duplicate'
          }),
          {
            status: 200,
            headers: {
              ...corsHeaders,
              'Content-Type': 'application/json'
            }
          }
        )
      }
      await handleContactCreate({
        ghlBody: ghlBody,
        LOCATION_ID: LOCATION_ID,
        supabase: supabase
      })
      return new Response(
        JSON.stringify({
          ok: true,
          message: 'Contact created'
        }),
        {
          status: 200,
          headers: {
            ...corsHeaders,
            'Content-Type': 'application/json'
          }
        }
      )
    }
    if (eventType === 'contact-update') {
      await handleContactUpdate({
        ghlBody: ghlBody,
        supabase: supabase
      })
      return new Response(
        JSON.stringify({
          ok: true,
          message: 'Contact updated'
        }),
        {
          status: 200,
          headers: {
            ...corsHeaders,
            'Content-Type': 'application/json'
          }
        }
      )
    }
    if (eventType === 'opportunity-update') {
      if (
        ghlBody.customData?.outreach_attempt === '6' ||
        ghlBody.customData?.outreach_attempt === 6
      ) {
        const { error } = await supabase
          .from('fact_contacts')
          .update({ ghl_opportunity_id: null })
          .eq('ghl_contact_id', ghlBody.contact_id)

        if (error) {
          console.error('Error updating opportunity deletion:', error)
          return new Response(
            JSON.stringify({
              ok: false,
              error: 'Error updating opportunity deletion'
            }),
            {
              status: 500,
              headers: {
                ...corsHeaders,
                'Content-Type': 'application/json'
              }
            }
          )
        }

        console.log('Opportunity deleted')
        return new Response(
          JSON.stringify({
            ok: true,
            message: 'Opportunity deleted successfully'
          }),
          {
            status: 200,
            headers: {
              ...corsHeaders,
              'Content-Type': 'application/json'
            }
          }
        )
      }

      await handleOpportunityUpdate({
        ghlBody: ghlBody,
        supabase: supabase
      })
      return new Response(
        JSON.stringify({
          ok: true,
          message: 'Opportunity updated'
        }),
        {
          status: 200,
          headers: {
            ...corsHeaders,
            'Content-Type': 'application/json'
          }
        }
      )
    }
    if (eventType === 'opportunity-creation') {
      const { data, error } = await supabase
        .from('fact_contacts')
        .update({
          ghl_opportunity_id: ghlBody.id
        })
        .eq('ghl_contact_id', ghlBody.contact_id)

      if (error) {
        console.error('Error updating opportunity creation:', error)
        return new Response(
          JSON.stringify({
            ok: false,
            error: 'Error updating opportunity creation'
          }),
          {
            status: 500,
            headers: {
              ...corsHeaders,
              'Content-Type': 'application/json'
            }
          }
        )
      }

      console.log('Opportunity created, updated contact:', data)

      await handleOpportunityUpdate({
        ghlBody: ghlBody,
        supabase: supabase
      })

      return new Response(
        JSON.stringify({
          ok: true,
          message: 'Opportunity created successfully'
        }),
        {
          status: 200,
          headers: {
            ...corsHeaders,
            'Content-Type': 'application/json'
          }
        }
      )
    }

    if (eventType === 'opportunity-delete') {
      const { data, error } = await supabase
        .from('fact_contacts')
        .update({ ghl_opportunity_id: null })
        .eq('ghl_contact_id', ghlBody.customData.contact_id)

      if (error) {
        console.error('Error updating opportunity deletion:', error)
        return new Response(
          JSON.stringify({
            ok: false,
            error: 'Error updating opportunity deletion'
          }),
          {
            status: 500,
            headers: {
              ...corsHeaders,
              'Content-Type': 'application/json'
            }
          }
        )
      }

      console.log('Opportunity deleted, updated contact:', data)
      return new Response(
        JSON.stringify({
          ok: true,
          message: 'Opportunity deleted successfully'
        }),
        {
          status: 200,
          headers: {
            ...corsHeaders,
            'Content-Type': 'application/json'
          }
        }
      )
    }

    return new Response(
      JSON.stringify({
        ok: true,
        received: payload !== undefined
      }),
      {
        status: 200,
        headers: {
          ...corsHeaders,
          'Content-Type': 'application/json'
        }
      }
    )
  } catch (err) {
    console.error('Error handling request:', err)
    return new Response(
      JSON.stringify({
        ok: false,
        error: 'Internal Server Error'
      }),
      {
        status: 500,
        headers: {
          ...corsHeaders,
          'Content-Type': 'application/json'
        }
      }
    )
  }
})
