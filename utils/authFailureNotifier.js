/**
 * Authentication Failure Notification System
 * Sends email alerts and frontend notifications when authentication fails
 */

const nodemailer = require('nodemailer');

class AuthFailureNotifier {
    constructor() {
        this.alertEmailSent = new Map(); // Track sent alerts per session
        this.alertCooldown = 30 * 60 * 1000; // 30 minutes cooldown
        this.adminEmail = 'benefitscare@inspro.com.sg';

        // Initialize email transporter (using environment variables)
        this.initEmailTransporter();

        // Webhook URL for external notifications (optional)
        this.webhookUrl = process.env.NOTIFICATION_WEBHOOK_URL;
    }

    initEmailTransporter() {
        try {
            // Primary SMTP transporter (independent of Microsoft Graph)
            this.transporter = null;

            if (process.env.NOTIFICATION_EMAIL_USER && process.env.NOTIFICATION_EMAIL_PASS) {
                // Configure SMTP based on email provider
                const emailDomain = process.env.NOTIFICATION_EMAIL_USER.split('@')[1];
                let smtpConfig;

                if (emailDomain.includes('gmail')) {
                    smtpConfig = {
                        service: 'gmail',
                        auth: {
                            user: process.env.NOTIFICATION_EMAIL_USER,
                            pass: process.env.NOTIFICATION_EMAIL_PASS
                        }
                    };
                } else if (emailDomain.includes('outlook') || emailDomain.includes('hotmail')) {
                    smtpConfig = {
                        service: 'hotmail',
                        auth: {
                            user: process.env.NOTIFICATION_EMAIL_USER,
                            pass: process.env.NOTIFICATION_EMAIL_PASS
                        }
                    };
                } else {
                    // Generic SMTP configuration
                    smtpConfig = {
                        host: process.env.SMTP_HOST || 'smtp.gmail.com',
                        port: process.env.SMTP_PORT || 587,
                        secure: process.env.SMTP_SECURE === 'true' || false,
                        auth: {
                            user: process.env.NOTIFICATION_EMAIL_USER,
                            pass: process.env.NOTIFICATION_EMAIL_PASS
                        }
                    };
                }

                this.transporter = nodemailer.createTransporter(smtpConfig);
                console.log('✅ Independent SMTP email transporter initialized');
            } else {
                console.log('⚠️ Email notifications not configured - missing NOTIFICATION_EMAIL_USER or NOTIFICATION_EMAIL_PASS');
                console.log('📋 Set these environment variables for email alerts:');
                console.log('   NOTIFICATION_EMAIL_USER=your-email@domain.com');
                console.log('   NOTIFICATION_EMAIL_PASS=your-app-password');
            }
        } catch (error) {
            console.error('❌ Failed to initialize email transporter:', error.message);
            this.transporter = null;
        }
    }

    /**
     * Handle authentication failure during campaign
     */
    async handleAuthFailure(sessionId, userInfo, failureDetails) {
        const now = new Date();
        const lastAlert = this.alertEmailSent.get(sessionId);

        // Check cooldown to prevent spam
        if (lastAlert && (now.getTime() - lastAlert.getTime()) < this.alertCooldown) {
            console.log(`🚫 Auth failure alert skipped (cooldown active) for session: ${sessionId}`);
            return false;
        }

        // Record this alert time
        this.alertEmailSent.set(sessionId, now);

        const alertData = {
            sessionId,
            userEmail: userInfo?.username || 'Unknown User',
            failureTime: now.toISOString(),
            campaignDetails: failureDetails,
            serverTime: now.toLocaleString(),
            renderUrl: process.env.RENDER_EXTERNAL_URL || 'localhost:3000'
        };

        // Send notifications through multiple channels for redundancy
        const results = await Promise.allSettled([
            this.sendEmailAlert(alertData),
            this.sendWebhookAlert(alertData),
            this.logCriticalAlert(alertData)
        ]);

        // Trigger frontend notification
        this.triggerFrontendAlert(sessionId, alertData);

        // Check if at least one notification method succeeded
        const successCount = results.filter(r => r.status === 'fulfilled').length;
        console.log(`🚨 Authentication failure alert sent through ${successCount}/3 channels for session: ${sessionId}`);

        return successCount > 0;
    }

