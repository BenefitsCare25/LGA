/**
 * Domain Duplicate Checker API Route
 * Compares domains from local Excel file with OneDrive master file
 */

const express = require('express');
const router = express.Router();
const multer = require('multer');
const DomainDuplicateChecker = require('../utils/domainDuplicateChecker');
const { requireDelegatedAuth, getDelegatedAuthProvider } = require('../middleware/delegatedGraphAuth');

// Configure multer for file uploads (in-memory)
const upload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: 10 * 1024 * 1024 } // 10MB limit
});

/**
 * POST /api/domain-check/compare
 * Upload local Excel file and compare domains with OneDrive
 */
router.post('/compare', requireDelegatedAuth, upload.single('domainFile'), async (req, res) => {
    try {
        console.log('🔍 Domain duplicate check request received');

        // Validate file upload
        if (!req.file) {
            return res.status(400).json({
                success: false,
                message: 'No file uploaded. Please upload an Excel file.'
            });
        }

        console.log(`📂 File uploaded: ${req.file.originalname} (${(req.file.size / 1024).toFixed(2)} KB)`);

        // Get Microsoft Graph client using session authentication
        const graphClient = await req.delegatedAuth.getGraphClient(req.sessionId);

        if (!graphClient) {
            return res.status(401).json({
                success: false,
                message: 'Authentication required. Please authenticate with Microsoft Graph.'
            });
        }

        // Create temp file for processing
        const fs = require('fs');
        const path = require('path');
        const tempFilePath = path.join(__dirname, '..', 'temp', `domain-check-${Date.now()}.xlsx`);

        // Ensure temp directory exists
        const tempDir = path.join(__dirname, '..', 'temp');
        if (!fs.existsSync(tempDir)) {
            fs.mkdirSync(tempDir, { recursive: true });
        }

        // Write uploaded file to temp location
        fs.writeFileSync(tempFilePath, req.file.buffer);

        // Run domain duplicate checker
        const checker = new DomainDuplicateChecker();
        const report = await checker.generateDuplicateReport(tempFilePath, graphClient);

        // Clean up temp file
        fs.unlinkSync(tempFilePath);

        console.log('✅ Domain duplicate check completed successfully');

        res.json({
            success: true,
            message: `Found ${report.duplicateCount} duplicate domains`,
            report: report
        });

    } catch (error) {
        console.error('❌ Domain duplicate check error:', error);

        res.status(500).json({
            success: false,
            message: 'Failed to check domain duplicates',
            error: error.message
        });
    }
});

/**
 * POST /api/domain-check/check-local-file
 * Check a specific local file path for domain duplicates
 */
router.post('/check-local-file', requireDelegatedAuth, async (req, res) => {
    try {
        const { filePath } = req.body;

        if (!filePath) {
            return res.status(400).json({
                success: false,
                message: 'File path is required'
            });
        }

        console.log(`🔍 Checking local file: ${filePath}`);

        // Validate file exists
        const fs = require('fs');
        if (!fs.existsSync(filePath)) {
            return res.status(404).json({
                success: false,
                message: `File not found: ${filePath}`
            });
        }

        // Get Microsoft Graph client using session authentication
        const graphClient = await req.delegatedAuth.getGraphClient(req.sessionId);

        if (!graphClient) {
            return res.status(401).json({
                success: false,
                message: 'Authentication required. Please authenticate with Microsoft Graph.'
            });
        }

        // Run domain duplicate checker
        const checker = new DomainDuplicateChecker();
        const report = await checker.generateDuplicateReport(filePath, graphClient);

        console.log('✅ Domain duplicate check completed successfully');

        res.json({
            success: true,
            message: `Found ${report.duplicateCount} duplicate domains`,
            report: report
        });

    } catch (error) {
        console.error('❌ Domain duplicate check error:', error);

        res.status(500).json({
            success: false,
            message: 'Failed to check domain duplicates',
            error: error.message
        });
    }
});

/**
 * GET /api/domain-check/test
 * Test endpoint to verify domain checker is working
 */
router.get('/test', (req, res) => {
    res.json({
        success: true,
        message: 'Domain duplicate checker API is running',
        endpoints: {
            compare: 'POST /api/domain-check/compare - Upload Excel file to compare',
            checkLocalFile: 'POST /api/domain-check/check-local-file - Check specific file path'
        }
    });
});

module.exports = router;
