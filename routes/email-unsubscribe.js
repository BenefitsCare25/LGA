/**
 * Email Unsubscribe Routes
 * Handles unsubscribe requests and removes leads from Excel master list
 */

const express = require('express');
const { Client } = require('@microsoft/microsoft-graph-client');
const { getLeadsViaGraphAPI, getExcelColumnLetter } = require('../utils/excelGraphAPI');
const ROPCGraphAuth = require('../middleware/ropcGraphAuth');
const { getDelegatedAuthProvider } = require('../middleware/delegatedGraphAuth');
const router = express.Router();

/**
 * Get Graph client using ROPC authentication (service account)
 * This allows unsubscribe to work without user authentication while using delegated permissions
 */
async function getUnsubscribeGraphClient() {
    console.log('🔐 [UNSUBSCRIBE] Initializing ROPC authentication for unsubscribe request...');

    // Check if ROPC is configured
    if (!ROPCGraphAuth.isConfigured()) {
        console.error('❌ [UNSUBSCRIBE] ROPC not configured - missing service account credentials');
        throw new Error('Unsubscribe service not configured. Please contact support.');
    }

    try {
        // Create ROPC auth instance
        const ropcAuth = new ROPCGraphAuth();
        const delegatedAuth = getDelegatedAuthProvider();

        console.log('🔑 [UNSUBSCRIBE] Authenticating with service account...');

        // Create or get existing session from ROPC
        const result = await ropcAuth.createSessionFromROPC(delegatedAuth);

        if (!result.success) {
            console.error('❌ [UNSUBSCRIBE] ROPC authentication failed:', result.error);
            throw new Error('Failed to authenticate unsubscribe service');
        }

        console.log(`✅ [UNSUBSCRIBE] Authenticated as: ${result.user}`);
        console.log(`📅 [UNSUBSCRIBE] Session ID: ${result.sessionId}`);

        // Get Graph client using the session
        const graphClient = await delegatedAuth.getGraphClient(result.sessionId);

        console.log('✅ [UNSUBSCRIBE] Graph client ready for Excel operations');

        return graphClient;

    } catch (error) {
        console.error('❌ [UNSUBSCRIBE] Failed to create Graph client:', error.message);
        throw error;
    }
}

/**
 * Handle unsubscribe request - removes lead from Excel file
 * GET /api/email/unsubscribe?email=recipient@example.com
 */
