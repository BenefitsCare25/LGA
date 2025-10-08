# Apollo API Migration Guide

## Overview

This project has been upgraded to use **Apollo.io API directly** instead of the Apify scraper. The new integration is faster, more reliable, and provides better control over lead scraping.

## What Changed

### Backend Integration
- **New**: Direct Apollo API integration via `https://api.apollo.io/api/v1/mixed_people/search`
- **Fallback**: Apify integration still available as backup
- **Auto-switching**: System automatically uses Apollo API if available, falls back to Apify otherwise

### Frontend
- **No changes required** - All existing filters work seamlessly with Apollo API
- Job titles, company sizes, and location filters map directly to Apollo API parameters

## Environment Variables Setup

### Required for Apollo API (Recommended)
Add this to your Render environment variables:

```bash
APOLLO_API_KEY=your_apollo_api_key_here
```

**How to get Apollo API key:**
1. Log in to [Apollo.io](https://app.apollo.io)
2. Go to Settings → Integrations → API
3. Copy your API key

### Optional Fallback (Legacy)
Keep Apify as backup (optional):

```bash
APIFY_API_TOKEN=your_apify_token_here
```

### Toggle Integration Method (Optional)
Force Apify even if Apollo key exists:

```bash
USE_APOLLO_API=false
```

## Key Differences

| Feature | Apollo API (New) | Apify (Old) |
|---------|-----------------|-------------|
| **Speed** | Fast (seconds) | Slow (minutes) |
| **Max Records** | 50,000 | Unlimited |
| **Pagination** | 100/page, 500 pages max | Auto-handled |
| **Cost** | Per credit | Per run |
| **Reliability** | Direct API, stable | Scraper, may break |
| **Email/Phone** | ⚠️ **Your account data only** | Scrapes all visible data |

## ⚠️ CRITICAL: Email Extraction Limitation

**Apollo API CANNOT extract emails without exporting contacts first.**

### The Problem

Apollo API returns `email_not_unlocked@domain.com` for all leads because:
- Search API (`/mixed_people/search`) **does NOT unlock emails**
- `reveal_personal_emails: true` parameter **does NOT work** without export
- You must **export/save contacts** in Apollo UI first (costs 1 credit per contact)
- This is Apollo's intentional design to protect their data

### The Solution: Use Apify ✅

**Apify scrapes actual visible emails from Apollo UI** - bypassing the API lock.

**Default Behavior:**
- System now uses **Apify by default** for reliable email extraction
- Apollo API only used if you explicitly set `USE_APOLLO_API=true`

### Environment Variable Control

**Use Apify (Default - Recommended):**
```bash
# Don't set USE_APOLLO_API, or set to false
USE_APOLLO_API=false
```

**Force Apollo API (Not Recommended - emails will be locked):**
```bash
USE_APOLLO_API=true
```

### Why Apify is Better for Email Extraction

| Feature | Apify | Apollo API |
|---------|-------|------------|
| **Email Extraction** | ✅ Actual emails | ❌ `email_not_unlocked@domain.com` |
| **Credit Cost** | Per run | Per search + per export |
| **Setup Complexity** | Simple | Requires export workflow |
| **Reliability** | High | Requires manual unlock steps |

## API Limits

### Apollo API
- **Max records per search**: 50,000 (500 pages × 100 per page)
- **Rate limits**: Varies by plan
- **Credits**: Consumes credits per search
- **Note**: Does not discover new emails/phones, returns existing data only

### Apify (Fallback)
- No hard record limit
- Per-run pricing
- May be slower for large datasets

## Testing Your Setup

### Test Endpoint
Visit: `http://localhost:3000/api/apollo/test`

**Expected Response (Apollo API working):**
```json
{
  "status": "OK",
  "checks": {
    "apolloApiKey": true,
    "apolloApiConnection": true,
    "apifyToken": true,
    "apifyConnection": true,
    "activeIntegration": "apollo_api"
  },
  "message": "Apollo API direct integration ready (primary)",
  "recommendation": "Using Apollo API direct integration (recommended)"
}
```

**Expected Response (Fallback to Apify):**
```json
{
  "status": "OK",
  "checks": {
    "apolloApiKey": false,
    "apolloApiConnection": false,
    "apifyToken": true,
    "apifyConnection": true,
    "activeIntegration": "apify_fallback"
  },
  "message": "Apify fallback integration ready (Apollo API unavailable)",
  "recommendation": "Using Apify fallback - consider adding APOLLO_API_KEY for direct access"
}
```

## Filter Mapping

The frontend filters map automatically to Apollo API:

| Frontend Filter | Apollo API Parameter | Example Values |
|----------------|---------------------|----------------|
| Job Titles | `person_titles[]` | `["CEO", "Owner", "Director"]` |
| Company Sizes | `organization_num_employees_ranges[]` | `["1-10", "11-50", "51-200"]` |
| Location | `person_locations[]` | `["Singapore", "Singapore, Singapore"]` |
| Email Status | `contact_email_status[]` | `["verified"]` |

## Migration Checklist

- [ ] Add `APOLLO_API_KEY` to Render environment variables
- [ ] Restart Render service to load new env var
- [ ] Test integration: `https://your-app.onrender.com/api/apollo/test`
- [ ] Verify frontend still works (no code changes needed)
- [ ] Monitor logs for `🎯 Using Apollo API direct integration` message
- [ ] Optional: Remove `APIFY_API_TOKEN` if no longer needed

## Troubleshooting

### Error: "Invalid Apollo API key"
- Check API key is correct in Render env vars
- Verify key has not expired in Apollo.io dashboard
- Ensure no extra spaces in the env var value

### Error: "Apollo API credits exhausted"
- Check your Apollo.io plan credits
- Consider upgrading plan or using Apify fallback

### Error: "Apollo API rate limit exceeded"
- Wait a few minutes before retrying
- Reduce maxRecords in frontend
- System will retry automatically with exponential backoff

### Fallback to Apify automatically
- This is normal if Apollo API key is not configured
- System logs will show: `🔄 Using Apify fallback integration`
- Add `APOLLO_API_KEY` to use direct Apollo API

## Advanced Configuration

### Force Apify Usage
Even with Apollo API key configured:
```bash
USE_APOLLO_API=false
```

### Increase Record Limit Safety
Default max is 10,000 for Apify, override with:
```bash
MAX_LEADS_PER_REQUEST=20000
```

### Enable Debug Logging
```bash
NODE_ENV=development
```

## Response Format

Both Apollo API and Apify return the same data structure to maintain compatibility:

```json
{
  "success": true,
  "count": 150,
  "leads": [...],
  "metadata": {
    "source": "apollo_api",
    "scrapedAt": "2025-10-08T12:00:00Z",
    "maxRecords": 500,
    "rawScraped": 155,
    "duplicatesRemoved": 5,
    "finalCount": 150,
    "jobTitles": ["CEO"],
    "companySizes": ["1-10", "11-50"]
  }
}
```

## Support

For issues:
1. Check logs for detailed error messages
2. Test endpoint: `/api/apollo/test`
3. Verify environment variables in Render dashboard
4. Review Apollo.io API documentation: https://docs.apollo.io

## Next Steps

Once Apollo API is working:
1. Monitor credit usage in Apollo.io dashboard
2. Consider removing Apify integration if no longer needed
3. Optimize search filters to reduce credit consumption
4. Set up alerts for credit limits
