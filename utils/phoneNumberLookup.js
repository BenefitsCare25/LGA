const OpenAI = require('openai');

/**
 * Phone Number Lookup Utility
 * Uses OpenAI gpt-4o-mini-search-preview with web search to find missing contact phone numbers
 * Searches company websites, LinkedIn, business directories, and professional profiles
 */

class PhoneNumberLookup {
    constructor() {
        this.openai = new OpenAI({
            apiKey: process.env.OPENAI_API_KEY
        });

        // Cache to avoid duplicate lookups
        this.cache = new Map();
        this.cacheTimeout = 24 * 60 * 60 * 1000; // 24 hours
    }

    /**
     * Find phone number for a lead using OpenAI
     * @param {object} lead - Lead information
     * @returns {Promise<object>} Result with phone number and confidence
     */
    async findPhoneNumber(lead) {
        try {
            const { Name, 'Company Name': companyName, 'LinkedIn URL': linkedinUrl, Email } = lead;

            // Check cache first
            const cacheKey = this.getCacheKey(lead);
            if (this.cache.has(cacheKey)) {
                const cached = this.cache.get(cacheKey);
                if (Date.now() - cached.timestamp < this.cacheTimeout) {
                    console.log(`📞 Using cached phone lookup for ${Name}`);
                    return cached.result;
                }
            }

            console.log(`🔍 Looking up phone number for ${Name} at ${companyName}...`);

            // Build search context
            const searchContext = this.buildSearchContext(lead);

            if (!searchContext) {
                return {
                    found: false,
                    reason: 'Insufficient information for lookup',
                    phoneNumber: null
                };
            }

            // Use OpenAI with web search to find phone number
            const prompt = `Search the web to find the business phone number for this person:

Person: ${Name}
Company: ${companyName}
${linkedinUrl ? `LinkedIn: ${linkedinUrl}` : ''}
${Email ? `Email: ${Email}` : ''}

Find their direct business phone number or company phone number from:
- Company website contact pages
- LinkedIn profile
- Business directories
- Professional profiles

Return ONLY the phone number in international format (e.g., +65-1234-5678 or +1-555-123-4567) or "NOT_FOUND" if you cannot find it.`;

            // Retry logic for rate limiting
            let completion;
            let retries = 3;

            while (retries > 0) {
                try {
                    completion = await this.openai.chat.completions.create({
                        model: 'gpt-4o-mini-search-preview',
                        web_search_options: {
                            user_location: {
                                type: 'approximate',
                                approximate: {
                                    country: 'SG',
                                    city: 'Singapore',
                                    region: 'Singapore'
                                }
                            },
                            search_context_size: 'medium'
                        },
                        messages: [
                            {
                                role: 'system',
                                content: 'You are a professional contact information researcher with web search capabilities. Search the web to find business phone numbers from publicly available sources like company websites, LinkedIn, and business directories. Return only the phone number in international format or "NOT_FOUND".'
                            },
                            {
                                role: 'user',
                                content: prompt
                            }
                        ]
                    });
                    break; // Success, exit retry loop
                } catch (apiError) {
                    if (apiError.status === 429 && retries > 1) {
                        // Rate limit hit, wait and retry
                        const waitTime = apiError.error?.message?.match(/try again in (\d+)ms/)
                            ? parseInt(apiError.error.message.match(/try again in (\d+)ms/)[1])
                            : 1000;
                        console.log(`⏳ Rate limit hit for ${Name}, waiting ${waitTime}ms before retry...`);
                        await new Promise(resolve => setTimeout(resolve, waitTime));
                        retries--;
                    } else {
                        throw apiError; // Not a rate limit or out of retries
                    }
                }
            }

            const response = completion.choices[0].message.content.trim();

            // Parse response
            const result = this.parsePhoneResponse(response, lead);

            // Cache result
            this.cache.set(cacheKey, {
                result,
                timestamp: Date.now()
            });

            return result;

        } catch (error) {
            console.error(`❌ Phone lookup error for ${lead.Name}:`, error.message);
            return {
                found: false,
                reason: `Lookup failed: ${error.message}`,
                phoneNumber: null
            };
        }
    }

