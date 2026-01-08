/**
 * SharePoint Document Automation Routes
 * Handles automated PowerPoint updates from Excel placement slips
 * Uses Microsoft Graph API for file operations
 */

const express = require('express');
const multer = require('multer');
const { requireDelegatedAuth } = require('../middleware/delegatedGraphAuth');
const placementSlipParser = require('../utils/placementSlipParser');
const pptxProcessor = require('../utils/pptxProcessor');
const router = express.Router();

// Configuration
const CONFIG = {
    ROOT_FOLDER: '/CBRE-Document-Automation',
    PLACEMENT_FOLDER: '/CBRE-Document-Automation/Placement-Slips',
    TEMPLATE_FOLDER: '/CBRE-Document-Automation/Templates',
    GENERATED_FOLDER: '/CBRE-Document-Automation/Generated',
    ARCHIVE_FOLDER: '/CBRE-Document-Automation/Archive',
    TEMPLATE_FILENAME: 'CBRE Staff Communication 2025.pptx',
    WEBHOOK_CLIENT_STATE: 'cbre-document-automation-secret'
};

// Store for webhook subscriptions
const subscriptions = new Map();

// Configure multer for file uploads
const upload = multer({
    limits: { fileSize: 50 * 1024 * 1024 }, // 50MB limit for PPTX files
    fileFilter: (req, file, cb) => {
        const allowedTypes = [
            'application/vnd.openxmlformats-officedocument.presentationml.presentation',
            'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
            'application/vnd.ms-excel'
        ];
        if (allowedTypes.includes(file.mimetype)) {
            cb(null, true);
        } else {
            cb(new Error('Only PPTX and Excel files allowed'), false);
        }
    }
});

/**
 * Generate timestamped filename for output
 * @param {string} baseName - Original filename
 * @returns {string} Timestamped filename
 */
function generateTimestampedFilename(baseName) {
    const now = new Date();
    const timestamp = now.toISOString()
        .replace(/[-:]/g, '')
        .replace('T', '_')
        .replace(/\.\d+Z$/, '');
    const ext = baseName.substring(baseName.lastIndexOf('.'));
    const name = baseName.substring(0, baseName.lastIndexOf('.'));
    return `${name}_Updated_${timestamp}${ext}`;
}

/**
 * Ensure folder exists, create if not
 * @param {Object} graphClient - Microsoft Graph client
 * @param {string} folderPath - Folder path
 */
async function ensureFolderExists(graphClient, folderPath) {
    try {
        await graphClient.api(`/me/drive/root:${folderPath}`).get();
        return true;
    } catch (error) {
        if (error.statusCode === 404) {
            // Create folder
            const parentPath = folderPath.substring(0, folderPath.lastIndexOf('/'));
            const folderName = folderPath.substring(folderPath.lastIndexOf('/') + 1);

            try {
                await graphClient.api(`/me/drive/root:${parentPath}:/children`).post({
                    name: folderName,
                    folder: {},
                    '@microsoft.graph.conflictBehavior': 'fail'
                });
                console.log(`📁 Created folder: ${folderPath}`);
                return true;
            } catch (createError) {
                if (createError.code !== 'nameAlreadyExists') {
                    throw createError;
                }
                return true;
            }
        }
        throw error;
    }
}

/**
 * Get status of automation system
 */
