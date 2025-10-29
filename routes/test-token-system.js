/**
 * Diagnostic endpoint to test unsubscribe token system
 * Tests if UNSUBSCRIBE_SECRET_KEY is loaded and tokens work correctly
 */

const express = require('express');
const router = express.Router();

/**
 * Test token generation and decryption in real-time
 * GET /api/test-token-system
 */
router.get('/test-token-system', async (req, res) => {
    const results = {
        timestamp: new Date().toISOString(),
        environment: process.env.NODE_ENV || 'unknown',
        tests: []
    };

    // Test 1: Check if UNSUBSCRIBE_SECRET_KEY is set
    results.tests.push({
        test: 'Environment Variable Check',
        passed: !!process.env.UNSUBSCRIBE_SECRET_KEY,
        details: {
            isSet: !!process.env.UNSUBSCRIBE_SECRET_KEY,
            length: process.env.UNSUBSCRIBE_SECRET_KEY ? process.env.UNSUBSCRIBE_SECRET_KEY.length : 0,
            first16: process.env.UNSUBSCRIBE_SECRET_KEY ? process.env.UNSUBSCRIBE_SECRET_KEY.substring(0, 16) + '...' : 'NOT SET',
            last16: process.env.UNSUBSCRIBE_SECRET_KEY ? '...' + process.env.UNSUBSCRIBE_SECRET_KEY.substring(process.env.UNSUBSCRIBE_SECRET_KEY.length - 16) : 'NOT SET'
        }
    });

    if (!process.env.UNSUBSCRIBE_SECRET_KEY) {
        results.summary = 'CRITICAL: UNSUBSCRIBE_SECRET_KEY not loaded from environment';
        return res.json(results);
    }

    // Test 2: Check key format
    try {
        const keyBuffer = Buffer.from(process.env.UNSUBSCRIBE_SECRET_KEY, 'hex');
        const keyValid = keyBuffer.length === 32;

        results.tests.push({
            test: 'Key Format Validation',
            passed: keyValid,
            details: {
                bufferLength: keyBuffer.length,
                expectedLength: 32,
                isValidHex: true
            }
        });

        if (!keyValid) {
            results.summary = 'ERROR: Key has invalid length';
            return res.json(results);
        }
    } catch (error) {
        results.tests.push({
            test: 'Key Format Validation',
            passed: false,
            error: error.message
        });
        results.summary = 'ERROR: Key is not valid hex';
        return res.json(results);
    }

    // Test 3: Generate and decrypt token
    try {
        const tokenManager = require('../utils/unsubscribeTokenManager');
        const testEmail = 'diagnostic-test@example.com';

        // Generate token
        const token = tokenManager.generateToken(testEmail);

        results.tests.push({
            test: 'Token Generation',
            passed: true,
            details: {
                inputEmail: testEmail,
                tokenLength: token.length,
                tokenParts: token.split('.').length,
                token: token
            }
        });

        // Immediately decrypt the same token
        const decryptedEmail = tokenManager.getEmailFromToken(token);

        const decryptionSuccess = decryptedEmail === testEmail;

        results.tests.push({
            test: 'Token Decryption (Immediate)',
            passed: decryptionSuccess,
            details: {
                originalEmail: testEmail,
                decryptedEmail: decryptedEmail,
                match: decryptionSuccess
            }
        });

        if (!decryptionSuccess) {
            results.summary = 'CRITICAL: Token decryption failed immediately after generation!';
            results.conclusion = 'Key mismatch or encryption/decryption logic error';
            return res.json(results);
        }

    } catch (error) {
        results.tests.push({
            test: 'Token Generation/Decryption',
            passed: false,
            error: error.message,
            stack: error.stack
        });
        results.summary = 'ERROR: Token system failed';
        return res.json(results);
    }

    // Test 4: Test the actual problematic token from logs (if provided)
    const problematicToken = req.query.token;
    if (problematicToken) {
        try {
            const tokenManager = require('../utils/unsubscribeTokenManager');
            const decryptedEmail = tokenManager.getEmailFromToken(problematicToken);

            results.tests.push({
                test: 'Problematic Token from Query',
                passed: !!decryptedEmail,
                details: {
                    token: problematicToken,
                    tokenLength: problematicToken.length,
                    decryptedEmail: decryptedEmail,
                    conclusion: decryptedEmail ? 'Token is valid with current key' : 'Token was created with different key'
                }
            });
        } catch (error) {
            results.tests.push({
                test: 'Problematic Token from Query',
                passed: false,
                error: error.message
            });
        }
    }

    // All tests passed
    results.summary = 'SUCCESS: All token system tests passed';
    results.conclusion = 'Token system is working correctly with current environment';

    res.json(results);
});

module.exports = router;
