const express = require('express');
const { githubAuthManager } = require('../utils/githubAuth');
const router = express.Router();

/**
 * GitHub Device Flow Authentication Routes
 * Handles OAuth2 device flow for GitHub authentication
 */

// Generate session ID helper
function generateSessionId() {
    return 'gh_' + Date.now().toString(36) + Math.random().toString(36).substr(2);
}

/**
 * Initiate GitHub device flow authentication
 * POST /api/github-auth/device-flow
 */
router.post('/device-flow', async (req, res) => {
    try {
        const sessionId = generateSessionId();

        console.log(`🔑 Initiating GitHub device flow for session: ${sessionId}`);

        // Start device flow (this will trigger the onVerification callback)
        const deviceFlowPromise = githubAuthManager.initiateDeviceFlow(sessionId);

        // Give the verification callback time to execute
        await new Promise(resolve => setTimeout(resolve, 100));

        // Get the device flow status which contains verification details
        const status = githubAuthManager.getDeviceFlowStatus(sessionId);

        if (status.status === 'pending') {
            res.json({
                success: true,
                sessionId: sessionId,
                userCode: status.userCode,
                verificationUri: status.verificationUri,
                expiresIn: status.expiresIn,
                interval: status.interval,
                message: 'Please visit the verification URL and enter the user code to complete authentication'
            });

            // Continue device flow in background
            deviceFlowPromise.catch(error => {
                console.error(`❌ Background device flow error for session ${sessionId}:`, error.message);
            });
        } else {
            res.status(500).json({
                success: false,
                error: 'Failed to initiate device flow',
                message: 'Could not start GitHub device authentication'
            });
        }

    } catch (error) {
        console.error('GitHub device flow initiation error:', error);
        res.status(500).json({
            success: false,
            error: 'Device Flow Error',
            message: 'Failed to initiate GitHub device flow',
            details: process.env.NODE_ENV === 'development' ? error.message : undefined
        });
    }
});

/**
 * Check GitHub device flow status
 * GET /api/github-auth/status/:sessionId
 */
router.get('/status/:sessionId', async (req, res) => {
    try {
        const { sessionId } = req.params;
        const status = githubAuthManager.getDeviceFlowStatus(sessionId);

        if (status.status === 'authenticated') {
            // Get user info for authenticated sessions
            const userInfo = await githubAuthManager.getUserInfo(sessionId);

            res.json({
                status: 'authenticated',
                authenticated: true,
                sessionId: sessionId,
                user: userInfo.success ? userInfo.user : null,
                message: 'GitHub authentication successful'
            });
        } else if (status.status === 'pending') {
            res.json({
                status: 'pending',
                authenticated: false,
                userCode: status.userCode,
                verificationUri: status.verificationUri,
                message: status.message
            });
        } else {
            res.json({
                status: status.status,
                authenticated: false,
                message: status.message
            });
        }

    } catch (error) {
        console.error('GitHub status check error:', error);
        res.status(500).json({
            status: 'error',
            authenticated: false,
            error: error.message
        });
    }
});

/**
 * Get authenticated user information
 * GET /api/github-auth/user/:sessionId
 */
router.get('/user/:sessionId', async (req, res) => {
    try {
        const { sessionId } = req.params;

        if (!githubAuthManager.isAuthenticated(sessionId)) {
            return res.status(401).json({
                success: false,
                error: 'Session not authenticated'
            });
        }

        const userInfo = await githubAuthManager.getUserInfo(sessionId);

        if (userInfo.success) {
            res.json({
                success: true,
                user: userInfo.user
            });
        } else {
            res.status(401).json({
                success: false,
                error: userInfo.error
            });
        }

    } catch (error) {
        console.error('GitHub user info error:', error);
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

/**
 * Test GitHub API connection
 * GET /api/github-auth/test/:sessionId
 */
router.get('/test/:sessionId', async (req, res) => {
    try {
        const { sessionId } = req.params;

        const result = await githubAuthManager.testConnection(sessionId);

        if (result.success) {
            res.json({
                success: true,
                message: result.message,
                user: result.user,
                authType: 'GitHub Device Flow'
            });
        } else {
            res.status(401).json({
                success: false,
                error: result.error,
                message: 'GitHub API connection failed'
            });
        }

    } catch (error) {
        console.error('GitHub test error:', error);
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

/**
 * Logout GitHub user
 * POST /api/github-auth/logout/:sessionId
 */
router.post('/logout/:sessionId', (req, res) => {
    try {
        const { sessionId } = req.params;

        githubAuthManager.logout(sessionId);

        res.json({
            success: true,
            message: 'GitHub logout successful'
        });

    } catch (error) {
        console.error('GitHub logout error:', error);
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

/**
 * Get all active GitHub sessions (development/debugging)
 */
router.get('/sessions', (req, res) => {
    try {
        if (process.env.NODE_ENV !== 'development') {
            return res.status(404).json({ error: 'Not found' });
        }

        const sessions = [];
        for (const [sessionId, sessionData] of githubAuthManager.sessions.entries()) {
            sessions.push({
                sessionId,
                status: sessionData.status,
                startTime: sessionData.startTime,
                hasToken: !!sessionData.token
            });
        }

        res.json({
            success: true,
            sessions: sessions,
            count: sessions.length
        });

    } catch (error) {
        console.error('GitHub sessions error:', error);
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

module.exports = router;