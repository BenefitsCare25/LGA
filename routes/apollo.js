const express = require('express');
const axios = require('axios');
const PhoneNumberLookup = require('../utils/phoneNumberLookup');
const router = express.Router();

// Initialize Apollo job storage (in production, use Redis or database)
global.apolloJobs = global.apolloJobs || new Map();

// Apollo API Configuration
const APOLLO_API_BASE_URL = 'https://api.apollo.io/api/v1';
const APOLLO_MAX_PAGES = 500; // Apollo API limit
const APOLLO_PER_PAGE = 100; // Apollo API page size

/**
 * Call Apollo.io API directly for lead scraping
 * @param {Array} personTitles - Job titles to search for
 * @param {Array} companySizes - Company size ranges (e.g., ["1-10", "11-50"])
 * @param {Number} maxRecords - Maximum records to fetch (0 = max available, capped at 50k)
 * @returns {Promise<Array>} Array of lead objects
 */
async function scrapeWithApolloAPI(personTitles, companySizes, maxRecords = 0) {
    if (!process.env.APOLLO_API_KEY) {
        throw new Error('Apollo API key not configured');
    }

    console.log('🚀 Starting Apollo API direct search...');
    console.log(`📋 Filters: ${personTitles.length} titles, ${companySizes.length} sizes`);

    // Convert company sizes from "1-10" format to "1,10" format for Apollo API
    const normalizedSizes = companySizes.map(size => size.replace('-', ','));
    console.log(`📊 Normalized company sizes:`, { original: companySizes, normalized: normalizedSizes });

    const allLeads = [];
    let currentPage = 1;
    const effectiveMaxRecords = maxRecords === 0 ? 50000 : Math.min(maxRecords, 50000);
    const maxPages = Math.min(Math.ceil(effectiveMaxRecords / APOLLO_PER_PAGE), APOLLO_MAX_PAGES);

    while (currentPage <= maxPages) {
        try {
            console.log(`📄 Fetching page ${currentPage}/${maxPages}...`);

            const requestBody = {
                person_titles: personTitles,
                person_locations: ['Singapore', 'Singapore, Singapore'],
                organization_num_employees_ranges: normalizedSizes,
                contact_email_status: ['verified'],
                per_page: APOLLO_PER_PAGE,
                page: currentPage
            };

            // Debug: Log the exact request being sent
            console.log(`🔍 Apollo API Request Body:`, JSON.stringify(requestBody, null, 2));

            const response = await axios.post(
                `${APOLLO_API_BASE_URL}/mixed_people/search`,
                requestBody,
                {
                    headers: {
                        'Cache-Control': 'no-cache',
                        'Content-Type': 'application/json',
                        'x-api-key': process.env.APOLLO_API_KEY
                    },
                    timeout: 30000
                }
            );

            const people = response.data.people || [];
            const pagination = response.data.pagination || {};

            // Debug: Log response details
            console.log(`📊 Apollo API Response - Page ${currentPage}:`, {
                peopleCount: people.length,
                pagination: pagination,
                totalEntries: pagination.total_entries,
                totalPages: pagination.total_pages,
                hasMore: !!people.length
            });

            console.log(`✅ Page ${currentPage}: ${people.length} leads fetched`);
            allLeads.push(...people);

            // Check if we've reached the end or our limit
            if (people.length < APOLLO_PER_PAGE || allLeads.length >= effectiveMaxRecords) {
                console.log(`🏁 Reached end: ${allLeads.length} total leads`);
                break;
            }

            // Check pagination metadata
            if (pagination.page >= pagination.total_pages) {
                console.log(`🏁 Reached last page: ${pagination.total_pages}`);
                break;
            }

            currentPage++;

            // Rate limiting: small delay between requests
            await new Promise(resolve => setTimeout(resolve, 500));

        } catch (error) {
            console.error(`❌ Apollo API error on page ${currentPage}:`, error.message);

            if (error.response?.status === 401) {
                throw new Error('Invalid Apollo API key');
            } else if (error.response?.status === 429) {
                throw new Error('Apollo API rate limit exceeded');
            } else if (error.response?.status === 402) {
                throw new Error('Apollo API credits exhausted');
            }

            // If we have some data, return what we got
            if (allLeads.length > 0) {
                console.log(`⚠️ Returning ${allLeads.length} leads fetched before error`);
                break;
            }

            throw error;
        }
    }

    console.log(`✅ Apollo API search complete: ${allLeads.length} leads`);
    return allLeads;
}

/**
 * Transform Apollo API response to match our internal data structure
 */
function transformApolloLead(apolloLead) {
    const organization = apolloLead.organization || {};
    const employment = apolloLead.employment_history?.[0] || {};

    return {
        name: apolloLead.name || apolloLead.first_name + ' ' + apolloLead.last_name || '',
        title: apolloLead.title || employment.title || '',
        organization_name: organization.name || '',
        organization_website_url: organization.website_url || organization.primary_domain || '',
        estimated_num_employees: organization.estimated_num_employees || '',
        email: apolloLead.email || '',
        email_verified: apolloLead.email_status === 'verified' ? 'Y' : 'N',
        linkedin_url: apolloLead.linkedin_url || '',
        phone_number: apolloLead.phone_numbers?.[0]?.sanitized_number || apolloLead.sanitized_phone || organization.phone || '',
        industry: organization.industry || '',
        country: apolloLead.country || apolloLead.state || 'Singapore',
        conversion_status: 'Pending'
    };
}

// Apollo URL generation endpoint
router.post('/generate-url', async (req, res) => {
    try {
        const { jobTitles, companySizes } = req.body;

        // Validation
        if (!jobTitles || !Array.isArray(jobTitles) || jobTitles.length === 0) {
            return res.status(400).json({
                error: 'Validation Error',
                message: 'Job titles are required and must be a non-empty array'
            });
        }

        if (!companySizes || !Array.isArray(companySizes) || companySizes.length === 0) {
            return res.status(400).json({
                error: 'Validation Error', 
                message: 'Company sizes are required and must be a non-empty array'
            });
        }

        // Generate Apollo URL (same logic as frontend)
        const baseUrl = "https://app.apollo.io/#/people?page=1";
        
        const defaultFilters = [
            "contactEmailStatusV2[]=verified",
            "existFields[]=person_title_normalized",
            "existFields[]=organization_domain", 
            "personLocations[]=Singapore",
            "personLocations[]=Singapore%2C%20Singapore",
            "sortAscending=true",
            "sortByField=sanitized_organization_name_unanalyzed"
        ];

        const titleFilters = jobTitles.map(title => 
            `personTitles[]=${encodeURIComponent(title)}`
        );

        const sizeFilters = companySizes.map(size => {
            const normalized = size.replace("-", ",");
            return `organizationNumEmployeesRanges[]=${encodeURIComponent(normalized)}`;
        });

        const allFilters = [...defaultFilters, ...titleFilters, ...sizeFilters];
        const apolloUrl = `${baseUrl}&${allFilters.join("&")}`;

        res.json({
            success: true,
            apolloUrl,
            filters: {
                jobTitles,
                companySizes,
                location: 'Singapore'
            }
        });

    } catch (error) {
        console.error('Apollo URL generation error:', error);
        res.status(500).json({
            error: 'Server Error',
            message: 'Failed to generate Apollo URL'
        });
    }
});