    /**
     * Parse OpenAI response for phone number
     */
    parsePhoneResponse(response, lead) {
        console.log(`🔍 AI Response for ${lead.Name}: "${response}"`);

        // Check if not found
        if (response.toUpperCase().includes('NOT_FOUND') ||
            response.toUpperCase().includes('NOT FOUND') ||
            response.toUpperCase().includes('UNAVAILABLE')) {
            console.log(`❌ No phone number found for ${lead.Name}`);
            return {
                found: false,
                reason: 'Phone number not available publicly',
                phoneNumber: null
            };
        }

        // Extract phone number using improved regex
        // Matches: +65 1234 5678, +65-1234-5678, (65) 1234-5678, 6512345678, etc.
        const phoneRegex = /(\+?\d{1,3}[\s\-\.\(\)]?\d{3,4}[\s\-\.\)]?\d{3,4}[\s\-]?\d{0,4})/g;
        const matches = response.match(phoneRegex);

        console.log(`📱 Extracted matches for ${lead.Name}:`, matches);

        if (matches && matches.length > 0) {
            // Try each match until we find a valid one
            for (const match of matches) {
                const phoneNumber = match.trim();

                // Validate it looks like a real phone number
                if (this.isValidPhoneNumber(phoneNumber)) {
                    console.log(`✅ Found valid phone number for ${lead.Name}: ${phoneNumber}`);
                    return {
                        found: true,
                        phoneNumber: phoneNumber,
                        confidence: 'high',
                        source: 'OpenAI Web Search (gpt-4o-mini-search-preview)'
                    };
                } else {
                    console.log(`❌ Invalid phone format: ${phoneNumber} (digits: ${phoneNumber.replace(/\D/g, '').length})`);
                }
            }
        }

        console.log(`⚠️ No valid phone number format found for ${lead.Name}`);
        return {
            found: false,
            reason: 'Invalid phone number format in response',
            phoneNumber: null
        };
    }

    /**
     * Validate phone number format
     */
    isValidPhoneNumber(phone) {
        // Remove all non-digit characters for validation
        const digitsOnly = phone.replace(/\D/g, '');

        // Valid phone numbers should have 7-15 digits
        return digitsOnly.length >= 7 && digitsOnly.length <= 15;
    }

    /**
     * Build search context from lead information
     */
    buildSearchContext(lead) {
        const { Name, 'Company Name': companyName } = lead;

        // Minimum required: name and company
        if (!Name || !companyName) {
            return null;
        }

        return {
            name: Name,
            company: companyName,
            linkedin: lead['LinkedIn URL'] || null,
            email: lead.Email || null
        };
    }

    /**
     * Generate cache key for a lead
     */
    getCacheKey(lead) {
        const { Name, 'Company Name': companyName, Email } = lead;
        return `${Name}|${companyName}|${Email || ''}`.toLowerCase();
    }

    /**
     * Clear lookup cache
     */
    clearCache() {
        const size = this.cache.size;
        this.cache.clear();
        console.log(`🗑️ Cleared ${size} cached phone lookups`);
    }

    /**
     * Batch lookup phone numbers for multiple leads
     * @param {Array} leads - Array of leads with missing phone numbers
     * @param {Function} onProgress - Progress callback
     * @returns {Promise<object>} Batch results
     */
    async batchLookup(leads, onProgress = null) {
        console.log(`📞 Starting batch phone lookup for ${leads.length} leads...`);

        const results = {
            total: leads.length,
            found: 0,
            notFound: 0,
            errors: 0,
            details: []
        };

        for (let i = 0; i < leads.length; i++) {
            const lead = leads[i];

            try {
                const result = await this.findPhoneNumber(lead);

                results.details.push({
                    email: lead.Email,
                    name: lead.Name,
                    company: lead['Company Name'],
                    ...result
                });

                if (result.found) {
                    results.found++;
                } else {
                    results.notFound++;
                }

                // Progress callback
                if (onProgress) {
                    onProgress(i + 1, leads.length, lead, result);
                }

                // Rate limiting: wait 1 second between requests to avoid hitting API limits
                if (i < leads.length - 1) {
                    await new Promise(resolve => setTimeout(resolve, 1000));
                }

            } catch (error) {
                console.error(`❌ Error processing ${lead.Name}:`, error.message);
                results.errors++;
                results.details.push({
                    email: lead.Email,
                    name: lead.Name,
                    company: lead['Company Name'],
                    found: false,
                    reason: `Error: ${error.message}`,
                    phoneNumber: null
                });
            }
        }

        console.log(`✅ Batch lookup completed: ${results.found} found, ${results.notFound} not found, ${results.errors} errors`);

        return results;
    }
}

module.exports = PhoneNumberLookup;