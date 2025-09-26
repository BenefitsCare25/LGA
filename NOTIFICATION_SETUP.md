# Authentication Failure Notification Setup

## Overview

This system provides **triple-redundancy notifications** when authentication fails during email campaigns:

1. **SMTP Email Notifications** (Independent of Microsoft Graph)
2. **Webhook Notifications** (External service integration)
3. **Structured Logging** (Always visible in server logs)
4. **Frontend Popup Notifications** (Real-time user alerts)

## Environment Variables Required

### Email Notifications (Primary Alert Channel)

```bash
# Required for email notifications
NOTIFICATION_EMAIL_USER=your-email@domain.com
NOTIFICATION_EMAIL_PASS=your-app-password

# Optional SMTP configuration (auto-detected for gmail/outlook)
SMTP_HOST=smtp.gmail.com
SMTP_PORT=587
SMTP_SECURE=false
```

### Webhook Notifications (Secondary Alert Channel)

```bash
# Optional webhook for external services (Slack, Discord, etc.)
NOTIFICATION_WEBHOOK_URL=https://hooks.slack.com/services/YOUR/WEBHOOK/URL
```

### Server Configuration

```bash
# Required for proper auth URLs in alerts
RENDER_EXTERNAL_URL=https://your-app.onrender.com
```

## Setup Instructions

### 1. Email Setup (Gmail Example)

1. Go to Google Account Settings → Security → 2-Step Verification
2. Enable 2-Step Verification if not already enabled
3. Go to App Passwords and generate a new app password
4. Set environment variables in Render:
   ```
   NOTIFICATION_EMAIL_USER=your-email@gmail.com
   NOTIFICATION_EMAIL_PASS=your-16-digit-app-password
   ```

### 2. Email Setup (Outlook Example)

1. Go to Microsoft Account Security → Advanced Security Options
2. Enable App Passwords
3. Generate an app password for "Email"
4. Set environment variables:
   ```
   NOTIFICATION_EMAIL_USER=your-email@outlook.com
   NOTIFICATION_EMAIL_PASS=your-app-password
   ```

### 3. Webhook Setup (Slack Example)

1. Go to Slack → Apps → Incoming Webhooks
2. Create a new webhook for your channel
3. Copy the webhook URL
4. Set environment variable:
   ```
   NOTIFICATION_WEBHOOK_URL=https://hooks.slack.com/services/XXX/YYY/ZZZ
   ```

### 4. Webhook Setup (Discord Example)

1. Go to Discord Server Settings → Integrations → Webhooks
2. Create a new webhook
3. Copy the webhook URL
4. Set environment variable:
   ```
   NOTIFICATION_WEBHOOK_URL=https://discord.com/api/webhooks/XXX/YYY
   ```

## Notification Behavior

### When Authentication Fails

1. **Immediate Multi-Channel Alert**: System attempts all 3 notification methods simultaneously
2. **Cooldown Protection**: 30-minute cooldown between alerts for the same session
3. **Frontend Notification**: Real-time popup appears in browser with re-auth button
4. **Persistent Logging**: Critical alert always appears in server logs

### Alert Contains

- User email address
- Session ID for troubleshooting
- Exact failure time
- Campaign progress (emails sent/total)
- Direct re-authentication link
- Server status information

## Testing the System

### Test Email Notifications

```bash
curl -X POST http://localhost:3000/api/notifications/test-auth-failure \
  -H "Content-Type: application/json" \
  -d '{"testEmail": "test@example.com"}'
```

### Check Notification Status

```bash
curl http://localhost:3000/api/notifications/status
```

### Test Frontend Notifications

1. Open browser developer console
2. Run: `testNotification()`
3. Should see popup notification appear

## Troubleshooting

### No Email Notifications

1. Check environment variables are set correctly
2. Verify app passwords are generated (not regular passwords)
3. Check server logs for SMTP connection errors
4. Test with a simple email client using same credentials

### No Webhook Notifications

1. Verify webhook URL is accessible
2. Check webhook service logs for incoming requests
3. Test webhook URL manually with curl

### No Frontend Notifications

1. Verify JavaScript console for errors
2. Check if notification polling is active
3. Confirm session ID is being passed correctly

## Log Format

### Human-Readable Log
```
🚨🚨🚨 CRITICAL AUTHENTICATION FAILURE ALERT 🚨🚨🚨
============================================================
🕐 Time: 12/26/2024, 3:45:30 PM
👤 User: user@example.com
🔑 Session: session_abc123_1640123456
🌐 Server: https://your-app.onrender.com
📧 Admin: benefitscare@inspro.com.sg
📊 Campaign Status: {"status":"Failed","processed":"15/375","currentEmail":"test@example.com"}
⚡ ACTION REQUIRED: User must re-authenticate immediately
🔗 Auth URL: https://your-app.onrender.com/auth/login
============================================================
```

### JSON Log (for log aggregation)
```json
{
  "timestamp": "2024-12-26T15:45:30.123Z",
  "level": "CRITICAL",
  "type": "AUTH_FAILURE_ALERT",
  "user": "user@example.com",
  "session": "session_abc123_1640123456",
  "server": "https://your-app.onrender.com",
  "campaign_details": {"status":"Failed","processed":"15/375"},
  "action_required": "IMMEDIATE_RE_AUTHENTICATION",
  "admin_contact": "benefitscare@inspro.com.sg"
}
```

## Security Notes

- Email credentials are app passwords, not main account passwords
- Webhook URLs should be kept secret and rotated regularly
- All notifications include only necessary information, no sensitive data
- Session IDs are included for troubleshooting but don't expose user data