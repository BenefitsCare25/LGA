/**
 * Unsubscribe Token Manager
 * Generates and manages unique tokens for unsubscribe links
 * Prevents email corruption by using tokens instead of email addresses in URLs
 */

const crypto = require('crypto');

class UnsubscribeTokenManager {
    constructor() {
        // In-memory storage: token → email mapping
        // In production, this should be in a database
        this.tokenStore = new Map();

        // Reverse lookup: email → tokens (for cleanup)
        this.emailTokens = new Map();

        // Token expiry: 90 days (reasonable for unsubscribe links)
        this.TOKEN_EXPIRY_MS = 90 * 24 * 60 * 60 * 1000;

        // Cleanup old tokens every 24 hours
        this.startCleanupInterval();
    }

    /**
     * Generate a unique unsubscribe token for an email address
     * @param {string} email - Email address to generate token for
     * @returns {string} Unique token
     */
    generateToken(email) {
        if (!email) {
            throw new Error('Email is required to generate unsubscribe token');
        }

        // Create unique token using crypto
        const token = crypto.randomBytes(32).toString('hex');

        // Store token data
        const tokenData = {
            email: email.toLowerCase().trim(),
            createdAt: Date.now(),
            expiresAt: Date.now() + this.TOKEN_EXPIRY_MS
        };

        this.tokenStore.set(token, tokenData);

        // Track tokens by email for cleanup
        if (!this.emailTokens.has(email)) {
            this.emailTokens.set(email, []);
        }
        this.emailTokens.get(email).push(token);

        console.log(`🔑 [TOKEN-MGR] Generated unsubscribe token for ${email} (expires in 90 days)`);

        return token;
    }

    /**
     * Get email address from unsubscribe token
     * @param {string} token - Unsubscribe token
     * @returns {string|null} Email address or null if token invalid/expired
     */
    getEmailFromToken(token) {
        if (!token) {
            console.warn('⚠️ [TOKEN-MGR] No token provided');
            return null;
        }

        const tokenData = this.tokenStore.get(token);

        if (!tokenData) {
            console.warn(`⚠️ [TOKEN-MGR] Token not found: ${token.substring(0, 8)}...`);
            return null;
        }

        // Check if token expired
        if (Date.now() > tokenData.expiresAt) {
            console.warn(`⚠️ [TOKEN-MGR] Token expired: ${token.substring(0, 8)}... (created ${new Date(tokenData.createdAt).toISOString()})`);
            this.tokenStore.delete(token);
            return null;
        }

        console.log(`✅ [TOKEN-MGR] Token valid for email: ${tokenData.email}`);
        return tokenData.email;
    }

    /**
     * Invalidate token after successful unsubscribe
     * @param {string} token - Token to invalidate
     */
    invalidateToken(token) {
        const tokenData = this.tokenStore.get(token);
        if (tokenData) {
            console.log(`🗑️ [TOKEN-MGR] Invalidating token for ${tokenData.email}`);
            this.tokenStore.delete(token);

            // Clean up from email tracking
            const emailTokenList = this.emailTokens.get(tokenData.email);
            if (emailTokenList) {
                const index = emailTokenList.indexOf(token);
                if (index > -1) {
                    emailTokenList.splice(index, 1);
                }
            }
        }
    }

    /**
     * Invalidate all tokens for an email address
     * @param {string} email - Email address
     */
    invalidateEmailTokens(email) {
        const tokens = this.emailTokens.get(email) || [];
        console.log(`🗑️ [TOKEN-MGR] Invalidating ${tokens.length} tokens for ${email}`);

        tokens.forEach(token => {
            this.tokenStore.delete(token);
        });

        this.emailTokens.delete(email);
    }

    /**
     * Clean up expired tokens
     */
    cleanup() {
        const now = Date.now();
        let expiredCount = 0;

        for (const [token, data] of this.tokenStore.entries()) {
            if (now > data.expiresAt) {
                this.tokenStore.delete(token);
                expiredCount++;
            }
        }

        if (expiredCount > 0) {
            console.log(`🧹 [TOKEN-MGR] Cleaned up ${expiredCount} expired tokens`);
        }
    }

    /**
     * Start automatic cleanup interval
     */
    startCleanupInterval() {
        // Run cleanup every 24 hours
        setInterval(() => {
            this.cleanup();
        }, 24 * 60 * 60 * 1000);

        console.log('🔄 [TOKEN-MGR] Started automatic token cleanup (runs every 24 hours)');
    }

    /**
     * Get statistics about token storage
     */
    getStats() {
        return {
            totalTokens: this.tokenStore.size,
            totalEmails: this.emailTokens.size,
            oldestToken: this.getOldestTokenAge(),
            newestToken: this.getNewestTokenAge()
        };
    }

    /**
     * Get age of oldest token in days
     */
    getOldestTokenAge() {
        let oldest = Date.now();
        for (const data of this.tokenStore.values()) {
            if (data.createdAt < oldest) {
                oldest = data.createdAt;
            }
        }
        return Math.floor((Date.now() - oldest) / (24 * 60 * 60 * 1000));
    }

    /**
     * Get age of newest token in hours
     */
    getNewestTokenAge() {
        let newest = 0;
        for (const data of this.tokenStore.values()) {
            if (data.createdAt > newest) {
                newest = data.createdAt;
            }
        }
        return Math.floor((Date.now() - newest) / (60 * 60 * 1000));
    }
}

// Export singleton instance
module.exports = new UnsubscribeTokenManager();
