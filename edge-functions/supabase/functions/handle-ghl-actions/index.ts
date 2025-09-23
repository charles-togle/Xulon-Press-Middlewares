import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.56.1'
import { handleCreateContact } from './handleCreateContact.ts'
import { handleUpdateContact } from './handleUpdateContact.ts'
import { handleUpdateOpportunity } from './handleUpdateOpportunity.ts'
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
    const { data } = await supabase
      .from('fact_contacts')
      .select('ghl_contact_id')
      .eq('ghl_contact_id', ghlBody.contact_id)
      .maybeSingle()
    let contactExists
    if (data?.ghl_contact_id) {
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
      await handleCreateContact({
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
      await handleUpdateContact({
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
      await handleUpdateOpportunity({
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
