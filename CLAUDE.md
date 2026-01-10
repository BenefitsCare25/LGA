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
- `utils/slideDetector.js` - Dynamic slide detection by content patterns
- `utils/placementSlipParser.js` - Excel data extraction (XLSX)
- `routes/sharepoint-automation.js` - API endpoints
- `config/slideSignatures.json` - Slide signature patterns configuration

### Dynamic Slide Detection

The system uses content-based slide detection instead of hardcoded slide numbers, making it robust to template variations where slides may be inserted or deleted.

**Architecture**:
```
slideDetector.js
├── loadSignatures() - Load patterns from slideSignatures.json
├── extractAllSlideData() - Extract text from all slides via <a:t> elements
├── scoreSlideMatch() - Score slides against signatures
├── detectSlidePositions() - Main detection with confidence scoring
└── getSlideNumber() - Get detected slide number with fallback
```

**Confidence Scoring** (max 100 points):
- Primary pattern match: 50 points (e.g., "Group Term Life", "Schedule of Benefits")
- Secondary signals: 30 points (e.g., "Eligibility", "Last Entry Age")
- Unique signals: 20 points (differentiates similar slides like multiple SOB slides)

**Thresholds**:
- ≥70%: High confidence - use detected position
- 40-69%: Medium confidence - use detected + warn frontend
- <40%: Low confidence - use fallback position + notify frontend

**Slide Signatures** (18 total):
| Slide Type | Primary Pattern | Unique Signals | Fallback |
|------------|-----------------|----------------|----------|
| PERIOD_OF_INSURANCE | Period of Insurance | - | 1 |
| GTL_OVERVIEW | Group Term Life | - | 8 |
| GDD_OVERVIEW | Group Dread Disease | - | 9 |
| GPA_OVERVIEW | Group Personal Accident | - | 10 |
| GHS_OVERVIEW | Group Hospital & Surgical | - | 12 |
| GHS_SOB_1 | Schedule of Benefits | Daily Room & Board | 15 |
| GHS_SOB_2 | Schedule of Benefits | Psychiatric, Overseas Treatment | 16 |
| GHS_NOTES | Notes, Qualification Period | - | 17 |
| GHS_ROOM_BOARD | Room & Board, Hospital Cash | - | 18 |
| GMM_OVERVIEW | Group Major Medical | - | 19 |
| GMM_SOB | Schedule of Benefits | Deductible, Per disability | 20 |
| GP_OVERVIEW | General Practitioner | - | 24 |
| GP_SOB | Schedule of Benefits | Polyclinic, Panel TCM | 25 |
| SP_OVERVIEW | Specialist | - | 26 |
| SP_SOB | Schedule of Benefits | Panel Specialist, Diagnostic X-ray | 27 |
| DENTAL_OVERVIEW | Group Dental | - | 30 |
| DENTAL_SOB_1 | Schedule of Benefits | Overall Limit, Scaling | 31 |
| DENTAL_SOB_2 | Schedule of Benefits | Crown, Denture | 32 |

**API Response** includes detection results:
```json
{
  "slideDetection": {
    "results": {
      "GTL_OVERVIEW": { "detected": true, "slideNum": 8, "confidence": 0.85 }
    },
    "warnings": ["GHS_SOB_1 detected with medium confidence (55%) at Slide 15"]
  }
}
```

### Slide Mapping Status

