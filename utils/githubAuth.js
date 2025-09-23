// Dynamic imports for ES modules
async function loadOAuthDeviceAuth() {
    const authModule = await import('@octokit/auth-oauth-device');
    return authModule.createOAuthDeviceAuth;
}

async function loadOctokit() {
    const octokitModule = await import('@octokit/rest');
    return octokitModule.Octokit;
}

/**
 * GitHub Device Flow Authentication Manager
 * Handles OAuth device flow for GitHub authentication
 */
class GitHubAuthManager {
    constructor() {
        this.sessions = new Map(); // sessionId -> authData
        this.clientId = process.env.GITHUB_CLIENT_ID;

        if (!this.clientId) {
            console.warn('⚠️ GitHub Client ID not configured. GitHub authentication will not work.');
        }
    }

    /**
     * Initiate GitHub device flow authentication
     * @param {string} sessionId - Unique session identifier
     * @returns {Promise<{success: boolean, deviceCode?: string, userCode?: string, verificationUri?: string, error?: string}>}
     */
    async initiateDeviceFlow(sessionId) {
        try {
            if (!this.clientId) {
                throw new Error('GitHub Client ID not configured');
            }

            // Load ES modules dynamically
            const createOAuthDeviceAuth = await loadOAuthDeviceAuth();
            const Octokit = await loadOctokit();

            const auth = createOAuthDeviceAuth({
                clientType: 'oauth-app',
                clientId: this.clientId,
                scopes: ['user:email', 'read:user'],
                onVerification: (verification) => {
                    // Store verification data for this session
                    this.sessions.set(sessionId, {
                        status: 'pending',
                        verification,
                        startTime: Date.now()
                    });

                    console.log(`🔑 GitHub device flow initiated for session: ${sessionId}`);
                    console.log(`📱 User code: ${verification.user_code}`);
                    console.log(`🌐 Verification URL: ${verification.verification_uri}`);
                },
            });

            // Start the authentication process
            const authResult = await auth({
                type: 'oauth',
            });

            // Update session with successful authentication
            const sessionData = this.sessions.get(sessionId);
            if (sessionData) {
                sessionData.status = 'authenticated';
                sessionData.token = authResult.token;
                sessionData.authResult = authResult;

                // Create authenticated Octokit instance
                sessionData.octokit = new Octokit({
                    auth: authResult.token,
                });

                console.log(`✅ GitHub authentication successful for session: ${sessionId}`);
            }

            return {
                success: true,
                token: authResult.token,
                sessionId
            };

        } catch (error) {
            console.error(`❌ GitHub device flow error for session ${sessionId}:`, error.message);

            // Clean up failed session
            this.sessions.delete(sessionId);

            return {
                success: false,
                error: error.message
            };
        }
    }

    /**
     * Get device flow status and verification details
     * @param {string} sessionId - Session identifier
     * @returns {object} Status object with verification details
     */
    getDeviceFlowStatus(sessionId) {
        const sessionData = this.sessions.get(sessionId);

        if (!sessionData) {
            return {
                status: 'not_found',
                message: 'Session not found'
            };
        }

        if (sessionData.status === 'pending') {
            return {
                status: 'pending',
                userCode: sessionData.verification.user_code,
                verificationUri: sessionData.verification.verification_uri,
                expiresIn: sessionData.verification.expires_in,
                interval: sessionData.verification.interval,
                message: 'Please visit the verification URL and enter the user code'
            };
        }

        if (sessionData.status === 'authenticated') {
            return {
                status: 'authenticated',
                message: 'Authentication successful'
            };
        }

        return {
            status: 'unknown',
            message: 'Unknown session status'
        };
    }

    /**
     * Check if session is authenticated
     * @param {string} sessionId - Session identifier
     * @returns {boolean} Authentication status
     */
    isAuthenticated(sessionId) {
        const sessionData = this.sessions.get(sessionId);
        return sessionData && sessionData.status === 'authenticated';
    }

    /**
     * Get authenticated Octokit instance for session
     * @param {string} sessionId - Session identifier
     * @returns {Octokit|null} Authenticated Octokit instance or null
     */
    getOctokit(sessionId) {
        const sessionData = this.sessions.get(sessionId);
        return sessionData?.octokit || null;
    }

    /**
     * Get user information for authenticated session
     * @param {string} sessionId - Session identifier
     * @returns {Promise<{success: boolean, user?: object, error?: string}>}
     */
    async getUserInfo(sessionId) {
        try {
            const octokit = this.getOctokit(sessionId);
            if (!octokit) {
                return {
                    success: false,
                    error: 'Session not authenticated'
                };
            }

            const { data: user } = await octokit.rest.users.getAuthenticated();

            return {
                success: true,
                user: {
                    id: user.id,
                    login: user.login,
                    name: user.name,
                    email: user.email,
                    avatar_url: user.avatar_url,
                    html_url: user.html_url
                }
            };

        } catch (error) {
            console.error(`❌ GitHub user info error for session ${sessionId}:`, error.message);
            return {
                success: false,
                error: error.message
            };
        }
    }

    /**
     * Logout user session
     * @param {string} sessionId - Session identifier
     */
    logout(sessionId) {
        if (this.sessions.has(sessionId)) {
            console.log(`🚪 GitHub logout for session: ${sessionId}`);
            this.sessions.delete(sessionId);
        }
    }

    /**
     * Clean up expired sessions
     */
    cleanupExpiredSessions() {
        const now = Date.now();
        const maxAge = 24 * 60 * 60 * 1000; // 24 hours

        for (const [sessionId, sessionData] of this.sessions.entries()) {
            if (sessionData.startTime && (now - sessionData.startTime) > maxAge) {
                console.log(`🧹 Cleaning up expired GitHub session: ${sessionId}`);
                this.sessions.delete(sessionId);
            }
        }
    }

    /**
     * Test GitHub API connection for authenticated session
     * @param {string} sessionId - Session identifier
     * @returns {Promise<{success: boolean, message?: string, error?: string}>}
     */
    async testConnection(sessionId) {
        try {
            const userInfo = await this.getUserInfo(sessionId);

            if (userInfo.success) {
                return {
                    success: true,
                    message: 'GitHub API connection successful',
                    user: userInfo.user
                };
            } else {
                return {
                    success: false,
                    error: userInfo.error
                };
            }

        } catch (error) {
            return {
                success: false,
                error: error.message
            };
        }
    }
}

// Create singleton instance
const githubAuthManager = new GitHubAuthManager();

// Clean up expired sessions every hour
setInterval(() => {
    githubAuthManager.cleanupExpiredSessions();
}, 60 * 60 * 1000);

module.exports = {
    GitHubAuthManager,
    githubAuthManager
};