// Apollo lead scraping endpoint
router.post('/scrape-leads', async (req, res) => {
    try {
        const { apolloUrl, maxRecords = 500, jobTitles, companySizes } = req.body;

        // Determine if we should use Apollo API or fallback to Apify
        const useApolloAPI = process.env.APOLLO_API_KEY && process.env.USE_APOLLO_API !== 'false';

        if (useApolloAPI) {
            // **NEW: Direct Apollo API Integration**
            console.log('🎯 Using Apollo API direct integration');

            // Extract filters from URL or use provided parameters
            let personTitles = jobTitles || [];
            let companySizeRanges = companySizes || [];

            // If no direct params, try to extract from Apollo URL
            if ((!personTitles || personTitles.length === 0) && apolloUrl) {
                const urlParams = new URLSearchParams(apolloUrl.split('?')[1] || '');
                personTitles = urlParams.getAll('personTitles[]');
                const rawSizes = urlParams.getAll('organizationNumEmployeesRanges[]');
                companySizeRanges = rawSizes.map(s => s.replace(',', '-'));
            }

            if (personTitles.length === 0 || companySizeRanges.length === 0) {
                return res.status(400).json({
                    error: 'Validation Error',
                    message: 'Job titles and company sizes are required for Apollo API'
                });
            }

            // Call Apollo API
            const rawData = await scrapeWithApolloAPI(personTitles, companySizeRanges, maxRecords || 0);

            // Transform Apollo data to our format
            const transformedLeads = rawData.map(transformApolloLead);

            // Duplicate prevention
            const uniqueLeads = [];
            const seen = new Set();

            transformedLeads.forEach(lead => {
                const email = (lead.email || '').toLowerCase().trim();
                const linkedin = (lead.linkedin_url || '').toLowerCase().trim();
                const name = (lead.name || '').toLowerCase().trim();
                const company = (lead.organization_name || '').toLowerCase().trim();

                let identifier;
                if (email && email !== '') {
                    identifier = email;
                } else if (linkedin && linkedin !== '') {
                    identifier = linkedin;
                } else {
                    identifier = `${name}|${company}`;
                }

                if (!seen.has(identifier)) {
                    seen.add(identifier);
                    uniqueLeads.push(lead);
                }
            });

            const duplicatesRemoved = transformedLeads.length - uniqueLeads.length;

            // AI-powered phone lookup for leads without phone numbers
            console.log(`📞 Checking for missing phone numbers in ${uniqueLeads.length} leads...`);
            const leadsWithoutPhone = uniqueLeads.filter(lead => !lead.phone_number || lead.phone_number.trim() === '');

            if (leadsWithoutPhone.length > 0) {
                console.log(`🔍 Found ${leadsWithoutPhone.length} leads without phone numbers - starting AI lookup...`);
                const phoneLookup = new PhoneNumberLookup();
                let phonesFound = 0;

                for (const lead of leadsWithoutPhone) {
                    try {
                        const lookupResult = await phoneLookup.findPhoneNumber({
                            Name: lead.name,
                            'Company Name': lead.organization_name,
                            'LinkedIn URL': lead.linkedin_url,
                            Email: lead.email
                        });

                        if (lookupResult.found) {
                            lead.phone_number = lookupResult.phoneNumber;
                            phonesFound++;
                            console.log(`✅ Found phone for ${lead.name}: ${lookupResult.phoneNumber}`);
                        }
                    } catch (error) {
                        console.error(`❌ Phone lookup error for ${lead.name}:`, error.message);
                    }
                }

                console.log(`📞 AI phone lookup completed: ${phonesFound}/${leadsWithoutPhone.length} found`);
            }

            // Return response
            if (uniqueLeads.length > 250) {
                global.tempLeads = global.tempLeads || new Map();
                const sessionId = Date.now().toString() + Math.random().toString(36).substr(2, 9);
                global.tempLeads.set(sessionId, uniqueLeads);

                setTimeout(() => global.tempLeads.delete(sessionId), 30 * 60 * 1000);

                return res.json({
                    success: true,
                    count: uniqueLeads.length,
                    sessionId: sessionId,
                    metadata: {
                        source: 'apollo_api',
                        apolloUrl: apolloUrl || 'N/A',
                        scrapedAt: new Date().toISOString(),
                        maxRecords: maxRecords || 0,
                        rawScraped: rawData.length,
                        duplicatesRemoved: duplicatesRemoved,
                        finalCount: uniqueLeads.length,
                        jobTitles: personTitles,
                        companySizes: companySizeRanges
                    }
                });
            } else {
                return res.json({
                    success: true,
                    count: uniqueLeads.length,
                    leads: uniqueLeads,
                    metadata: {
                        source: 'apollo_api',
                        apolloUrl: apolloUrl || 'N/A',
                        scrapedAt: new Date().toISOString(),
                        maxRecords: maxRecords || 0,
                        rawScraped: rawData.length,
                        duplicatesRemoved: duplicatesRemoved,
                        finalCount: uniqueLeads.length,
                        jobTitles: personTitles,
                        companySizes: companySizeRanges
                    }
                });
            }
        }

        // **FALLBACK: Original Apify Integration**
        console.log('🔄 Using Apify fallback integration');

        // Validation
        if (!apolloUrl) {
            return res.status(400).json({
                error: 'Validation Error',
                message: 'Apollo URL is required'
            });
        }

        if (!apolloUrl.includes('apollo.io')) {
            return res.status(400).json({
                error: 'Validation Error',
                message: 'Invalid Apollo URL'
            });
        }

        // Check if Apify API token is configured
        if (!process.env.APIFY_API_TOKEN) {
            return res.status(500).json({
                error: 'Configuration Error',
                message: 'Apify API token not configured'
            });
        }

        // Handle unlimited vs limited records
        let recordLimit;

        if (maxRecords === 0) {
            recordLimit = 0; // Truly unlimited - let Apify scrape all available
        } else {
            // Optional safety limit (can be overridden with environment variable)
            const safetyLimit = parseInt(process.env.MAX_LEADS_PER_REQUEST) || 10000;
            recordLimit = Math.min(parseInt(maxRecords), safetyLimit);
        }

        console.log(`🔍 Starting Apollo scrape for ${recordLimit} records...`);

        console.log(`⏱️ No timeout limit - scraper will run until completion for ${recordLimit} records`);

        let apifyResponse;
        let retryCount = 0;
        const maxRetries = 2;

        while (retryCount <= maxRetries) {
            try {
                console.log(`🎯 Attempt ${retryCount + 1}/${maxRetries + 1} - Calling Apify scraper...`);
                
                apifyResponse = await axios.post(
                    'https://api.apify.com/v2/acts/code_crafter~apollo-io-scraper/run-sync-get-dataset-items',
                    {
                        cleanOutput: true,
                        totalRecords: recordLimit,
                        url: apolloUrl
                    },
                    {
                        headers: {
                            'Accept': 'application/json',
                            'Authorization': `Bearer ${process.env.APIFY_API_TOKEN}`,
                            'Connection': 'keep-alive',
                            'User-Agent': 'LGA-Lead-Generator/1.0'
                        },
                        timeout: 0, // No timeout - let it run until completion
                        maxRedirects: 5,
                        validateStatus: function (status) {
                            return status < 500; // Resolve only if status is less than 500
                        }
                    }
                ).catch(error => {
                    // Remove sensitive data from error logs
                    if (error.config && error.config.headers && error.config.headers.Authorization) {
                        error.config.headers.Authorization = 'Bearer [REDACTED]';
                    }
                    throw error;
                });
                
                console.log('✅ Apify scraper completed successfully');
                console.log('📊 Response data extracted');
                break; // Success, exit retry loop
                
            } catch (error) {
                retryCount++;
                console.error(`❌ Attempt ${retryCount}/${maxRetries + 1} failed:`, error.code || error.message);
                
                if (retryCount > maxRetries) {
                    // All retries exhausted - provide specific error messages
                    if (error.code === 'ECONNABORTED') {
                        throw new Error(`Apollo scraping was interrupted. Please try again with fewer records (current: ${recordLimit}) or check your network connection.`);
                    } else if (error.code === 'ECONNRESET' || error.message.includes('socket hang up') || error.message.includes('ECONNRESET')) {
                        throw new Error(`Network connection lost during scraping. This may be due to high server load. Please try again in a few minutes or reduce the record count (current: ${recordLimit}).`);
                    } else if (error.code === 'ETIMEDOUT' || error.message.includes('ETIMEDOUT')) {
                        throw new Error(`Network timeout during scraping. Please check your internet connection and try again.`);
                    } else if (error.response && error.response.status === 429) {
                        throw new Error(`Apify API rate limit exceeded. Please wait a few minutes before trying again.`);
                    } else if (error.response && error.response.status >= 500) {
                        throw new Error(`Apify server error (${error.response.status}). Please try again in a few minutes.`);
                    } else {
                        throw new Error(`Apify scraper failed after ${maxRetries + 1} attempts: ${error.message}`);
                    }
                } else {
                    // Wait before retry with longer delays for network issues
                    let waitTime;
                    if (error.code === 'ECONNRESET' || error.message.includes('socket hang up')) {
                        // Longer wait for connection issues
                        waitTime = Math.pow(2, retryCount - 1) * 10000; // 10s, 20s delays
                        console.log(`🌐 Network issue detected - waiting ${waitTime/1000}s before retry...`);
                    } else {
                        // Standard exponential backoff
                        waitTime = Math.pow(2, retryCount - 1) * 5000; // 5s, 10s delays
                        console.log(`⏳ Waiting ${waitTime/1000}s before retry...`);
                    }
                    await new Promise(resolve => setTimeout(resolve, waitTime));
                }
            }
        }

        // Validate and extract data from Apify response
        let rawData = [];
        
        if (apifyResponse.data) {
            if (Array.isArray(apifyResponse.data)) {
                rawData = apifyResponse.data;
            } else if (typeof apifyResponse.data === 'object') {
                // Check if it's an error response
                if (apifyResponse.data.error) {
                    console.error('❌ Apify API error:', apifyResponse.data);
                    throw new Error(`Apify API error: ${apifyResponse.data.error}`);
                }
                // Try to find data in nested structure
                rawData = apifyResponse.data.items || apifyResponse.data.data || apifyResponse.data.results || [];
            }
        }
        
        // Ensure rawData is an array
        if (!Array.isArray(rawData)) {
            console.error('❌ Invalid Apify response format:', typeof rawData, rawData);
            throw new Error(`Invalid response format from Apify: expected array, got ${typeof rawData}`);
        }
        
        console.log(`✅ Successfully scraped ${rawData.length} leads`);

        // Extract total count from Apify response metadata if available
        let totalAvailable = rawData.length;
        let limitReached = false;
        
        if (apifyResponse.headers && apifyResponse.headers['x-apify-total-results']) {
            totalAvailable = parseInt(apifyResponse.headers['x-apify-total-results']);
            limitReached = totalAvailable > rawData.length;
        }

        // Duplicate prevention: Remove duplicates based on email and LinkedIn URL
        const uniqueLeads = [];
        const seen = new Set();
        
        rawData.forEach(lead => {
            // Create unique identifier: email + linkedin_url (fallback to name + company)
            const email = (lead.email || '').toLowerCase().trim();
            const linkedin = (lead.linkedin_url || '').toLowerCase().trim();
            const name = (lead.name || '').toLowerCase().trim();
            const company = (lead.organization_name || '').toLowerCase().trim();
            
            let identifier;
            if (email && email !== '') {
                identifier = email; // Email is most unique
            } else if (linkedin && linkedin !== '') {
                identifier = linkedin; // LinkedIn URL second most unique
            } else {
                identifier = `${name}|${company}`; // Fallback to name+company
            }
            
            if (!seen.has(identifier)) {
                seen.add(identifier);
                uniqueLeads.push(lead);
            } else {
                console.log(`🔄 Removed duplicate: ${lead.name} (${identifier})`);
            }
        });

        const duplicatesRemoved = rawData.length - uniqueLeads.length;
        if (duplicatesRemoved > 0) {
            console.log(`🧹 Removed ${duplicatesRemoved} duplicate records`);
        }

        // Transform leads to match n8n workflow structure
        const transformedLeads = uniqueLeads.map(lead => ({
            name: lead.name || '',
            title: lead.title || '',
            organization_name: lead.organization_name || '',
            organization_website_url: lead.organization_website_url || '',
            estimated_num_employees: lead.estimated_num_employees || '',
            email: lead.email || '',
            email_verified: lead.email ? 'Y' : 'N',
            linkedin_url: lead.linkedin_url || '',
            phone_number: lead.organization_phone || '',
            industry: lead.industry || '',
            country: lead.country || 'Singapore',
            conversion_status: 'Pending'
        }));

        // AI-powered phone lookup for leads without phone numbers
        console.log(`📞 Checking for missing phone numbers in ${transformedLeads.length} leads...`);
        const leadsWithoutPhone = transformedLeads.filter(lead => !lead.phone_number || (typeof lead.phone_number === 'string' && lead.phone_number.trim() === ''));

        if (leadsWithoutPhone.length > 0) {
            console.log(`🔍 Found ${leadsWithoutPhone.length} leads without phone numbers - starting AI lookup...`);

            const phoneLookup = new PhoneNumberLookup();
            let phonesFound = 0;

            for (const lead of leadsWithoutPhone) {
                try {
                    const lookupResult = await phoneLookup.findPhoneNumber({
                        Name: lead.name,
                        'Company Name': lead.organization_name,
                        'LinkedIn URL': lead.linkedin_url,
                        Email: lead.email
                    });

                    if (lookupResult.found) {
                        lead.phone_number = lookupResult.phoneNumber;
                        phonesFound++;
                        console.log(`✅ Found phone for ${lead.name}: ${lookupResult.phoneNumber}`);
                    } else {
                        console.log(`❌ No phone found for ${lead.name}: ${lookupResult.reason}`);
                    }
                } catch (error) {
                    console.error(`❌ Phone lookup error for ${lead.name}:`, error.message);
                }
            }

            console.log(`📞 AI phone lookup completed: ${phonesFound}/${leadsWithoutPhone.length} found`);
        } else {
            console.log(`✅ All leads already have phone numbers`);
        }

        // For large datasets, don't return all leads in the response to avoid memory issues
        if (transformedLeads.length > 250) {
            // Store leads temporarily (in a real app, you'd use Redis or database)
            global.tempLeads = global.tempLeads || new Map();
            const sessionId = Date.now().toString() + Math.random().toString(36).substr(2, 9);
            global.tempLeads.set(sessionId, transformedLeads);
            
            // Clean up old sessions after 30 minutes
            setTimeout(() => {
                global.tempLeads.delete(sessionId);
            }, 30 * 60 * 1000);

            res.json({
                success: true,
                count: transformedLeads.length,
                sessionId: sessionId, // Use this to retrieve leads in chunks
                metadata: {
                    apolloUrl,
                    scrapedAt: new Date().toISOString(),
                    maxRecords: recordLimit,
                    totalAvailable: totalAvailable,
                    rawScraped: rawData.length,
                    duplicatesRemoved: duplicatesRemoved,
                    finalCount: transformedLeads.length,
                    limitReached: limitReached,
                    deduplicationStats: {
                        input: rawData.length,
                        duplicates: duplicatesRemoved,
                        unique: transformedLeads.length,
                        deduplicationRate: rawData.length > 0 ? ((duplicatesRemoved / rawData.length) * 100).toFixed(1) + '%' : '0%'
                    }
                }
            });
        } else {
            // For smaller datasets, return leads directly
            res.json({
                success: true,
                count: transformedLeads.length,
                leads: transformedLeads,
                metadata: {
                    apolloUrl,
                    scrapedAt: new Date().toISOString(),
                    maxRecords: recordLimit,
                    totalAvailable: totalAvailable,
                    rawScraped: rawData.length,
                    duplicatesRemoved: duplicatesRemoved,
                    finalCount: transformedLeads.length,
                    limitReached: limitReached,
                    deduplicationStats: {
                        input: rawData.length,
                        duplicates: duplicatesRemoved,
                        unique: transformedLeads.length,
                        deduplicationRate: rawData.length > 0 ? ((duplicatesRemoved / rawData.length) * 100).toFixed(1) + '%' : '0%'
                    }
                }
            });
        }

    } catch (error) {
        console.error('Apollo scraping error:', error);

        // Handle specific error types
        if (error.code === 'ECONNABORTED' || error.message.includes('timeout')) {
            return res.status(408).json({
                error: 'Timeout Error',
                message: 'Apollo scraping took too long. Try reducing the number of records or try again later.'
            });
        }

        if (error.response?.status === 401) {
            return res.status(401).json({
                error: 'Authentication Error', 
                message: 'Invalid Apify API token'
            });
        }

        if (error.response?.status === 429) {
            return res.status(429).json({
                error: 'Rate Limit Error',
                message: 'Apify API rate limit exceeded. Please try again later.'
            });
        }

        res.status(500).json({
            error: 'Scraping Error',
            message: 'Failed to scrape leads from Apollo',
            details: process.env.NODE_ENV === 'development' ? error.message : undefined
        });
    }
});

