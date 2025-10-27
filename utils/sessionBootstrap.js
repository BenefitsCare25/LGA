/**
 * Session Bootstrap Utility
 * Creates authenticated sessions from stored refresh tokens
 *
 * This is the fallback/alternative to ROPC when:
 * - MFA is enabled on service account
 * - Conditional Access blocks ROPC
 * - ROPC is deprecated/disabled by Microsoft
 *
 * Usage:
 * 1. Authenticate once via OAuth browser flow
 * 2. Extract refresh token from session
 * 3. Store in environment variable BOOTSTRAP_REFRESH_TOKEN
 * 4. Server creates session from token on every startup
 *
 * Environment Variables Required:
 * - BOOTSTRAP_REFRESH_TOKEN (from /auth/get-refresh-token endpoint)
 * - BOOTSTRAP_SESSION_EMAIL (service account email)
 * - AZURE_TENANT_ID, AZURE_CLIENT_ID, AZURE_CLIENT_SECRET
 */

const crypto = require('crypto');

class SessionBootstrap {
    /**
     * Bootstrap session from environment variable refresh token
     * @param {Object} delegatedAuthProvider - DelegatedGraphAuth instance
     * @returns {Object} Bootstrap result with session ID or error
     */
    static async bootstrapFromEnv(delegatedAuthProvider) {
        const refreshToken = process.env.BOOTSTRAP_REFRESH_TOKEN;
        const email = process.env.BOOTSTRAP_SESSION_EMAIL;

        if (!refreshToken || !email) {
            return {
                success: false,
                error: 'Bootstrap credentials not configured',
                hint: 'Set BOOTSTRAP_REFRESH_TOKEN and BOOTSTRAP_SESSION_EMAIL in environment'
            };
        }

        try {
            console.log('🔐 Attempting session bootstrap from refresh token...');
            console.log(`👤 Email: ${email}`);

            // Create deterministic session ID from email
            const sessionId = this.generateSessionId(email);

            // Create account object
            const account = {
                username: email,
                name: email.split('@')[0],
                environment: 'bootstrap',
                tenantId: process.env.AZURE_TENANT_ID,
                homeAccountId: `${sessionId}.${process.env.AZURE_TENANT_ID}`,
                localAccountId: sessionId
            };

            // Create session with stored refresh token
            // Mark as needs refresh to get fresh access token immediately
            delegatedAuthProvider.userTokens.set(sessionId, {
                refreshToken: refreshToken,
                account: account,
                expiresOn: new Date(Date.now() + 3600000), // 1 hour from now
                needsRefresh: true, // Force immediate refresh to get access token
                scopes: [
                    'https://graph.microsoft.com/User.Read',
                    'https://graph.microsoft.com/Files.ReadWrite.All',
                    'https://graph.microsoft.com/Mail.Send',
                    'https://graph.microsoft.com/Mail.ReadWrite'
                ],
                createdAt: new Date().toISOString(),
                authMethod: 'bootstrap',
                hasStoredRefreshToken: true
            });

            console.log(`✅ Session created: ${sessionId}`);
            console.log(`🔄 Refreshing token to obtain access token...`);

            // Immediately refresh to get valid access token
            try {
                await delegatedAuthProvider.refreshSessionToken(sessionId);
                console.log(`✅ Access token obtained via refresh`);
            } catch (refreshError) {
                console.error(`❌ Token refresh failed:`, refreshError.message);

                // Clean up failed session
                delegatedAuthProvider.userTokens.delete(sessionId);

                return {
                    success: false,
                    error: 'Refresh token invalid or expired',
                    details: refreshError.message,
                    hint: 'Obtain new refresh token via /auth/get-refresh-token endpoint'
                };
            }

            // Save to persistent storage
            const persistentStorage = require('./persistentStorage');
            await persistentStorage.saveSessions(delegatedAuthProvider.userTokens);
            await persistentStorage.saveUserContext(
                sessionId,
                email,
                '/LGA-Email-Automation'
            );

            console.log(`💾 Session persisted to storage`);
            console.log(`🎉 Bootstrap successful - session ready for automation`);

            return {
                success: true,
                sessionId: sessionId,
                user: email
            };

        } catch (error) {
            console.error('❌ Session bootstrap failed:', error.message);
            return {
                success: false,
                error: error.message
            };
        }
    }

