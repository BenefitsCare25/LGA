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
 * Handle unsubscribe request - removes lead from Excel file immediately (one-click unsubscribe)
 * GET /api/email/unsubscribe?email=recipient@example.com
 */
router.get('/unsubscribe', async (req, res) => {
    const startTime = Date.now();

    try {
        const { email } = req.query;

        console.log('═══════════════════════════════════════════════════════════════');
        console.log('📧 [UNSUBSCRIBE] New unsubscribe request received');
        console.log(`📧 [UNSUBSCRIBE] Timestamp: ${new Date().toISOString()}`);
        console.log(`📧 [UNSUBSCRIBE] Email address: ${email}`);

        if (!email) {
            console.error('❌ [UNSUBSCRIBE] No email address provided in request');
            return res.status(400).send(`
                <!DOCTYPE html>
                <html>
                <head>
                    <title>Invalid Unsubscribe Request</title>
                    <meta charset="UTF-8">
                    <meta name="viewport" content="width=device-width, initial-scale=1.0">
                    <style>
                        body { font-family: Arial, sans-serif; max-width: 600px; margin: 50px auto; padding: 20px; text-align: center; background-color: #f8f9fa; }
                        .container { background: white; padding: 40px; border-radius: 8px; box-shadow: 0 2px 10px rgba(0,0,0,0.1); }
                        .error { color: #dc3545; }
                    </style>
                </head>
                <body>
                    <div class="container">
                        <h1 class="error">Invalid Unsubscribe Request</h1>
                        <p>No email address was provided in the unsubscribe link.</p>
                        <p>If you continue to receive emails, please contact us directly at BenefitsCare@inspro.com.sg</p>
                    </div>
                </body>
                </html>
            `);
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

            // Success page
            return res.send(`
                <!DOCTYPE html>
                <html>
                <head>
                    <title>Successfully Unsubscribed</title>
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
                        .info {
                            color: #666;
                            font-size: 14px;
                            margin-top: 20px;
                        }
                    </style>
                </head>
                <body>
                    <div class="container">
                        <h1 class="success">✓ Successfully Unsubscribed</h1>
                        <p>You have been removed from our mailing list.</p>
                        <div class="email">${email}</div>
                        <p>You will no longer receive emails from us.</p>
                        <p class="info">If you unsubscribed by mistake, please contact us at BenefitsCare@inspro.com.sg</p>
                    </div>
                </body>
                </html>
            `);
        } else {
            console.log(`⚠️ [UNSUBSCRIBE] Email ${email} not found in mailing list`);
            console.log(`⚠️ [UNSUBSCRIBE] Possible reasons: already unsubscribed or never subscribed`);
            console.log(`⏱️ [UNSUBSCRIBE] Processing time: ${processingTime}ms`);
            console.log('═══════════════════════════════════════════════════════════════');

            // Not found page (still treat as success to avoid information disclosure)
            return res.send(`
                <!DOCTYPE html>
                <html>
                <head>
                    <title>Unsubscribed</title>
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
                        .info {
                            color: #666;
                            font-size: 14px;
                            margin-top: 20px;
                        }
                    </style>
                </head>
                <body>
                    <div class="container">
                        <h1 class="success">✓ Unsubscribed</h1>
                        <p>Your email address is not in our mailing list.</p>
                        <div class="email">${email}</div>
                        <p>You may have already unsubscribed or were never subscribed.</p>
                        <p class="info">If you continue to receive emails, please contact us at BenefitsCare@inspro.com.sg</p>
                    </div>
                </body>
                </html>
            `);
        }

    } catch (error) {
        const processingTime = Date.now() - startTime;

        console.error('❌ [UNSUBSCRIBE] FAILED: Unsubscribe error');
        console.error(`❌ [UNSUBSCRIBE] Error: ${error.message}`);
        console.error(`❌ [UNSUBSCRIBE] Stack trace:`, error.stack);
        console.error(`⏱️ [UNSUBSCRIBE] Failed after: ${processingTime}ms`);
        console.log('═══════════════════════════════════════════════════════════════');

        res.status(500).send(`
            <!DOCTYPE html>
            <html>
            <head>
                <title>Error - Unsubscribe</title>
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
                    .error { color: #dc3545; }
                    .info {
                        color: #666;
                        font-size: 14px;
                        margin-top: 20px;
                    }
                </style>
            </head>
            <body>
                <div class="container">
                    <h1 class="error">An Error Occurred</h1>
                    <p>We encountered an error processing your unsubscribe request.</p>
                    <p class="info">Please try again later, or contact us directly at BenefitsCare@inspro.com.sg</p>
                </div>
            </body>
            </html>
        `);
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
        console.log(`🔍 [UNSUBSCRIBE-EXCEL] Target email (normalized): "${email.toLowerCase().trim()}"`);
        console.log(`🔍 [UNSUBSCRIBE-EXCEL] Target email length: ${email.toLowerCase().trim().length} characters`);

        // Show first 5 emails from Excel for debugging
        console.log('📋 [UNSUBSCRIBE-EXCEL] Sample emails from Excel (first 5 rows):');
        for (let i = 0; i < Math.min(5, rows.length); i++) {
            const sampleEmail = rows[i][emailColumnIndex];
            if (sampleEmail) {
                console.log(`   ${i + 1}. "${sampleEmail}" (normalized: "${sampleEmail.toLowerCase().trim()}")`);
            }
        }

        // Find target row
        let targetRowIndex = -1;
        let checkedCount = 0;
        for (let i = 0; i < rows.length; i++) {
            const rowEmail = rows[i][emailColumnIndex];
            if (rowEmail) {
                checkedCount++;
                const normalizedRowEmail = rowEmail.toLowerCase().trim();
                const normalizedSearchEmail = email.toLowerCase().trim();

                if (normalizedRowEmail === normalizedSearchEmail) {
                    targetRowIndex = i + 2; // +2 for 1-based and header row
                    console.log(`✅ [UNSUBSCRIBE-EXCEL] Step 2.4/5 Complete: Found lead at row ${targetRowIndex}`);
                    console.log(`📍 [UNSUBSCRIBE-EXCEL] Matched email: "${rowEmail}" → "${normalizedRowEmail}"`);
                    console.log(`📍 [UNSUBSCRIBE-EXCEL] Lead data: ${JSON.stringify(rows[i].slice(0, 5))}...`);
                    break;
                }
            }
        }

        if (targetRowIndex === -1) {
            console.log(`⚠️ [UNSUBSCRIBE-EXCEL] Lead with email ${email} not found in Excel file`);
            console.log(`⚠️ [UNSUBSCRIBE-EXCEL] Searched ${rows.length} total rows, ${checkedCount} had email values`);
            console.log(`⚠️ [UNSUBSCRIBE-EXCEL] Column searched: "${headers[emailColumnIndex]}" at index ${emailColumnIndex}`);

            // Check for partial matches (for debugging)
            const partialMatches = rows.filter((row, idx) => {
                const rowEmail = row[emailColumnIndex];
                return rowEmail && rowEmail.toLowerCase().includes(email.toLowerCase().substring(0, 10));
            });

            if (partialMatches.length > 0) {
                console.log(`🔍 [UNSUBSCRIBE-EXCEL] Found ${partialMatches.length} partial match(es) (similar emails):`);
                partialMatches.slice(0, 3).forEach((row, idx) => {
                    console.log(`   ${idx + 1}. "${row[emailColumnIndex]}"`);
                });
            } else {
                console.log(`🔍 [UNSUBSCRIBE-EXCEL] No partial matches found for "${email.substring(0, 20)}..."`);
            }

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
