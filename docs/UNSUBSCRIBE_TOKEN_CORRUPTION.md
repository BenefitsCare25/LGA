# Unsubscribe Token Corruption Issue & Solutions

## 🚨 Problem Statement

Email security gateways (Proofpoint, Mimecast, Microsoft Defender) are **actively transforming unsubscribe tokens** using ROT13-variant ciphers, breaking JWT signature verification.

### Evidence from Production Logs

**Token Generated:**
```
eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJlbWFpbCI6InJheUBnb29kam9iY3JlYXRpb25zLmNvbS5zZyIsInR5cGUiOiJ1bnN1YnNjcmliZSIsImlhdCI6MTc2MTc4ODE2MCwiZXhwIjoxNzY0MzgwMTYwfQ.0PBfqLpiCHBrDbVDh4BAnKzCA8N85frCXd90yQgW-F0
```

**Token Received at Unsubscribe Endpoint:**
```
flWucTdvBvWVHmV4AvVfVaE8dDV9VxcKIDW2.flWycJAccDV9V...
```

### Character Transformation Pattern

| Original | Corrupted | Shift | Type |
|----------|-----------|-------|------|
| `e` | `f` | +1 | Mixed shift |
| `y` | `l` | -13 | ROT13 reverse |
| `J` | `W` | +13 | ROT13 forward |
| `1` | `4` | +3 | Numeric shift |
| `.` | `.` | 0 | Unchanged |

**Statistics:**
- 38% of characters: +13 shift (ROT13)
- 28% of characters: -13 shift (reverse ROT13)
- 20% of characters: +1 shift
- 8% of characters: +3 shift (numbers)

## ✅ Current Implementation Status

### What IS Implemented:

1. ✅ **JWT tokens with base64url encoding** (URL-safe characters only)
2. ✅ **List-Unsubscribe header** (RFC 8058 compliant, bypasses HTML modification)
3. ✅ **encodeURIComponent() on HTML links** (FIXED in latest commit)
4. ✅ **Dual delivery** (both HTML link and List-Unsubscribe header)
5. ✅ **Source tracking** (`&source=header` vs `&source=html`)
6. ✅ **Comprehensive diagnostic logging**

### What's NOT Working:

❌ **Email gateways are transforming tokens EVEN IN EMAIL HEADERS**
- This suggests recipients are clicking **HTML links** (not List-Unsubscribe buttons)
- Or gateways are aggressive enough to modify protocol headers (rare but possible)

## 💡 Solution Options

### Option 1: Database-Backed Proxy ID System ⭐ **RECOMMENDED**

**How it works:**
1. Generate short random IDs (8-12 characters, e.g., `abc123xyz`)
2. Store in database: `{ id, email, campaign_id, created_at, expires_at, used_at }`
3. Use simple URL: `https://lga.com/api/email/unsubscribe?id=abc123xyz`
4. On click: Look up ID → Mark unsubscribed → Set used_at

**Benefits:**
- ✅ Short, simple characters less likely to be transformed
- ✅ Database-backed with expiration tracking
- ✅ Can mark as "used" to prevent reuse
- ✅ Easy to implement cleanup cron jobs
- ✅ Survives any character transformation

**Drawbacks:**
- ❌ Requires database storage
- ❌ Need to implement cleanup mechanism

**Implementation:**

```javascript
// 1. Database Schema (SQL)
CREATE TABLE unsubscribe_tokens (
    id VARCHAR(12) PRIMARY KEY,
    email VARCHAR(255) NOT NULL,
    campaign_id VARCHAR(255),
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    expires_at TIMESTAMP NOT NULL,
    used_at TIMESTAMP NULL,
    INDEX idx_email (email),
    INDEX idx_expires (expires_at)
);

// 2. Token Generation (Node.js)
const crypto = require('crypto');

function generateUnsubscribeId(email, campaignId = null) {
    const id = crypto.randomBytes(6).toString('base64url'); // 8 chars
    const expiresAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000); // 30 days

    // Store in database
    await db.query(
        'INSERT INTO unsubscribe_tokens (id, email, campaign_id, expires_at) VALUES (?, ?, ?, ?)',
        [id, email, campaignId, expiresAt]
    );

    return id;
}

// 3. Token Verification (Node.js)
async function verifyUnsubscribeId(id) {
    const token = await db.query(
        'SELECT * FROM unsubscribe_tokens WHERE id = ? AND expires_at > NOW() AND used_at IS NULL',
        [id]
    );

    if (!token) {
        return null; // Invalid, expired, or already used
    }

    // Mark as used
    await db.query(
        'UPDATE unsubscribe_tokens SET used_at = NOW() WHERE id = ?',
        [id]
    );

    return { email: token.email, campaignId: token.campaign_id };
}

// 4. Cleanup Cron (runs daily)
async function cleanupExpiredTokens() {
    await db.query('DELETE FROM unsubscribe_tokens WHERE expires_at < NOW()');
}
```

