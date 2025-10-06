/**
 * Excel-Based Duplicate Checker
 * Uses Excel as the single source of truth for duplicate prevention
 * More reliable than separate campaign state management
 */

const { getLeadsViaGraphAPI } = require('./excelGraphAPI');

class ExcelDuplicateChecker {
    constructor() {
        this.cache = new Map(); // Cache lead data for performance
        this.cacheExpiry = 5 * 60 * 1000; // 5 minutes cache
    }

    /**
     * Check if an email has already been sent by looking at Excel data
     * @param {object} graphClient - Microsoft Graph client
     * @param {string} email - Email address to check
     * @returns {Promise<{alreadySent: boolean, leadData: object|null, reason: string}>}
     */
    async isEmailAlreadySent(graphClient, email) {
        try {
            console.log(`🔍 EXCEL DUPLICATE CHECK: Checking if ${email} has already been sent...`);

            // Get fresh Excel data
            const allLeads = await this.getLeadsWithCache(graphClient);
            
            if (!allLeads) {
                console.log(`⚠️ Could not retrieve Excel data for duplicate check`);
                return {
                    alreadySent: false,
                    leadData: null,
                    reason: 'Excel data not available - allowing send'
                };
            }

            // Find the lead by email
            const lead = allLeads.find(l => 
                l.Email && l.Email.toLowerCase().trim() === email.toLowerCase().trim()
            );

            if (!lead) {
                console.log(`❌ Email ${email} not found in Excel - cannot send`);
                return {
                    alreadySent: true, // Prevent sending if not in Excel
                    leadData: null,
                    reason: 'Email not found in Excel master list'
                };
            }

            // Check various "sent" indicators
            const sentIndicators = this.checkSentIndicators(lead);
            
            if (sentIndicators.alreadySent) {
                console.log(`⚠️ DUPLICATE PREVENTED: ${email} - ${sentIndicators.reason}`);
                console.log(`📊 Lead status: Status=${lead.Status}, Last_Email_Date=${lead.Last_Email_Date}, Email_Count=${lead.Email_Count}`);
                
                return {
                    alreadySent: true,
                    leadData: lead,
                    reason: sentIndicators.reason
                };
            }

            console.log(`✅ SAFE TO SEND: ${email} - No previous send indicators found`);
            return {
                alreadySent: false,
                leadData: lead,
                reason: 'No previous send indicators found'
            };

        } catch (error) {
            console.error(`❌ Excel duplicate check error for ${email}:`, error.message);
            
            // Fail safe - if we can't check, don't send
            return {
                alreadySent: true,
                leadData: null,
                reason: `Excel check failed: ${error.message}`
            };
        }
    }

    /**
     * Check if email can be sent based on 14-day cooldown period
     * @param {object} lead - Lead object from Excel
     * @returns {object} {alreadySent: boolean, reason: string}
     */
    checkSentIndicators(lead) {
        const COOLDOWN_DAYS = 14;

        // Only check Last_Email_Date for 14-day cooldown
        if (lead.Last_Email_Date) {
            const lastEmailDate = this.parseExcelDate(lead.Last_Email_Date);
            if (lastEmailDate) {
                const lastSentDate = new Date(lastEmailDate);
                const today = new Date();
                const daysSinceLastEmail = Math.floor((today - lastSentDate) / (1000 * 60 * 60 * 24));

                if (daysSinceLastEmail < COOLDOWN_DAYS) {
                    return {
                        alreadySent: true,
                        reason: `Last email sent ${daysSinceLastEmail} days ago (${lastEmailDate}). Cooldown period: ${COOLDOWN_DAYS} days`
                    };
                } else {
                    return {
                        alreadySent: false,
                        reason: `Last email sent ${daysSinceLastEmail} days ago (${lastEmailDate}). Cooldown period passed - safe to send`
                    };
                }
            }
        }

        // No Last_Email_Date means first time sending
        return {
            alreadySent: false,
            reason: 'No previous email found - first time sending'
        };
    }

    /**
     * Get leads with caching for performance
     * @param {object} graphClient - Microsoft Graph client
     * @returns {Promise<Array|null>}
     */
    async getLeadsWithCache(graphClient) {
        const now = new Date().getTime();
        const cacheKey = 'leads_data';

        // Check cache first
        const cached = this.cache.get(cacheKey);
        if (cached && (now - cached.timestamp) < this.cacheExpiry) {
            console.log(`📋 Using cached leads data (${cached.data.length} leads)`);
            return cached.data;
        }

        // Fetch fresh data
        console.log(`📋 Fetching fresh leads data from Excel...`);
        const leads = await getLeadsViaGraphAPI(graphClient);
        
        if (leads) {
            // Cache the data
            this.cache.set(cacheKey, {
                data: leads,
                timestamp: now
            });
            console.log(`📋 Cached ${leads.length} leads for duplicate checking`);
        }

        return leads;
    }

    /**
     * Clear the cache (useful for testing or manual refresh)
     */
    clearCache() {
        this.cache.clear();
        console.log('🧹 Excel duplicate checker cache cleared');
    }

    /**
     * Parse Excel date values (handles both serial numbers and date strings)
     * @param {*} dateValue - Date value from Excel
     * @returns {string|null} ISO date string or null
     */
    parseExcelDate(dateValue) {
        if (!dateValue) return null;
        
        try {
            // Handle Excel serial numbers (like 45907)
            if (typeof dateValue === 'number' && dateValue > 40000) {
                const excelEpoch = new Date(1900, 0, 1);
                const jsDate = new Date(excelEpoch.getTime() + (dateValue - 2) * 24 * 60 * 60 * 1000);
                return jsDate.toISOString().split('T')[0];
            } else {
                // Handle regular date strings
                return new Date(dateValue).toISOString().split('T')[0];
            }
        } catch (error) {
            return null;
        }
    }

    /**
     * Get comprehensive duplicate check report for debugging
     * @param {object} graphClient - Microsoft Graph client
     * @param {Array} emails - Array of email addresses to check
     * @returns {Promise<object>} Detailed report
     */
    async getDuplicateReport(graphClient, emails) {
        const report = {
            totalChecked: emails.length,
            alreadySent: 0,
            safeToSend: 0,
            errors: 0,
            details: []
        };

        for (const email of emails) {
            try {
                const result = await this.isEmailAlreadySent(graphClient, email);
                
                report.details.push({
                    email: email,
                    alreadySent: result.alreadySent,
                    reason: result.reason,
                    leadData: result.leadData ? {
                        Status: result.leadData.Status,
                        Last_Email_Date: result.leadData.Last_Email_Date,
                        Email_Count: result.leadData.Email_Count
                    } : null
                });

                if (result.alreadySent) {
                    report.alreadySent++;
                } else {
                    report.safeToSend++;
                }

            } catch (error) {
                report.errors++;
                report.details.push({
                    email: email,
                    error: error.message
                });
            }
        }

        return report;
    }
}

// Export singleton instance
module.exports = new ExcelDuplicateChecker();