// Get leads in chunks for large datasets
router.post('/get-leads-chunk', async (req, res) => {
    try {
        const { sessionId, offset = 0, limit = 100 } = req.body;
        
        if (!sessionId) {
            return res.status(400).json({
                error: 'Validation Error',
                message: 'Session ID is required'
            });
        }

        global.tempLeads = global.tempLeads || new Map();
        const allLeads = global.tempLeads.get(sessionId);
        
        if (!allLeads) {
            return res.status(404).json({
                error: 'Session Not Found',
                message: 'Session expired or invalid'
            });
        }

        const chunk = allLeads.slice(offset, offset + limit);
        
        res.json({
            success: true,
            leads: chunk,
            hasMore: offset + limit < allLeads.length,
            total: allLeads.length,
            offset: offset,
            limit: limit
        });

    } catch (error) {
        console.error('Get leads chunk error:', error);
        res.status(500).json({
            error: 'Server Error',
            message: 'Failed to retrieve leads chunk'
        });
    }
});

// Start Apollo scraping job asynchronously
router.post('/start-scrape-job', async (req, res) => {
    try {
        const { apolloUrl, maxRecords = 500 } = req.body;

        // Validation
        if (!apolloUrl) {
            return res.status(400).json({
                error: 'Validation Error',
                message: 'Apollo URL is required'
            });
        }

        if (!apolloUrl.includes('apollo.io')) {
            return res.status(400).json({
                error: 'Validation Error',
                message: 'Invalid Apollo URL'
            });
        }

        // Check if Apify API token is configured
        if (!process.env.APIFY_API_TOKEN) {
            return res.status(500).json({
                error: 'Configuration Error',
                message: 'Apify API token not configured'
            });
        }

        // Generate unique Apollo job ID
        const apolloJobId = Date.now().toString() + Math.random().toString(36).substr(2, 9);
        
        // Initialize Apollo job status
        const apolloJobStatus = {
            id: apolloJobId,
            status: 'started',
            startTime: new Date().toISOString(),
            params: { apolloUrl, maxRecords },
            result: null,
            error: null,
            completedAt: null
        };
        
        // Store Apollo job status
        global.apolloJobs.set(apolloJobId, apolloJobStatus);
        
        // Clean up old Apollo jobs after 2 hours
        setTimeout(() => {
            global.apolloJobs.delete(apolloJobId);
        }, 2 * 60 * 60 * 1000);

        console.log(`🚀 Starting Apollo job ${apolloJobId} for ${maxRecords} records...`);
        
        // Return Apollo job ID immediately
        res.json({
            success: true,
            jobId: apolloJobId,
            message: 'Apollo scraping started in background'
        });
        
        // Run Apollo scraping in background
        processApolloJob(apolloJobId).catch(error => {
            console.error(`Apollo job ${apolloJobId} failed:`, error);
            const job = global.apolloJobs.get(apolloJobId);
            if (job) {
                job.status = 'failed';
                job.error = error.message;
                job.completedAt = new Date().toISOString();
            }
        });
        
    } catch (error) {
        console.error('Apollo job creation error:', error);
        res.status(500).json({
            error: 'Job Creation Error',
            message: 'Failed to start Apollo scraping job'
        });
    }
});