    /**
     * Send email alert to admin
     */
    async sendEmailAlert(alertData) {
        try {
            if (!this.transporter) {
                // Fallback: Log the alert instead
                console.log('📧 AUTH FAILURE ALERT (Email not configured):');
                console.log('='.repeat(50));
                console.log(`User: ${alertData.userEmail}`);
                console.log(`Session: ${alertData.sessionId}`);
                console.log(`Time: ${alertData.serverTime}`);
                console.log(`Campaign: ${JSON.stringify(alertData.campaignDetails, null, 2)}`);
                console.log(`Action Required: User needs to re-authenticate at ${alertData.renderUrl}/auth/login`);
                console.log('='.repeat(50));
                return;
            }

            const emailContent = `
<!DOCTYPE html>
<html>
<head>
    <style>
        body { font-family: Arial, sans-serif; margin: 20px; }
        .alert-box { background: #fff3cd; border: 1px solid #ffeaa7; padding: 20px; border-radius: 5px; }
        .critical { background: #f8d7da; border: 1px solid #f5c6cb; }
        .details { background: #f8f9fa; padding: 15px; border-radius: 3px; margin: 10px 0; }
        .action-btn { background: #007bff; color: white; padding: 10px 20px; text-decoration: none; border-radius: 5px; display: inline-block; margin: 10px 0; }
        code { background: #e9ecef; padding: 2px 5px; border-radius: 3px; }
    </style>
</head>
<body>
    <div class="alert-box critical">
        <h2>🚨 LGA Email Campaign Authentication Failure</h2>

        <div class="details">
            <h3>Failure Details:</h3>
            <p><strong>User:</strong> ${alertData.userEmail}</p>
            <p><strong>Session ID:</strong> <code>${alertData.sessionId}</code></p>
            <p><strong>Failure Time:</strong> ${alertData.serverTime}</p>
            <p><strong>Server:</strong> ${alertData.renderUrl}</p>
        </div>

        <div class="details">
            <h3>Campaign Impact:</h3>
            <p><strong>Campaign Status:</strong> ${alertData.campaignDetails.status || 'Failed'}</p>
            <p><strong>Emails Processed:</strong> ${alertData.campaignDetails.processed || 'Unknown'}</p>
            <p><strong>Current Email:</strong> ${alertData.campaignDetails.currentEmail || 'Unknown'}</p>
            <p><strong>Error:</strong> User authentication expired during campaign execution</p>
        </div>

        <div class="details">
            <h3>Required Actions:</h3>
            <ol>
                <li>User needs to re-authenticate immediately</li>
                <li>Campaign has been paused/failed</li>
                <li>Resume campaign after successful authentication</li>
            </ol>
        </div>

        <a href="${alertData.renderUrl}/auth/login" class="action-btn">🔐 Re-authenticate Now</a>

        <p style="margin-top: 20px; color: #666; font-size: 12px;">
            This is an automated alert from LGA Email Automation System.<br>
            Time: ${alertData.failureTime}
        </p>
    </div>
</body>
</html>
            `;

            const mailOptions = {
                from: process.env.NOTIFICATION_EMAIL_USER || 'noreply@lga-system.com',
                to: this.adminEmail,
                subject: `🚨 LGA Authentication Failure Alert - ${alertData.userEmail}`,
                html: emailContent,
                priority: 'high',
                headers: {
                    'X-Priority': '1',
                    'X-MSMail-Priority': 'High',
                    'Importance': 'high'
                }
            };

            await this.transporter.sendMail(mailOptions);
            console.log(`📧 Authentication failure email sent to ${this.adminEmail}`);

        } catch (error) {
            console.error('❌ Failed to send authentication failure email:', error.message);
            throw error; // Re-throw for Promise.allSettled handling
        }
    }

