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

        // Cache to avoid duplicate lookups with size limit
        this.cache = new Map();
        this.cacheTimeout = 24 * 60 * 60 * 1000; // 24 hours
        this.maxEntries = 500; // Prevent unbounded memory growth

        // Start periodic cleanup
        this.startCleanupTimer();
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
                    return cached.result;
                }
            }

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

            // Ensure cache size before adding new entry
            this.ensureCacheSize();

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
        // Check if not found
        if (response.toUpperCase().includes('NOT_FOUND') ||
            response.toUpperCase().includes('NOT FOUND') ||
            response.toUpperCase().includes('UNAVAILABLE')) {
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

        if (matches && matches.length > 0) {
            // Collect ALL valid phone numbers
            const validPhoneNumbers = [];

            for (const match of matches) {
                const phoneNumber = match.trim();

                // Validate it looks like a real phone number
                if (this.isValidPhoneNumber(phoneNumber)) {
                    // Avoid duplicates
                    if (!validPhoneNumbers.includes(phoneNumber)) {
                        validPhoneNumbers.push(phoneNumber);
                    }
                }
            }

            // Return all found phone numbers
            if (validPhoneNumbers.length > 0) {
                const phoneNumberString = validPhoneNumbers.join(', ');
                return {
                    found: true,
                    phoneNumber: phoneNumberString,
                    confidence: 'high',
                    source: 'OpenAI Web Search (gpt-4o-mini-search-preview)',
                    count: validPhoneNumbers.length
                };
            }
        }

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
     * Ensure cache doesn't exceed maximum entries (LRU eviction)
     */
    ensureCacheSize() {
        if (this.cache.size >= this.maxEntries) {
            // Convert to array and sort by timestamp (oldest first)
            const entries = Array.from(this.cache.entries())
                .sort((a, b) => a[1].timestamp - b[1].timestamp);

            // Remove oldest 10%
            const toRemove = Math.ceil(this.maxEntries * 0.1);
            for (let i = 0; i < toRemove && i < entries.length; i++) {
                const [key] = entries[i];
                this.cache.delete(key);
            }
        }
    }

    /**
     * Clean up expired cache entries
     */
    cleanup() {
        let cleanedCount = 0;
        const now = Date.now();

        for (const [key, cached] of this.cache.entries()) {
            if (now - cached.timestamp >= this.cacheTimeout) {
                this.cache.delete(key);
                cleanedCount++;
            }
        }

        if (cleanedCount > 0) {
            console.log(`🧹 Cleaned up ${cleanedCount} expired phone lookup cache entries`);
        }

        return cleanedCount;
    }

    /**
     * Start periodic cleanup timer
     */
    startCleanupTimer() {
        // Run cleanup every hour
        setInterval(() => {
            this.cleanup();
        }, 60 * 60 * 1000);
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