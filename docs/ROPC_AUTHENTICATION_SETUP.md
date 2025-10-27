# ROPC Authentication Setup Guide
## Continuous Email Automation with Username/Password

**Last Updated**: 2025-10-27
**Status**: Implementation Guide
**Authentication Method**: Resource Owner Password Credentials (ROPC) Flow

---

## Table of Contents

1. [Overview](#overview)
2. [How ROPC Flow Works](#how-ropc-flow-works)
3. [Requirements & Limitations](#requirements--limitations)
4. [Implementation Plan](#implementation-plan)
5. [Technical Implementation](#technical-implementation)
6. [Environment Configuration](#environment-configuration)
7. [Integration with Existing System](#integration-with-existing-system)
8. [Troubleshooting](#troubleshooting)
9. [Alternative Approach](#alternative-approach-refresh-token-bootstrap)
10. [Comparison & Recommendations](#comparison--recommendations)

---

## Overview

This guide documents how to implement continuous, unattended email automation using stored username/password credentials. The Resource Owner Password Credentials (ROPC) flow allows direct authentication with Microsoft Graph API without browser interaction.

### Current Problem
- Existing system requires OAuth login via browser
- Access tokens expire after 1 hour
- Manual re-authentication needed for long campaigns
- Not suitable for unattended server operations

### ROPC Solution
- Authenticate using stored username/password
- Obtain refresh token valid for 90+ days
- Automatic token refresh every 50 minutes
- Fully unattended operation
- No 1-hour campaign limitations

---

## How ROPC Flow Works

### Authentication Flow Diagram

```
┌─────────────────────────────────────────────────┐
│ Step 1: Server Startup                          │
├─────────────────────────────────────────────────┤
│ • Read credentials from environment variables   │
│   - AZURE_SERVICE_ACCOUNT_USERNAME              │
│   - AZURE_SERVICE_ACCOUNT_PASSWORD              │
│   - AZURE_CLIENT_ID, CLIENT_SECRET, TENANT_ID   │
└─────────────────────────────────────────────────┘
                    ↓
┌─────────────────────────────────────────────────┐
│ Step 2: Initial Authentication (ROPC)           │
├─────────────────────────────────────────────────┤
│ POST https://login.microsoftonline.com/         │
│      {tenant}/oauth2/v2.0/token                 │
│                                                  │
│ Payload:                                        │
│ • grant_type: password                          │
│ • username: BenefitsCare@inspro.com.sg         │
│ • password: [from environment]                  │
│ • client_id: [from environment]                 │
│ • client_secret: [from environment]             │
│ • scope: https://graph.microsoft.com/.default   │
│           offline_access                        │
└─────────────────────────────────────────────────┘
                    ↓
┌─────────────────────────────────────────────────┐
│ Step 3: Token Response                          │
├─────────────────────────────────────────────────┤
│ Response:                                       │
│ • access_token: [Valid 1 hour]                  │
│ • refresh_token: [Valid 90+ days]               │
│ • expires_in: 3600                              │
│ • token_type: Bearer                            │
└─────────────────────────────────────────────────┘
                    ↓
┌─────────────────────────────────────────────────┐
│ Step 4: Session Creation & Persistence          │
├─────────────────────────────────────────────────┤
│ • Create authenticated session                  │
│ • Store refresh token (encrypted)               │
│ • Save to persistent storage                    │
│ • Session persists across server restarts       │
└─────────────────────────────────────────────────┘
                    ↓
┌─────────────────────────────────────────────────┐
│ Step 5: Automatic Token Refresh (Every 50min)   │
├─────────────────────────────────────────────────┤
│ POST https://login.microsoftonline.com/         │
│      {tenant}/oauth2/v2.0/token                 │
│                                                  │
│ Payload:                                        │
│ • grant_type: refresh_token                     │
│ • refresh_token: [from storage]                 │
│ • client_id: [from environment]                 │
│ • client_secret: [from environment]             │
│ • scope: https://graph.microsoft.com/.default   │
│                                                  │
│ Returns: New access_token + refresh_token       │
│ → Updates session automatically                 │
│ → Continues indefinitely                        │
└─────────────────────────────────────────────────┘
                    ↓
┌─────────────────────────────────────────────────┐
│ Step 6: Email Campaigns                         │
├─────────────────────────────────────────────────┤
│ • Send emails using current access token        │
│ • No 1-hour limitation                          │
│ • Automatic refresh during long campaigns       │
│ • Fully unattended operation                    │
│ • Works across server restarts                  │
└─────────────────────────────────────────────────┘
```

### Token Lifecycle

| Time | Event | Token Status |
|------|-------|--------------|
| 0:00 | Initial authentication | Access token valid, refresh token stored |
| 0:50 | Proactive refresh | New access token obtained |
| 1:40 | Proactive refresh | New access token obtained |
| 2:30 | Proactive refresh | New access token obtained |
| ... | Continues automatically | Indefinite operation |
| 90+ days | Refresh token expires | Re-authentication needed |

---

## Requirements & Limitations

### ✅ Requirements (Must Have All)

#### 1. Service Account Configuration
- **Account Type**: Work/school account in Azure AD
- **Email**: BenefitsCare@inspro.com.sg
- **Password**: Valid and not expired
- **Permissions**: Mail.Send, Files.ReadWrite.All, Mail.ReadWrite

#### 2. MFA Status
⚠️ **CRITICAL**: Multi-Factor Authentication **MUST BE DISABLED**

ROPC flow is incompatible with MFA. The service account must allow password-only authentication.

**To verify MFA status:**
1. Go to Azure Portal → Azure AD → Users
2. Find service account: BenefitsCare@inspro.com.sg
3. Check MFA status → Must be "Disabled"

#### 3. Azure AD Tenant Configuration
- ROPC grant type must be enabled (usually enabled by default)
- Client app has delegated permissions with admin approval
- No Conditional Access policies blocking password authentication

#### 4. Environment Variables (Already Configured)
```env
AZURE_TENANT_ID=496f1a0a-6a4a-4436-b4b3-fdb75d235254
AZURE_CLIENT_ID=d5042b07-f7dc-4706-bf6f-847a7bd1538d
AZURE_CLIENT_SECRET=6eL8Q~oD2j72+Pokej10pwuxs.MtEXddsxzxwc5n
AZURE_SERVICE_ACCOUNT_USERNAME=BenefitsCare@inspro.com.sg
AZURE_SERVICE_ACCOUNT_PASSWORD=Bs626144798454uz
```

### ❌ Limitations

| Limitation | Impact | Severity |
|------------|--------|----------|
| **Deprecated by Microsoft** | Could stop working at any time | 🔴 Critical |
| **No MFA Support** | Bypasses two-factor authentication | 🔴 Security Risk |
| **Personal Accounts** | Doesn't work with @outlook.com, @hotmail.com | 🔴 Blocker |
| **Conditional Access Bypass** | Bypasses modern security policies | 🟡 Policy Violation |
| **Not Recommended by Microsoft** | Against best practices | 🟡 Warning |
| **Legacy Authentication** | Being phased out industry-wide | 🟡 Future Risk |

### ⚠️ When ROPC Flow FAILS

**Error: `AADSTS50076` - Multi-factor authentication required**
- **Cause**: MFA is enabled on service account
- **Solution**: Disable MFA or use refresh token bootstrap approach

**Error: `AADSTS50126` - Invalid username or password**
- **Cause**: Wrong credentials or password expired
- **Solution**: Verify credentials in Azure AD, update if needed

**Error: `AADSTS700016` - ROPC not supported for this application**
- **Cause**: Conditional Access policy blocks ROPC
- **Solution**: Adjust policy or use refresh token approach

**Error: `AADSTS50055` - Password expired**
- **Cause**: Service account password needs to be changed
- **Solution**: Update password in Azure AD and environment variable

**Error: `AADSTS53003` - Access blocked by Conditional Access**
- **Cause**: Conditional Access requires modern authentication
- **Solution**: Exclude service account or use refresh token approach

---

## Implementation Plan

### Phase 1: Create ROPC Authentication Module

**File**: `middleware/ropcGraphAuth.js`

Create new authentication module with:
- Username/password token acquisition
- Refresh token management
- Session creation and persistence
- Integration with existing token refresh system

### Phase 2: Enhance Delegated Auth Provider

**File**: `middleware/delegatedGraphAuth.js`

Add bootstrap capability:
- Detect ROPC credentials on startup
- Create deterministic session ID from service account email
- Initialize session using ROPC tokens
- Fall back to OAuth if ROPC unavailable

### Phase 3: Update Server Startup

**File**: `server.js`

Add automatic authentication:
- Check for service account credentials
- Attempt ROPC authentication on startup
- Log authentication method used
- Create default session for automation

### Phase 4: Testing & Validation

Test scenarios:
- Initial authentication with username/password
- Token refresh after 1 hour
- Session persistence across server restarts
- Long-running campaigns (2+ hours)
- Error handling for invalid credentials

---

## Technical Implementation

### 1. ROPC Token Acquisition

```javascript
/**
 * middleware/ropcGraphAuth.js
 * Resource Owner Password Credentials Authentication
 */

const msal = require('@azure/msal-node');
const { Client } = require('@microsoft/microsoft-graph-client');

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
            }
        };

        this.msalInstance = new msal.ConfidentialClientApplication(this.msalConfig);
    }

    /**
     * Authenticate using username/password (ROPC flow)
     */
    async authenticateWithPassword() {
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
            const response = await this.msalInstance.acquireTokenByUsernamePassword(ropcRequest);

            console.log('✅ ROPC authentication successful');
            console.log(`👤 Authenticated as: ${response.account.username}`);

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

            // Provide helpful error messages
            if (error.errorCode === 'invalid_grant') {
                console.error('🔐 Invalid credentials - check username/password');
            } else if (error.message.includes('AADSTS50076')) {
                console.error('🔐 MFA required - ROPC cannot work with MFA enabled');
                console.error('💡 Solution: Disable MFA on service account or use refresh token approach');
            } else if (error.message.includes('AADSTS700016')) {
                console.error('🔐 ROPC not supported - Conditional Access policy blocking ROPC');
                console.error('💡 Solution: Use refresh token bootstrap approach instead');
            }

            return {
                success: false,
                error: error.message,
                errorCode: error.errorCode
            };
        }
    }

    /**
     * Create session from ROPC tokens
     */
    async createSessionFromROPC(delegatedAuthProvider) {
        const authResult = await this.authenticateWithPassword();

        if (!authResult.success) {
            return authResult;
        }

        // Create deterministic session ID from service account email
        const sessionId = this.generateSessionId(this.username);

        // Store tokens in delegated auth provider
        delegatedAuthProvider.userTokens.set(sessionId, {
            accessToken: authResult.accessToken,
            refreshToken: authResult.refreshToken,
            expiresOn: authResult.expiresOn,
            account: authResult.account,
            scopes: authResult.scopes,
            createdAt: new Date().toISOString(),
            authMethod: 'ROPC'
        });

        console.log(`✅ Session created: ${sessionId}`);

        // Save to persistent storage
        const persistentStorage = require('../utils/persistentStorage');
        await persistentStorage.saveSessions(delegatedAuthProvider.userTokens);

        return {
            success: true,
            sessionId: sessionId,
            user: authResult.account.username
        };
    }

    /**
     * Generate deterministic session ID from email
     */
    generateSessionId(email) {
        const crypto = require('crypto');
        return crypto.createHash('sha256')
            .update(email.toLowerCase())
            .digest('hex')
            .substring(0, 32);
    }

    /**
     * Check if ROPC credentials are configured
     */
    static isConfigured() {
        return !!(
            process.env.AZURE_SERVICE_ACCOUNT_USERNAME &&
            process.env.AZURE_SERVICE_ACCOUNT_PASSWORD &&
            process.env.AZURE_CLIENT_ID &&
            process.env.AZURE_CLIENT_SECRET &&
            process.env.AZURE_TENANT_ID
        );
    }
}

module.exports = ROPCGraphAuth;
```

### 2. Bootstrap on Server Startup

```javascript
/**
 * server.js
 * Add to server initialization
 */

const { getDelegatedAuthProvider } = require('./middleware/delegatedGraphAuth');
const ROPCGraphAuth = require('./middleware/ropcGraphAuth');

// Bootstrap service account authentication on startup
async function bootstrapServiceAccount() {
    if (!ROPCGraphAuth.isConfigured()) {
        console.log('⚠️ ROPC credentials not configured - OAuth browser flow required');
        return null;
    }

    console.log('🚀 Bootstrapping service account via ROPC...');

    const ropcAuth = new ROPCGraphAuth();
    const delegatedAuth = getDelegatedAuthProvider();

    const result = await ropcAuth.createSessionFromROPC(delegatedAuth);

    if (result.success) {
        console.log('✅ Service account authenticated and ready');
        console.log('📧 Email automation enabled for unattended operation');
        console.log(`🔑 Session ID: ${result.sessionId}`);

        // Store default session ID for automation routes
        global.DEFAULT_SESSION_ID = result.sessionId;

        return result.sessionId;
    } else {
        console.error('❌ Service account bootstrap failed:', result.error);
        console.error('⚠️ Falling back to OAuth browser flow');
        return null;
    }
}

// Add to server startup sequence
async function startServer() {
    // ... existing server setup ...

    // Bootstrap service account
    await bootstrapServiceAccount();

    // Start server
    app.listen(PORT, () => {
        console.log(`Server running on port ${PORT}`);
    });
}

startServer();
```

### 3. Use Default Session in Email Routes

```javascript
/**
 * routes/email-automation.js
 * Update to use default session when available
 */

router.post('/send-campaign', async (req, res) => {
    try {
        // Use default session if available, otherwise require authentication
        const sessionId = global.DEFAULT_SESSION_ID || req.sessionId;

        if (!sessionId) {
            return res.status(401).json({
                error: 'Authentication required',
                message: 'No authenticated session available'
            });
        }

        const delegatedAuth = getDelegatedAuthProvider();
        const graphClient = await delegatedAuth.getGraphClient(sessionId);

        // ... rest of email sending logic ...
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});
```

### 4. Token Refresh Integration

The ROPC flow integrates seamlessly with existing token refresh:

```javascript
// Existing token refresh in delegatedGraphAuth.js works automatically
// No changes needed - it already handles refresh tokens from any source

// Token refresh happens in these locations:
// 1. delegatedGraphAuth.js:177-285 - refreshSessionToken()
// 2. campaignTokenManager.js:75-96 - ensureValidToken()
// 3. EmailSender.js:81-109 - Token validation before each email
```

---

## Environment Configuration

### Current Configuration (Already Set Up)

Your Render environment variables:

```env
# Azure AD Configuration
AZURE_TENANT_ID=496f1a0a-6a4a-4436-b4b3-fdb75d235254
AZURE_CLIENT_ID=d5042b07-f7dc-4706-bf6f-847a7bd1538d
AZURE_CLIENT_SECRET=6eL8Q~oD2j72+Pokej10pwuxs.MtEXddsxzxwc5n

# Service Account Credentials (for ROPC)
AZURE_SERVICE_ACCOUNT_USERNAME=BenefitsCare@inspro.com.sg
AZURE_SERVICE_ACCOUNT_PASSWORD=Bs626144798454uz

# Other Configuration
RENDER_EXTERNAL_URL=https://your-app.onrender.com
```

### No Additional Configuration Needed

The ROPC implementation will automatically detect and use these existing environment variables. No changes to Render configuration required.

### Optional Configuration

```env
# Optional: Disable ROPC and force OAuth browser flow
DISABLE_ROPC_AUTH=false

# Optional: Enable verbose ROPC logging
ROPC_DEBUG_LOGGING=true
```

---

## Integration with Existing System

### Leverages Existing Infrastructure

The ROPC implementation integrates with your existing authentication system:

| Component | File | Integration Point |
|-----------|------|-------------------|
| **Token Storage** | `utils/persistentStorage.js` | ROPC stores refresh tokens using existing encryption |
| **Token Refresh** | `middleware/delegatedGraphAuth.js:177-285` | ROPC tokens refresh using existing logic |
| **Campaign Management** | `utils/campaignTokenManager.js` | ROPC sessions tracked like OAuth sessions |
| **Email Sending** | `utils/EmailSender.js` | No changes needed - uses same token system |
| **Session Persistence** | `data/sessions.json` | ROPC sessions persist across restarts |

### Authentication Flow Comparison

**Before ROPC (OAuth Browser Flow)**:
```
User → Browser → Microsoft Login → OAuth Callback → Token → Session
```

**After ROPC (Password Flow)**:
```
Server Startup → Environment Vars → ROPC API Call → Token → Session
```

**Both flows result in the same session structure**, so all existing code continues to work without modification.

### Fallback Behavior

If ROPC authentication fails, the system automatically falls back to OAuth:

```javascript
// server.js bootstrap logic
const sessionId = await bootstrapServiceAccount();

if (!sessionId) {
    console.log('⚠️ ROPC unavailable - OAuth browser flow required');
    // Existing OAuth routes remain available
    // Users can still authenticate via /auth/login
}
```

---

## Troubleshooting

### Common Issues & Solutions

#### Issue 1: AADSTS50076 - MFA Required

**Symptom**:
```
❌ ROPC authentication failed: AADSTS50076
🔐 MFA required - ROPC cannot work with MFA enabled
```

**Cause**: Multi-Factor Authentication is enabled on the service account

**Solution**:
1. Go to Azure Portal → Azure AD → Users
2. Find: BenefitsCare@inspro.com.sg
3. Disable MFA for this account
4. Restart server to retry authentication

**Alternative**: Use refresh token bootstrap approach instead (see below)

---

#### Issue 2: AADSTS50126 - Invalid Credentials

**Symptom**:
```
❌ ROPC authentication failed: AADSTS50126
🔐 Invalid credentials - check username/password
```

**Cause**: Wrong username, password, or password expired

**Solution**:
1. Verify credentials in Azure AD
2. Check if password expired
3. Update environment variables in Render
4. Restart service

---

#### Issue 3: AADSTS700016 - ROPC Not Supported

**Symptom**:
```
❌ ROPC authentication failed: AADSTS700016
🔐 ROPC not supported - Conditional Access policy blocking ROPC
```

**Cause**: Conditional Access policy requires modern authentication

**Solution**:
1. Go to Azure Portal → Azure AD → Security → Conditional Access
2. Find policy blocking legacy authentication
3. Exclude service account from policy
4. OR: Use refresh token bootstrap approach instead

---

#### Issue 4: Token Refresh Failures After Initial Success

**Symptom**:
```
✅ ROPC authentication successful
... (1 hour later) ...
❌ Token refresh failed: invalid_grant
```

**Cause**: Refresh token expired or revoked

**Solution**:
1. Check if admin revoked access
2. Verify service account not disabled
3. Restart server to re-authenticate
4. Check refresh token validity (should be 90+ days)

---

#### Issue 5: Session Not Persisting Across Restarts

**Symptom**:
```
Server restarts but session not restored
Manual authentication required each time
```

**Cause**: Persistent storage not working correctly

**Solution**:
1. Check `data/sessions.json` file exists
2. Verify file permissions on Render
3. Check encryption key in `data/.encryption-key`
4. Review logs for storage errors

**Diagnostic Command**:
```bash
# Check if session data persists
ls -la data/
cat data/sessions.json
```

---

### Debug Logging

Enable verbose logging for troubleshooting:

```javascript
// Add to server.js or ropcGraphAuth.js
process.env.ROPC_DEBUG_LOGGING = 'true';
process.env.NODE_ENV = 'development';
```

This will log:
- ROPC authentication requests
- Token refresh attempts
- Session creation and storage
- Error details with error codes

---

## Alternative Approach: Refresh Token Bootstrap

If ROPC doesn't work (MFA enabled, Conditional Access blocks it, or Microsoft deprecates it), use the **Refresh Token Bootstrap** approach instead.

### Overview

Instead of storing password, store the refresh token directly:

```
1. One-time OAuth login via browser
2. Extract refresh token from session
3. Store refresh token in environment variable
4. Server bootstraps session from refresh token on startup
5. Automatic refresh maintains session indefinitely
```

### Advantages Over ROPC

| Feature | ROPC | Refresh Token Bootstrap |
|---------|------|------------------------|
| **MFA Compatible** | ❌ No | ✅ Yes |
| **Conditional Access** | ⚠️ Bypassed | ✅ Compliant |
| **Microsoft Approved** | ❌ Deprecated | ✅ Recommended |
| **Long-term Stability** | ⚠️ May break | ✅ Stable |
| **Security** | ⚠️ Lower | ✅ Higher |
| **Initial Setup** | Fully automated | One-time OAuth login |

### Implementation Steps

#### 1. Add Token Extraction Endpoint

```javascript
// routes/auth.js
router.get('/get-refresh-token', requireDelegatedAuth, (req, res) => {
    const sessionId = req.sessionId;
    const tokenData = req.delegatedAuth.userTokens.get(sessionId);

    if (!tokenData || !tokenData.refreshToken) {
        return res.status(404).json({ error: 'No refresh token available' });
    }

    res.json({
        message: 'Copy this refresh token to BOOTSTRAP_REFRESH_TOKEN environment variable',
        refreshToken: tokenData.refreshToken,
        user: tokenData.account.username,
        instructions: [
            '1. Copy the refresh token above',
            '2. Add to Render environment variables as BOOTSTRAP_REFRESH_TOKEN',
            '3. Add BOOTSTRAP_SESSION_EMAIL with your email',
            '4. Restart the service',
            '5. Server will auto-authenticate on every startup'
        ]
    });
});
```

#### 2. Create Bootstrap Utility

```javascript
// utils/sessionBootstrap.js
const crypto = require('crypto');

class SessionBootstrap {
    /**
     * Bootstrap session from environment variable refresh token
     */
    static async bootstrapFromEnv(delegatedAuthProvider) {
        const refreshToken = process.env.BOOTSTRAP_REFRESH_TOKEN;
        const email = process.env.BOOTSTRAP_SESSION_EMAIL;

        if (!refreshToken || !email) {
            return { success: false, error: 'Bootstrap credentials not configured' };
        }

        try {
            // Create deterministic session ID
            const sessionId = this.generateSessionId(email);

            // Create session with stored refresh token
            const account = {
                username: email,
                name: email.split('@')[0],
                environment: 'bootstrap',
                tenantId: process.env.AZURE_TENANT_ID
            };

            // Store session with refresh token
            delegatedAuthProvider.userTokens.set(sessionId, {
                refreshToken: refreshToken,
                account: account,
                expiresOn: new Date(Date.now() + 3600000), // 1 hour from now
                needsRefresh: true,
                scopes: [
                    'https://graph.microsoft.com/User.Read',
                    'https://graph.microsoft.com/Files.ReadWrite.All',
                    'https://graph.microsoft.com/Mail.Send',
                    'https://graph.microsoft.com/Mail.ReadWrite'
                ],
                createdAt: new Date().toISOString(),
                authMethod: 'bootstrap'
            });

            console.log(`✅ Session bootstrapped from environment: ${sessionId}`);

            // Immediately refresh to get valid access token
            await delegatedAuthProvider.refreshSessionToken(sessionId);

            // Save to persistent storage
            const persistentStorage = require('./persistentStorage');
            await persistentStorage.saveSessions(delegatedAuthProvider.userTokens);

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

    static generateSessionId(email) {
        return crypto.createHash('sha256')
            .update(email.toLowerCase())
            .digest('hex')
            .substring(0, 32);
    }

    static isConfigured() {
        return !!(
            process.env.BOOTSTRAP_REFRESH_TOKEN &&
            process.env.BOOTSTRAP_SESSION_EMAIL
        );
    }
}

module.exports = SessionBootstrap;
```

#### 3. Update Server Startup

```javascript
// server.js
const SessionBootstrap = require('./utils/sessionBootstrap');

async function bootstrapServiceAccount() {
    // Try ROPC first
    if (ROPCGraphAuth.isConfigured()) {
        console.log('🔐 Attempting ROPC authentication...');
        const ropcResult = await bootstrapROPC();
        if (ropcResult) return ropcResult;
    }

    // Fall back to refresh token bootstrap
    if (SessionBootstrap.isConfigured()) {
        console.log('🔐 Attempting refresh token bootstrap...');
        const delegatedAuth = getDelegatedAuthProvider();
        const result = await SessionBootstrap.bootstrapFromEnv(delegatedAuth);

        if (result.success) {
            console.log('✅ Session bootstrapped from refresh token');
            global.DEFAULT_SESSION_ID = result.sessionId;
            return result.sessionId;
        }
    }

    console.log('⚠️ No automatic authentication available - OAuth required');
    return null;
}
```

#### 4. Environment Variables for Bootstrap

```env
# Option 1: ROPC (if MFA disabled)
AZURE_SERVICE_ACCOUNT_USERNAME=BenefitsCare@inspro.com.sg
AZURE_SERVICE_ACCOUNT_PASSWORD=Bs626144798454uz

# Option 2: Refresh Token Bootstrap (if MFA enabled)
BOOTSTRAP_REFRESH_TOKEN=0.AXoAqhpv...  # Long refresh token from /auth/get-refresh-token
BOOTSTRAP_SESSION_EMAIL=BenefitsCare@inspro.com.sg
```

### Setup Process for Refresh Token Bootstrap

1. **Authenticate once via browser**:
   ```
   https://your-app.onrender.com/auth/login
   ```

2. **Extract refresh token**:
   ```
   https://your-app.onrender.com/auth/get-refresh-token
   ```

3. **Add to Render environment variables**:
   ```
   BOOTSTRAP_REFRESH_TOKEN=<copied_token>
   BOOTSTRAP_SESSION_EMAIL=BenefitsCare@inspro.com.sg
   ```

4. **Restart service** - server will auto-authenticate on every startup

5. **Verify** - check logs for "Session bootstrapped from refresh token"

---

## Comparison & Recommendations

### Side-by-Side Comparison

| Feature | ROPC (Password) | Refresh Token Bootstrap | OAuth Browser |
|---------|-----------------|------------------------|---------------|
| **Initial Setup** | None (automated) | One-time OAuth login | Every session |
| **MFA Support** | ❌ Must disable | ✅ Works with MFA | ✅ Works with MFA |
| **Conditional Access** | ⚠️ Bypassed | ✅ Compliant | ✅ Compliant |
| **Microsoft Approval** | ❌ Deprecated | ✅ Recommended | ✅ Standard |
| **Unattended Operation** | ✅ Yes | ✅ Yes | ❌ No |
| **Long-term Stability** | ⚠️ May break | ✅ Stable | ✅ Stable |
| **Security Level** | ⚠️ Lower | ✅ High | ✅ High |
| **Session Duration** | 90+ days | 90+ days | 1 hour |
| **Server Restart** | ✅ Auto-restore | ✅ Auto-restore | ❌ Re-auth needed |
| **Maintenance** | Password updates | Token refresh | Frequent re-auth |

### Recommendation Decision Tree

```
Is MFA enabled on service account?
├─ YES → Use Refresh Token Bootstrap
│         (ROPC won't work)
│
└─ NO → Try ROPC first
        ├─ ROPC works? → Use ROPC (easiest setup)
        │
        └─ ROPC blocked? → Use Refresh Token Bootstrap
                           (Conditional Access blocking ROPC)
```

### My Recommendation

**Primary**: Try **ROPC** first (since you have credentials stored)

**Fallback**: Implement **Refresh Token Bootstrap** for when:
- ROPC fails with MFA errors
- Conditional Access blocks ROPC
- Microsoft deprecates ROPC in future

**Best Practice**: Implement **both approaches** with automatic fallback:
1. Try ROPC on startup
2. If ROPC fails, try refresh token bootstrap
3. If both fail, require OAuth browser login

This gives maximum flexibility and future-proofing.

---

## Next Steps

### Implementation Checklist

- [ ] Create `middleware/ropcGraphAuth.js` with ROPC authentication
- [ ] Update `middleware/delegatedGraphAuth.js` with bootstrap method
- [ ] Modify `server.js` to bootstrap on startup
- [ ] Create `utils/sessionBootstrap.js` for refresh token approach
- [ ] Add `/auth/get-refresh-token` endpoint for token extraction
- [ ] Test ROPC authentication with credentials
- [ ] Test token refresh after 1 hour
- [ ] Test session persistence across server restarts
- [ ] Verify long-running campaigns (2+ hours)
- [ ] Document MFA requirements and limitations

### Verification Tests

After implementation:

1. **Initial Authentication Test**
   ```bash
   # Start server and check logs
   npm start
   # Should see: "✅ Service account authenticated and ready"
   ```

2. **Token Refresh Test**
   ```bash
   # Wait 1 hour, send test email
   # Should see: "🔄 Token refreshed for user: BenefitsCare@inspro.com.sg"
   ```

3. **Server Restart Test**
   ```bash
   # Restart server
   npm start
   # Should see: "✅ Session restored from persistent storage"
   # Should NOT require re-authentication
   ```

4. **Long Campaign Test**
   ```bash
   # Run campaign with 150+ leads (2+ hour duration)
   # Should complete without authentication errors
   ```

### Monitoring

Monitor these after deployment:

- Authentication success rate
- Token refresh frequency
- Session persistence across restarts
- Campaign completion rates
- Authentication error patterns

### Support

For issues or questions:
1. Check troubleshooting section above
2. Review server logs for error codes
3. Verify environment variables in Render
4. Check Azure AD authentication logs
5. Consider switching to refresh token bootstrap if ROPC issues persist

---

**Document Version**: 1.0
**Last Updated**: 2025-10-27
**Status**: Ready for Implementation
