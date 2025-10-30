/**
 * JWT-based Unsubscribe Token Manager
 *
 * This module provides URL-safe, stateless unsubscribe tokens using JWT.
 * Tokens are resilient to corporate email gateway modifications because:
 * 1. JWT uses base64url encoding (only A-Z, a-z, 0-9, -, _)
 * 2. No special characters that get rewritten by security tools
 * 3. Signed (not encrypted) so transparent to gateways
 * 4. Built-in expiration handling
 */

const jwt = require('jsonwebtoken');

/**
 * Get JWT secret from environment with validation
 */
function getJwtSecret() {
    const secret = process.env.JWT_SECRET;

    if (!secret) {
        console.error('[JWT] ❌ JWT_SECRET environment variable not set!');
        console.error('[JWT] Generate one with: node -e "console.log(require(\'crypto\').randomBytes(64).toString(\'hex\'))"');
        throw new Error('JWT_SECRET not configured');
    }

    if (secret.length < 32) {
        console.warn('[JWT] ⚠️ JWT_SECRET is too short (should be at least 32 characters)');
    }

    return secret;
}

/**
 * Generate URL-safe unsubscribe token
 *
 * @param {string} email - Email address to unsubscribe
 * @param {string} [campaignId] - Optional campaign identifier
 * @returns {string} URL-safe JWT token
 *
 * @example
 * const token = generateUnsubscribeToken('user@example.com', 'newsletter_oct25');
 * // Returns: eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJlbWFpbCI6InVzZXJAZXhhbXBsZS5jb20iLCJjYW1wYWlnbklkIjoibmV3c2xldHRlcl9vY3QyNSIsImlhdCI6MTYzMDM0NTYwMCwiZXhwIjoxNjMyOTM3NjAwfQ.abc123...
 */
function generateUnsubscribeToken(email, campaignId = null) {
    try {
        // Normalize email (lowercase, trim whitespace)
        const normalizedEmail = email.toLowerCase().trim();

        // Validate email format
        if (!normalizedEmail || !normalizedEmail.includes('@')) {
            throw new Error(`Invalid email format: ${email}`);
        }

        // Create payload
        const payload = {
            email: normalizedEmail,
            type: 'unsubscribe' // Token type for security
        };

        // Add campaignId if provided
        if (campaignId) {
            payload.campaignId = campaignId;
        }

        // Get secret
        const secret = getJwtSecret();

        // Generate JWT with 30-day expiration
        const token = jwt.sign(
            payload,
            secret,
            {
                expiresIn: '30d',
                algorithm: 'HS256' // HMAC SHA-256 (most common, well-supported)
            }
        );

        console.log(`[TOKEN] ✅ Generated for ${normalizedEmail}${campaignId ? ` (campaign: ${campaignId})` : ''}`);
        console.log(`[TOKEN] 📏 Length: ${token.length} characters`);
        console.log(`[TOKEN] 🔒 Expires in: 30 days`);

        return token;

    } catch (error) {
        console.error('[TOKEN] ❌ Generation failed:', error.message);
        throw error;
    }
}

/**
 * Verify and decode unsubscribe token
 *
 * @param {string} token - JWT token to verify
 * @returns {Object|null} Decoded payload with email and campaignId, or null if invalid
 *
 * @example
 * const data = verifyUnsubscribeToken(token);
 * // Returns: { email: 'user@example.com', campaignId: 'newsletter_oct25', iat: 1630345600, exp: 1632937600 }
 * // Returns: null if token is invalid or expired
 */
function verifyUnsubscribeToken(token) {
    try {
        // Validate token exists
        if (!token || typeof token !== 'string') {
            console.error('[TOKEN] ❌ Verification failed: Token is empty or not a string');
            return null;
        }

        // Log token details for debugging
        console.log(`[TOKEN] 🔍 Verifying token (length: ${token.length})`);
        console.log(`[TOKEN] 📝 First 30 chars: ${token.substring(0, 30)}...`);
        console.log(`[TOKEN] 📝 Last 30 chars: ...${token.substring(token.length - 30)}`);

        // Get secret
        const secret = getJwtSecret();

        // Verify and decode token
        const decoded = jwt.verify(token, secret, {
            algorithms: ['HS256'] // Only accept HS256 for security
        });

        // Validate token type
        if (decoded.type !== 'unsubscribe') {
            console.error('[TOKEN] ❌ Invalid token type:', decoded.type);
            return null;
        }

        // Validate email exists
        if (!decoded.email || !decoded.email.includes('@')) {
            console.error('[TOKEN] ❌ Invalid email in token:', decoded.email);
            return null;
        }

        console.log(`[TOKEN] ✅ Verified successfully for ${decoded.email}`);
        console.log(`[TOKEN] 📅 Issued at: ${new Date(decoded.iat * 1000).toISOString()}`);
        console.log(`[TOKEN] 📅 Expires at: ${new Date(decoded.exp * 1000).toISOString()}`);

        if (decoded.campaignId) {
            console.log(`[TOKEN] 📋 Campaign: ${decoded.campaignId}`);
        }

        return {
            email: decoded.email,
            campaignId: decoded.campaignId || null,
            issuedAt: new Date(decoded.iat * 1000),
            expiresAt: new Date(decoded.exp * 1000)
        };

    } catch (error) {
        // Handle specific JWT errors
        if (error.name === 'TokenExpiredError') {
            console.error(`[TOKEN] ⏰ Token expired at: ${error.expiredAt}`);
            return null;
        } else if (error.name === 'JsonWebTokenError') {
            console.error(`[TOKEN] ❌ Invalid token: ${error.message}`);
            return null;
        } else if (error.name === 'NotBeforeError') {
            console.error(`[TOKEN] ⏰ Token not yet valid (nbf): ${error.date}`);
            return null;
        } else {
            console.error('[TOKEN] ❌ Verification failed:', error.message);
            return null;
        }
    }
}

/**
 * Test function to validate JWT configuration
 *
 * @returns {boolean} True if JWT system is working correctly
 */
function testJwtSystem() {
    console.log('\n[JWT TEST] 🧪 Testing JWT unsubscribe system...\n');

    try {
        // Test 1: Generate token
        const testEmail = 'test@example.com';
        const testCampaign = 'test_campaign';
        const token = generateUnsubscribeToken(testEmail, testCampaign);
        console.log(`\n[JWT TEST] ✅ Token generated successfully`);

        // Test 2: Verify token
        const decoded = verifyUnsubscribeToken(token);
        if (!decoded) {
            throw new Error('Token verification failed');
        }
        console.log(`\n[JWT TEST] ✅ Token verified successfully`);

        // Test 3: Validate payload
        if (decoded.email !== testEmail) {
            throw new Error(`Email mismatch: expected ${testEmail}, got ${decoded.email}`);
        }
        if (decoded.campaignId !== testCampaign) {
            throw new Error(`Campaign mismatch: expected ${testCampaign}, got ${decoded.campaignId}`);
        }
        console.log(`\n[JWT TEST] ✅ Payload validation passed`);

        // Test 4: URL safety check
        const urlSafeChars = /^[A-Za-z0-9\-_\.]+$/;
        if (!urlSafeChars.test(token)) {
            throw new Error('Token contains non-URL-safe characters');
        }
        console.log(`\n[JWT TEST] ✅ Token is URL-safe`);

        console.log('\n[JWT TEST] 🎉 All tests passed!\n');
        return true;

    } catch (error) {
        console.error('\n[JWT TEST] ❌ Test failed:', error.message, '\n');
        return false;
    }
}

module.exports = {
    generateUnsubscribeToken,
    verifyUnsubscribeToken,
    testJwtSystem
};
