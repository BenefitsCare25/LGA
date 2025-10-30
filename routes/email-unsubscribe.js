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
        let { email, token, source } = req.query;

        console.log('═══════════════════════════════════════════════════════════════');
        console.log(`📧 [UNSUBSCRIBE] Request received at ${new Date().toISOString()}`);
        console.log(`📧 [UNSUBSCRIBE] Source: ${source || 'unknown'} (header=List-Unsubscribe button, html=HTML link, unknown=legacy/direct)`);
        console.log(`📧 [UNSUBSCRIBE] Token present: ${token ? 'Yes' : 'No'}, Email param: ${email || 'N/A'}`);

        // JWT Token-based unsubscribe (secure, URL-safe, resilient to gateway rewriting)
        if (token) {
            console.log(`🔍 [UNSUBSCRIBE] JWT token received (length: ${token.length})`);
            console.log(`🔍 [UNSUBSCRIBE] First 50 chars: ${token.substring(0, 50)}...`);
            console.log(`🔍 [UNSUBSCRIBE] Last 30 chars: ...${token.substring(token.length - 30)}`);

            // Diagnostic: Check if token has been corrupted by email gateway
            const isValidJWTFormat = token.split('.').length === 3;
            const startsWithExpectedJWT = token.startsWith('eyJ'); // All JWTs start with 'eyJ' (base64url of {"alg":...)

            if (!isValidJWTFormat) {
                console.warn(`⚠️  [UNSUBSCRIBE-DIAGNOSTIC] Token does NOT have 3 parts (header.payload.signature)`);
                console.warn(`⚠️  [UNSUBSCRIBE-DIAGNOSTIC] Parts count: ${token.split('.').length}`);
            }

            if (!startsWithExpectedJWT) {
                console.warn(`⚠️  [UNSUBSCRIBE-DIAGNOSTIC] Token does NOT start with 'eyJ' (expected for all JWTs)`);
                console.warn(`⚠️  [UNSUBSCRIBE-DIAGNOSTIC] Actual start: ${token.substring(0, 10)}`);
                console.warn(`🚨 [UNSUBSCRIBE-DIAGNOSTIC] ALERT: Token appears to be CORRUPTED by email security gateway!`);
                console.warn(`🚨 [UNSUBSCRIBE-DIAGNOSTIC] Character transformation detected (possible ROT13-style cipher)`);
                console.warn(`💡 [UNSUBSCRIBE-DIAGNOSTIC] Recommendation: Implement database-backed proxy ID system`);
            }

            const { verifyUnsubscribeToken } = require('../utils/jwtUnsubscribeManager');

            // Verify JWT token (handles URL decoding internally if needed)
            let tokenData = verifyUnsubscribeToken(token);

            // If verification fails, try URL-decoding first (in case of double encoding)
            if (!tokenData && token.includes('%')) {
                console.log(`🔍 [UNSUBSCRIBE] First attempt failed, trying URL decode...`);
                try {
                    const decodedToken = decodeURIComponent(token);
                    tokenData = verifyUnsubscribeToken(decodedToken);
                } catch (decodeError) {
                    console.error(`❌ [UNSUBSCRIBE] URL decode failed: ${decodeError.message}`);
                }
            }

            if (!tokenData) {
                console.error(`❌ [UNSUBSCRIBE] Invalid or expired JWT token`);
                return res.status(400).send(`
                    <!DOCTYPE html>
                    <html>
                    <head>
                        <title>Invalid Unsubscribe Link</title>
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
                            <h1 class="error">⚠️ Invalid or Expired Unsubscribe Link</h1>
                            <p>This unsubscribe link is invalid or has expired (links expire after 30 days).</p>
                            <p>If you continue to receive emails, please contact us directly at BenefitsCare@inspro.com.sg</p>
                        </div>
                    </body>
                    </html>
                `);
            }

            // Extract email and campaignId from verified token
            email = tokenData.email;
            const campaignId = tokenData.campaignId;

            console.log(`✅ [UNSUBSCRIBE] Token verified successfully`);
            console.log(`📧 [UNSUBSCRIBE] Email: ${email}`);
            if (campaignId) {
                console.log(`📋 [UNSUBSCRIBE] Campaign: ${campaignId}`);
            }
            console.log(`📅 [UNSUBSCRIBE] Token issued: ${tokenData.issuedAt.toISOString()}`);
            console.log(`📅 [UNSUBSCRIBE] Token expires: ${tokenData.expiresAt.toISOString()}`);
        }
        // OLD: Email-based unsubscribe (for backwards compatibility with old emails)
        else if (!email) {
            console.error('❌ [UNSUBSCRIBE] No token or email provided in request');
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
                        <p>No email address or token was provided in the unsubscribe link.</p>
                        <p>If you continue to receive emails, please contact us directly at BenefitsCare@inspro.com.sg</p>
                    </div>
                </body>
                </html>
            `);
        }

        // Comprehensive email sanitization

        // Remove all whitespace (including non-breaking spaces, zero-width spaces, etc.)
        email = email.replace(/\s+/g, '');

        // Normalize Unicode characters
        email = email.normalize('NFKC');

        // Convert to lowercase
        email = email.toLowerCase();

        // Remove any invisible characters (zero-width, control characters)
        email = email.replace(/[\u200B-\u200D\uFEFF\u0000-\u001F\u007F-\u009F]/g, '');

        // Extract email if it's in format "Name <email@domain.com>"
        const emailMatch = email.match(/<([^>]+)>$/);
        if (emailMatch) {
            email = emailMatch[1];
        }

        // Final validation
        const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
        if (!emailRegex.test(email)) {
            console.error(`❌ [UNSUBSCRIBE] Invalid email format after sanitization: "${email}"`);
            return res.status(400).send(`
                <!DOCTYPE html>
                <html>
                <head>
                    <title>Invalid Email Address</title>
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
                        <h1 class="error">Invalid Email Address</h1>
                        <p>The email address in the unsubscribe link is not valid.</p>
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

        // Find target row
        console.log(`🔍 [UNSUBSCRIBE-EXCEL] Searching ${rows.length} rows for matching email...`);
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

        // Delete the row using Table API (Excel data is in a Table structure)
        console.log('🗑️ [UNSUBSCRIBE-EXCEL] Step 2.5/5: Deleting lead row from Excel table...');

        // Instead of deleting (which causes table issues), mark as "Unsubscribed"
        console.log(`🔄 [UNSUBSCRIBE-EXCEL] Marking lead as "Unsubscribed" in Excel...`);

        // Update the Email_Bounce column to "Unsubscribed"
        const emailBounceColumnIndex = headers.findIndex(h =>
            h && typeof h === 'string' && h.toLowerCase().replace(/[\s_]/g, '') === 'emailbounce'
        );

        if (emailBounceColumnIndex !== -1) {
            const emailBounceCell = `${getExcelColumnLetter(emailBounceColumnIndex)}${targetRowIndex}`;
            await graphClient
                .api(`/me/drive/items/${fileId}/workbook/worksheets('${leadsSheet.name}')/range(address='${emailBounceCell}')`)
                .patch({
                    values: [['Unsubscribed']]
                });
            console.log(`✅ [UNSUBSCRIBE-EXCEL] Updated Email_Bounce to "Unsubscribed" at ${emailBounceCell}`);
        }

        // Update Last Updated column
        const lastUpdatedIndex = headers.findIndex(h =>
            h && typeof h === 'string' && h.toLowerCase().replace(/[\s_]/g, '') === 'lastupdated'
        );

        if (lastUpdatedIndex !== -1) {
            const lastUpdatedCell = `${getExcelColumnLetter(lastUpdatedIndex)}${targetRowIndex}`;
            await graphClient
                .api(`/me/drive/items/${fileId}/workbook/worksheets('${leadsSheet.name}')/range(address='${lastUpdatedCell}')`)
                .patch({
                    values: [[new Date().toLocaleString('en-US', {
                        month: 'short',
                        day: 'numeric',
                        year: 'numeric',
                        hour: 'numeric',
                        minute: 'numeric',
                        hour12: true
                    })]]
                });
            console.log(`✅ [UNSUBSCRIBE-EXCEL] Updated Last Updated timestamp at ${lastUpdatedCell}`);
        }

        console.log(`✅ [UNSUBSCRIBE-EXCEL] Step 2.5/5 Complete: Lead ${email} marked as "Unsubscribed"`);
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