router.get('/unsubscribe', async (req, res) => {
    try {
        const { email } = req.query;

        console.log('═══════════════════════════════════════════════════════════════');
        console.log('📧 [UNSUBSCRIBE] New unsubscribe request received');
        console.log(`📧 [UNSUBSCRIBE] Timestamp: ${new Date().toISOString()}`);

        if (!email) {
            console.error('❌ [UNSUBSCRIBE] No email address provided in request');
            return res.status(400).send(`
                <!DOCTYPE html>
                <html>
                <head>
                    <title>Invalid Unsubscribe Request</title>
                    <style>
                        body { font-family: Arial, sans-serif; max-width: 600px; margin: 50px auto; padding: 20px; text-align: center; }
                        .error { color: #dc3545; }
                    </style>
                </head>
                <body>
                    <h1 class="error">Invalid Unsubscribe Request</h1>
                    <p>No email address was provided in the unsubscribe link.</p>
                    <p>If you continue to receive emails, please contact us directly.</p>
                </body>
                </html>
            `);
        }

        console.log(`📧 [UNSUBSCRIBE] Email address: ${email}`);
        console.log('✅ [UNSUBSCRIBE] Confirmation page loading...');
        console.log('═══════════════════════════════════════════════════════════════');

        res.send(`
            <!DOCTYPE html>
            <html>
            <head>
                <title>Unsubscribe Confirmation</title>
                <meta charset="UTF-8">
                <meta name="viewport" content="width=device-width, initial-scale=1.0">
                <style>
                    body {
                        font-family: Arial, sans-serif;
                        max-width: 600px;
                        margin: 50px auto;
                        padding: 20px;
                        text-align: center;
                        background-color: #f8f9fa;
                    }
                    .container {
                        background: white;
                        padding: 40px;
                        border-radius: 8px;
                        box-shadow: 0 2px 10px rgba(0,0,0,0.1);
                    }
                    .success { color: #28a745; }
                    .email {
                        background-color: #e9ecef;
                        padding: 10px;
                        border-radius: 4px;
                        font-family: monospace;
                        margin: 20px 0;
                    }
                    .button {
                        display: inline-block;
                        margin-top: 20px;
                        padding: 12px 24px;
                        background-color: #28a745;
                        color: white !important;
                        text-decoration: none;
                        border-radius: 6px;
                        font-weight: bold;
                    }
                    .button:hover {
                        background-color: #218838;
                    }
                    .confirm-button {
                        background-color: #dc3545;
                        margin-top: 30px;
                        padding: 15px 40px;
                        color: white;
                        border: none;
                        border-radius: 6px;
                        font-size: 16px;
                        font-weight: bold;
                        cursor: pointer;
                    }
                    .confirm-button:hover {
                        background-color: #c82333;
                    }
                    .info {
                        color: #666;
                        font-size: 14px;
                        margin-top: 20px;
                    }
                </style>
                <script>
                    // Client-side email variable for JavaScript
                    const userEmail = '${email}';

                    async function confirmUnsubscribe() {
                        const button = document.getElementById('confirmBtn');
                        button.disabled = true;
                        button.textContent = 'Processing...';

                        try {
                            const response = await fetch('/api/email/unsubscribe/confirm?email=${encodeURIComponent(email)}', {
                                method: 'POST'
                            });

                            const result = await response.json();

                            if (result.success) {
                                document.getElementById('content').innerHTML =
                                    '<h1 class="success">✓ Successfully Unsubscribed</h1>' +
                                    '<p>You have been removed from our mailing list.</p>' +
                                    '<div class="email">' + userEmail + '</div>' +
                                    '<p>You will no longer receive emails from us.</p>' +
                                    '<p class="info">If you unsubscribed by mistake, please contact us at BenefitsCare@inspro.com.sg</p>';
                            } else {
                                throw new Error(result.message || 'Failed to unsubscribe');
                            }
                        } catch (error) {
                            alert('Error: ' + error.message + '\\nPlease contact us directly at BenefitsCare@inspro.com.sg');
                            button.disabled = false;
                            button.textContent = 'Confirm Unsubscribe';
                        }
                    }
                </script>
            </head>
            <body>
                <div class="container" id="content">
                    <h1>Confirm Unsubscribe</h1>
                    <p>Are you sure you want to unsubscribe from our mailing list?</p>
                    <div class="email">${email}</div>
                    <p class="info">This will remove you from all future email communications.</p>
                    <button class="confirm-button" id="confirmBtn" onclick="confirmUnsubscribe()">
                        Confirm Unsubscribe
                    </button>
                    <p class="info" style="margin-top: 40px;">
                        If you didn't request this, you can safely close this page.
                    </p>
                </div>
            </body>
            </html>
        `);

    } catch (error) {
        console.error('❌ [UNSUBSCRIBE] Page loading error:', error.message);
        console.error('❌ [UNSUBSCRIBE] Stack trace:', error.stack);
        console.log('═══════════════════════════════════════════════════════════════');
        res.status(500).send(`
            <!DOCTYPE html>
            <html>
            <head>
                <title>Error</title>
                <style>
                    body { font-family: Arial, sans-serif; max-width: 600px; margin: 50px auto; padding: 20px; text-align: center; }
                    .error { color: #dc3545; }
                </style>
            </head>
            <body>
                <h1 class="error">An Error Occurred</h1>
                <p>We encountered an error processing your unsubscribe request.</p>
                <p>Please contact us directly at BenefitsCare@inspro.com.sg</p>
            </body>
            </html>
        `);
    }
});

/**
 * Confirm unsubscribe and remove from Excel
 * POST /api/email/unsubscribe/confirm?email=recipient@example.com
 * No user authentication required - uses ROPC service account credentials
 */
