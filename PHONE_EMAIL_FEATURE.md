# Phone Number Toggle & Email Prioritization Feature

## Overview

Added user control for phone number extraction and intelligent email prioritization to optimize Apollo API credit usage and data quality.

## Features Added

### 1. Phone Number Toggle (Frontend)

**Location:** Lead Generator → Processing Options

**New Checkbox:**
```
📞 Include Phone Numbers (costs extra credits)
```

**Behavior:**
- ☐ Unchecked (default): Apollo API does NOT reveal phone numbers → saves credits
- ☑ Checked: Apollo API reveals phone numbers → costs extra credits per lead

**Why This Matters:**
- Phone number revelation costs **additional credits per lead**
- Example: 100 leads with phones = search credits + 100× phone reveal credits
- Users can now choose when phone numbers are worth the extra cost

### 2. Email Prioritization Logic (Backend)

**Priority Order:**
1. **Work/Corporate Email** (`apolloLead.email`)
   - Preferred for B2B outreach
   - Usually format: `name@company.com`

2. **Personal Email** (`apolloLead.personal_emails[0]`)
   - Fallback if no work email
   - Gmail, Yahoo, Outlook, etc.

3. **Organization Email** (`apolloLead.organization_email`)
   - Last resort fallback
   - Generic company email

**Tracking:**
- Added `email_type` field to track which type was used
- Values: `'work'`, `'personal'`, `'org'`, or empty
- Useful for debugging and quality analysis

## Technical Implementation

### Frontend Changes

**File:** `public/lead-generator.html`

Added checkbox:
```html
<input type="checkbox" id="includePhoneNumbers" style="accent-color: var(--color-primary-500);">
<label for="includePhoneNumbers">📞 Include Phone Numbers</label>
<small>(costs extra credits)</small>
```

Updated form data collection:
```javascript
const includePhoneNumbers = document.getElementById('includePhoneNumbers').checked;
```

### Backend Changes

**File:** `routes/apollo.js`

Updated Apollo API request:
```javascript
const requestBody = {
    person_titles: personTitles,
    person_locations: ['Singapore', 'Singapore, Singapore'],
    organization_num_employees_ranges: normalizedSizes,
    contact_email_status: ['verified'],
    reveal_personal_emails: true,              // Always reveal emails
    reveal_phone_number: includePhoneNumbers,  // User preference
    per_page: APOLLO_PER_PAGE,
    page: currentPage
};
```

Email prioritization logic:
```javascript
function transformApolloLead(apolloLead) {
    let selectedEmail = '';
    let emailType = '';

    // 1. Try work email first
    if (apolloLead.email) {
        selectedEmail = apolloLead.email;
        emailType = 'work';
    }

    // 2. Fallback to personal email
    if (!selectedEmail && apolloLead.personal_emails?.[0]) {
        selectedEmail = apolloLead.personal_emails[0];
        emailType = 'personal';
    }

    // 3. Last resort: organization email
    if (!selectedEmail && apolloLead.organization_email) {
        selectedEmail = apolloLead.organization_email;
        emailType = 'org';
    }

    return {
        email: selectedEmail,
        email_type: emailType,
        // ... other fields
    };
}
```

## Usage Instructions

### For Users

1. **Go to Lead Generator page**
2. **Fill in job title and company size filters**
3. **Processing Options section:**
   - ☑ Check "Include Phone Numbers" ONLY if you need phone data
   - ☐ Leave unchecked to save credits (default)
4. **Submit form**

### Credit Cost Comparison

**Without Phone Numbers (Unchecked):**
- Search: X credits
- Emails: Y credits per lead
- **Total**: X + (Y × number of leads)

**With Phone Numbers (Checked):**
- Search: X credits
- Emails: Y credits per lead
- Phones: Z credits per lead
- **Total**: X + (Y × leads) + (Z × leads)

Example: 100 leads
- Without phones: 1 + (1 × 100) = **101 credits**
- With phones: 1 + (1 × 100) + (1 × 100) = **201 credits**

## Email Quality Benefits

### Work Email Advantages
✅ More professional for B2B outreach
✅ Better deliverability rates
✅ Higher engagement rates
✅ Less likely to be spam filtered

### Personal Email Use Cases
- Fallback when work email unavailable
- Reaching decision makers at small businesses
- Follow-up after work email bounces

## Debugging

### Check Email Type Distribution

In logs, you'll see:
```
🔍 Lead 0: John Doe - work: "john@company.com"
🔍 Lead 1: Jane Smith - personal: "jane@gmail.com"
🔍 Lead 2: Bob Lee - org: "info@company.com"
```

This helps you understand:
- How many leads have work emails
- How often personal emails are used
- Data quality metrics

### Troubleshooting

**Issue: All emails are personal**
- Cause: Apollo doesn't have work emails for these contacts
- Solution: Consider different search criteria or enrichment

**Issue: No phone numbers despite checkbox checked**
- Cause: Apollo doesn't have phone data for these leads
- Solution: Use phone lookup service or different data source

**Issue: Many duplicate leads**
- Cause: Empty emails causing collision on name|company identifier
- Solution: Check email prioritization logs to see why emails are missing

## API Response Structure

### Apollo API Person Object (Example)

```json
{
  "id": "123456",
  "first_name": "John",
  "last_name": "Doe",
  "name": "John Doe",
  "email": "john@company.com",           // Work email
  "personal_emails": [                   // Personal emails
    "john.doe@gmail.com"
  ],
  "organization_email": "info@company.com",
  "email_status": "verified",
  "phone_numbers": [                     // Only if reveal_phone_number: true
    {
      "sanitized_number": "+65 1234 5678",
      "type": "work"
    }
  ],
  "organization": {
    "name": "Acme Corp",
    "website_url": "https://acme.com"
  }
}
```

## Future Enhancements

Potential improvements:
1. **Phone number type preference** (mobile vs work)
2. **Email domain validation** (avoid free email providers)
3. **Credit usage dashboard** (show costs before scraping)
4. **Bulk email validation** (verify emails before sending)
5. **Email preference scoring** (rank work emails by domain quality)

## Testing Checklist

- [ ] Phone checkbox appears in UI
- [ ] Default state is unchecked (saves credits)
- [ ] Checking box passes `includePhoneNumbers: true` to backend
- [ ] Unchecked sends `includePhoneNumbers: false`
- [ ] Work emails prioritized over personal in results
- [ ] `email_type` field populated correctly
- [ ] Logs show correct email type distribution
- [ ] Phone numbers only revealed when checkbox checked
- [ ] Credit costs align with checkbox state
