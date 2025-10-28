# Apollo API Migration Guide

## Overview

This project has been upgraded to use **Apollo.io API directly** instead of the Apify scraper. The new integration is faster, more reliable, and provides better control over lead scraping.

## What Changed

### Backend Integration
- **New**: Two-step Apollo API integration:
  1. Search API: `https://api.apollo.io/api/v1/mixed_people/search` (basic info)
  2. Enrichment API: `https://api.apollo.io/api/v1/people/bulk_match` (email unlock)
- **Removed**: Apify integration completely removed
- **Email Extraction**: Now uses proper Apollo enrichment workflow to unlock emails

### Frontend
- **No changes required** - All existing filters work seamlessly with Apollo API
- Job titles, company sizes, and location filters map directly to Apollo API parameters

## Environment Variables Setup

### Required for Apollo API
Add this to your Render environment variables:

```bash
APOLLO_API_KEY=your_apollo_api_key_here
```

**How to get Apollo API key:**
1. Log in to [Apollo.io](https://app.apollo.io)
2. Go to Settings → Integrations → API
3. Copy your API key

**Note**: Apify integration has been completely removed. Only Apollo API is supported.

## Key Differences

| Feature | Apollo API (New) | Apify (Old) |
|---------|-----------------|-------------|
| **Speed** | Fast (seconds) | Slow (minutes) |
| **Max Records** | 50,000 | Unlimited |
| **Pagination** | 100/page, 500 pages max | Auto-handled |
| **Cost** | Per credit | Per run |
| **Reliability** | Direct API, stable | Scraper, may break |
| **Email/Phone** | ⚠️ **Your account data only** | Scrapes all visible data |

## ✅ Email Extraction Solution

**Apollo API now properly extracts emails using enrichment workflow.**

### The Two-Step Process

1. **Search API** (`/mixed_people/search`):
   - Finds leads matching filters
   - Returns basic info (name, company, title, LinkedIn)
   - **Does NOT unlock emails** (by design)

2. **Enrichment API** (`/people/bulk_match`):
   - Takes lead info from search results
   - Enriches with email addresses and phone numbers
   - Processes 10 leads per batch
   - **Properly unlocks emails** with `reveal_personal_emails: true`

### How It Works

```javascript
// Step 1: Search for leads
const searchResults = await scrapeWithApolloAPI(titles, sizes, maxRecords);

// Step 2: Enrich with emails (batches of 10)
const enrichedData = await enrichApolloLeads(searchResults, includePhoneNumbers);
```

### Credit Costs

- **Search**: Credits per search query
- **Enrichment**: Credits per lead enriched
- **Phone Numbers**: Additional credits if opted in

**Example**: 100 leads = 1 search + 100 enrichments (+ 100 phone reveals if opted in)

## API Limits

### Apollo API
- **Max records per search**: 50,000 (500 pages × 100 per page)
- **Enrichment batch size**: 10 leads per request
- **Rate limits**: Varies by plan
- **Credits**: Consumes credits per search + per enrichment
- **Note**: Enrichment unlocks emails from Apollo's database

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

**Expected Response (Apollo API Not Configured):**
```json
{
  "status": "ERROR",
  "checks": {
    "apolloApiKey": false,
    "apolloApiConnection": false,
    "activeIntegration": "none"
  },
  "message": "Apollo API key not configured",
  "recommendation": "Add APOLLO_API_KEY environment variable"
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
- [ ] Monitor logs for `🎯 Using Apollo API direct integration with enrichment` message
- [ ] Remove `APIFY_API_TOKEN` and `USE_APOLLO_API` env vars (no longer needed)

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

### Error: "Enrichment failed"
- Check Apollo API credits are sufficient
- Verify enrichment batches are processing correctly
- Review logs for specific enrichment errors

## Advanced Configuration

### Enrichment Batch Size
Default is 10 leads per enrichment request (Apollo API limit).
This is hardcoded for optimal performance.

### Enable Debug Logging
```bash
NODE_ENV=development
```

View detailed logs for:
- Search API requests and responses
- Enrichment batch processing
- Email prioritization logic

## Response Format

Apollo API with enrichment returns:

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

Once Apollo API enrichment is working:
1. Monitor credit usage in Apollo.io dashboard (search + enrichment costs)
2. Remove `APIFY_API_TOKEN` and `USE_APOLLO_API` environment variables
3. Optimize search filters to reduce credit consumption
4. Set up alerts for credit limits
5. Monitor enrichment success rates in logs