router.post('/unsubscribe/confirm', async (req, res) => {
    const startTime = Date.now();

    try {
        const { email } = req.query;

        console.log('═══════════════════════════════════════════════════════════════');
        console.log('🗑️ [UNSUBSCRIBE] Processing unsubscribe confirmation');
        console.log(`📧 [UNSUBSCRIBE] Email: ${email}`);
        console.log(`⏰ [UNSUBSCRIBE] Timestamp: ${new Date().toISOString()}`);

        if (!email) {
            console.error('❌ [UNSUBSCRIBE] No email address provided');
            return res.status(400).json({
                success: false,
                message: 'Email address is required'
            });
        }

        console.log('🔐 [UNSUBSCRIBE] Step 1/3: Authenticating with service account...');

        // Get Graph client using ROPC authentication
        let graphClient;
        try {
            graphClient = await getUnsubscribeGraphClient();
            console.log('✅ [UNSUBSCRIBE] Step 1/3 Complete: Authentication successful');
        } catch (authError) {
            console.error('❌ [UNSUBSCRIBE] Step 1/3 Failed: Authentication error:', authError.message);
            throw new Error('Failed to authenticate unsubscribe service. Please try again later.');
        }

        console.log('📂 [UNSUBSCRIBE] Step 2/3: Searching for lead in Excel...');

        // Remove lead from Excel file
        let removed;
        try {
            removed = await removeLeadFromExcel(graphClient, email);
            console.log('✅ [UNSUBSCRIBE] Step 2/3 Complete: Excel search finished');
        } catch (excelError) {
            console.error('❌ [UNSUBSCRIBE] Step 2/3 Failed: Excel operation error:', excelError.message);
            throw new Error('Failed to access mailing list. Please try again later.');
        }

        console.log('📋 [UNSUBSCRIBE] Step 3/3: Processing results...');

        const processingTime = Date.now() - startTime;

        if (removed) {
            console.log(`✅ [UNSUBSCRIBE] SUCCESS: ${email} removed from mailing list`);
            console.log(`✅ [UNSUBSCRIBE] Lead data deleted from Excel file`);
            console.log(`⏱️ [UNSUBSCRIBE] Processing time: ${processingTime}ms`);
            console.log('═══════════════════════════════════════════════════════════════');

            res.json({
                success: true,
                message: 'Successfully unsubscribed',
                email: email,
                processingTime: processingTime
            });
        } else {
            console.log(`⚠️ [UNSUBSCRIBE] Email ${email} not found in mailing list`);
            console.log(`⚠️ [UNSUBSCRIBE] Possible reasons: already unsubscribed or never subscribed`);
            console.log(`⏱️ [UNSUBSCRIBE] Processing time: ${processingTime}ms`);
            console.log('═══════════════════════════════════════════════════════════════');

            res.json({
                success: true,
                message: 'Email address not found in our records (may already be unsubscribed)',
                email: email,
                processingTime: processingTime
            });
        }

    } catch (error) {
        const processingTime = Date.now() - startTime;

        console.error('❌ [UNSUBSCRIBE] FAILED: Unsubscribe confirmation error');
        console.error(`❌ [UNSUBSCRIBE] Error: ${error.message}`);
        console.error(`❌ [UNSUBSCRIBE] Stack trace:`, error.stack);
        console.error(`⏱️ [UNSUBSCRIBE] Failed after: ${processingTime}ms`);
        console.log('═══════════════════════════════════════════════════════════════');

        res.status(500).json({
            success: false,
            message: 'Failed to process unsubscribe request',
            error: error.message,
            processingTime: processingTime
        });
    }
});

/**
 * Remove lead from Excel master file via Graph API
 * @param {object} graphClient - Microsoft Graph client (ROPC delegated auth)
 * @param {string} email - Email address to remove
 * @returns {Promise<boolean>} True if removed, false if not found
 */