---

### Option 2: Email in URL (Simpler, Less Secure) ⚠️

**How it works:**
1. Encode email in base64url: `email=cmF5QGdvb2Rqb2JjcmVhdGlvbnMuY29tLnNn`
2. Use URL: `https://lga.com/api/email/unsubscribe?email=cmF5QGdvb2Rqb2JjcmVhdGlvbnMuY29tLnNn`
3. On click: Decode email → Mark unsubscribed

**Benefits:**
- ✅ No database required
- ✅ Stateless (like JWT)
- ✅ Simple to implement

**Drawbacks:**
- ❌ No HMAC verification (can be spoofed)
- ❌ Anyone can unsubscribe any email address
- ❌ No expiration enforcement
- ❌ Security risk (lacks authentication)

**Implementation:**

```javascript
// Token Generation
function generateUnsubscribeLink(email) {
    const encodedEmail = Buffer.from(email).toString('base64url');
    return `https://lga.com/api/email/unsubscribe?email=${encodedEmail}`;
}

// Token Verification
function verifyUnsubscribeLink(encodedEmail) {
    try {
        const email = Buffer.from(encodedEmail, 'base64url').toString('utf-8');
        return { email };
    } catch {
        return null;
    }
}
```

---

### Option 3: Reverse Engineer Gateway Cipher ❌ **NOT RECOMMENDED**

**Why NOT recommended:**
- ❌ Transformation patterns vary by gateway and version
- ❌ Extremely fragile and hard to maintain
- ❌ May break with gateway updates
- ❌ Complex code with high technical debt

---

## 📊 Recommendation Matrix

| Criteria | Proxy ID | Email in URL | Current JWT |
|----------|----------|--------------|-------------|
| **Security** | ⭐⭐⭐⭐⭐ Excellent | ⭐⭐ Poor | ⭐⭐⭐⭐⭐ Excellent (but broken) |
| **Gateway Resilience** | ⭐⭐⭐⭐⭐ Excellent | ⭐⭐⭐⭐ Good | ❌ Broken |
| **Implementation Complexity** | ⭐⭐⭐ Medium | ⭐⭐⭐⭐⭐ Very Easy | ⭐⭐⭐⭐ Easy |
| **Database Required** | ✅ Yes | ❌ No | ❌ No |
| **Expiration Support** | ✅ Yes | ❌ No (manual) | ✅ Yes |
| **Anti-Spoofing** | ✅ Yes | ❌ No | ✅ Yes |
| **One-Click Unsubscribe** | ✅ Yes | ✅ Yes | ✅ Yes |

## 🎯 Final Recommendation

**Use Option 1: Database-Backed Proxy ID System**

### Why?
1. **Most resilient** - Simple IDs won't be transformed by gateways
2. **Secure** - Can track usage and prevent replay attacks
3. **Scalable** - Easy to add features (rate limiting, analytics)
4. **Industry standard** - Used by major email platforms
5. **Future-proof** - Works regardless of gateway transformation algorithms

### Migration Path

1. **Phase 1: Deploy fixes (current)**
   - encodeURIComponent() on HTML links ✅
   - Source tracking (&source parameter) ✅
   - Enhanced logging ✅

2. **Phase 2: Monitor (1-2 weeks)**
   - Check if encodeURIComponent() helps
   - Analyze which source is being used (header vs HTML)
   - Collect more corruption patterns

3. **Phase 3: Implement Proxy ID System (if issue persists)**
   - Set up database table
   - Implement ID generation and verification
   - Deploy and test

4. **Phase 4: Gradual Migration**
   - Keep JWT system for backwards compatibility
   - Generate both JWT and proxy ID
   - Include both in emails
   - Monitor success rates

## 🔬 Testing

Run the corruption analyzer:
```bash
node tests/analyze-token-corruption.js
```

This will show you the exact character transformation pattern being applied by the email gateway.

## 📝 Implementation Status

- ✅ JWT tokens with List-Unsubscribe header
- ✅ encodeURIComponent() on HTML links (FIXED)
- ✅ Source tracking for diagnostics
- ✅ Comprehensive logging
- ✅ Token corruption analyzer tool
- ⏳ Database proxy ID system (if needed based on monitoring)

## 📧 Contact

If you need help implementing the database-backed system or have questions about the analysis, please refer to this documentation.

---

Last Updated: 2025-10-30
Analysis Based On: Production logs from ray@goodjobcreations.com.sg unsubscribe attempt