    /**
     * Send webhook notification to external service
     */
    async sendWebhookAlert(alertData) {
        try {
            if (!this.webhookUrl) {
                console.log('🔗 No webhook URL configured, skipping webhook alert');
                return;
            }

            const webhookPayload = {
                type: 'AUTH_FAILURE',
                timestamp: alertData.failureTime,
                severity: 'critical',
                service: 'LGA Email Automation',
                user: alertData.userEmail,
                session: alertData.sessionId,
                server: alertData.renderUrl,
                details: alertData.campaignDetails,
                action_required: 'Re-authentication needed',
                alert_url: `${alertData.renderUrl}/auth/login`
            };

            const axios = require('axios');
            const response = await axios.post(this.webhookUrl, webhookPayload, {
                headers: {
                    'Content-Type': 'application/json',
                    'User-Agent': 'LGA-Auth-Failure-Notifier'
                },
                timeout: 10000 // 10 second timeout
            });

            console.log(`🔗 Webhook alert sent successfully (${response.status})`);

        } catch (error) {
            console.error('❌ Failed to send webhook alert:', error.message);
            throw error; // Re-throw for Promise.allSettled handling
        }
    }

    /**
     * Log critical alert with structured format (always works)
     */
    async logCriticalAlert(alertData) {
        try {
            const logEntry = {
                timestamp: new Date().toISOString(),
                level: 'CRITICAL',
                type: 'AUTH_FAILURE_ALERT',
                user: alertData.userEmail,
                session: alertData.sessionId,
                server: alertData.renderUrl,
                campaign_details: alertData.campaignDetails,
                action_required: 'IMMEDIATE_RE_AUTHENTICATION',
                admin_contact: this.adminEmail
            };

            // Structured logging (always visible in server logs)
            console.log('🚨🚨🚨 CRITICAL AUTHENTICATION FAILURE ALERT 🚨🚨🚨');
            console.log('='.repeat(60));
            console.log(`🕐 Time: ${alertData.serverTime}`);
            console.log(`👤 User: ${alertData.userEmail}`);
            console.log(`🔑 Session: ${alertData.sessionId}`);
            console.log(`🌐 Server: ${alertData.renderUrl}`);
            console.log(`📧 Admin: ${this.adminEmail}`);
            console.log(`📊 Campaign Status: ${JSON.stringify(alertData.campaignDetails, null, 2)}`);
            console.log(`⚡ ACTION REQUIRED: User must re-authenticate immediately`);
            console.log(`🔗 Auth URL: ${alertData.renderUrl}/auth/login`);
            console.log('='.repeat(60));

            // Also write to structured log format for log aggregation services
            console.log('AUTH_FAILURE_JSON_LOG:', JSON.stringify(logEntry));

        } catch (error) {
            // This should never fail, but just in case
            console.error('❌ Even logging failed:', error.message);
            console.log('EMERGENCY AUTH FAILURE ALERT - ALL SYSTEMS DOWN');
            throw error;
        }
    }

    /**
     * Trigger frontend notification (store in session/memory for frontend to poll)
     */
    triggerFrontendAlert(sessionId, alertData) {
        // Store alert data for frontend polling
        const frontendAlert = {
            type: 'AUTH_FAILURE',
            message: 'Authentication expired during email campaign',
            severity: 'critical',
            timestamp: new Date().toISOString(),
            actions: [{
                text: 'Re-authenticate Now',
                url: '/auth/login',
                style: 'primary'
            }],
            details: {
                userEmail: alertData.userEmail,
                failureTime: alertData.serverTime,
                sessionId: alertData.sessionId
            },
            autoShow: true,
            persistent: true // Don't auto-dismiss
        };

        // Store in a global notifications cache (you can implement Redis or database later)
        if (!global.frontendNotifications) {
            global.frontendNotifications = new Map();
        }

        const sessionNotifications = global.frontendNotifications.get(sessionId) || [];
        sessionNotifications.push(frontendAlert);
        global.frontendNotifications.set(sessionId, sessionNotifications);

        console.log(`🔔 Frontend alert queued for session: ${sessionId}`);
    }

    /**
     * Get pending notifications for a session (for frontend polling)
     */
    static getPendingNotifications(sessionId) {
        if (!global.frontendNotifications) {
            return [];
        }

        const notifications = global.frontendNotifications.get(sessionId) || [];

        // Clear notifications after retrieving (one-time delivery)
        global.frontendNotifications.delete(sessionId);

        return notifications;
    }

    /**
     * Clear cooldown for testing or immediate re-alert
     */
    clearCooldown(sessionId) {
        this.alertEmailSent.delete(sessionId);
        console.log(`🔄 Alert cooldown cleared for session: ${sessionId}`);
    }
}

module.exports = AuthFailureNotifier;