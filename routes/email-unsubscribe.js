/**
 * Email Unsubscribe Routes
 * Handles unsubscribe requests and removes leads from Excel master list
 */

const express = require('express');
const { Client } = require('@microsoft/microsoft-graph-client');
const { getLeadsViaGraphAPI, getExcelColumnLetter } = require('../utils/excelGraphAPI');
const router = express.Router();

/**
 * Get application-level Graph client (not user-delegated)
 * This allows unsubscribe to work without user authentication
 */
async function getApplicationGraphClient() {
    const { ClientSecretCredential } = require('@azure/identity');
    const { Client } = require('@microsoft/microsoft-graph-client');
    const { TokenCredentialAuthenticationProvider } = require('@microsoft/microsoft-graph-client/authProviders/azureTokenCredentials');

    const credential = new ClientSecretCredential(
        process.env.AZURE_TENANT_ID,
        process.env.AZURE_CLIENT_ID,
        process.env.AZURE_CLIENT_SECRET
    );

    const authProvider = new TokenCredentialAuthenticationProvider(credential, {
        scopes: ['https://graph.microsoft.com/.default']
    });

    return Client.initWithMiddleware({ authProvider });
}

/**
 * Handle unsubscribe request - removes lead from Excel file
 * GET /api/email/unsubscribe?email=recipient@example.com
 */
router.get('/unsubscribe', async (req, res) => {
    try {
        const { email } = req.query;

        if (!email) {
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

        console.log(`📧 Unsubscribe request received for: ${email}`);

        // For unsubscribe, we need to use application authentication, not delegated
        // We'll create a separate endpoint that processes this asynchronously
        // For now, render a confirmation page and log the request

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
                                document.getElementById('content').innerHTML = \`
                                    <h1 class="success">✓ Successfully Unsubscribed</h1>
                                    <p>You have been removed from our mailing list.</p>
                                    <div class="email">${email}</div>
                                    <p>You will no longer receive emails from us.</p>
                                    <p class="info">If you unsubscribed by mistake, please contact us at BenefitsCare@inspro.com.sg</p>
                                \`;
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
        console.error('❌ Unsubscribe page error:', error.message);
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
 * No authentication required - uses application-level credentials
 */
router.post('/unsubscribe/confirm', async (req, res) => {
    try {
        const { email } = req.query;

        if (!email) {
            return res.status(400).json({
                success: false,
                message: 'Email address is required'
            });
        }

        console.log(`🗑️ Processing unsubscribe confirmation for: ${email}`);

        // Get application-level Graph client (no user auth required)
        const graphClient = await getApplicationGraphClient();

        // Remove lead from Excel file
        const removed = await removeLeadFromExcel(graphClient, email);

        if (removed) {
            console.log(`✅ Successfully removed ${email} from mailing list`);
            res.json({
                success: true,
                message: 'Successfully unsubscribed',
                email: email
            });
        } else {
            console.log(`⚠️ Email ${email} not found in mailing list (may already be unsubscribed)`);
            res.json({
                success: true,
                message: 'Email address not found in our records (may already be unsubscribed)',
                email: email
            });
        }

    } catch (error) {
        console.error('❌ Unsubscribe confirmation error:', error.message);
        res.status(500).json({
            success: false,
            message: 'Failed to process unsubscribe request',
            error: error.message
        });
    }
});

/**
 * Remove lead from Excel master file via Graph API
 * @param {object} graphClient - Microsoft Graph client (application-level)
 * @param {string} email - Email address to remove
 * @returns {Promise<boolean>} True if removed, false if not found
 */
async function removeLeadFromExcel(graphClient, email) {
    try {
        const masterFileName = 'LGA-Master-Email-List.xlsx';
        const masterFolderPath = '/LGA-Email-Automation';

        // Get the user's email from environment variable (the account that owns the OneDrive)
        const oneDriveUserEmail = process.env.ONEDRIVE_USER_EMAIL || 'benefitscare@inspro.com.sg';

        console.log(`🔍 Searching for ${email} in Excel file (using application auth for user: ${oneDriveUserEmail})...`);

        // Get the Excel file ID using application-level access to specific user's OneDrive
        const files = await graphClient
            .api(`/users/${oneDriveUserEmail}/drive/root:${masterFolderPath}:/children`)
            .filter(`name eq '${masterFileName}'`)
            .get();

        if (files.value.length === 0) {
            console.log(`❌ Master file not found: ${masterFileName}`);
            return false;
        }

        const fileId = files.value[0].id;

        // Get worksheets to find the Leads sheet (using user's drive path)
        const worksheets = await graphClient
            .api(`/users/${oneDriveUserEmail}/drive/items/${fileId}/workbook/worksheets`)
            .get();

        const leadsSheet = worksheets.value.find(sheet =>
            sheet.name === 'Leads' || sheet.name.toLowerCase().includes('lead')
        ) || worksheets.value[0];

        if (!leadsSheet) {
            console.log(`❌ No leads worksheet found in ${masterFileName}`);
            return false;
        }

        // Get worksheet data to find the email
        const usedRange = await graphClient
            .api(`/users/${oneDriveUserEmail}/drive/items/${fileId}/workbook/worksheets('${leadsSheet.name}')/usedRange`)
            .get();

        if (!usedRange || !usedRange.values || usedRange.values.length <= 1) {
            console.log(`❌ No data found in worksheet ${leadsSheet.name}`);
            return false;
        }

        const headers = usedRange.values[0];
        const rows = usedRange.values.slice(1);

        // Find email column
        const emailColumnIndex = headers.findIndex(header =>
            header && typeof header === 'string' &&
            header.toLowerCase().includes('email') &&
            !header.toLowerCase().includes('date')
        );

        if (emailColumnIndex === -1) {
            console.log(`❌ Email column not found in ${leadsSheet.name}`);
            return false;
        }

        // Find target row
        let targetRowIndex = -1;
        for (let i = 0; i < rows.length; i++) {
            const rowEmail = rows[i][emailColumnIndex];
            if (rowEmail && rowEmail.toLowerCase().trim() === email.toLowerCase().trim()) {
                targetRowIndex = i + 2; // +2 for 1-based and header row
                console.log(`📍 Found lead at row ${targetRowIndex}`);
                break;
            }
        }

        if (targetRowIndex === -1) {
            console.log(`❌ Lead with email ${email} not found in Excel file`);
            return false;
        }

        // Delete the row (using user's drive path)
        // Use cell range notation (e.g., A1125:ZZ1125) to delete entire row
        const deleteRange = `A${targetRowIndex}:ZZ${targetRowIndex}`;
        await graphClient
            .api(`/users/${oneDriveUserEmail}/drive/items/${fileId}/workbook/worksheets('${leadsSheet.name}')/range(address='${deleteRange}')/delete`)
            .post({
                shift: 'Up'
            });

        console.log(`✅ Deleted row ${targetRowIndex} for ${email}`);
        return true;

    } catch (error) {
        console.error('❌ Remove lead from Excel error:', error.message);
        throw error;
    }
}

module.exports = router;
