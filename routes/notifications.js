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
router.post('/test-auth-failure', async (req, res) => {
    try {
        const sessionId = req.session?.id || req.headers['x-session-id'] || 'test-session';

        const authFailureNotifier = new AuthFailureNotifier();

        // Simulate authentication failure
        const mockUserInfo = {
            username: req.body.testEmail || 'test.user@example.com'
        };

        const mockFailureDetails = {
            status: 'Failed during campaign - TEST MODE',
            processed: '15/375',
            currentEmail: 'test@example.com',
            error: 'User not authenticated - Token expired (TEST ALERT)'
        };

        console.log('🧪 Testing authentication failure notification system...');
        const result = await authFailureNotifier.handleAuthFailure(sessionId, mockUserInfo, mockFailureDetails);

        res.json({
            success: true,
            message: 'Test authentication failure notification triggered',
            sessionId: sessionId,
            notificationsSent: result,
            testData: {
                userInfo: mockUserInfo,
                failureDetails: mockFailureDetails
            },
            instructions: {
                email: 'Check benefitscare@inspro.com.sg inbox for test alert',
                webhook: 'Check configured webhook service for alert',
                logs: 'Check server console logs for structured alert output',
                frontend: 'Refresh browser and check for popup notification'
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
        const hasWebhookConfig = !!process.env.NOTIFICATION_WEBHOOK_URL;
        const totalPendingNotifications = global.frontendNotifications ?
            Array.from(global.frontendNotifications.values()).reduce((sum, arr) => sum + arr.length, 0) : 0;

        // Determine email provider from configured email
        let emailProvider = 'Unknown';
        if (process.env.NOTIFICATION_EMAIL_USER) {
            const domain = process.env.NOTIFICATION_EMAIL_USER.split('@')[1];
            if (domain.includes('gmail')) emailProvider = 'Gmail';
            else if (domain.includes('outlook') || domain.includes('hotmail')) emailProvider = 'Outlook';
            else emailProvider = 'Custom SMTP';
        }

        res.json({
            success: true,
            status: {
                emailNotificationsEnabled: hasEmailConfig,
                webhookNotificationsEnabled: hasWebhookConfig,
                frontendNotificationsEnabled: true,
                structuredLoggingEnabled: true, // Always enabled
                adminEmail: 'benefitscare@inspro.com.sg',
                totalPendingSessions: global.frontendNotifications ? global.frontendNotifications.size : 0,
                totalPendingNotifications: totalPendingNotifications,
                cooldownPeriod: '30 minutes',
                lastCheck: new Date().toISOString()
            },
            channels: {
                email: {
                    enabled: hasEmailConfig,
                    provider: emailProvider,
                    configuredUser: process.env.NOTIFICATION_EMAIL_USER ?
                        process.env.NOTIFICATION_EMAIL_USER.replace(/(.{2}).*@(.*)/, '$1***@$2') : 'Not configured'
                },
                webhook: {
                    enabled: hasWebhookConfig,
                    url: process.env.NOTIFICATION_WEBHOOK_URL ?
                        process.env.NOTIFICATION_WEBHOOK_URL.replace(/(https?:\/\/[^\/]+).*/, '$1/***') : 'Not configured'
                },
                frontend: {
                    enabled: true,
                    pollingInterval: '30 seconds',
                    notificationContainer: 'Top-right popup'
                },
                logging: {
                    enabled: true,
                    format: 'Human-readable + JSON structured',
                    visibility: 'Server console logs'
                }
            },
            configuration: {
                renderUrl: process.env.RENDER_EXTERNAL_URL || 'localhost:3000',
                redundancy: `${[hasEmailConfig, hasWebhookConfig, true, true].filter(Boolean).length}/4 channels active`
            },
            testEndpoint: '/api/notifications/test-auth-failure'
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