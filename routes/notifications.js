/**
 * Frontend Notifications API
 * Handles real-time notifications for authentication failures and other alerts
 */

const express = require('express');
const AuthFailureNotifier = require('../utils/authFailureNotifier');
const router = express.Router();

// Get pending notifications for current session
router.get('/poll', (req, res) => {
    try {
        const sessionId = req.session?.id || req.headers['x-session-id'];

        if (!sessionId) {
            return res.json({
                success: true,
                notifications: [],
                message: 'No session ID provided'
            });
        }

        const notifications = AuthFailureNotifier.getPendingNotifications(sessionId);

        res.json({
            success: true,
            notifications: notifications,
            sessionId: sessionId,
            timestamp: new Date().toISOString()
        });

    } catch (error) {
        console.error('❌ Notification polling error:', error.message);
        res.status(500).json({
            success: false,
            error: error.message,
            notifications: []
        });
    }
});

// Mark notification as read/dismissed
router.post('/dismiss/:notificationId', (req, res) => {
    try {
        const { notificationId } = req.params;
        const sessionId = req.session?.id || req.headers['x-session-id'];

        console.log(`🔕 Notification dismissed: ${notificationId} for session: ${sessionId}`);

        res.json({
            success: true,
            message: `Notification ${notificationId} dismissed`
        });

    } catch (error) {
        console.error('❌ Notification dismiss error:', error.message);
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

// Test endpoint for authentication failure notifications
router.post('/test-auth-failure', (req, res) => {
    try {
        const sessionId = req.session?.id || req.headers['x-session-id'] || 'test-session';

        const authFailureNotifier = new AuthFailureNotifier();

        // Simulate authentication failure
        const mockUserInfo = {
            username: req.body.testEmail || 'test.user@example.com'
        };

        const mockFailureDetails = {
            status: 'Failed during campaign',
            processed: '15/375',
            currentEmail: 'test@example.com',
            error: 'User not authenticated - Token expired'
        };

        authFailureNotifier.handleAuthFailure(sessionId, mockUserInfo, mockFailureDetails);

        res.json({
            success: true,
            message: 'Test authentication failure notification triggered',
            sessionId: sessionId,
            testData: {
                userInfo: mockUserInfo,
                failureDetails: mockFailureDetails
            }
        });

    } catch (error) {
        console.error('❌ Test auth failure error:', error.message);
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

// Get notification system status
router.get('/status', (req, res) => {
    try {
        const hasEmailConfig = !!(process.env.NOTIFICATION_EMAIL_USER && process.env.NOTIFICATION_EMAIL_PASS);
        const totalPendingNotifications = global.frontendNotifications ?
            Array.from(global.frontendNotifications.values()).reduce((sum, arr) => sum + arr.length, 0) : 0;

        res.json({
            success: true,
            status: {
                emailNotificationsEnabled: hasEmailConfig,
                frontendNotificationsEnabled: true,
                adminEmail: 'benefitscare@inspro.com.sg',
                totalPendingSessions: global.frontendNotifications ? global.frontendNotifications.size : 0,
                totalPendingNotifications: totalPendingNotifications,
                cooldownPeriod: '30 minutes',
                lastCheck: new Date().toISOString()
            },
            configuration: {
                emailUser: process.env.NOTIFICATION_EMAIL_USER ? 'Configured' : 'Not Configured',
                renderUrl: process.env.RENDER_EXTERNAL_URL || 'localhost:3000'
            }
        });

    } catch (error) {
        console.error('❌ Notification status error:', error.message);
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

module.exports = router;