// Background Apollo job processor
async function processApolloJob(apolloJobId) {
    const job = global.apolloJobs.get(apolloJobId);
    if (!job) return;

    try {
        const { apolloUrl, maxRecords, jobTitles, companySizes } = job.params;

        job.status = 'scraping';

        // Determine if we should use Apollo API or fallback to Apify
        const useApolloAPI = process.env.APOLLO_API_KEY && process.env.USE_APOLLO_API !== 'false';

        if (useApolloAPI) {
            // **NEW: Direct Apollo API Integration for background jobs**
            console.log(`🎯 Apollo job ${apolloJobId}: Using Apollo API direct integration`);

            // Extract filters from URL or use provided parameters
            let personTitles = jobTitles || [];
            let companySizeRanges = companySizes || [];

            // If no direct params, try to extract from Apollo URL
            if ((!personTitles || personTitles.length === 0) && apolloUrl) {
                const urlParams = new URLSearchParams(apolloUrl.split('?')[1] || '');
                personTitles = urlParams.getAll('personTitles[]');
                const rawSizes = urlParams.getAll('organizationNumEmployeesRanges[]');
                companySizeRanges = rawSizes.map(s => s.replace(',', '-'));
            }

            if (personTitles.length === 0 || companySizeRanges.length === 0) {
                throw new Error('Job titles and company sizes are required for Apollo API');
            }

            // Call Apollo API
            const rawData = await scrapeWithApolloAPI(personTitles, companySizeRanges, maxRecords || 0);

            // Transform Apollo data to our format
            const transformedLeads = rawData.map(transformApolloLead);

            // Duplicate prevention
            const uniqueLeads = [];
            const seen = new Set();

            transformedLeads.forEach(lead => {
                const email = (lead.email || '').toLowerCase().trim();
                const linkedin = (lead.linkedin_url || '').toLowerCase().trim();
                const name = (lead.name || '').toLowerCase().trim();
                const company = (lead.organization_name || '').toLowerCase().trim();

                let identifier;
                if (email && email !== '') {
                    identifier = email;
                } else if (linkedin && linkedin !== '') {
                    identifier = linkedin;
                } else {
                    identifier = `${name}|${company}`;
                }

                if (!seen.has(identifier)) {
                    seen.add(identifier);
                    uniqueLeads.push(lead);
                }
            });

            const duplicatesRemoved = transformedLeads.length - uniqueLeads.length;

            // AI-powered phone lookup
            console.log(`📞 Apollo job ${apolloJobId}: Checking for missing phone numbers in ${uniqueLeads.length} leads...`);
            const leadsWithoutPhone = uniqueLeads.filter(lead => !lead.phone_number || lead.phone_number.trim() === '');

            if (leadsWithoutPhone.length > 0) {
                console.log(`🔍 Apollo job ${apolloJobId}: Found ${leadsWithoutPhone.length} leads without phone numbers - starting AI lookup...`);
                const phoneLookup = new PhoneNumberLookup();
                let phonesFound = 0;

                for (const lead of leadsWithoutPhone) {
                    try {
                        const lookupResult = await phoneLookup.findPhoneNumber({
                            Name: lead.name,
                            'Company Name': lead.organization_name,
                            'LinkedIn URL': lead.linkedin_url,
                            Email: lead.email
                        });

                        if (lookupResult.found) {
                            lead.phone_number = lookupResult.phoneNumber;
                            phonesFound++;
                            console.log(`✅ Apollo job ${apolloJobId}: Found phone for ${lead.name}: ${lookupResult.phoneNumber}`);
                        }
                    } catch (error) {
                        console.error(`❌ Apollo job ${apolloJobId}: Phone lookup error for ${lead.name}:`, error.message);
                    }
                }

                console.log(`📞 Apollo job ${apolloJobId}: AI phone lookup completed: ${phonesFound}/${leadsWithoutPhone.length} found`);
            }

            // Job completed successfully
            job.status = 'completed';
            job.result = {
                success: true,
                count: uniqueLeads.length,
                leads: uniqueLeads,
                metadata: {
                    source: 'apollo_api',
                    apolloUrl: apolloUrl || 'N/A',
                    scrapedAt: new Date().toISOString(),
                    maxRecords: maxRecords || 0,
                    rawScraped: rawData.length,
                    duplicatesRemoved: duplicatesRemoved,
                    finalCount: uniqueLeads.length,
                    jobTitles: personTitles,
                    companySizes: companySizeRanges
                }
            };
            job.completedAt = new Date().toISOString();

            console.log(`✅ Apollo job ${apolloJobId} completed successfully with ${uniqueLeads.length} leads`);
            return;
        }

        // **FALLBACK: Original Apify Integration**
        console.log(`🔄 Apollo job ${apolloJobId}: Using Apify fallback integration`);

        // Handle unlimited vs limited records
        let recordLimit;

        if (maxRecords === 0) {
            recordLimit = 0; // Truly unlimited - let Apify scrape all available
        } else {
            // Optional safety limit (can be overridden with environment variable)
            const safetyLimit = parseInt(process.env.MAX_LEADS_PER_REQUEST) || 10000;
            recordLimit = Math.min(parseInt(maxRecords), safetyLimit);
        }

        const recordText = recordLimit === 0 ? 'unlimited records' : `${recordLimit} records`;
        console.log(`🔍 Apollo job ${apolloJobId}: Starting Apify scraper for ${recordText}...`);

        let apifyResponse;
        let retryCount = 0;
        const maxRetries = 2;

        // Start Apify run asynchronously (no 5-minute timeout limit)
        let apifyRunId;
        
        while (retryCount <= maxRetries) {
            try {
                console.log(`🎯 Apollo job ${apolloJobId}: Attempt ${retryCount + 1}/${maxRetries + 1} - Starting Apify run...`);
                
                // Prepare Apify input
                const apifyInput = {
                    cleanOutput: true,
                    url: apolloUrl
                };
                
                // Only set totalRecords if not unlimited
                if (recordLimit > 0) {
                    apifyInput.totalRecords = recordLimit;
                }
                
                console.log(`🔍 Apollo job ${apolloJobId}: Apify input:`, { 
                    ...apifyInput, 
                    recordLimit: recordLimit === 0 ? 'unlimited' : recordLimit 
                });
                
                const runResponse = await axios.post(
                    'https://api.apify.com/v2/acts/code_crafter~apollo-io-scraper/runs',
                    apifyInput,
                    {
                        headers: {
                            'Accept': 'application/json',
                            'Authorization': `Bearer ${process.env.APIFY_API_TOKEN}`,
                            'Content-Type': 'application/json',
                            'User-Agent': 'LGA-Lead-Generator/1.0'
                        },
                        timeout: 30000, // 30 second timeout for starting run
                        validateStatus: function (status) {
                            return status < 500;
                        }
                    }
                ).catch(error => {
                    if (error.config && error.config.headers && error.config.headers.Authorization) {
                        error.config.headers.Authorization = 'Bearer [REDACTED]';
                    }
                    throw error;
                });
                
                apifyRunId = runResponse.data.data.id;
                console.log(`✅ Apollo job ${apolloJobId}: Apify run started: ${apifyRunId}`);
                break; // Success, exit retry loop
                
            } catch (error) {
                retryCount++;
                console.error(`❌ Apollo job ${apolloJobId}: Attempt ${retryCount}/${maxRetries + 1} failed:`, error.code || error.message);
                
                if (retryCount > maxRetries) {
                    throw new Error(`Failed to start Apify run after ${maxRetries + 1} attempts: ${error.message}`);
                } else {
                    const waitTime = Math.pow(2, retryCount - 1) * 10000; // 10s, 20s delays
                    console.log(`⏳ Apollo job ${apolloJobId}: Waiting ${waitTime/1000}s before retry...`);
                    await new Promise(resolve => setTimeout(resolve, waitTime));
                }
            }
        }
        
        // Poll Apify run status until completion
        console.log(`🔄 Apollo job ${apolloJobId}: Polling Apify run ${apifyRunId} status...`);
        apifyResponse = await pollApifyRun(apolloJobId, apifyRunId);

        // Process and validate Apify response
        let rawData = [];
        
        console.log(`🔍 Apollo job ${apolloJobId}: Analyzing Apify response...`);
        console.log(`📊 Apollo job ${apolloJobId}: Processing response data`);
        
        if (!apifyResponse.data) {
            throw new Error('Apify API returned empty response');
        }
        
        if (Array.isArray(apifyResponse.data)) {
            rawData = apifyResponse.data;
            console.log(`✅ Apollo job ${apolloJobId}: Array data extracted`);
        } else if (typeof apifyResponse.data === 'object') {
            // Log the object structure for debugging
            const keys = Object.keys(apifyResponse.data);
            console.log(`📋 Apollo job ${apolloJobId}: Response object keys: ${keys.join(', ')}`);
            
            // Check for error in response
            if (apifyResponse.data.error) {
                const errorDetails = typeof apifyResponse.data.error === 'object' 
                    ? JSON.stringify(apifyResponse.data.error, null, 2)
                    : apifyResponse.data.error;
                console.error(`❌ Apollo job ${apolloJobId}: Apify API error details:`, errorDetails);
                throw new Error(`Apify API error: ${errorDetails}`);
            }
            
            // Try to extract data from nested structure
            if (apifyResponse.data.items) {
                rawData = apifyResponse.data.items;
                console.log(`✅ Apollo job ${apolloJobId}: Items field processed`);
            } else if (apifyResponse.data.data) {
                rawData = apifyResponse.data.data;
                console.log(`✅ Apollo job ${apolloJobId}: Data field processed`);
            } else if (apifyResponse.data.results) {
                rawData = apifyResponse.data.results;
                console.log(`✅ Apollo job ${apolloJobId}: Results field processed`);
            } else {
                // Log full object for debugging
                const responseStr = JSON.stringify(apifyResponse.data, null, 2);
                console.error(`❌ Apollo job ${apolloJobId}: Unexpected response structure:`, responseStr.substring(0, 500) + '...');
                throw new Error(`Apify API returned unexpected response structure. Keys: ${keys.join(', ')}`);
            }
        } else {
            throw new Error(`Apify API returned unexpected data type: ${typeof apifyResponse.data}`);
        }
        
        if (!Array.isArray(rawData)) {
            console.error(`❌ Apollo job ${apolloJobId}: rawData is not array: ${typeof rawData}`);
            throw new Error(`Invalid response format from Apify: expected array, got ${typeof rawData}`);
        }
        
        if (rawData.length === 0) {
            console.log(`⚠️ Apollo job ${apolloJobId}: Apify returned empty results array`);
        } else {
            console.log(`✅ Apollo job ${apolloJobId}: Successfully validated ${rawData.length} leads from Apify`);
        }

        // Duplicate prevention and transformation (same logic as before)
        const uniqueLeads = [];
        const seen = new Set();
        
        rawData.forEach(lead => {
            const email = (lead.email || '').toLowerCase().trim();
            const linkedin = (lead.linkedin_url || '').toLowerCase().trim();
            const name = (lead.name || '').toLowerCase().trim();
            const company = (lead.organization_name || '').toLowerCase().trim();
            
            let identifier;
            if (email && email !== '') {
                identifier = email;
            } else if (linkedin && linkedin !== '') {
                identifier = linkedin;
            } else {
                identifier = `${name}|${company}`;
            }
            
            if (!seen.has(identifier)) {
                seen.add(identifier);
                uniqueLeads.push(lead);
            }
        });

        const duplicatesRemoved = rawData.length - uniqueLeads.length;

        // Transform leads
        const transformedLeads = uniqueLeads.map(lead => ({
            name: lead.name || '',
            title: lead.title || '',
            organization_name: lead.organization_name || '',
            organization_website_url: lead.organization_website_url || '',
            estimated_num_employees: lead.estimated_num_employees || '',
            email: lead.email || '',
            email_verified: lead.email ? 'Y' : 'N',
            linkedin_url: lead.linkedin_url || '',
            phone_number: lead.organization_phone || '',
            industry: lead.industry || '',
            country: lead.country || 'Singapore',
            conversion_status: 'Pending'
        }));

        // AI-powered phone lookup for leads without phone numbers
        console.log(`📞 Apollo job ${apolloJobId}: Checking for missing phone numbers in ${transformedLeads.length} leads...`);
        const leadsWithoutPhone = transformedLeads.filter(lead => !lead.phone_number || (typeof lead.phone_number === 'string' && lead.phone_number.trim() === ''));

        if (leadsWithoutPhone.length > 0) {
            console.log(`🔍 Apollo job ${apolloJobId}: Found ${leadsWithoutPhone.length} leads without phone numbers - starting AI lookup...`);

            const phoneLookup = new PhoneNumberLookup();
            let phonesFound = 0;

            for (const lead of leadsWithoutPhone) {
                try {
                    const lookupResult = await phoneLookup.findPhoneNumber({
                        Name: lead.name,
                        'Company Name': lead.organization_name,
                        'LinkedIn URL': lead.linkedin_url,
                        Email: lead.email
                    });

                    if (lookupResult.found) {
                        lead.phone_number = lookupResult.phoneNumber;
                        phonesFound++;
                        console.log(`✅ Apollo job ${apolloJobId}: Found phone for ${lead.name}: ${lookupResult.phoneNumber}`);
                    } else {
                        console.log(`❌ Apollo job ${apolloJobId}: No phone found for ${lead.name}: ${lookupResult.reason}`);
                    }
                } catch (error) {
                    console.error(`❌ Apollo job ${apolloJobId}: Phone lookup error for ${lead.name}:`, error.message);
                }
            }

            console.log(`📞 Apollo job ${apolloJobId}: AI phone lookup completed: ${phonesFound}/${leadsWithoutPhone.length} found`);
        } else {
            console.log(`✅ Apollo job ${apolloJobId}: All leads already have phone numbers`);
        }

        // Job completed successfully
        job.status = 'completed';
        job.result = {
            success: true,
            count: transformedLeads.length,
            leads: transformedLeads,
            metadata: {
                apolloUrl,
                scrapedAt: new Date().toISOString(),
                maxRecords: recordLimit,
                rawScraped: rawData.length,
                duplicatesRemoved: duplicatesRemoved,
                finalCount: transformedLeads.length
            }
        };
        job.completedAt = new Date().toISOString();
        
        console.log(`✅ Apollo job ${apolloJobId} completed successfully with ${transformedLeads.length} leads`);
        
    } catch (error) {
        console.error(`❌ Apollo job ${apolloJobId} failed:`, error);
        job.status = 'failed';
        job.error = error.message;
        job.completedAt = new Date().toISOString();
    }
}

