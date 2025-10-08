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
 * @param {Boolean} includePhoneNumbers - Whether to reveal phone numbers (costs extra credits)
 * @returns {Promise<Array>} Array of lead objects
 */
async function scrapeWithApolloAPI(personTitles, companySizes, maxRecords = 0, includePhoneNumbers = false) {
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

            // Debug: Log first person to see raw structure
            if (currentPage === 1 && people.length > 0) {
                console.log(`🔍 Sample Apollo API person object:`, JSON.stringify(people[0], null, 2));
            }

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
 * Enrich Apollo leads with email addresses using bulk enrichment API
 * @param {Array} searchResults - Results from search API
 * @param {Boolean} includePhoneNumbers - Whether to reveal phone numbers
 * @returns {Promise<Array>} Enriched lead objects
 */
async function enrichApolloLeads(searchResults, includePhoneNumbers = false) {
    if (!process.env.APOLLO_API_KEY) {
        throw new Error('Apollo API key not configured');
    }

    console.log(`🔍 Enriching ${searchResults.length} leads with email data...`);

    const enrichedLeads = [];
    const BATCH_SIZE = 10; // Apollo bulk enrichment allows max 10 per request

    for (let i = 0; i < searchResults.length; i += BATCH_SIZE) {
        const batch = searchResults.slice(i, i + BATCH_SIZE);
        console.log(`📦 Enriching batch ${Math.floor(i / BATCH_SIZE) + 1}/${Math.ceil(searchResults.length / BATCH_SIZE)} (${batch.length} leads)...`);

        try {
            // Prepare enrichment details for each person in batch
            const details = batch.map(person => {
                const org = person.organization || {};
                return {
                    first_name: person.first_name,
                    last_name: person.last_name,
                    name: person.name,
                    organization_name: org.name,
                    domain: org.primary_domain || org.website_url?.replace(/^https?:\/\/(www\.)?/, '').split('/')[0],
                    linkedin_url: person.linkedin_url,
                    id: person.id
                };
            });

            const response = await axios.post(
                `${APOLLO_API_BASE_URL}/people/bulk_match`,
                {
                    details: details,
                    reveal_personal_emails: true,
                    reveal_phone_number: includePhoneNumbers
                },
                {
                    headers: {
                        'Cache-Control': 'no-cache',
                        'Content-Type': 'application/json',
                        'x-api-key': process.env.APOLLO_API_KEY
                    },
                    timeout: 30000
                }
            );

            const matches = response.data.matches || [];
            console.log(`✅ Batch enriched: ${matches.length} matches found`);

            // Merge enriched data back into original search results
            batch.forEach((searchPerson, idx) => {
                const enrichedPerson = matches[idx] || searchPerson;
                enrichedLeads.push(enrichedPerson);
            });

            // Rate limiting: small delay between batches
            await new Promise(resolve => setTimeout(resolve, 500));

        } catch (error) {
            console.error(`❌ Enrichment error for batch ${Math.floor(i / BATCH_SIZE) + 1}:`, error.message);

            // If enrichment fails, use original search results for this batch
            console.log(`⚠️ Using un-enriched data for batch ${Math.floor(i / BATCH_SIZE) + 1}`);
            enrichedLeads.push(...batch);
        }
    }

    console.log(`✅ Enrichment complete: ${enrichedLeads.length} total leads`);
    return enrichedLeads;
}

/**
 * Transform Apollo API response to match our internal data structure
 */
function transformApolloLead(apolloLead) {
    const organization = apolloLead.organization || {};
    const employment = apolloLead.employment_history?.[0] || {};

    // Prioritize work email over personal email
    let selectedEmail = '';
    let emailType = '';

    // Check for work/corporate email first
    if (apolloLead.email) {
        selectedEmail = apolloLead.email;
        emailType = 'work';
    }

    // If no work email, check personal emails
    if (!selectedEmail && apolloLead.personal_emails && apolloLead.personal_emails.length > 0) {
        selectedEmail = apolloLead.personal_emails[0];
        emailType = 'personal';
    }

    // Fallback to organization email if nothing else
    if (!selectedEmail && apolloLead.organization_email) {
        selectedEmail = apolloLead.organization_email;
        emailType = 'org';
    }

    return {
        name: apolloLead.name || apolloLead.first_name + ' ' + apolloLead.last_name || '',
        title: apolloLead.title || employment.title || '',
        organization_name: organization.name || '',
        organization_website_url: organization.website_url || organization.primary_domain || '',
        estimated_num_employees: organization.estimated_num_employees || '',
        email: selectedEmail,
        email_verified: apolloLead.email_status === 'verified' ? 'Y' : 'N',
        email_type: emailType, // Track which type of email was used
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
        const { apolloUrl, maxRecords = 500, jobTitles, companySizes, includePhoneNumbers = false, enableAiPhoneFinder = true } = req.body;

        // **Apollo API Integration (Search + Enrichment)**
        if (!process.env.APOLLO_API_KEY) {
            return res.status(500).json({
                error: 'Configuration Error',
                message: 'Apollo API key not configured'
            });
        }

        console.log('🎯 Using Apollo API direct integration with enrichment');

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

            // Step 1: Search for leads (basic info only, no emails)
            const searchResults = await scrapeWithApolloAPI(personTitles, companySizeRanges, maxRecords || 0, false);

            // Step 2: Enrich leads with email addresses
            const enrichedData = await enrichApolloLeads(searchResults, includePhoneNumbers);

            // Transform Apollo data to our format
            const transformedLeads = enrichedData.map(transformApolloLead);

            // Duplicate prevention
            const uniqueLeads = [];
            const seen = new Set();

            transformedLeads.forEach((lead, index) => {
                const email = (lead.email || '').toLowerCase().trim();
                const linkedin = (lead.linkedin_url || '').toLowerCase().trim();
                const name = (lead.name || '').toLowerCase().trim();
                const company = (lead.organization_name || '').toLowerCase().trim();

                let identifier;
                let identifierType;
                if (email && email !== '') {
                    identifier = email;
                    identifierType = 'email';
                } else if (linkedin && linkedin !== '') {
                    identifier = linkedin;
                    identifierType = 'linkedin';
                } else {
                    identifier = `${name}|${company}`;
                    identifierType = 'name+company';
                }

                // Debug first few leads
                if (index < 3) {
                    console.log(`🔍 Lead ${index}: ${lead.name} - ${identifierType}: "${identifier}"`);
                }

                if (!seen.has(identifier)) {
                    seen.add(identifier);
                    uniqueLeads.push(lead);
                } else {
                    console.log(`🔄 Duplicate ${index}: ${lead.name} - ${identifierType}: "${identifier}"`);
                }
            });

            const duplicatesRemoved = transformedLeads.length - uniqueLeads.length;

            // AI-powered phone lookup for leads without phone numbers (if enabled)
            if (enableAiPhoneFinder) {
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
                } else {
                    console.log(`✅ All leads already have phone numbers`);
                }
            } else {
                console.log(`⏭️ AI phone finder disabled by user`);
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
                        rawScraped: enrichedData.length,
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
                    rawScraped: enrichedData.length,
                    duplicatesRemoved: duplicatesRemoved,
                    finalCount: uniqueLeads.length,
                    jobTitles: personTitles,
                    companySizes: companySizeRanges
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
                message: 'Invalid Apollo API key'
            });
        }

        if (error.response?.status === 429) {
            return res.status(429).json({
                error: 'Rate Limit Error',
                message: 'Apollo API rate limit exceeded. Please try again later.'
            });
        }

        if (error.response?.status === 402) {
            return res.status(402).json({
                error: 'Credits Error',
                message: 'Apollo API credits exhausted. Please check your account.'
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
        const { apolloUrl, maxRecords = 500, jobTitles, companySizes, includePhoneNumbers = false, enableAiPhoneFinder = true } = req.body;

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

        // Check if Apollo API key is configured
        if (!process.env.APOLLO_API_KEY) {
            return res.status(500).json({
                error: 'Configuration Error',
                message: 'Apollo API key not configured'
            });
        }

        // Generate unique Apollo job ID
        const apolloJobId = Date.now().toString() + Math.random().toString(36).substr(2, 9);

        // Initialize Apollo job status
        const apolloJobStatus = {
            id: apolloJobId,
            status: 'started',
            startTime: new Date().toISOString(),
            params: { apolloUrl, maxRecords, jobTitles, companySizes, includePhoneNumbers, enableAiPhoneFinder },
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
        const { apolloUrl, maxRecords, jobTitles, companySizes, includePhoneNumbers = false, enableAiPhoneFinder = true } = job.params;

        job.status = 'scraping';

        // Apollo API Integration for background jobs
        if (!process.env.APOLLO_API_KEY) {
            throw new Error('Apollo API key not configured');
        }

        console.log(`🎯 Apollo job ${apolloJobId}: Using Apollo API with enrichment`);

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

            // Step 1: Search for leads (basic info only, no emails)
            const searchResults = await scrapeWithApolloAPI(personTitles, companySizeRanges, maxRecords || 0, false);

            // Step 2: Enrich leads with email addresses
            const enrichedData = await enrichApolloLeads(searchResults, includePhoneNumbers);

            // Transform Apollo data to our format
            const transformedLeads = enrichedData.map(transformApolloLead);

            // Duplicate prevention
            const uniqueLeads = [];
            const seen = new Set();

            transformedLeads.forEach((lead, index) => {
                const email = (lead.email || '').toLowerCase().trim();
                const linkedin = (lead.linkedin_url || '').toLowerCase().trim();
                const name = (lead.name || '').toLowerCase().trim();
                const company = (lead.organization_name || '').toLowerCase().trim();

                let identifier;
                let identifierType;
                if (email && email !== '') {
                    identifier = email;
                    identifierType = 'email';
                } else if (linkedin && linkedin !== '') {
                    identifier = linkedin;
                    identifierType = 'linkedin';
                } else {
                    identifier = `${name}|${company}`;
                    identifierType = 'name+company';
                }

                // Debug first few leads
                if (index < 3) {
                    console.log(`🔍 Lead ${index}: ${lead.name} - ${identifierType}: "${identifier}"`);
                }

                if (!seen.has(identifier)) {
                    seen.add(identifier);
                    uniqueLeads.push(lead);
                } else {
                    console.log(`🔄 Duplicate ${index}: ${lead.name} - ${identifierType}: "${identifier}"`);
                }
            });

            const duplicatesRemoved = transformedLeads.length - uniqueLeads.length;

            // AI-powered phone lookup (if enabled)
            if (enableAiPhoneFinder) {
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
                } else {
                    console.log(`✅ Apollo job ${apolloJobId}: All leads already have phone numbers`);
                }
            } else {
                console.log(`⏭️ Apollo job ${apolloJobId}: AI phone finder disabled by user`);
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
                    rawScraped: enrichedData.length,
                    duplicatesRemoved: duplicatesRemoved,
                    finalCount: uniqueLeads.length,
                    jobTitles: personTitles,
                    companySizes: companySizeRanges
                }
            };
            job.completedAt = new Date().toISOString();

            console.log(`✅ Apollo job ${apolloJobId} completed successfully with ${uniqueLeads.length} leads`);

    } catch (error) {
        console.error(`❌ Apollo job ${apolloJobId} failed:`, error);
        job.status = 'failed';
        job.error = error.message;
        job.completedAt = new Date().toISOString();
    }
}

// Poll Apify run until completion
// REMOVED: pollApifyRun function (132 lines)
// Dead code - Apify integration was replaced with Apollo API direct integration
// Successfully migrated to scrapeWithApolloAPI() and enrichApolloLeads()

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