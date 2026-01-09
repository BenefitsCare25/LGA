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
- `routes/sharepoint-automation.js` - SharePoint document automation
- `routes/auth.js` - Authentication handling

**Utility Modules (utils/)**
- `pptxProcessor.js` - PowerPoint XML manipulation (PizZip)
- `placementSlipParser.js` - Excel placement slip parsing (XLSX)
- `excelProcessor.js` - Excel file manipulation and processing
- `excelGraphAPI.js` - Direct Excel updates via Microsoft Graph API
- `EmailSender.js` - Centralized email campaign sending

## Environment Configuration

Required environment variables (see `.env.example`):
- `APIFY_API_TOKEN` - Apollo.io scraping via Apify
- `OPENAI_API_KEY` - AI content generation
- `AZURE_TENANT_ID`, `AZURE_CLIENT_ID`, `AZURE_CLIENT_SECRET` - Microsoft Graph integration

## SharePoint Document Automation

Automated PowerPoint generation from Excel placement slips.

### Key Files
- `utils/pptxProcessor.js` - PowerPoint XML manipulation (PizZip)
- `utils/placementSlipParser.js` - Excel data extraction (XLSX)
- `routes/sharepoint-automation.js` - API endpoints

### Slide Mapping Status

| Slide | Product | Excel Sheet | Fields | Status |
|-------|---------|-------------|--------|--------|
| 1 | Period of Insurance | GTL | Date range | ✅ |
| 8 | GTL (Group Term Life) | GTL | Eligibility, Last Entry Age, Basis of Cover, Non-evidence Limit | ✅ |
| 9 | GDD (Group Dread Disease) | GDD  | Eligibility, Last Entry Age, Basis of Cover, Non-evidence Limit | ✅ |
| 10 | GPA (Group Personal Accident) | GPA | Eligibility, Last Entry Age, Basis of Cover | ✅ |
| 11 | GPA Additional Features | - | Static content | N/A |
| 12 | GHS (Group Hospital & Surgical) | GHS | Eligibility, Last Entry Age, Category/Plan | ✅ |
| 13-15 | GHS Details | GHS | TBD | ⏳ |

### Technical Notes

**Eligibility/Last Entry Age Cell Structure**:
Template cell has 3 text elements: \`": "\` + eligibility + \`": age XX next birthday"\`
Code uses \`replaceEligibilityAndLastEntryAgeSeparately()\` to update each element independently.

**Excel Sheet Names**: GTL, GHS, GPA (standard), "GDD " (trailing space)

**Excel Column Mapping**:
| Sheet | Category Col | Value Col |
|-------|--------------|-----------|
| GTL/GDD | 3 | 5 (Basis) |
| GPA | 3 | 6 (Basis) |
| GHS | 3 | 8 (Plan) |

### API Endpoints
- \`POST /api/sharepoint-automation/process\` - Process Excel → Generate PPTX
- \`GET /api/sharepoint-automation/check-new-files\` - Check pending files

### Next Phase
- Slides 13-15: Additional GHS plan details
