# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

### Development Commands
- `npm run dev` - Start development server with nodemon auto-restart
- `npm start` - Start production server 
- `node server.js` - Direct server start (same as npm start)

### Testing API Endpoints
- Visit `http://localhost:3000/api/apollo/test` - Test Apify connection
- Visit `http://localhost:3000/api/leads/test` - Test OpenAI connection
- Visit `http://localhost:3000/health` - Server health check
- Visit `http://localhost:3000/github-auth-test` - Test GitHub device flow authentication

### File Processing
- No build step required (server serves static HTML directly)
- Excel files are processed in-memory using XLSX library
- PDF files are processed using pdf-parse for content extraction

## Architecture Overview

This is a lead generation automation tool that combines Apollo.io scraping with AI-powered email outreach and Microsoft Graph integration for email campaigns.

### Core Components

**Server Architecture (server.js)**
- Express.js server with security middleware (Helmet, CORS)
- Process singleton pattern prevents multiple server instances
- Modular route-based architecture with specialized endpoints

**Route Modules**
- `routes/apollo.js` - Apollo.io/Apify integration for lead scraping
- `routes/leads.js` - Lead processing and OpenAI content generation  
- `routes/email-automation.js` - Email campaign management with Excel integration
- `routes/microsoft-graph.js` - Microsoft Graph API integration
- `routes/email-*.js` - Various email-related services (templates, tracking, scheduling, bounce detection)
- `routes/auth.js` - Authentication handling
- `routes/campaign-status.js` - Campaign monitoring

**Utility Modules (utils/)**
- `excelProcessor.js` - Excel file manipulation and processing
- `excelGraphAPI.js` - Direct Excel updates via Microsoft Graph API
- `emailContentProcessor.js` - Email content generation and processing
- `campaignLockManager.js` - Prevents concurrent campaign conflicts
- `campaignTokenManager.js` - Manages campaign authentication tokens
- `excelDuplicateChecker.js` - Prevents duplicate lead processing
- `EmailSender.js` - Centralized email campaign sending with token refresh and error handling
- `processSingleton.js` - Ensures single server instance

### Data Flow Architecture

1. **Lead Generation**: Form submission → Apollo URL generation → Apify scraper → Lead extraction
2. **Content Processing**: Lead data → OpenAI API → AI-generated outreach content
3. **Email Campaigns**: Excel upload → Lead processing → Microsoft Graph → Email sending → Tracking updates
4. **Tracking**: Read receipts (pixel tracking) + Reply monitoring (cron job) → Excel updates via Graph API

### Key Integration Points

**External APIs**
- Apify API for Apollo.io lead scraping
- OpenAI API for AI content generation
- Microsoft Graph API for email sending and Excel integration

**Authentication**
- Delegated authentication for Microsoft Graph (in `middleware/delegatedGraphAuth.js`)
- GitHub OAuth device flow authentication (in `utils/githubAuth.js`)
- API key-based authentication for external services

**GitHub Device Flow Integration**
- OAuth device flow for GitHub authentication without client secrets
- Secure authentication flow suitable for server-side applications
- Session-based token management with automatic cleanup
- Routes available at `/api/github-auth/*` for device flow management

**File Processing**
- Excel files processed with XLSX library and updated via Graph API
- PDF content extraction for reference material processing
- Multer for file upload handling with 10MB limits

## Environment Configuration

Required environment variables (see `.env.example`):
- `APIFY_API_TOKEN` - Apollo.io scraping via Apify
- `OPENAI_API_KEY` - AI content generation
- `AZURE_TENANT_ID`, `AZURE_CLIENT_ID`, `AZURE_CLIENT_SECRET` - Microsoft Graph integration
- `GITHUB_CLIENT_ID` - GitHub OAuth app client ID for device flow authentication
- `RENDER_EXTERNAL_URL` - Deployment URL for tracking callbacks

## Important Implementation Notes

### File Path Configuration
- HTML files are served from the `public/` directory
- Server routes use `path.join(__dirname, 'public', 'filename.html')` pattern
- Fixed ENOENT errors by correcting file paths in server.js (lines 117, 122, 127)

## Important Implementation Notes

### Process Management
- Server uses singleton pattern to prevent multiple instances
- Campaign lock manager prevents concurrent email sending conflicts  
- Background job processing for large datasets to avoid timeouts