// Poll Apify run until completion
async function pollApifyRun(apolloJobId, apifyRunId) {
    let pollCount = 0;
    // No timeout limit - scraper will run until completion
    
    while (true) {
        try {
            pollCount++;
            
            // Check Apify run status
            const statusResponse = await axios.get(
                `https://api.apify.com/v2/acts/code_crafter~apollo-io-scraper/runs/${apifyRunId}`,
                {
                    headers: {
                        'Accept': 'application/json',
                        'Authorization': `Bearer ${process.env.APIFY_API_TOKEN}`,
                        'User-Agent': 'LGA-Lead-Generator/1.0'
                    },
                    timeout: 10000
                }
            );
            
            const runData = statusResponse.data.data;
            const status = runData.status;
            
            console.log(`🔄 Apollo job ${apolloJobId}: Apify run ${apifyRunId} status: ${status} (poll ${pollCount})`);
            
            if (status === 'SUCCEEDED') {
                // Get dataset ID from run data
                const datasetId = runData.defaultDatasetId;
                console.log(`🎯 Apollo job ${apolloJobId}: Apify run completed, retrieving dataset: ${datasetId}`);
                
                if (!datasetId) {
                    throw new Error('No dataset ID found in completed Apify run');
                }
                
                // Try multiple methods to get dataset items
                let datasetResponse;
                let datasetData = [];
                
                try {
                    // Method 1: Direct dataset access
                    console.log(`📡 Apollo job ${apolloJobId}: Trying direct dataset access...`);
                    datasetResponse = await axios.get(
                        `https://api.apify.com/v2/datasets/${datasetId}/items`,
                        {
                            headers: {
                                'Accept': 'application/json',
                                'Authorization': `Bearer ${process.env.APIFY_API_TOKEN}`,
                                'User-Agent': 'LGA-Lead-Generator/1.0'
                            },
                            timeout: 60000
                        }
                    );
                    datasetData = datasetResponse.data;
                    console.log(`✅ Apollo job ${apolloJobId}: Dataset retrieved via direct access`);
                    
                } catch (datasetError) {
                    console.log(`⚠️ Apollo job ${apolloJobId}: Direct dataset access failed: ${datasetError.message}`);
                    
                    try {
                        // Method 2: Via run endpoint
                        console.log(`📡 Apollo job ${apolloJobId}: Trying run-based dataset access...`);
                        datasetResponse = await axios.get(
                            `https://api.apify.com/v2/acts/code_crafter~apollo-io-scraper/runs/${apifyRunId}/dataset/items`,
                            {
                                headers: {
                                    'Accept': 'application/json',
                                    'Authorization': `Bearer ${process.env.APIFY_API_TOKEN}`,
                                    'User-Agent': 'LGA-Lead-Generator/1.0'
                                },
                                timeout: 60000
                            }
                        );
                        datasetData = datasetResponse.data;
                        console.log(`✅ Apollo job ${apolloJobId}: Dataset retrieved via run endpoint`);
                        
                    } catch (runError) {
                        console.log(`⚠️ Apollo job ${apolloJobId}: Run-based dataset access failed: ${runError.message}`);
                        
                        try {
                            // Method 3: Alternative dataset format
                            console.log(`📡 Apollo job ${apolloJobId}: Trying alternative dataset format...`);
                            datasetResponse = await axios.get(
                                `https://api.apify.com/v2/datasets/${datasetId}/items?format=json`,
                                {
                                    headers: {
                                        'Accept': 'application/json',
                                        'Authorization': `Bearer ${process.env.APIFY_API_TOKEN}`,
                                        'User-Agent': 'LGA-Lead-Generator/1.0'
                                    },
                                    timeout: 60000
                                }
                            );
                            datasetData = datasetResponse.data;
                            console.log(`✅ Apollo job ${apolloJobId}: Dataset retrieved via alternative format`);
                            
                        } catch (altError) {
                            console.error(`❌ Apollo job ${apolloJobId}: All dataset retrieval methods failed`);
                            console.error(`❌ Direct: ${datasetError.message}`);
                            console.error(`❌ Run-based: ${runError.message}`);  
                            console.error(`❌ Alternative: ${altError.message}`);
                            throw new Error(`Failed to retrieve dataset after trying all methods. Dataset ID: ${datasetId}`);
                        }
                    }
                }
                
                return { data: datasetData };
                
            } else if (status === 'FAILED' || status === 'ABORTED' || status === 'TIMED-OUT') {
                const failureReason = runData.statusMessage || 'Unknown failure';
                throw new Error(`Apify run ${status.toLowerCase()}: ${failureReason}`);
            }
            
            // Continue polling for RUNNING, READY, etc.
            await new Promise(resolve => setTimeout(resolve, 5000));
            
        } catch (error) {
            console.error(`❌ Apollo job ${apolloJobId}: Apify polling error:`, error.message);
            
            // For API errors, retry a few times
            if (pollCount < 5) {
                console.log(`⚠️ Apollo job ${apolloJobId}: Retrying Apify status check in 10 seconds...`);
                await new Promise(resolve => setTimeout(resolve, 10000));
                continue;
            } else {
                throw new Error(`Apify run polling failed: ${error.message}`);
            }
        }
    }
    
    // This should never be reached since we removed the timeout limit
}

