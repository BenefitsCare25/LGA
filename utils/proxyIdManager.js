/**
 * Proxy ID Manager for Excel-Based Unsubscribe System
 *
 * Stores token data in Excel "Location" column format:
 * TOKEN:abc123xyz:2025-11-29T12:00:00Z:ACTIVE
 * TOKEN:abc123xyz:2025-11-29T12:00:00Z:USED:2025-10-30T13:00:00Z
 *
 * Benefits:
 * - Short, simple IDs (8 chars) resist email gateway corruption
 * - In-memory cache for fast lookups (1-5ms vs 3-7 seconds)
 * - No database required, uses existing Excel infrastructure
 */

const crypto = require('crypto');

/**
 * Generate a short, URL-safe proxy ID
 * @returns {string} 8-character random ID (e.g., "abc123xyz")
 */
function generateProxyId() {
    return crypto.randomBytes(6).toString('base64url'); // 8 characters
}

/**
 * Create Location column value with token data
 * @param {string} proxyId - The proxy ID (e.g., "abc123xyz")
 * @param {Date} expiryDate - When the token expires (default: 30 days)
 * @returns {string} Encoded string for Location column
 */
function encodeLocationToken(proxyId, expiryDate = null) {
    if (!expiryDate) {
        expiryDate = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000); // 30 days
    }

    const expiry = expiryDate.toISOString();
    const locationValue = `TOKEN:${proxyId}:${expiry}:ACTIVE`;

    console.log(`📍 [LOCATION-TOKEN] Generated: ${locationValue}`);
    return locationValue;
}

/**
 * Parse Location column value to extract token data
 * @param {string} locationValue - Value from Excel Location column
 * @returns {object|null} { proxyId, expiry, used } or null if invalid
 */
function parseLocationToken(locationValue) {
    if (!locationValue || typeof locationValue !== 'string') {
        return null;
    }

    if (!locationValue.startsWith('TOKEN:')) {
        return null; // Not a token, might be actual location data
    }

    try {
        const parts = locationValue.split(':');

        if (parts.length < 4) {
            console.warn(`⚠️  [LOCATION-TOKEN] Invalid format: ${locationValue}`);
            return null;
        }

        const proxyId = parts[1];
        const expiry = parts[2];
        const status = parts[3];
        const usedDate = parts[4] || null; // Only present if status === 'USED'

        return {
            proxyId,
            expiry: new Date(expiry),
            used: status === 'USED' ? (usedDate ? new Date(usedDate) : true) : null
        };
    } catch (error) {
        console.error(`❌ [LOCATION-TOKEN] Parse error: ${error.message}`);
        return null;
    }
}

/**
 * Mark a token as used by updating Location value
 * @param {string} locationValue - Current Location value
 * @returns {string} Updated Location value with USED status
 */
function markTokenAsUsed(locationValue) {
    const parsed = parseLocationToken(locationValue);
    if (!parsed) return locationValue;

    if (parsed.used) {
        console.log(`⚠️  [LOCATION-TOKEN] Token already used: ${parsed.proxyId}`);
        return locationValue; // Already marked as used
    }

    const usedDate = new Date().toISOString();
    const newLocationValue = `TOKEN:${parsed.proxyId}:${parsed.expiry.toISOString()}:USED:${usedDate}`;

    console.log(`✅ [LOCATION-TOKEN] Marked as used: ${parsed.proxyId}`);
    return newLocationValue;
}

/**
 * Verify if a token is valid (not expired, not used)
 * @param {object} tokenData - Parsed token data from parseLocationToken()
 * @returns {boolean} True if valid, false otherwise
 */
function isTokenValid(tokenData) {
    if (!tokenData) {
        console.log(`❌ [LOCATION-TOKEN] Invalid token data`);
        return false;
    }

    // Check if already used
    if (tokenData.used) {
        console.log(`❌ [LOCATION-TOKEN] Token already used: ${tokenData.proxyId}`);
        return false;
    }

    // Check if expired
    if (tokenData.expiry < new Date()) {
        console.log(`❌ [LOCATION-TOKEN] Token expired: ${tokenData.proxyId} (expired at ${tokenData.expiry})`);
        return false;
    }

    console.log(`✅ [LOCATION-TOKEN] Token valid: ${tokenData.proxyId}`);
    return true;
}

module.exports = {
    generateProxyId,
    encodeLocationToken,
    parseLocationToken,
    markTokenAsUsed,
    isTokenValid
};