| Slide | Product | Excel Sheet | Fields | Status |
|-------|---------|-------------|--------|--------|
| 1 | Period of Insurance | GTL | Date range | ✅ |
| 8 | GTL (Group Term Life) | GTL | Eligibility, Last Entry Age, Basis of Cover, Non-evidence Limit | ✅ |
| 9 | GDD (Group Dread Disease) | GDD  | Eligibility, Last Entry Age, Basis of Cover, Non-evidence Limit | ✅ |
| 10 | GPA (Group Personal Accident) | GPA | Eligibility, Last Entry Age, Basis of Cover | ✅ |
| 11 | GPA Additional Features | - | Static content | N/A |
| 12 | GHS (Group Hospital & Surgical) | GHS | Eligibility, Last Entry Age, Category/Plan | ✅ |
| 13-14 | GHS Additional Info | - | Static content | N/A |
| 15 | GHS Schedule of Benefits (1-6) | GHS | Daily Room & Board, ICU, In-patient, Out-patient, Emergency, Overall Limits | ✅ |
| 16 | GHS Schedule of Benefits (7-15) | GHS | Outpatient Treatment, Miscarriage, Death, Ambulance, Medical Report, Psychiatric, Overseas, Rehab, GST | ✅ |
| 17 | GHS Notes | GHS | Qualification Period (14 days from Row 43) | ✅ |
| 18 | GHS Hospital Cash Allowance | GHS | Room & Board Entitlements (1&2 Bedded, 4 Bedded ward classes) | ✅ |
| 19 | GMM (Group Major Medical) Overview | GMM | Eligibility, Last Entry Age | ✅ |
| 20 | GMM Schedule of Benefits | GMM | Dynamic plan columns, 10 benefits with sub-items | ✅ |
| 21-23 | Additional Content | - | Static content | N/A |
| 24 | GP (General Practitioner) Overview | GP | Eligibility, Last Entry Age, Category/Plan | ✅ |
| 25 | GP Schedule of Benefits | GP | Dynamic plan columns, 6 benefits (Panel, Polyclinic, Non-Panel, A&E, Overseas, TCM) | ✅ |
| 26 | SP (Specialist) Overview | SP | Eligibility, Last Entry Age, Category/Plan | ✅ |
| 27 | SP Schedule of Benefits | SP | Dynamic plan columns, 7 benefits with sub-items | ✅ |
| 28-29 | Additional Content | - | Static content | N/A |
| 30 | Group Dental Overview | Dental | Eligibility, Last Entry Age | ✅ |
| 31 | Group Dental SOB Part 1 | Dental | Overall Limit (S$500), Benefits 1-11 | ✅ |
| 32 | Group Dental SOB Part 2 | Dental | Benefits 12-19, GST Extension | ✅ |

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

### GHS Schedule of Benefits Mapping (Slides 15-16)

**Excel Source**: GHS sheet, Rows 41-100, Columns 6-8 (G, H, I)
- Column 6 (G): Plan 1A/1B values
- Column 7 (H): Plan 2A/2B values
- Column 8 (I): Plan 3 values

**PowerPoint Table Structure**:
- Slide 15: Columns 10-12 for plan values (benefits 1-6)
- Slide 16: Columns 12-14 for plan values (benefits 7-15)

### Slide 17 Qualification Period

**Excel Source**: GHS Row 43 (All disabilities... No. of days)
- Value in Column 6 (G): "14 DAYS"
- Template placeholder: "14 days (CELL: G43)"
- Replaced with extracted number + "days"

### Slide 18 Room & Board Entitlements

**Excel Source**: GHS Rows 106-116 (Hospital Cash Allowance section)
- Section 1: "GHS Entitlement : Room & Board 1 & 2 Bedded" (Rows 106-111)
- Section 2: "GHS Entitlement : Room & Board 4 Bedded" (Rows 112-116)

**Ward Class Mapping**:
| Ward Class | 1&2 Bedded | 4 Bedded |
|------------|------------|----------|
| B1 | S$100 | - |
| B2 / B2 + | S$200 | S$150 |
| C | S$300 | S$200 |

### Slide 19 GMM Overview

**Excel Source**: GMM sheet
- Row 10, Col 2: Eligibility
- Row 12, Col 2: Last Entry Age

**PowerPoint Structure**: Small table with Eligibility/Last Entry Age row (same pattern as slides 8-12)

### Slide 20 GMM Schedule of Benefits