// Get Apollo job status
router.get('/job-status/:jobId', async (req, res) => {
    try {
        const { jobId } = req.params;
        
        if (!jobId) {
            return res.status(400).json({
                error: 'Validation Error',
                message: 'Job ID is required'
            });
        }

        global.apolloJobs = global.apolloJobs || new Map();
        const job = global.apolloJobs.get(jobId);
        
        if (!job) {
            return res.status(404).json({
                error: 'Job Not Found',
                message: 'Apollo job not found or expired'
            });
        }

        res.json({
            success: true,
            jobId: jobId,
            status: job.status,
            startTime: job.startTime,
            completedAt: job.completedAt,
            error: job.error,
            isComplete: ['completed', 'failed'].includes(job.status)
        });

    } catch (error) {
        console.error('Apollo job status check error:', error);
        res.status(500).json({
            error: 'Server Error',
            message: 'Failed to check Apollo job status'
        });
    }
});

// Get Apollo job result
router.get('/job-result/:jobId', async (req, res) => {
    try {
        const { jobId } = req.params;
        
        if (!jobId) {
            return res.status(400).json({
                error: 'Validation Error',
                message: 'Job ID is required'
            });
        }

        global.apolloJobs = global.apolloJobs || new Map();
        const job = global.apolloJobs.get(jobId);
        
        if (!job) {
            return res.status(404).json({
                error: 'Job Not Found',
                message: 'Apollo job not found or expired'
            });
        }

        if (job.status !== 'completed') {
            return res.status(400).json({
                error: 'Job Not Complete',
                message: `Apollo job is still ${job.status}. Check job-status first.`
            });
        }

        res.json({
            success: true,
            jobId: jobId,
            ...job.result
        });

    } catch (error) {
        console.error('Apollo job result retrieval error:', error);
        res.status(500).json({
            error: 'Server Error',
            message: 'Failed to retrieve Apollo job result'
        });
    }
});

