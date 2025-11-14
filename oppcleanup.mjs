#!/usr/bin/env node

import { createClient } from '@supabase/supabase-js'
import dotenv from 'dotenv'

dotenv.config()

const SUPABASE_URL = process.env.SUPABASE_URL ?? ''
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY ?? ''
const BASE_URL =
  process.env.GHL_BASE_URL ?? 'https://services.leadconnectorhq.com'
const API_VERSION = process.env.API_VERSION ?? '2021-07-28'
const TOKEN = process.env.TOKEN
const LOCATION_ID = process.env.LOCATION_ID
// Configuration for performance
const PAGE_LIMIT = 100
const BATCH_SIZE = 500 // Process deletions in batches to avoid SQL limits
const MAX_FUNCTION_RUNTIME = 110 // seconds - leave buffer for cleanup
const HEADERS = {
  Authorization: `Bearer ${TOKEN}`,
  'Content-Type': 'application/json',
  Accept: 'application/json',
  Version: API_VERSION,
  'User-Agent': 'node-script-cleanup/1.0'
}

async function runCleanup () {
  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY)
  const jobId = crypto.randomUUID()
  const startTime = new Date().toISOString()
  const stats = {
    totalGhlOpportunities: 0,
    totalDbOpportunities: 0,
    deletedOpportunities: 0,
    errorCount: 0,
    currentPage: 1
  }
  try {
    console.log('Starting opportunity cleanup job...')
    const startTimeMs = Date.now()
    // Step 1: Search for all GHL opportunities and compile into a single list
    console.log('Fetching all opportunities from GoHighLevel...')
    const ghlOpportunityIds = []
    let currentPage = 1
    let hasMorePages = true
    const getGhlOpportunities = async page => {
      const response = await fetch(
        `${BASE_URL}/opportunities/search?location_id=${LOCATION_ID}&page=${page}&limit=${PAGE_LIMIT}`,
        {
          method: 'GET',
          headers: HEADERS
        }
      )
      if (response.status === 429) {
        console.warn(`API rate limit hit on page ${page}`)
        await new Promise(resolve => setTimeout(resolve, 5000))
        return await getGhlOpportunities(page)
      }
      if (!response.ok) {
        throw new Error(`HTTP error ${response.status} fetching page ${page}`)
      }
      return await response.json()
    }
    // Fetch all opportunities from GHL
    let fetchCompletedSuccessfully = true
    while (hasMorePages) {
      // Check if we're approaching the function timeout limit
      const elapsedSeconds = (Date.now() - startTimeMs) / 1000
      if (elapsedSeconds > MAX_FUNCTION_RUNTIME) {
        console.error(
          `⚠️  CRITICAL: Approaching function timeout limit (${elapsedSeconds}s), stopping GHL fetch`
        )
        console.error(
          `⚠️  INCOMPLETE FETCH - Only fetched ${
            ghlOpportunityIds.length
          } opportunities from ${currentPage - 1} pages`
        )
        fetchCompletedSuccessfully = false
        break
      }
      try {
        const response = await getGhlOpportunities(currentPage)
        const { opportunities, meta } = response
        if (!opportunities || opportunities.length === 0) {
          hasMorePages = false
          break
        }
        // Extract opportunity IDs and add to our list
        opportunities.forEach(opp => {
          if (opp.id) {
            ghlOpportunityIds.push(opp.id)
          }
        })
        stats.totalGhlOpportunities += opportunities.length
        stats.currentPage = currentPage
        console.log(
          `Processed page ${currentPage}, found ${opportunities.length} opportunities (Total: ${ghlOpportunityIds.length})`
        )
        // Check if there are more pages based on meta information
        hasMorePages =
          opportunities.length === PAGE_LIMIT &&
          Boolean(meta?.nextPage || meta?.nextPageUrl)
        currentPage++
      } catch (error) {
        console.error(`Error processing page ${currentPage}:`, error)
        stats.errorCount++
        currentPage++
        // If we hit too many errors, stop
        if (stats.errorCount > 10) {
          console.error(
            `⚠️  CRITICAL: Too many consecutive errors (${stats.errorCount}), stopping GHL fetch`
          )
          fetchCompletedSuccessfully = false
          throw new Error('Too many consecutive errors, stopping cleanup')
        }
      }
    }
    console.log(
      `Found ${ghlOpportunityIds.length} total opportunities in GoHighLevel`
    )

    // SAFETY CHECK: Abort if fetch was incomplete
    if (!fetchCompletedSuccessfully) {
      console.error(
        '\n❌ ABORTING CLEANUP: GHL fetch did not complete successfully'
      )
      console.error(
        'Cannot safely proceed with deletion when fetch is incomplete'
      )
      throw new Error(
        'Incomplete GHL fetch - cleanup aborted to prevent data loss'
      )
    }
    // Step 2: Get count of opportunities in our database
    const { count: dbOpportunityCount, error: countError } = await supabase
      .from('fact_contacts')
      .select('*', {
        count: 'exact',
        head: true
      })
      .not('ghl_opportunity_id', 'is', null)
    if (countError) {
      throw new Error(
        `Error counting database opportunities: ${JSON.stringify(countError)}`
      )
    }
    stats.totalDbOpportunities = dbOpportunityCount || 0
    console.log(`Found ${stats.totalDbOpportunities} opportunities in database`)

    // SAFETY CHECK: Verify fetched count is reasonable compared to DB
    const fetchedCount = ghlOpportunityIds.length
    const dbCount = stats.totalDbOpportunities
    const discrepancyThreshold = 0.1 // 10% difference allowed

    if (dbCount > 0 && fetchedCount < dbCount) {
      const discrepancyRatio = (dbCount - fetchedCount) / dbCount
      console.warn(
        `⚠️  WARNING: Fetched ${fetchedCount} opportunities but DB has ${dbCount} (${(
          discrepancyRatio * 100
        ).toFixed(1)}% difference)`
      )

      if (discrepancyRatio > discrepancyThreshold) {
        console.error(
          `\n❌ ABORTING CLEANUP: Fetched count (${fetchedCount}) is significantly lower than DB count (${dbCount})`
        )
        console.error(
          `This suggests an incomplete fetch. Discrepancy: ${(
            discrepancyRatio * 100
          ).toFixed(1)}% (threshold: ${discrepancyThreshold * 100}%)`
        )
        console.error(
          'Possible causes: API rate limiting, timeout, pagination issues, or network problems'
        )
        throw new Error(
          `Unsafe to proceed: fetched ${fetchedCount} but expected ~${dbCount} opportunities`
        )
      } else {
        console.log(
          `✓ Discrepancy within acceptable range (${(
            discrepancyRatio * 100
          ).toFixed(1)}% < ${discrepancyThreshold * 100}%)`
        )
      }
    } else {
      console.log(
        `✓ Fetch validation passed: ${fetchedCount} opportunities fetched`
      )
    }
    // Step 3: Two-phase cleanup approach to avoid batch processing issues
    console.log('Starting two-phase cleanup process...')
    const currentTimestamp = new Date().toISOString()
    // Phase 1: Mark all found opportunities as checked in this cleanup run
    console.log('Phase 1: Marking found opportunities as checked...')
    if (ghlOpportunityIds.length > 0) {
      // Process in batches for marking as checked
      const batches = []
      for (let i = 0; i < ghlOpportunityIds.length; i += BATCH_SIZE) {
        batches.push(ghlOpportunityIds.slice(i, i + BATCH_SIZE))
      }
      console.log(
        `Marking ${ghlOpportunityIds.length} opportunities as checked in ${batches.length} batches`
      )
      for (let batchIndex = 0; batchIndex < batches.length; batchIndex++) {
        const batch = batches[batchIndex]
        try {
          const { error: markError } = await supabase
            .from('fact_contacts')
            .update({
              opportunity_last_checked_at: currentTimestamp
            })
            .in('ghl_opportunity_id', batch)
          if (markError) {
            console.error(
              `Error marking batch ${batchIndex + 1} as checked:`,
              markError
            )
            stats.errorCount++
            // Retry this batch once
            console.log(`Retrying batch ${batchIndex + 1}...`)
            await new Promise(resolve => setTimeout(resolve, 1000))
            const { error: retryError } = await supabase
              .from('fact_contacts')
              .update({
                opportunity_last_checked_at: currentTimestamp
              })
              .in('ghl_opportunity_id', batch)
            if (retryError) {
              console.error(
                `Retry failed for batch ${batchIndex + 1}:`,
                retryError
              )
              stats.errorCount++
            } else {
              console.log(`Retry successful for batch ${batchIndex + 1}`)
            }
          } else {
            console.log(
              `Marked batch ${batchIndex + 1}/${batches.length} as checked`
            )
          }
          // Small delay between batches
          if (batchIndex < batches.length - 1) {
            await new Promise(resolve => setTimeout(resolve, 100))
          }
        } catch (error) {
          console.error(
            `Error processing marking batch ${batchIndex + 1}:`,
            error
          )
          stats.errorCount++
        }
      }
      // Phase 2: Delete opportunities that weren't checked in this run
      console.log('Phase 2: Cleaning up unchecked opportunities...')
      const { data: uncheckedOpportunities, error: cleanupError } =
        await supabase.rpc('cleanup_unchecked_opportunities', {
          p_current_timestamp: currentTimestamp
        })
      if (cleanupError) {
        throw new Error(
          `Error cleaning up unchecked opportunities: ${JSON.stringify(
            cleanupError
          )}`
        )
      }
      stats.deletedOpportunities = uncheckedOpportunities?.length || 0
      console.log(
        `Phase 2 complete: Cleaned up ${stats.deletedOpportunities} opportunities that weren't found in GHL`
      )
    } else {
      console.log(
        'No opportunities found in GHL, clearing all database opportunities'
      )
      // If no opportunities in GHL, clear all opportunity IDs from database
      const { data: allDeletedOpportunities, error: clearAllError } =
        await supabase.rpc('clear_all_opportunities', {
          p_current_timestamp: currentTimestamp
        })
      if (clearAllError) {
        throw new Error(
          `Error clearing all opportunities: ${JSON.stringify(clearAllError)}`
        )
      }
      stats.deletedOpportunities = allDeletedOpportunities?.length || 0
      console.log(
        `Cleared ${stats.deletedOpportunities} opportunities from database`
      )
    }
    // Step 4: Log cleanup results to cleanup_logs table
    const { error: logError } = await supabase
      .from('opportunity_cleanup_logs')
      .insert({
        job_id: jobId,
        cleanup_time: startTime,
        total_ghl_opportunities: stats.totalGhlOpportunities,
        total_db_opportunities: stats.totalDbOpportunities,
        deleted_opportunities: stats.deletedOpportunities,
        error_count: stats.errorCount,
        status: 'completed',
        end_time: new Date().toISOString()
      })
    if (logError) {
      console.error('Error logging cleanup results:', logError)
    }

    console.log('\n=== CLEANUP COMPLETED SUCCESSFULLY ===')
    console.log(
      JSON.stringify(
        {
          success: true,
          job_id: jobId,
          message: 'Opportunity cleanup completed successfully',
          stats: {
            totalGhlOpportunities: stats.totalGhlOpportunities,
            totalDbOpportunities: stats.totalDbOpportunities,
            deletedOpportunities: stats.deletedOpportunities,
            errorCount: stats.errorCount
          }
        },
        null,
        2
      )
    )
  } catch (error) {
    console.error('Cleanup job failed:', error)
    // Log failed cleanup attempt
    await supabase.from('opportunity_cleanup_logs').insert({
      job_id: jobId,
      cleanup_time: startTime,
      total_ghl_opportunities: stats.totalGhlOpportunities,
      total_db_opportunities: stats.totalDbOpportunities,
      deleted_opportunities: stats.deletedOpportunities,
      error_count: stats.errorCount,
      status: 'failed',
      end_time: new Date().toISOString(),
      error_details: error.message
    })

    console.error('CLEANUP FAILED')
    console.error(
      JSON.stringify(
        {
          success: false,
          job_id: jobId,
          error: 'Cleanup job failed',
          details: error.message,
          stats: stats
        },
        null,
        2
      )
    )

    process.exit(1)
  }
}

// Run the cleanup
runCleanup()
  .then(() => {
    console.log('Cleanup script completed successfully')
    process.exit(0)
  })
  .catch(error => {
    console.error('Fatal error:', error)
    process.exit(1)
  })
