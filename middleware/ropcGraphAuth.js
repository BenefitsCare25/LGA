/**
 * ROPC Graph Authentication
 * Resource Owner Password Credentials flow for unattended email automation
 *
 * This module enables authentication using stored username/password credentials
 * without requiring browser interaction. Tokens are automatically refreshed
 * to maintain sessions indefinitely (90+ days).
 *
 * Requirements:
 * - MFA must be DISABLED on service account
 * - No Conditional Access policies blocking ROPC
 * - Work/school account (not personal Microsoft account)
 *
 * Environment Variables Required:
 * - AZURE_TENANT_ID
 * - AZURE_CLIENT_ID
 * - AZURE_CLIENT_SECRET
 * - AZURE_SERVICE_ACCOUNT_USERNAME
 * - AZURE_SERVICE_ACCOUNT_PASSWORD
 */

const msal = require('@azure/msal-node');
const { Client } = require('@microsoft/microsoft-graph-client');
const crypto = require('crypto');

class ROPCGraphAuth {
    constructor() {
        this.tenantId = process.env.AZURE_TENANT_ID;
        this.clientId = process.env.AZURE_CLIENT_ID;
        this.clientSecret = process.env.AZURE_CLIENT_SECRET;
        this.username = process.env.AZURE_SERVICE_ACCOUNT_USERNAME;
        this.password = process.env.AZURE_SERVICE_ACCOUNT_PASSWORD;

        this.msalConfig = {
            auth: {
                clientId: this.clientId,
                clientSecret: this.clientSecret,
                authority: `https://login.microsoftonline.com/${this.tenantId}`
            },
            system: {
                loggerOptions: {
                    loggerCallback: (level, message, containsPii) => {
                        if (process.env.ROPC_DEBUG_LOGGING === 'true') {
                            console.log(`[ROPC] ${message}`);
                        }
                    },
                    piiLoggingEnabled: false,
                    logLevel: process.env.ROPC_DEBUG_LOGGING === 'true'
                        ? msal.LogLevel.Verbose
                        : msal.LogLevel.Warning
                }
            }
        };

        if (this.clientId && this.clientSecret && this.tenantId) {
            this.msalInstance = new msal.ConfidentialClientApplication(this.msalConfig);
        } else {
            this.msalInstance = null;
        }
    }

    /**
     * Authenticate using username/password (ROPC flow)
     * @returns {Object} Authentication result with tokens or error
     */
    async authenticateWithPassword() {
        if (!this.msalInstance) {
            return {
                success: false,
                error: 'MSAL not initialized - check Azure credentials'
            };
        }

        if (!this.username || !this.password) {
            return {
                success: false,
                error: 'Service account credentials not configured'
            };
        }

        try {
            const ropcRequest = {
                scopes: [
                    'https://graph.microsoft.com/User.Read',
                    'https://graph.microsoft.com/Files.ReadWrite.All',
                    'https://graph.microsoft.com/Mail.Send',
                    'https://graph.microsoft.com/Mail.ReadWrite',
                    'offline_access'
                ],
                username: this.username,
                password: this.password
            };

            console.log('🔐 Attempting ROPC authentication...');
            console.log(`👤 Username: ${this.username}`);

            const response = await this.msalInstance.acquireTokenByUsernamePassword(ropcRequest);

            console.log('✅ ROPC authentication successful');
            console.log(`👤 Authenticated as: ${response.account.username}`);
            console.log(`⏰ Token expires: ${new Date(response.expiresOn).toLocaleString()}`);

            return {
                success: true,
                accessToken: response.accessToken,
                refreshToken: response.refreshToken,
                expiresOn: response.expiresOn,
                account: response.account,
                scopes: response.scopes
            };

        } catch (error) {
            console.error('❌ ROPC authentication failed:', error.message);

            // Provide detailed error diagnostics
            if (error.errorCode === 'invalid_grant') {
                console.error('🔐 Invalid credentials - username or password incorrect');
                console.error('💡 Solution: Verify credentials in Azure AD and environment variables');
            } else if (error.message.includes('AADSTS50076')) {
                console.error('🔐 MFA required - ROPC cannot work with MFA enabled');
                console.error('💡 Solution: Disable MFA on service account or use refresh token bootstrap');
            } else if (error.message.includes('AADSTS700016')) {
                console.error('🔐 ROPC not supported - Conditional Access policy blocking ROPC');
                console.error('💡 Solution: Adjust Conditional Access policy or use refresh token bootstrap');
            } else if (error.message.includes('AADSTS50055')) {
                console.error('🔐 Password expired - service account password needs to be changed');
                console.error('💡 Solution: Update password in Azure AD and environment variables');
            } else if (error.message.includes('AADSTS53003')) {
                console.error('🔐 Access blocked by Conditional Access policy');
                console.error('💡 Solution: Exclude service account from policy or use refresh token bootstrap');
            } else if (error.message.includes('AADSTS50126')) {
                console.error('🔐 Invalid username or password');
                console.error('💡 Solution: Verify credentials are correct in environment variables');
            }

            return {
                success: false,
                error: error.message,
                errorCode: error.errorCode
            };
        }
    }