### Excel Integration Pattern
- Direct Graph API updates for real-time Excel modifications
- Duplicate checking before processing leads
- Batch processing with error recovery for large datasets

### Email Campaign Architecture
- Centralized campaign sending via EmailSender utility class
- Template-based email generation with AI personalization
- Automatic token refresh during long campaigns (>1 hour)
- Graceful authentication expiration handling with campaign stops
- Tracking via pixel images and Microsoft Graph inbox monitoring
- Rate limiting and bounce detection for deliverability
- Excel update queueing with proper closure handling

### Phone Number Lookup (AI-Powered Web Search Feature)
- **Real-time web search**: Uses OpenAI **gpt-4o-mini-search-preview** model with native web search capabilities
- **Automatic Integration**: Phone lookup runs automatically during Apollo scraping for leads without phone numbers
- **Search sources**: Company websites, LinkedIn profiles, business directories, and professional networks
- **Singapore-optimized**: Geolocation set to Singapore for relevant local results
- **Manual lookup options**:
  - Frontend: "Find Missing Phones" button in email-automation.html
  - API: `/api/email-automation/find-missing-phones` (batch lookup for all missing)
  - API: `/api/email-automation/find-phones-for-leads` (targeted lookup by email list)
- **Smart caching**: 24-hour cache prevents duplicate API calls for same leads
- **Automatic Excel updates**: Found phone numbers automatically saved to OneDrive Excel file via Graph API
- **No rate limiting**: Processes all leads as fast as possible
- **Comprehensive logging**: Detailed progress tracking and error reporting with source attribution

### Error Handling
- Graceful degradation when optional services are unavailable
- Comprehensive API testing endpoints for troubleshooting
- Detailed error logging for campaign and processing issues

## SharePoint Document Automation

Automated PowerPoint generation from Excel placement slips stored on SharePoint/OneDrive.

### Overview
- **Input**: Excel placement slip files (e.g., `Placement Slips - CBRE Group (2025-2026).xlsx`)
- **Template**: `CBRE Staff Communication 2025.pptx` stored in SharePoint Templates folder
- **Output**: Updated PowerPoint with client-specific data, saved to SharePoint Generated folder

### Key Files
- `routes/sharepoint-automation.js` - API endpoints for SharePoint integration
- `utils/pptxProcessor.js` - PowerPoint XML manipulation using PizZip
- `utils/placementSlipParser.js` - Excel data extraction using XLSX library
- `public/sharepoint-automation.html` - Frontend UI for processing

### SharePoint Folder Structure
```
/CBRE-Document-Automation/
├── Placement-Slips/     # Input Excel files
├── Templates/           # PowerPoint templates
├── Generated/           # Output files
└── Archive/             # Processed files
```

### Slide Update Progress

#### ✅ Slide 1 - Period of Insurance
- **Field**: Period of Insurance date range
- **Source**: Excel GTL sheet, row with "Period of Insurance :" label
- **Format**: `DD Month YYYY to DD Month YYYY` (e.g., "10 July 2024 to 30 June 2026")
- **Method**: Direct text replacement in slide XML

#### ✅ Slide 8 - GTL (Group Term Life) Table
| Field | Status | Notes |
|-------|--------|-------|
| Eligibility | ✅ | Combined row with Last Entry Age |
| Last Entry Age | ✅ | Combined row with Eligibility |
| Basis of Cover | ✅ | Bullet point pattern matching |
| Non-evidence Limit | ✅ | Table cell replacement |

**Template Structure (Slide 8 Table):**
```
Row 1: "24 Hours-Worldwide" (header)
Row 2: "EligibilityLast Entry Age" → Combined eligibility + last entry age value
Row 3: "Basis of Cover" → Bullet points with category: basis format
Row 4: "Non-evidence Limit" → Insurance limit value
```

**Important**: The template has "Eligibility" and "Last Entry Age" merged into ONE row labeled `EligibilityLast Entry Age` (no space). Code handles this by:
1. First trying combined label match
2. Falling back to separate row matching if combined not found

### API Endpoints
- `POST /api/sharepoint-automation/process` - Process Excel and generate PowerPoint
- `GET /api/sharepoint-automation/check-new-files` - Check for pending Excel files
- `GET /api/sharepoint-automation/inspect-slide8-tables` - Debug endpoint for template inspection

### Future Phases
- Slide 9-11: Additional insurance product details (GDD, GHS, GMM, etc.)
- Webhook integration for automatic processing when new files uploaded