/**
 * Unsubscribe Token Manager
 * Generates and validates signed unsubscribe tokens using encryption
 * Tokens are stateless and self-contained (no storage required)
 * Works across server restarts by encoding email directly into token
 */

const crypto = require('crypto');

class UnsubscribeTokenManager {
    constructor() {
        // Encryption algorithm: AES-256-GCM (secure, authenticated encryption)
        this.algorithm = 'aes-256-gcm';

        // Get encryption key from environment
        this.secretKey = process.env.UNSUBSCRIBE_SECRET_KEY;

        if (!this.secretKey) {
            console.warn('⚠️ [TOKEN-MGR] UNSUBSCRIBE_SECRET_KEY not configured - unsubscribe tokens will not work!');
            console.warn('⚠️ [TOKEN-MGR] Please add UNSUBSCRIBE_SECRET_KEY to your .env file');
        } else {
            // Validate key length (should be 32 bytes = 64 hex characters)
            try {
                const keyBuffer = Buffer.from(this.secretKey, 'hex');
                if (keyBuffer.length !== 32) {
                    console.warn(`⚠️ [TOKEN-MGR] UNSUBSCRIBE_SECRET_KEY must be 64 hex characters (32 bytes). Current: ${keyBuffer.length} bytes`);
                } else {
                    console.log('✅ [TOKEN-MGR] Signed token system initialized (stateless, restart-safe)');
                }
            } catch (error) {
                console.warn('⚠️ [TOKEN-MGR] UNSUBSCRIBE_SECRET_KEY is not valid hex format');
            }
        }
    }

    /**
     * Generate a signed unsubscribe token for an email address
     * Token contains encrypted email - no storage needed
     * @param {string} email - Email address to generate token for
     * @returns {string} Signed token containing encrypted email
     */
    generateToken(email) {
        if (!email) {
            throw new Error('Email is required to generate unsubscribe token');
        }

        if (!this.secretKey) {
            throw new Error('UNSUBSCRIBE_SECRET_KEY not configured - cannot generate tokens');
        }

        try {
            // Normalize email
            const normalizedEmail = email.toLowerCase().trim();

            // Generate random initialization vector (IV) for encryption
            const iv = crypto.randomBytes(16);

            // Create cipher using secret key
            const key = Buffer.from(this.secretKey, 'hex');
            const cipher = crypto.createCipheriv(this.algorithm, key, iv);

            // Encrypt the email
            let encrypted = cipher.update(normalizedEmail, 'utf8', 'base64url');
            encrypted += cipher.final('base64url');

            // Get authentication tag (prevents tampering)
            const authTag = cipher.getAuthTag();

            // Combine: IV + encrypted data + auth tag
            // Format: [iv].[encrypted].[tag] (all base64url encoded)
            const token = `${iv.toString('base64url')}.${encrypted}.${authTag.toString('base64url')}`;

            console.log(`🔑 [TOKEN-MGR] Generated signed token for ${normalizedEmail} (length: ${token.length})`);

            return token;

        } catch (error) {
            console.error('❌ [TOKEN-MGR] Token generation failed:', error.message);
            throw new Error('Failed to generate unsubscribe token');
        }
    }

    /**
     * Get email address from signed unsubscribe token
     * Decrypts token to extract email
     * @param {string} token - Signed unsubscribe token
     * @returns {string|null} Email address or null if token invalid/tampered
     */
    getEmailFromToken(token) {
        if (!token) {
            console.warn('⚠️ [TOKEN-MGR] No token provided');
            return null;
        }

        if (!this.secretKey) {
            console.error('❌ [TOKEN-MGR] UNSUBSCRIBE_SECRET_KEY not configured - cannot decrypt tokens');
            return null;
        }

        try {
            // Parse token format: [iv].[encrypted].[tag]
            const parts = token.split('.');
            if (parts.length !== 3) {
                console.warn(`⚠️ [TOKEN-MGR] Invalid token format: expected 3 parts, got ${parts.length}`);
                return null;
            }

            const [ivBase64, encrypted, authTagBase64] = parts;

            // Decode components
            const iv = Buffer.from(ivBase64, 'base64url');
            const authTag = Buffer.from(authTagBase64, 'base64url');
            const key = Buffer.from(this.secretKey, 'hex');

            // Create decipher
            const decipher = crypto.createDecipheriv(this.algorithm, key, iv);
            decipher.setAuthTag(authTag);

            // Decrypt the email
            let decrypted = decipher.update(encrypted, 'base64url', 'utf8');
            decrypted += decipher.final('utf8');

            console.log(`✅ [TOKEN-MGR] Token decrypted successfully: ${decrypted}`);
            return decrypted;

        } catch (error) {
            // Decryption failure = invalid/tampered token
            console.warn(`⚠️ [TOKEN-MGR] Token decryption failed: ${error.message}`);
            console.warn(`⚠️ [TOKEN-MGR] Token may be invalid, tampered, or encrypted with different key`);
            return null;
        }
    }

    /**
     * Validate token format without decrypting
     * @param {string} token - Token to validate
     * @returns {boolean} True if token has valid format
     */
    isValidTokenFormat(token) {
        if (!token || typeof token !== 'string') {
            return false;
        }

        const parts = token.split('.');
        return parts.length === 3 && parts.every(part => part.length > 0);
    }

    /**
     * Get system status
     */
    getStatus() {
        return {
            configured: !!this.secretKey,
            algorithm: this.algorithm,
            stateless: true,
            persistsAcrossRestarts: true
        };
    }
}

// Export singleton instance
module.exports = new UnsubscribeTokenManager();