// Test endpoint for Apollo integration
router.get('/test', async (req, res) => {
    const checks = {
        apolloApiKey: !!process.env.APOLLO_API_KEY,
        apolloApiConnection: false,
        apifyToken: !!process.env.APIFY_API_TOKEN,
        apifyConnection: false,
        activeIntegration: 'none'
    };

    // Test Apollo API connection if key is available
    if (checks.apolloApiKey) {
        try {
            const testResponse = await axios.post(
                `${APOLLO_API_BASE_URL}/mixed_people/search`,
                {
                    person_titles: ['CEO'],
                    person_locations: ['Singapore'],
                    per_page: 1,
                    page: 1
                },
                {
                    headers: {
                        'Cache-Control': 'no-cache',
                        'Content-Type': 'application/json',
                        'x-api-key': process.env.APOLLO_API_KEY
                    },
                    timeout: 10000
                }
            );
            checks.apolloApiConnection = testResponse.status === 200;
            checks.activeIntegration = 'apollo_api';
        } catch (error) {
            checks.apolloApiConnection = false;
            checks.apolloApiError = error.response?.status || error.message;
        }
    }

    // Test Apify connection if token is available
    if (checks.apifyToken) {
        try {
            const testResponse = await axios.get('https://api.apify.com/v2/actor-tasks', {
                headers: {
                    'Authorization': `Bearer ${process.env.APIFY_API_TOKEN}`
                },
                timeout: 5000
            });
            checks.apifyConnection = testResponse.status === 200;
            if (!checks.apolloApiConnection && checks.apifyConnection) {
                checks.activeIntegration = 'apify_fallback';
            }
        } catch (error) {
            checks.apifyConnection = false;
            checks.apifyError = error.response?.status || 'Connection failed';
        }
    }

    const apolloReady = checks.apolloApiConnection;
    const apifyReady = checks.apifyConnection;
    const anyReady = apolloReady || apifyReady;

    let message = 'Apollo integration has issues';
    if (apolloReady) {
        message = 'Apollo API direct integration ready (primary)';
    } else if (apifyReady) {
        message = 'Apify fallback integration ready (Apollo API unavailable)';
    }

    res.status(anyReady ? 200 : 500).json({
        status: anyReady ? 'OK' : 'Error',
        checks,
        message,
        recommendation: !apolloReady && !apifyReady
            ? 'Configure APOLLO_API_KEY or APIFY_API_TOKEN in environment variables'
            : apolloReady
                ? 'Using Apollo API direct integration (recommended)'
                : 'Using Apify fallback - consider adding APOLLO_API_KEY for direct access'
    });
});

module.exports = router;