/**
 * EmailSender - Shared utility for sending email campaigns
 * Handles authentication, token refresh, Excel updates, and error handling
 */

const { updateLeadViaGraphAPI } = require('./excelGraphAPI');
const excelUpdateQueue = require('./excelUpdateQueue');
const campaignTokenManager = require('./campaignTokenManager');

class EmailSender {
    /**
     * Send emails to leads with proper authentication and error handling
     *
     * @param {Object} options - Configuration options
     * @param {Object} options.graphClient - Initial Microsoft Graph client
     * @param {Array} options.leads - Array of lead objects with email data
     * @param {Object} options.templates - Email templates object
     * @param {string} options.campaignId - Unique campaign identifier
     * @param {Array} options.attachments - Optional email attachments
     * @param {Object} options.delegatedAuth - Auth provider for token refresh
     * @param {string} options.sessionId - Session ID for token refresh
     * @param {Object} options.emailConfig - Email-specific configuration
     * @param {Function} options.buildEmailContent - Function to build email content for each lead
     * @param {Function} options.filterLead - Optional async function to filter/check leads (return {skip: boolean, reason: string})
     * @param {Function} options.onProgress - Optional progress callback
     * @param {Function} options.getDelay - Optional function to get delay between emails (index, totalLeads) => ms
     * @param {boolean} options.trackReads - Enable read tracking via pixel
     * @returns {Object} Results with sent count, failed count, duplicates count, and errors array
     */
    static async sendCampaign({
        graphClient,
        leads,
        templates,
        campaignId,
        attachments = [],
        delegatedAuth = null,
        sessionId = null,
        emailConfig = {},
        buildEmailContent,
        filterLead = null,
        onProgress = null,
        getDelay = null,
        trackReads = false
    }) {
        const results = {
            sent: 0,
            failed: 0,
            duplicates: 0,
            errors: []
        };

        const canRefreshToken = delegatedAuth && sessionId;

        for (let i = 0; i < leads.length; i++) {
            const lead = leads[i];

            try {
                // Validate lead has email
                if (!lead.Email) {
                    results.failed++;
                    results.errors.push(`Lead missing email: ${lead.Name || 'Unknown'}`);
                    continue;
                }

                // Apply filter function if provided (e.g., duplicate checking)
                if (filterLead) {
                    const filterResult = await filterLead(lead, graphClient);
                    if (filterResult.skip) {
                        console.log(`⚠️ Lead skipped: ${lead.Email} - ${filterResult.reason}`);
                        results.duplicates++;
                        continue;
                    }
                }

                // Progress callback
                if (onProgress) {
                    await onProgress(i, leads.length, lead);
                }

                // Validate token before each email
                if (canRefreshToken) {
                    const tokenValid = await campaignTokenManager.ensureValidToken(delegatedAuth, sessionId);
                    if (!tokenValid) {
                        console.error(`🔐 Authentication session expired after ${results.sent} emails sent`);
                        console.error(`⚠️ Campaign stopped - user needs to refresh browser and re-authenticate`);
                        results.errors.push(`Campaign stopped at email ${i + 1}/${leads.length}: Authentication session expired (1-hour timeout). Please refresh your browser and re-authenticate to continue.`);
                        break; // Stop campaign - user needs to re-authenticate
                    }

                    // Get fresh GraphClient with current token
                    try {
                        graphClient = await delegatedAuth.getGraphClient(sessionId);
                    } catch (graphClientError) {
                        console.error(`❌ Failed to refresh Graph client:`, graphClientError.message);

                        // Check if this is an authentication expiration error
                        if (graphClientError.message.includes('User not authenticated') ||
                            graphClientError.message.includes('Authentication expired') ||
                            graphClientError.message.includes('AADSTS')) {
                            console.error(`🔐 Authentication session expired after ${results.sent} emails sent`);
                            console.error(`⚠️ Campaign stopped - user needs to refresh browser and re-authenticate`);
                            results.errors.push(`Campaign stopped at email ${i + 1}/${leads.length}: Authentication expired. Please refresh browser and re-authenticate to continue.`);
                            break; // Stop campaign - user needs to re-authenticate
                        }

                        throw graphClientError;
                    }
                }

                // Build email content using provided function
                const { message: emailMessage, excelUpdates } = await buildEmailContent(lead, templates, emailConfig);

                // Send email via Microsoft Graph
                await graphClient
                    .api('/me/sendMail')
                    .post({ message: emailMessage });

                console.log(`✅ [${campaignId}] Email sent to ${lead.Email}`);
                results.sent++;

                // Queue Excel update with fresh GraphClient (use custom updates if provided)
                const defaultUpdates = {
                    Status: 'Sent',
                    'Last Campaign': campaignId,
                    'Last Contact Date': new Date().toISOString().split('T')[0]
                };

                await this._queueExcelUpdate(
                    lead,
                    excelUpdates || defaultUpdates,
                    delegatedAuth,
                    sessionId,
                    graphClient,
                    canRefreshToken
                );

            } catch (error) {
                console.error(`❌ [${campaignId}] Failed to send to ${lead.Email}:`, error.message);
                results.failed++;
                results.errors.push({
                    email: lead.Email,
                    name: lead['Company Name'] || lead.Name || 'Unknown',
                    error: error.message
                });

                // Queue Excel update for failure
                await this._queueExcelUpdate(
                    lead,
                    {
                        Status: 'Failed',
                        'Last Campaign': campaignId,
                        'Error Message': error.message.substring(0, 250)
                    },
                    delegatedAuth,
                    sessionId,
                    graphClient,
                    canRefreshToken
                );

                // Continue to next lead instead of stopping entire campaign
                continue;
            }

            // Add delay between emails (skip for last email)
            if (getDelay && i < leads.length - 1) {
                const delayMs = await getDelay(i, leads.length);
                console.log(`⏳ Adding ${Math.round(delayMs / 1000)}s delay before next email...`);
                await new Promise(resolve => setTimeout(resolve, delayMs));
                console.log(`✅ Delay completed - ready for next email`);
            }
        }

        return results;
    }