    /**
     * Generate deterministic session ID from email address
     * @param {string} email - Service account email
     * @returns {string} 32-character session ID
     */
    static generateSessionId(email) {
        return crypto.createHash('sha256')
            .update(email.toLowerCase())
            .digest('hex')
            .substring(0, 32);
    }

    /**
     * Check if bootstrap credentials are configured
     * @returns {boolean} True if all required environment variables present
     */
    static isConfigured() {
        const hasRefreshToken = !!process.env.BOOTSTRAP_REFRESH_TOKEN;
        const hasEmail = !!process.env.BOOTSTRAP_SESSION_EMAIL;

        if (!hasRefreshToken || !hasEmail) {
            if (process.env.ROPC_DEBUG_LOGGING === 'true') {
                const missing = [];
                if (!hasRefreshToken) missing.push('BOOTSTRAP_REFRESH_TOKEN');
                if (!hasEmail) missing.push('BOOTSTRAP_SESSION_EMAIL');
                console.log(`⚠️ Bootstrap configuration incomplete - missing: ${missing.join(', ')}`);
            }
            return false;
        }

        return true;
    }

    /**
     * Validate bootstrap configuration
     * @returns {Object} Validation result
     */
    static validateConfiguration() {
        const warnings = [];
        const errors = [];

        if (!this.isConfigured()) {
            errors.push('Bootstrap credentials not fully configured');
            return { valid: false, errors, warnings };
        }

        // Validate refresh token format (should be long Base64 string)
        const refreshToken = process.env.BOOTSTRAP_REFRESH_TOKEN;
        if (refreshToken.length < 100) {
            warnings.push('Refresh token seems too short - may be invalid');
        }

        // Validate email format
        const email = process.env.BOOTSTRAP_SESSION_EMAIL;
        if (!email.includes('@')) {
            errors.push('BOOTSTRAP_SESSION_EMAIL must be a valid email address');
            return { valid: false, errors, warnings };
        }

        warnings.push('Refresh tokens typically expire after 90 days of inactivity');
        warnings.push('Regular use keeps refresh token active indefinitely');

        return {
            valid: true,
            errors,
            warnings
        };
    }

    /**
     * Extract refresh token instructions for display
     * @returns {Object} Detailed instructions
     */
    static getSetupInstructions() {
        return {
            title: 'Refresh Token Bootstrap Setup',
            steps: [
                {
                    step: 1,
                    action: 'Authenticate via OAuth',
                    url: '/auth/login',
                    description: 'Log in with Microsoft account via browser'
                },
                {
                    step: 2,
                    action: 'Extract refresh token',
                    url: '/auth/get-refresh-token',
                    description: 'Visit this endpoint to see your refresh token'
                },
                {
                    step: 3,
                    action: 'Add to environment variables',
                    variables: {
                        BOOTSTRAP_REFRESH_TOKEN: 'Long Base64 token from step 2',
                        BOOTSTRAP_SESSION_EMAIL: 'Your service account email'
                    },
                    description: 'Add these variables in Render dashboard'
                },
                {
                    step: 4,
                    action: 'Restart service',
                    description: 'Server will auto-authenticate on every startup'
                },
                {
                    step: 5,
                    action: 'Verify operation',
                    check: 'Look for "Bootstrap successful" in server logs',
                    description: 'Session should persist across restarts'
                }
            ],
            benefits: [
                'Works with MFA enabled',
                'Complies with Conditional Access policies',
                'Microsoft-approved modern authentication',
                'Session valid for 90+ days',
                'Automatic token refresh'
            ]
        };
    }
}

module.exports = SessionBootstrap;