router.get('/status', requireDelegatedAuth, async (req, res) => {
    try {
        const graphClient = await req.delegatedAuth.getGraphClient(req.sessionId);

        // Check folder structure
        const folderStatus = {};
        const folders = [
            CONFIG.PLACEMENT_FOLDER,
            CONFIG.TEMPLATE_FOLDER,
            CONFIG.GENERATED_FOLDER,
            CONFIG.ARCHIVE_FOLDER
        ];

        for (const folder of folders) {
            try {
                const result = await graphClient.api(`/me/drive/root:${folder}`).get();
                folderStatus[folder] = { exists: true, id: result.id };
            } catch (error) {
                folderStatus[folder] = { exists: false };
            }
        }

        // Check for template file
        let templateStatus = { exists: false };
        try {
            const templatePath = `${CONFIG.TEMPLATE_FOLDER}/${CONFIG.TEMPLATE_FILENAME}`;
            const result = await graphClient.api(`/me/drive/root:${templatePath}`).get();
            templateStatus = {
                exists: true,
                id: result.id,
                name: result.name,
                size: result.size,
                lastModified: result.lastModifiedDateTime
            };
        } catch (error) {
            templateStatus = { exists: false };
        }

        res.json({
            success: true,
            status: 'ready',
            config: {
                rootFolder: CONFIG.ROOT_FOLDER,
                placementFolder: CONFIG.PLACEMENT_FOLDER,
                templateFolder: CONFIG.TEMPLATE_FOLDER,
                generatedFolder: CONFIG.GENERATED_FOLDER,
                archiveFolder: CONFIG.ARCHIVE_FOLDER
            },
            folders: folderStatus,
            template: templateStatus,
            subscriptions: Array.from(subscriptions.keys())
        });

    } catch (error) {
        console.error('Status check error:', error);
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

/**
 * Initialize folder structure
 */
router.post('/initialize', requireDelegatedAuth, async (req, res) => {
    try {
        const graphClient = await req.delegatedAuth.getGraphClient(req.sessionId);

        const folders = [
            CONFIG.ROOT_FOLDER,
            CONFIG.PLACEMENT_FOLDER,
            CONFIG.TEMPLATE_FOLDER,
            CONFIG.GENERATED_FOLDER,
            CONFIG.ARCHIVE_FOLDER
        ];

        const results = [];
        for (const folder of folders) {
            try {
                await ensureFolderExists(graphClient, folder);
                results.push({ folder, status: 'ready' });
            } catch (error) {
                results.push({ folder, status: 'error', error: error.message });
            }
        }

        res.json({
            success: true,
            message: 'Folder structure initialized',
            results
        });

    } catch (error) {
        console.error('Initialize error:', error);
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

/**
 * List files in placement slips folder
 */
router.get('/check-folder', requireDelegatedAuth, async (req, res) => {
    try {
        const graphClient = await req.delegatedAuth.getGraphClient(req.sessionId);

        const result = await graphClient
            .api(`/me/drive/root:${CONFIG.PLACEMENT_FOLDER}:/children`)
            .select('id,name,size,createdDateTime,lastModifiedDateTime,file,folder')
            .orderby('lastModifiedDateTime desc')
            .get();

        // Filter for Excel files only (exclude folders)
        const excelFiles = result.value.filter(f =>
            f.file && (  // Must be a file, not a folder
                f.name.toLowerCase().endsWith('.xlsx') ||
                f.name.toLowerCase().endsWith('.xls')
            )
        );

        res.json({
            success: true,
            totalFiles: result.value.filter(f => f.file).length,
            excelFiles: excelFiles.length,
            files: excelFiles.map(f => ({
                id: f.id,
                name: f.name,
                size: f.size,
                created: f.createdDateTime,
                modified: f.lastModifiedDateTime
            }))
        });

    } catch (error) {
        console.error('Check folder error:', error);
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

/**
 * Process a specific Excel placement slip
 */
router.post('/process-slip', requireDelegatedAuth, async (req, res) => {
    try {
        const { fileId, fileName } = req.body;

        if (!fileId) {
            return res.status(400).json({
                success: false,
                error: 'fileId is required'
            });
        }

        const graphClient = await req.delegatedAuth.getGraphClient(req.sessionId);

        console.log(`📊 Processing placement slip: ${fileName || fileId}`);

        // Download Excel file
        const excelBuffer = await graphClient
            .api(`/me/drive/items/${fileId}/content`)
            .get();

        // Parse Excel and extract data
        const placementData = placementSlipParser.processPlacementSlip(excelBuffer);

        if (!placementData.success) {
            return res.status(400).json({
                success: false,
                error: 'Failed to parse placement slip'
            });
        }

        // Download template PPTX
        const templatePath = `${CONFIG.TEMPLATE_FOLDER}/${CONFIG.TEMPLATE_FILENAME}`;
        let templateBuffer;

        try {
            templateBuffer = await graphClient
                .api(`/me/drive/root:${templatePath}:/content`)
                .get();
        } catch (error) {
            return res.status(400).json({
                success: false,
                error: `Template file not found: ${CONFIG.TEMPLATE_FILENAME}`
            });
        }

        // Process PPTX with extracted data
        const pptxResult = pptxProcessor.processPPTX(templateBuffer, placementData);

        if (!pptxResult.success) {
            return res.status(500).json({
                success: false,
                error: 'Failed to process PowerPoint'
            });
        }

        // Generate output filename
        const outputFilename = generateTimestampedFilename(CONFIG.TEMPLATE_FILENAME);

        // Upload generated PPTX
        const uploadPath = `${CONFIG.GENERATED_FOLDER}/${outputFilename}`;
        const uploadResult = await graphClient
            .api(`/me/drive/root:${uploadPath}:/content`)
            .put(pptxResult.buffer);

        console.log(`✅ Uploaded generated PPTX: ${outputFilename}`);

        // Move original Excel to archive
        const archivePath = `/drive/root:${CONFIG.ARCHIVE_FOLDER}`;
        try {
            await graphClient.api(`/me/drive/items/${fileId}`).patch({
                parentReference: { path: archivePath }
            });
            console.log(`📦 Moved Excel to archive`);
        } catch (archiveError) {
            console.log(`⚠️ Could not move to archive: ${archiveError.message}`);
        }

        res.json({
            success: true,
            message: 'Placement slip processed successfully',
            input: {
                fileId,
                fileName,
                periodOfInsurance: placementData.periodOfInsurance?.formatted
            },
            output: {
                filename: outputFilename,
                fileId: uploadResult.id,
                size: pptxResult.bufferSize,
                updatedSlides: pptxResult.updatedSlides
            }
        });

    } catch (error) {
        console.error('Process slip error:', error);
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

/**
 * Manual trigger - process latest Excel file
 */
router.post('/manual-trigger', requireDelegatedAuth, async (req, res) => {
    try {
        const graphClient = await req.delegatedAuth.getGraphClient(req.sessionId);

        // Get latest Excel file from placement folder
        const result = await graphClient
            .api(`/me/drive/root:${CONFIG.PLACEMENT_FOLDER}:/children`)
            .select('id,name,size,createdDateTime,lastModifiedDateTime,file,folder')
            .orderby('lastModifiedDateTime desc')
            .get();

        // Filter for Excel files only (exclude folders)
        const excelFiles = result.value.filter(f =>
            f.file && (
                f.name.toLowerCase().endsWith('.xlsx') ||
                f.name.toLowerCase().endsWith('.xls')
            )
        );

        if (excelFiles.length === 0) {
            return res.json({
                success: false,
                message: 'No Excel files found in placement folder'
            });
        }

        // Get the latest file (already sorted by lastModifiedDateTime desc)
        const latestFile = excelFiles[0];
        console.log(`📊 Processing latest file: ${latestFile.name}`);

        // Process the file
        req.body = { fileId: latestFile.id, fileName: latestFile.name };

        // Call the process-slip logic directly
        const excelBuffer = await graphClient
            .api(`/me/drive/items/${latestFile.id}/content`)
            .get();

        const placementData = placementSlipParser.processPlacementSlip(excelBuffer);

        if (!placementData.success || !placementData.periodOfInsurance) {
            return res.json({
                success: false,
                message: 'Could not extract Period of Insurance from Excel file',
                file: latestFile.name
            });
        }

        // Download template PPTX
        const templatePath = `${CONFIG.TEMPLATE_FOLDER}/${CONFIG.TEMPLATE_FILENAME}`;
        let templateBuffer;

        try {
            templateBuffer = await graphClient
                .api(`/me/drive/root:${templatePath}:/content`)
                .get();
        } catch (error) {
            return res.status(400).json({
                success: false,
                error: `Template file not found: ${CONFIG.TEMPLATE_FILENAME}. Please upload the template first.`
            });
        }

        // Process PPTX
        const pptxResult = pptxProcessor.processPPTX(templateBuffer, placementData);

        // Upload result
        const outputFilename = generateTimestampedFilename(CONFIG.TEMPLATE_FILENAME);
        const uploadPath = `${CONFIG.GENERATED_FOLDER}/${outputFilename}`;
        const uploadResult = await graphClient
            .api(`/me/drive/root:${uploadPath}:/content`)
            .put(pptxResult.buffer);

        // Move to archive
        try {
            await graphClient.api(`/me/drive/items/${latestFile.id}`).patch({
                parentReference: { path: `/drive/root:${CONFIG.ARCHIVE_FOLDER}` }
            });
        } catch (archiveError) {
            console.log(`⚠️ Archive move failed: ${archiveError.message}`);
        }

        res.json({
            success: true,
            message: 'Document automation completed',
            input: {
                file: latestFile.name,
                periodOfInsurance: placementData.periodOfInsurance.formatted
            },
            output: {
                filename: outputFilename,
                fileId: uploadResult.id,
                updatedSlides: pptxResult.updatedSlides
            }
        });

    } catch (error) {
        console.error('Manual trigger error:', error);
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

/**
 * Upload template PowerPoint file
 */
router.post('/upload-template', requireDelegatedAuth, upload.single('template'), async (req, res) => {
    try {
        if (!req.file) {
            return res.status(400).json({
                success: false,
                error: 'No template file provided'
            });
        }

        const graphClient = await req.delegatedAuth.getGraphClient(req.sessionId);

        // Validate PPTX file
        if (!pptxProcessor.isValidPPTXBuffer(req.file.buffer)) {
            return res.status(400).json({
                success: false,
                error: 'Invalid PowerPoint file'
            });
        }

        // Ensure template folder exists
        await ensureFolderExists(graphClient, CONFIG.TEMPLATE_FOLDER);

        // Upload template
        const uploadPath = `${CONFIG.TEMPLATE_FOLDER}/${CONFIG.TEMPLATE_FILENAME}`;
        const result = await graphClient
            .api(`/me/drive/root:${uploadPath}:/content`)
            .put(req.file.buffer);

        // Get PPTX info
        const pptxInfo = pptxProcessor.getPPTXInfo(pptxProcessor.readPPTX(req.file.buffer));

        res.json({
            success: true,
            message: 'Template uploaded successfully',
            template: {
                filename: CONFIG.TEMPLATE_FILENAME,
                fileId: result.id,
                size: req.file.size,
                totalSlides: pptxInfo.totalSlides
            }
        });

    } catch (error) {
        console.error('Upload template error:', error);
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

/**
 * Get slide mappings configuration
 */
router.get('/mappings', (req, res) => {
    res.json({
        success: true,
        phase: 1,
        mappings: [
            {
                slide: 1,
                name: 'Title & Period of Insurance',
                source: {
                    sheet: 'GTL (first sheet)',
                    row: 9,
                    column: 'B',
                    field: 'Period of Insurance'
                },
                target: {
                    shape: 'Shape 20 (PLACEHOLDER)',
                    text: 'Period of Insurance: [date range]'
                },
                status: 'active'
            }
        ],
        futureMappings: [
            { slide: '6-7', name: 'Insurance Overview', status: 'phase-2' },
            { slide: '8-11', name: 'GTL, GDD, GPA Details', status: 'phase-3' },
            { slide: '12-23', name: 'GHS Details', status: 'phase-4' },
            { slide: '19-21', name: 'GMM Details', status: 'phase-5' },
            { slide: '24-30', name: 'GP/SP Details', status: 'phase-6' },
            { slide: '31-35', name: 'Dental Details', status: 'phase-7' }
        ]
    });
});

/**
 * List generated files
 */
router.get('/generated-files', requireDelegatedAuth, async (req, res) => {
    try {
        const graphClient = await req.delegatedAuth.getGraphClient(req.sessionId);

        const result = await graphClient
            .api(`/me/drive/root:${CONFIG.GENERATED_FOLDER}:/children`)
            .select('id,name,size,createdDateTime,lastModifiedDateTime,webUrl')
            .orderby('lastModifiedDateTime desc')
            .get();

        res.json({
            success: true,
            files: result.value.map(f => ({
                id: f.id,
                name: f.name,
                size: f.size,
                created: f.createdDateTime,
                modified: f.lastModifiedDateTime,
                webUrl: f.webUrl
            }))
        });

    } catch (error) {
        console.error('List generated files error:', error);
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

/**
 * Webhook endpoint for Graph notifications
 */
router.post('/webhook', async (req, res) => {
    // Validation request from Microsoft Graph
    if (req.query.validationToken) {
        console.log('📨 Webhook validation request received');
        res.set('Content-Type', 'text/plain');
        return res.send(req.query.validationToken);
    }

    // Notification request
    console.log('📨 Webhook notification received');

    const { value: notifications } = req.body;

    if (!notifications || !Array.isArray(notifications)) {
        return res.status(200).send('OK');
    }

    for (const notification of notifications) {
        // Validate client state
        if (notification.clientState !== CONFIG.WEBHOOK_CLIENT_STATE) {
            console.log('⚠️ Invalid webhook client state');
            continue;
        }

        console.log(`📝 Notification: ${notification.changeType} on ${notification.resource}`);

        // Queue the processing (don't block the webhook response)
        if (notification.changeType === 'created' || notification.changeType === 'updated') {
            setImmediate(async () => {
                try {
                    // Processing would happen here with stored auth
                    console.log(`🔄 Processing webhook notification for: ${notification.resource}`);
                } catch (error) {
                    console.error('Webhook processing error:', error);
                }
            });
        }
    }

    res.status(200).send('OK');
});

/**
 * Create webhook subscription
 */
router.post('/subscribe-webhook', requireDelegatedAuth, async (req, res) => {
    try {
        const graphClient = await req.delegatedAuth.getGraphClient(req.sessionId);
        const { notificationUrl } = req.body;

        if (!notificationUrl) {
            return res.status(400).json({
                success: false,
                error: 'notificationUrl is required'
            });
        }

        // Calculate expiration (max 3 days for drive items)
        const expirationDateTime = new Date();
        expirationDateTime.setDate(expirationDateTime.getDate() + 3);

        const subscription = await graphClient.api('/subscriptions').post({
            changeType: 'created,updated',
            notificationUrl: notificationUrl,
            resource: `/me/drive/root:${CONFIG.PLACEMENT_FOLDER}:/children`,
            expirationDateTime: expirationDateTime.toISOString(),
            clientState: CONFIG.WEBHOOK_CLIENT_STATE
        });

        subscriptions.set(subscription.id, subscription);

        res.json({
            success: true,
            subscription: {
                id: subscription.id,
                resource: subscription.resource,
                expirationDateTime: subscription.expirationDateTime
            }
        });

    } catch (error) {
        console.error('Subscribe webhook error:', error);
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

/**
 * Preview extraction from a local file (for testing)
 */
router.post('/preview-extraction', upload.single('excelFile'), async (req, res) => {
    try {
        if (!req.file) {
            return res.status(400).json({
                success: false,
                error: 'No Excel file provided'
            });
        }

        const placementData = placementSlipParser.processPlacementSlip(req.file.buffer);

        res.json({
            success: true,
            filename: req.file.originalname,
            extraction: {
                periodOfInsurance: placementData.periodOfInsurance,
                sheets: placementData.sheets,
                slide1Data: placementData.slide1Data
            }
        });

    } catch (error) {
        console.error('Preview extraction error:', error);
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

/**
 * Test PPTX inspection
 */
router.post('/inspect-pptx', upload.single('pptxFile'), async (req, res) => {
    try {
        if (!req.file) {
            return res.status(400).json({
                success: false,
                error: 'No PPTX file provided'
            });
        }

        const zip = pptxProcessor.readPPTX(req.file.buffer);
        const info = pptxProcessor.getPPTXInfo(zip);

        // Inspect slide 1
        const slide1Info = pptxProcessor.inspectSlide(req.file.buffer, 1);

        res.json({
            success: true,
            filename: req.file.originalname,
            pptxInfo: info,
            slide1: {
                textElements: slide1Info.textElements,
                containsPeriodOfInsurance: slide1Info.containsPeriodOfInsurance
            }
        });

    } catch (error) {
        console.error('Inspect PPTX error:', error);
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

module.exports = router;