async function removeLeadFromExcel(graphClient, email) {
    try {
        const masterFileName = 'LGA-Master-Email-List.xlsx';
        const masterFolderPath = '/LGA-Email-Automation';

        console.log(`🔍 [UNSUBSCRIBE-EXCEL] Searching for ${email} in Excel file...`);
        console.log(`📁 [UNSUBSCRIBE-EXCEL] File: ${masterFolderPath}/${masterFileName}`);

        // Get the Excel file ID using delegated access (/me/drive)
        console.log('📂 [UNSUBSCRIBE-EXCEL] Step 2.1/5: Locating Excel file in OneDrive...');
        const files = await graphClient
            .api(`/me/drive/root:${masterFolderPath}:/children`)
            .filter(`name eq '${masterFileName}'`)
            .get();

        if (files.value.length === 0) {
            console.error(`❌ [UNSUBSCRIBE-EXCEL] Master file not found: ${masterFileName}`);
            console.error(`❌ [UNSUBSCRIBE-EXCEL] Expected path: ${masterFolderPath}/${masterFileName}`);
            return false;
        }

        const fileId = files.value[0].id;
        console.log(`✅ [UNSUBSCRIBE-EXCEL] Step 2.1/5 Complete: Excel file found (ID: ${fileId.substring(0, 20)}...)`);

        // Get worksheets to find the Leads sheet
        console.log('📊 [UNSUBSCRIBE-EXCEL] Step 2.2/5: Reading worksheets...');
        const worksheets = await graphClient
            .api(`/me/drive/items/${fileId}/workbook/worksheets`)
            .get();

        console.log(`📊 [UNSUBSCRIBE-EXCEL] Found ${worksheets.value.length} worksheet(s): ${worksheets.value.map(s => s.name).join(', ')}`);

        const leadsSheet = worksheets.value.find(sheet =>
            sheet.name === 'Leads' || sheet.name.toLowerCase().includes('lead')
        ) || worksheets.value[0];

        if (!leadsSheet) {
            console.error(`❌ [UNSUBSCRIBE-EXCEL] No leads worksheet found in ${masterFileName}`);
            return false;
        }

        console.log(`✅ [UNSUBSCRIBE-EXCEL] Step 2.2/5 Complete: Using worksheet "${leadsSheet.name}"`);

        // Get worksheet data to find the email
        console.log('📋 [UNSUBSCRIBE-EXCEL] Step 2.3/5: Reading worksheet data...');
        const usedRange = await graphClient
            .api(`/me/drive/items/${fileId}/workbook/worksheets('${leadsSheet.name}')/usedRange`)
            .get();

        if (!usedRange || !usedRange.values || usedRange.values.length <= 1) {
            console.error(`❌ [UNSUBSCRIBE-EXCEL] No data found in worksheet ${leadsSheet.name}`);
            return false;
        }

        const headers = usedRange.values[0];
        const rows = usedRange.values.slice(1);
        console.log(`✅ [UNSUBSCRIBE-EXCEL] Step 2.3/5 Complete: Read ${rows.length} data rows`);
        console.log(`📋 [UNSUBSCRIBE-EXCEL] Columns: ${headers.join(', ')}`);

        // Find email column
        console.log('🔍 [UNSUBSCRIBE-EXCEL] Step 2.4/5: Searching for email address...');
        const emailColumnIndex = headers.findIndex(header =>
            header && typeof header === 'string' &&
            header.toLowerCase().includes('email') &&
            !header.toLowerCase().includes('date')
        );

        if (emailColumnIndex === -1) {
            console.error(`❌ [UNSUBSCRIBE-EXCEL] Email column not found in ${leadsSheet.name}`);
            console.error(`❌ [UNSUBSCRIBE-EXCEL] Available columns: ${headers.join(', ')}`);
            return false;
        }

        console.log(`📧 [UNSUBSCRIBE-EXCEL] Email column found at index ${emailColumnIndex}: "${headers[emailColumnIndex]}"`);

        // Find target row
        let targetRowIndex = -1;
        for (let i = 0; i < rows.length; i++) {
            const rowEmail = rows[i][emailColumnIndex];
            if (rowEmail && rowEmail.toLowerCase().trim() === email.toLowerCase().trim()) {
                targetRowIndex = i + 2; // +2 for 1-based and header row
                console.log(`✅ [UNSUBSCRIBE-EXCEL] Step 2.4/5 Complete: Found lead at row ${targetRowIndex}`);
                console.log(`📍 [UNSUBSCRIBE-EXCEL] Lead data: ${JSON.stringify(rows[i].slice(0, 5))}...`);
                break;
            }
        }

        if (targetRowIndex === -1) {
            console.log(`⚠️ [UNSUBSCRIBE-EXCEL] Lead with email ${email} not found in Excel file`);
            console.log(`⚠️ [UNSUBSCRIBE-EXCEL] Searched ${rows.length} rows in column "${headers[emailColumnIndex]}"`);
            return false;
        }

        // Delete the row
        console.log('🗑️ [UNSUBSCRIBE-EXCEL] Step 2.5/5: Deleting lead row from Excel...');
        const deleteRange = `A${targetRowIndex}:ZZ${targetRowIndex}`;
        console.log(`🗑️ [UNSUBSCRIBE-EXCEL] Deleting range: ${deleteRange}`);

        await graphClient
            .api(`/me/drive/items/${fileId}/workbook/worksheets('${leadsSheet.name}')/range(address='${deleteRange}')/delete`)
            .post({
                shift: 'Up'
            });

        console.log(`✅ [UNSUBSCRIBE-EXCEL] Step 2.5/5 Complete: Row ${targetRowIndex} deleted successfully`);
        console.log(`✅ [UNSUBSCRIBE-EXCEL] Lead ${email} permanently removed from Excel file`);
        return true;

    } catch (error) {
        console.error('❌ [UNSUBSCRIBE-EXCEL] Remove lead from Excel error:', error.message);
        console.error('❌ [UNSUBSCRIBE-EXCEL] Error details:', {
            message: error.message,
            statusCode: error.statusCode,
            code: error.code
        });
        throw error;
    }
}

module.exports = router;