    /**
     * Create session from ROPC tokens and integrate with delegated auth system
     * @param {Object} delegatedAuthProvider - DelegatedGraphAuth instance
     * @returns {Object} Session creation result
     */
    async createSessionFromROPC(delegatedAuthProvider) {
        const authResult = await this.authenticateWithPassword();

        if (!authResult.success) {
            return authResult;
        }

        try {
            // Create deterministic session ID from service account email
            const sessionId = this.generateSessionId(this.username);

            // Store tokens in delegated auth provider (same structure as OAuth sessions)
            delegatedAuthProvider.userTokens.set(sessionId, {
                accessToken: authResult.accessToken,
                refreshToken: authResult.refreshToken,
                expiresOn: authResult.expiresOn,
                account: authResult.account,
                scopes: authResult.scopes,
                createdAt: new Date().toISOString(),
                authMethod: 'ROPC',
                hasStoredRefreshToken: true
            });

            console.log(`✅ Session created: ${sessionId}`);
            console.log(`🔑 Session will persist across server restarts`);

            // Save to persistent storage immediately
            const persistentStorage = require('../utils/persistentStorage');
            await persistentStorage.saveSessions(delegatedAuthProvider.userTokens);
            await persistentStorage.saveUserContext(
                sessionId,
                authResult.account.username,
                '/LGA-Email-Automation'
            );

            console.log(`💾 Session persisted to storage`);

            return {
                success: true,
                sessionId: sessionId,
                user: authResult.account.username,
                expiresOn: authResult.expiresOn
            };

        } catch (error) {
            console.error('❌ Session creation failed:', error.message);
            return {
                success: false,
                error: error.message
            };
        }
    }

    /**
     * Generate deterministic session ID from email address
     * Same email always produces same session ID for consistency
     * @param {string} email - Service account email
     * @returns {string} 32-character session ID
     */
    generateSessionId(email) {
        return crypto.createHash('sha256')
            .update(email.toLowerCase())
            .digest('hex')
            .substring(0, 32);
    }

    /**
     * Check if ROPC credentials are fully configured
     * @returns {boolean} True if all required environment variables present
     */
    static isConfigured() {
        const required = [
            'AZURE_SERVICE_ACCOUNT_USERNAME',
            'AZURE_SERVICE_ACCOUNT_PASSWORD',
            'AZURE_CLIENT_ID',
            'AZURE_CLIENT_SECRET',
            'AZURE_TENANT_ID'
        ];

        const missing = required.filter(key => !process.env[key]);

        if (missing.length > 0) {
            if (process.env.ROPC_DEBUG_LOGGING === 'true') {
                console.log(`⚠️ ROPC configuration incomplete - missing: ${missing.join(', ')}`);
            }
            return false;
        }

        return true;
    }

    /**
     * Validate ROPC can work (non-blocking check)
     * @returns {Object} Validation result with warnings
     */
    static validateConfiguration() {
        const warnings = [];
        const errors = [];

        if (!this.isConfigured()) {
            errors.push('ROPC credentials not fully configured');
            return { valid: false, errors, warnings };
        }

        // Add warnings about ROPC limitations
        warnings.push('ROPC is a legacy authentication flow deprecated by Microsoft');
        warnings.push('MFA must be disabled on the service account');
        warnings.push('Conditional Access policies may block ROPC authentication');
        warnings.push('Consider using refresh token bootstrap for better stability');

        return {
            valid: true,
            errors,
            warnings
        };
    }
}

module.exports = ROPCGraphAuth;