    /**
     * Queue Excel update with proper GraphClient handling
     * @private
     */
    static async _queueExcelUpdate(lead, updates, delegatedAuth, sessionId, graphClient, canRefreshToken) {
        await excelUpdateQueue.queueUpdate(
            lead.Email,
            async () => {
                // Create fresh Graph client when queue processes this update
                if (canRefreshToken) {
                    try {
                        const freshClient = await delegatedAuth.getGraphClient(sessionId);
                        return await updateLeadViaGraphAPI(freshClient, lead.Email, updates);
                    } catch (error) {
                        // If token refresh fails during queue processing, log and skip
                        console.error(`⚠️ Token expired during Excel update for ${lead.Email}, skipping update`);
                        return null;
                    }
                }
                // Fallback to original client if no auth context
                return await updateLeadViaGraphAPI(graphClient, lead.Email, updates);
            },
            {
                type: 'campaign-send',
                email: lead.Email,
                source: 'EmailSender',
                priority: 'high'
            }
        );
    }

    /**
     * Build standard email message object
     *
     * @param {Object} params - Email parameters
     * @param {string} params.to - Recipient email
     * @param {string} params.subject - Email subject
     * @param {string} params.body - Email body (HTML)
     * @param {Array} params.attachments - Optional attachments
     * @returns {Object} Microsoft Graph sendMail message object
     */
    static buildEmailMessage({ to, subject, body, attachments = [] }) {
        const message = {
            message: {
                subject: subject,
                body: {
                    contentType: 'HTML',
                    content: body
                },
                toRecipients: [
                    {
                        emailAddress: {
                            address: to
                        }
                    }
                ]
            }
        };

        // Add attachments if provided
        if (attachments && attachments.length > 0) {
            message.message.attachments = attachments.map(att => ({
                '@odata.type': '#microsoft.graph.fileAttachment',
                name: att.name,
                contentBytes: att.contentBytes
            }));
        }

        return message;
    }

    /**
     * Generate unique campaign ID
     * @returns {string} Campaign ID in format CAMPAIGN_YYYYMMDD_HHMMSS
     */
    static generateCampaignId() {
        const now = new Date();
        const timestamp = now.toISOString()
            .replace(/[-:T]/g, '')
            .replace(/\..+/, '')
            .substring(0, 14);
        return `CAMPAIGN_${timestamp}`;
    }
}

module.exports = EmailSender;