**Dynamic Plan Column Handling**:
- Plan headers extracted from Excel Row 49 (columns 7+)
- Supports variable number of plan types (e.g., 1A/1B, 1AS/1BS, 2A/2B, 2AS/2BS, 3, 3S)
- PPTX plan columns start at index 6, mapped sequentially

**Excel Source**: GMM sheet, Rows 50-95
| Excel Column | Content |
|--------------|---------|
| 7 (H) | Plan 1A/1B values |
| 8 (I) | Plan 1AS/1BS values (spouse) |
| 9 (J) | Plan 2A/2B values |
| 10 (K) | Plan 2AS/2BS values (spouse) |
| 11 (L) | Plan 3 values |
| 12 (M) | Plan 3S values (spouse) |

**Benefit Items (10 total)**:
1. Daily Room & Board (with sub-items: from, Co-insurance)
2. Inpatient benefits (with sub-items: Deductible, Co-insurance)
3. Post Hospitalisation (with sub-items: from, Co-insurance)
4. Surgical Implants (with sub-item: Co-insurance)
5. Outpatient Treatment (NA values)
6. Daily Parental Accommodation (with sub-items: Max days, Co-insurance)
7. Daily Home Nursing Benefit (with sub-items: Max days, Co-insurance)
8. HIV due to blood Transfusion (with sub-item: Co-insurance)
9. Maximum Benefit (with sub-items: Per disability, Co-insurance)
10. Extension to cover GST

**Value Formatting**:
- Co-insurance decimals (0.2) → percentages (20%)
- Literal strings preserved: "As per GHS", "As charged", "NA"

### Slide 25 GP Schedule of Benefits

**Excel-to-PPT Benefit Mapping**:
| PPT # | PPT Benefit | Excel ID | Excel Benefit |
|-------|-------------|----------|---------------|
| (1) | Panel (Fullerton) | -1 | Panel |
| (2) | Polyclinic | -2 | Polyclinic |
| (3) | Non Panel | -3 | Non Panel |
| (4) | A&E of a hospital | -4 | For Emergencies at A&E |
| (5) | Overseas GP/Specialist | -5 | Overseas GP/Specialist |
| (6) | Panel TCM | -6 | Panel TCM |
| (7) | Extension to cover GST | N/A | Not in Excel - keep template |

**Dynamic Plan Column Detection**: Uses `cells.length - 2` and `cells.length - 1` for last two columns.

### Slide 27 SP Schedule of Benefits

**Excel-to-PPT Benefit Mapping** (PPT consolidates Excel benefits):
| PPT # | PPT Benefit (Consolidated) | Excel # | Excel Benefit (Primary) |
|-------|---------------------------|---------|------------------------|
| 1 | Panel & Non Panel Specialist | 1 | Panel Specialist |
| 2 | Traditional Chinese Medicine | 3 | TCM |
| 3 | Panel & Non-Panel Diagnostic X-ray | 4 | Panel Diagnostic X-ray |
| 4 | Outpatient therapy treatment | 8 | Outpatient therapy |
| 5 | Extension to cover GST | null | Not in Excel - skip |

**Mapping Constant** (`SP_PPT_TO_EXCEL_MAPPING`):
```javascript
{ 1: 1, 2: 3, 3: 4, 4: 8, 5: null }
```

### Slides 30-32 Group Dental

**Excel Source**: Dental sheet
- Row 11, Col C: Eligibility (merged cell)
- Row 13, Col C: Last Entry Age
- Row 36, Col E: Overall Limit (merged E36:E92)

**Slide 30 (Dental Overview)**: Eligibility/Last Entry Age pattern (same as other overview slides)
**Slides 31-32 (SOB)**: Static benefit list with overall limit "S$500" - only update limit value

**Key Difference from GP/SP**:
- Single plan only (no dynamic plan columns)
- Benefits have descriptions but no individual plan values
- Overall limit applies to all benefits

### Completed Mappings
All slides 1-32 mapped. Dental is simpler due to single plan structure.
