/**
 * Placement Slip Excel Parser
 * Extracts insurance data from CBRE placement slip Excel files
 * Used for SharePoint-integrated document automation
 */

const XLSX = require('xlsx');

// Month names for date formatting
const MONTHS = [
    'January', 'February', 'March', 'April', 'May', 'June',
    'July', 'August', 'September', 'October', 'November', 'December'
];

// Sheet names in the placement slip Excel file
const SHEET_NAMES = ['GTL', 'GDD ', 'GHS', 'GMM', 'GP', 'SP', 'Dental', 'GPA'];

/**
 * Parse Excel buffer into workbook
 * @param {Buffer} buffer - Excel file buffer
 * @returns {Object} XLSX workbook object
 */
function parseExcelBuffer(buffer) {
    return XLSX.read(buffer, { type: 'buffer' });
}

/**
 * Extract Period of Insurance from a sheet
 * Looks for "Period of Insurance" in column A and extracts value from nearby columns
 * Handles merged cells and various Excel layouts
 * @param {Object} sheet - XLSX sheet object
 * @returns {string|null} Raw period of insurance string or null if not found
 */
function extractPeriodOfInsurance(sheet) {
    if (!sheet) return null;

    const data = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: '' });

    console.log(`🔍 Searching for Period of Insurance in ${data.length} rows...`);

    // Log first 15 rows for debugging
    for (let i = 0; i < Math.min(15, data.length); i++) {
        const row = data[i];
        if (row && row.length > 0) {
            const preview = row.slice(0, 5).map((c, idx) => `[${idx}]="${String(c).substring(0, 30)}"`).join(' | ');
            console.log(`  Row ${i}: ${preview}`);
        }
    }

    // Search for "Period of Insurance" in the first 20 rows, all columns
    for (let i = 0; i < Math.min(20, data.length); i++) {
        const row = data[i];
        if (!row) continue;

        // Check ALL columns for "Period of Insurance" text
        for (let searchCol = 0; searchCol < Math.min(10, row.length); searchCol++) {
            const cellValue = String(row[searchCol] || '').trim().toLowerCase();

            if (cellValue.includes('period of insurance') || cellValue.includes('period  of insurance')) {
                console.log(`✅ Found "Period of Insurance" at row ${i}, col ${searchCol}`);

                // Look for date in same row, columns after the label
                for (let col = searchCol + 1; col < Math.min(searchCol + 5, row.length); col++) {
                    const dateValue = row[col] ? String(row[col]).trim() : '';
                    console.log(`   Checking col ${col}: "${dateValue}"`);

                    // Check if this looks like a date range (various formats)
                    if (dateValue && (
                        dateValue.match(/\d{1,2}\/\d{1,2}\/\d{4}/) ||  // DD/MM/YYYY
                        dateValue.match(/\d{4}-\d{2}-\d{2}/)           // YYYY-MM-DD
                    )) {
                        console.log(`   ✅ Found date value: "${dateValue}"`);
                        return dateValue;
                    }
                }

                // If no date pattern found in same row, return first non-empty cell after label
                for (let col = searchCol + 1; col < Math.min(searchCol + 5, row.length); col++) {
                    const cellVal = row[col] ? String(row[col]).trim() : '';
                    if (cellVal && cellVal.length > 0) {
                        console.log(`   📝 Using non-date value: "${cellVal}"`);
                        return cellVal;
                    }
                }
            }
        }
    }

    console.log('❌ Period of Insurance not found in any cell');
    return null;
}

/**
 * Parse a date string in DD/MM/YYYY format
 * @param {string} dateStr - Date string like "01/07/2024"
 * @returns {Object} Parsed date with day, month, year
 */
function parseDateString(dateStr) {
    const match = dateStr.match(/(\d{1,2})\/(\d{1,2})\/(\d{4})/);
    if (!match) return null;

    return {
        day: parseInt(match[1], 10),
        month: parseInt(match[2], 10),
        year: parseInt(match[3], 10)
    };
}

/**
 * Format a parsed date to human-readable format
 * @param {Object} dateObj - Object with day, month, year
 * @returns {string} Formatted date like "1 July 2024"
 */
function formatDateHuman(dateObj) {
    if (!dateObj) return '';
    const monthName = MONTHS[dateObj.month - 1];
    return `${dateObj.day} ${monthName} ${dateObj.year}`;
}

/**
 * Extract and format date range from Period of Insurance cell
 * Removes extra text like "(2 years rate but to bill annually)"
 * @param {string} rawValue - Raw cell value
 * @returns {Object} Object with startDate, endDate, and formatted strings
 */
function formatDateRange(rawValue) {
    if (!rawValue) return null;

    // Extract date range using regex: DD/MM/YYYY - DD/MM/YYYY
    const dateRangeMatch = rawValue.match(/(\d{1,2}\/\d{1,2}\/\d{4})\s*-\s*(\d{1,2}\/\d{1,2}\/\d{4})/);

    if (!dateRangeMatch) {
        console.log(`⚠️ Could not parse date range from: "${rawValue}"`);
        return null;
    }

    const startDateStr = dateRangeMatch[1];
    const endDateStr = dateRangeMatch[2];

    const startDate = parseDateString(startDateStr);
    const endDate = parseDateString(endDateStr);

    if (!startDate || !endDate) {
        console.log(`⚠️ Could not parse dates: start="${startDateStr}", end="${endDateStr}"`);
        return null;
    }

    const startFormatted = formatDateHuman(startDate);
    const endFormatted = formatDateHuman(endDate);

    return {
        raw: rawValue,
        startDateRaw: startDateStr,
        endDateRaw: endDateStr,
        startDate: startDate,
        endDate: endDate,
        startFormatted: startFormatted,
        endFormatted: endFormatted,
        formatted: `${startFormatted} to ${endFormatted}`, // "1 July 2024 to 30 June 2026"
        shortFormatted: `${startDateStr} - ${endDateStr}` // "01/07/2024 - 30/06/2026"
    };
}

/**
 * Extract a field value by searching for a label in column A
 * @param {Array} data - Sheet data as 2D array
 * @param {string} labelPattern - Text pattern to search for in column A
 * @param {number} valueCol - Column index for the value (default: 2)
 * @returns {string|null} Extracted value or null
 */
function extractFieldByLabel(data, labelPattern, valueCol = 2) {
    const pattern = labelPattern.toLowerCase();

    for (let i = 0; i < data.length; i++) {
        const row = data[i];
        if (!row || !row[0]) continue;

        const cellA = String(row[0]).toLowerCase().trim();
        if (cellA.includes(pattern)) {
            const value = row[valueCol] ? String(row[valueCol]).trim() : null;
            if (value) {
                console.log(`  ✅ Found "${labelPattern}" at row ${i}: "${value.substring(0, 50)}..."`);
                return value;
            }
        }
    }

    console.log(`  ⚠️ "${labelPattern}" not found`);
    return null;
}

/**
 * Extract Basis of Cover table data from GTL sheet
 * Looks for rows with Category (col 3) and Basis (col 6) after "Basis of Cover" header
 * @param {Array} data - Sheet data as 2D array
 * @returns {Array} Array of {category, basis} objects
 */
function extractBasisOfCover(data) {
    const basisOfCover = [];
    let foundHeader = false;
    let headerRowPassed = false;

    console.log('  🔍 Searching for Basis of Cover table...');

    for (let i = 0; i < data.length; i++) {
        const row = data[i];
        if (!row) continue;

        // Look for "Basis of Cover" header row
        const cellA = String(row[0] || '').toLowerCase().trim();
        if (cellA.includes('basis of cover')) {
            foundHeader = true;
            console.log(`  ✅ Found "Basis of Cover" header at row ${i}`);
            continue;
        }

        // After finding header, look for data rows with Category and Basis
        if (foundHeader) {
            const category = row[3] ? String(row[3]).trim() : '';
            const basis = row[6] ? String(row[6]).trim() : '';

            // Skip the column header row (Category, Basis, etc.)
            if (category.toLowerCase() === 'category' || category.toLowerCase() === 'insured') {
                headerRowPassed = true;
                console.log(`  📋 Skipping header row ${i}`);
                continue;
            }

            // Stop if we hit the Rate section or another major section
            if (cellA.includes('rate') || cellA.includes('annual premium') || cellA.includes('non evidence')) {
                console.log(`  🛑 Stopping at row ${i} (found: "${cellA.substring(0, 30)}")`);
                break;
            }

            // Stop if we hit a note row with * in column 1
            if (String(row[1] || '').trim().startsWith('* FIGURES')) {
                console.log(`  🛑 Stopping at note row ${i}`);
                break;
            }

            // Valid data row: has category and some basis value, and we've passed the header
            if (category && category.length > 0 && !category.startsWith('*') && !category.toLowerCase().includes('category')) {
                // Clean up category - remove line breaks
                const cleanCategory = category.replace(/\n/g, ' ').replace(/\s+/g, ' ').trim();

                // Clean up basis - keep as-is if it's a description
                let cleanBasis = basis;

                // Only format as currency if it's a pure number (like 100000)
                if (basis && /^\d+$/.test(basis.replace(/,/g, ''))) {
                    const numValue = parseFloat(basis.replace(/,/g, ''));
                    cleanBasis = `$${numValue.toLocaleString()}`;
                }

                basisOfCover.push({
                    category: cleanCategory,
                    basis: cleanBasis
                });
                console.log(`  📊 Category: "${cleanCategory.substring(0, 40)}..." → Basis: "${String(cleanBasis).substring(0, 50)}..."`);
            }
        }
    }

    console.log(`  ✅ Extracted ${basisOfCover.length} basis of cover entries`);
    return basisOfCover;
}

/**
 * Extract GTL (Group Term Life) specific data from the GTL sheet
 * @param {Object} sheet - XLSX sheet object
 * @returns {Object} GTL data including eligibility, last entry age, basis of cover, non-evidence limit
 */
function extractGTLData(sheet) {
    if (!sheet) return null;

    const data = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: '' });
    console.log('📋 Extracting GTL data...');

    // Extract individual fields
    const eligibility = extractFieldByLabel(data, 'eligibility :', 2);
    const lastEntryAge = extractFieldByLabel(data, 'last entry age', 2);
    const nonEvidenceLimit = extractFieldByLabel(data, 'non evidence limit', 2);

    // Extract Basis of Cover table
    const basisOfCover = extractBasisOfCover(data);

    return {
        eligibility: eligibility,
        lastEntryAge: lastEntryAge,
        basisOfCover: basisOfCover,
        nonEvidenceLimit: nonEvidenceLimit
    };
}

/**
 * Extract GDD (Group Dread Disease) specific data from the GDD sheet
 * Sheet name has trailing space: "GDD "
 * @param {Object} sheet - XLSX sheet object
 * @returns {Object} GDD data including eligibility, last entry age, basis of cover, non-evidence limit
 */
function extractGDDData(sheet) {
    if (!sheet) return null;

    const data = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: '' });
    console.log('📋 Extracting GDD data...');

    // Extract individual fields (same structure as GTL)
    const eligibility = extractFieldByLabel(data, 'eligibility :', 2);
    const lastEntryAge = extractFieldByLabel(data, 'last entry age', 2);
    const nonEvidenceLimit = extractFieldByLabel(data, 'non evidence limit', 2);

    // Extract Basis of Cover - GDD typically has simpler structure
    const basisOfCover = extractBasisOfCover(data);

    return {
        eligibility: eligibility,
        lastEntryAge: lastEntryAge,
        basisOfCover: basisOfCover,
        nonEvidenceLimit: nonEvidenceLimit
    };
}

/**
 * Extract GHS (Group Hospital & Surgical) specific data from the GHS sheet
 * @param {Object} sheet - XLSX sheet object
 * @returns {Object} GHS data including eligibility, last entry age, categoryPlans, scheduleOfBenefits, roomAndBoardEntitlements
 */
function extractGHSData(sheet) {
    if (!sheet) return null;

    const data = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: '' });
    console.log('📋 Extracting GHS data...');

    // Extract individual fields (same structure as GTL/GDD)
    const eligibility = extractFieldByLabel(data, 'eligibility :', 2);
    const lastEntryAge = extractFieldByLabel(data, 'last entry age', 2);

    // Extract Category/Plan mapping for Slide 12 Table 2
    // GHS uses: Category (col 3), Plan (col 8 - column I)
    const categoryPlans = extractGHSCategoryPlans(data);

    // Extract Schedule of Benefits for Slides 15-16
    const scheduleOfBenefits = extractGHSScheduleOfBenefits(data);

    // Extract Qualification Period for Slide 17
    const qualificationPeriodDays = extractGHSQualificationPeriod(data);

    // Extract Room & Board Entitlements for Slide 18
    const roomAndBoardEntitlements = extractGHSRoomAndBoardEntitlements(data);

    return {
        eligibility: eligibility,
        lastEntryAge: lastEntryAge,
        categoryPlans: categoryPlans,
        scheduleOfBenefits: scheduleOfBenefits,
        qualificationPeriodDays: qualificationPeriodDays,
        roomAndBoardEntitlements: roomAndBoardEntitlements
    };
}

/**
 * Extract Category/Plan mapping from GHS sheet
 * GHS has Category in col 3, Plan in col 8 (column I)
 * @param {Array} data - Sheet data as 2D array
 * @returns {Array} Array of {category, plan} objects
 */
function extractGHSCategoryPlans(data) {
    const categoryPlans = [];
    let foundHeader = false;

    console.log('  🔍 Searching for GHS Category/Plan table...');

    for (let i = 0; i < data.length; i++) {
        const row = data[i];
        if (!row) continue;

        const cellA = String(row[0] || '').toLowerCase().trim();

        // Look for "Basis of Cover" header row (the Category/Plan table is under this)
        if (cellA.includes('basis of cover')) {
            foundHeader = true;
            console.log(`  ✅ Found "Basis of Cover" header at row ${i}`);
            continue;
        }

        // After finding header, look for data rows
        if (foundHeader) {
            // GHS structure: col 3 = Category, col 8 = Plan (column I)
            const category = row[3] ? String(row[3]).trim() : '';
            const plan = row[8] ? String(row[8]).trim() : '';

            // Skip header row (contains "Category", "Plan", etc.)
            if (category.toLowerCase() === 'category' || category.toLowerCase() === 'insured') {
                console.log(`  📋 Skipping header row ${i}`);
                continue;
            }

            // Stop at Rate section or notes
            if (cellA.includes('rate') || cellA.includes('premium')) {
                console.log(`  🛑 Stopping at row ${i} (found: "${cellA.substring(0, 30)}")`);
                break;
            }

            // Stop if we hit the note row
            if (String(row[1] || '').trim().startsWith('* FIGURES')) {
                console.log(`  🛑 Stopping at note row ${i}`);
                break;
            }

            // Valid data row: has category and plan
            if (category && category.length > 0 && !category.startsWith('*') && plan) {
                // Clean up category
                const cleanCategory = category.replace(/\n/g, ' ').replace(/\s+/g, ' ').trim();

                categoryPlans.push({
                    category: cleanCategory,
                    plan: plan
                });
                console.log(`  📊 Category: "${cleanCategory.substring(0, 40)}..." → Plan: "${plan}"`);
            }
        }
    }

    console.log(`  ✅ Extracted ${categoryPlans.length} GHS category/plan entries`);
    return categoryPlans;
}

/**
 * Extract GPA (Group Personal Accident) specific data from the GPA sheet
 * GPA has different column structure: Category in col 3, Basis in col 6
 * Note: GPA does NOT have Non-evidence Limit field
 * @param {Object} sheet - XLSX sheet object
 * @returns {Object} GPA data including eligibility, last entry age, basis of cover
 */
function extractGPAData(sheet) {
    if (!sheet) return null;

    const data = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: '' });
    console.log('📋 Extracting GPA data...');

    // Extract individual fields
    const eligibility = extractFieldByLabel(data, 'eligibility :', 2);
    const lastEntryAge = extractFieldByLabel(data, 'last entry age', 2);

    // Extract Basis of Cover - GPA uses Category (col 3) and Basis (col 6)
    const basisOfCover = extractGPABasisOfCover(data);

    return {
        eligibility: eligibility,
        lastEntryAge: lastEntryAge,
        basisOfCover: basisOfCover
        // Note: GPA does not have Non-evidence Limit
    };
}

/**
 * Extract Basis of Cover table data from GPA sheet
 * GPA has different column structure: Category in col 3, Basis in col 6
 * @param {Array} data - Sheet data as 2D array
 * @returns {Array} Array of {category, basis} objects
 */
function extractGPABasisOfCover(data) {
    const basisOfCover = [];
    let foundHeader = false;

    console.log('  🔍 Searching for GPA Basis of Cover table...');

    for (let i = 0; i < data.length; i++) {
        const row = data[i];
        if (!row) continue;

        const cellA = String(row[0] || '').toLowerCase().trim();

        // Look for "Basis of Cover" header row
        if (cellA.includes('basis of cover')) {
            foundHeader = true;
            console.log(`  ✅ Found "Basis of Cover" header at row ${i}`);
            continue;
        }

        // After finding header, look for data rows
        if (foundHeader) {
            // GPA structure: col 3 = Category, col 6 = Basis
            const category = row[3] ? String(row[3]).trim() : '';
            const basis = row[6] ? String(row[6]).trim() : '';

            // Skip header row (contains "Category", "Basis", etc.)
            if (category.toLowerCase() === 'category' || category.toLowerCase() === 'insured') {
                console.log(`  📋 Skipping header row ${i}`);
                continue;
            }

            // Stop at Rate section or notes
            if (cellA.includes('rate') || cellA.includes('premium')) {
                console.log(`  🛑 Stopping at row ${i} (found: "${cellA.substring(0, 30)}")`);
                break;
            }

            // Stop if we hit the note row
            if (String(row[1] || '').trim().startsWith('* FIGURES')) {
                console.log(`  🛑 Stopping at note row ${i}`);
                break;
            }

            // Valid data row: has category
            if (category && category.length > 0 && !category.startsWith('*')) {
                // Clean up category
                const cleanCategory = category.replace(/\n/g, ' ').replace(/\s+/g, ' ').trim();

                // Clean up basis - format as currency if pure number
                let cleanBasis = basis;
                if (basis && /^\d+$/.test(basis.replace(/,/g, ''))) {
                    const numValue = parseFloat(basis.replace(/,/g, ''));
                    cleanBasis = `$${numValue.toLocaleString()}`;
                }

                basisOfCover.push({
                    category: cleanCategory,
                    basis: cleanBasis
                });
                console.log(`  📊 Category: "${cleanCategory.substring(0, 40)}..." → Basis: "${String(cleanBasis).substring(0, 50)}..."`);
            }
        }
    }

    console.log(`  ✅ Extracted ${basisOfCover.length} GPA basis of cover entries`);
    return basisOfCover;
}

/**
 * Extract GMM (Group Major Medical) specific data from the GMM sheet
 * @param {Object} sheet - XLSX sheet object
 * @returns {Object} GMM data including eligibility, last entry age, scheduleOfBenefits
 */
function extractGMMData(sheet) {
    if (!sheet) return null;

    const data = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: '' });
    console.log('📋 Extracting GMM data...');

    // Extract individual fields
    const eligibility = extractFieldByLabel(data, 'eligibility :', 2);
    const lastEntryAge = extractFieldByLabel(data, 'last entry age', 2);

    // Extract Schedule of Benefits with dynamic plan handling
    const scheduleOfBenefits = extractGMMScheduleOfBenefits(data);

    // Extract Category/Plan table for Slide 19
    const categoryPlans = extractGMMCategoryPlans(data);

    return {
        eligibility: eligibility,
        lastEntryAge: lastEntryAge,
        scheduleOfBenefits: scheduleOfBenefits,
        categoryPlans: categoryPlans
    };
}

/**
 * Extract GMM Category/Plan table for Slide 19
 * Dynamically extracts categories and their corresponding plans
 * Excludes suffix plans (ending with "S" like 1AS, 1BS, 2AS, 2BS, 3S)
 * @param {Array} data - Sheet data as 2D array
 * @returns {Array} Array of {category, plan} objects
 */
function extractGMMCategoryPlans(data) {
    console.log('  🔍 Extracting GMM Category/Plan table...');

    const categoryPlans = [];
    let foundBasisOfCover = false;
    let headerRow = -1;

    for (let i = 0; i < data.length; i++) {
        const row = data[i];
        if (!row) continue;

        const colA = String(row[0] || '').trim().toLowerCase();

        // Find "Basis of Cover" header
        if (colA.includes('basis of cover')) {
            foundBasisOfCover = true;
            console.log(`    📍 Found "Basis of Cover" at row ${i + 1}`);
            continue;
        }

        // Stop at "Rate" section
        if (foundBasisOfCover && colA.includes('rate')) {
            console.log(`    🛑 Stopping at row ${i + 1} (found Rate section)`);
            break;
        }

        // Skip header row (contains "Category" and "Plan")
        if (foundBasisOfCover) {
            const colD = String(row[3] || '').trim();
            const colJ = String(row[9] || '').trim();

            if (colD.toLowerCase() === 'category' && colJ.toLowerCase() === 'plan') {
                headerRow = i;
                continue;
            }

            // Extract category and plan (skip if empty or suffix plan)
            if (colD && colJ && headerRow >= 0) {
                // Exclude suffix plans (ending with "S" like 1AS, 1BS, 2AS, 2BS, 3S)
                // Main plans end with numbers like 1A1, 1B1, 2A1, 2B1, 3.1
                const planUpper = colJ.toUpperCase();
                const isSuffixPlan = planUpper.endsWith('S') && !planUpper.endsWith('BS1');

                if (!isSuffixPlan) {
                    categoryPlans.push({
                        category: colD,
                        plan: colJ
                    });
                    console.log(`    📊 Category: "${colD.substring(0, 40)}..." → Plan: ${colJ}`);
                } else {
                    console.log(`    ⏭️ Skipping suffix plan: ${colJ}`);
                }
            }
        }
    }

    console.log(`  ✅ Extracted ${categoryPlans.length} GMM category/plan entries`);
    return categoryPlans;
}

/**
 * Extract GMM Schedule of Benefits table data for Slide 20
 * Dynamically extracts plan headers and all benefit rows with their values
 * @param {Array} data - Sheet data as 2D array
 * @returns {Object} { planHeaders, planColumns, benefits }
 */
function extractGMMScheduleOfBenefits(data) {
    console.log('  🔍 Extracting GMM Schedule of Benefits with dynamic plan handling...');

    const result = {
        planHeaders: [],   // Dynamic plan names from Excel header row
        planColumns: [],   // Column indices for each plan
        benefits: []       // Array of benefit rows with sub-items
    };

    // Benefit name patterns for matching
    const BENEFIT_PATTERNS = [
        { name: 'Daily Room & Board', pattern: /daily room.*board/i },
        { name: 'Inpatient benefits', pattern: /inpatient benefits/i },
        { name: 'Post Hospitalisation', pattern: /post hospital/i },
        { name: 'Surgical Implants', pattern: /surgical implants/i },
        { name: 'Outpatient Treatment', pattern: /outpatient treatment/i },
        { name: 'Daily Parental Accommodation', pattern: /parental accommodation/i },
        { name: 'Daily Home Nursing Benefit', pattern: /home nursing/i },
        { name: 'HIV due to blood Transfusion', pattern: /hiv.*transfusion/i },
        { name: 'Maximum Benefit', pattern: /maximum benefit/i },
        { name: 'Extension to cover GST', pattern: /extension.*gst/i }
    ];

    let foundScheduleHeader = false;
    let scheduleStartRow = -1;
    let currentBenefit = null;

    for (let i = 0; i < data.length; i++) {
        const row = data[i];
        if (!row) continue;

        const col0 = String(row[0] || '').trim();
        const col1 = String(row[1] || '').trim();
        const col0Lower = col0.toLowerCase();
        const col1Lower = col1.toLowerCase();

        // Find the "SCHEDULE OF BENEFITS / INSURER" header row to extract plan headers dynamically
        if (col0Lower.includes('schedule of benefits') && col0Lower.includes('insurer')) {
            foundScheduleHeader = true;
            scheduleStartRow = i;

            // Extract plan headers DYNAMICALLY from columns 7+ (column H onwards)
            // GMM has columns: 7=1A/1B, 8=1AS/1BS, 9=2A/2B, 10=2AS/2BS, 11=3, etc.
            for (let colIdx = 7; colIdx < row.length; colIdx++) {
                const header = String(row[colIdx] || '').trim();
                if (header && !header.toLowerCase().includes('schedule') && header.length < 20) {
                    result.planHeaders.push(header);
                    result.planColumns.push(colIdx);
                }
            }

            console.log(`    📍 Found Schedule of Benefits header at row ${i + 1}`);
            console.log(`    📋 Dynamic plan headers: ${result.planHeaders.join(', ')}`);
            console.log(`    📋 Plan columns: ${result.planColumns.join(', ')}`);
            continue;
        }

        // After finding header, extract benefit rows
        if (foundScheduleHeader && i > scheduleStartRow) {
            // Stop at Endorsements section
            if (col0Lower.includes('endorsement') || col0Lower.includes('endorsements')) {
                console.log(`    🛑 Stopping at row ${i + 1} (found endorsements section)`);
                break;
            }

            // Check if this is a main benefit row (has number in column 0)
            const rowNumber = parseInt(col0, 10);
            const isMainBenefitRow = !isNaN(rowNumber) && rowNumber >= 1 && rowNumber <= 20;

            // Match benefit by name pattern (column 1)
            let matchedPattern = null;
            for (const bp of BENEFIT_PATTERNS) {
                if (bp.pattern.test(col1)) {
                    matchedPattern = bp;
                    break;
                }
            }

            if (isMainBenefitRow || matchedPattern) {
                // Extract values for all dynamic plan columns
                const values = {};
                for (let p = 0; p < result.planHeaders.length; p++) {
                    const planHeader = result.planHeaders[p];
                    const colIdx = result.planColumns[p];
                    let value = String(row[colIdx] || '').trim();

                    // Format co-insurance decimals as percentages
                    if (value && !isNaN(parseFloat(value)) && parseFloat(value) < 1 && parseFloat(value) > 0) {
                        value = `${Math.round(parseFloat(value) * 100)}%`;
                    }

                    values[planHeader] = value;
                }

                // Create benefit item
                const benefitItem = {
                    number: isMainBenefitRow ? rowNumber : null,
                    name: matchedPattern ? matchedPattern.name : col1,
                    rawName: col1,
                    values: values,
                    subItems: []
                };

                result.benefits.push(benefitItem);
                currentBenefit = benefitItem;

                const firstValue = values[result.planHeaders[0]] || '';
                console.log(`    📊 Benefit ${rowNumber || '?'}: "${col1.substring(0, 40)}..." → ${result.planHeaders[0]}: "${firstValue.substring(0, 20)}"`);
            }
            // Check for sub-items (rows without number in col 0, but have content in col 1)
            else if (!col0 && col1 && currentBenefit) {
                // Sub-item patterns
                const isSubItem =
                    col1Lower.includes('from') ||
                    col1Lower.includes('deductible') ||
                    col1Lower.includes('co - insurance') || col1Lower.includes('co-insurance') ||
                    col1Lower.includes('maximum no') ||
                    col1Lower.includes('maximum limit') ||
                    col1Lower.includes('per any one disability') ||
                    col1Lower.match(/^\s*\(\s*[a-z]\s*\)\s*/i); // Match (a), (b), etc.

                if (isSubItem) {
                    // Extract values for all dynamic plan columns
                    const subValues = {};
                    for (let p = 0; p < result.planHeaders.length; p++) {
                        const planHeader = result.planHeaders[p];
                        const colIdx = result.planColumns[p];
                        let value = String(row[colIdx] || '').trim();

                        // Format co-insurance decimals as percentages
                        if (value && !isNaN(parseFloat(value)) && parseFloat(value) < 1 && parseFloat(value) > 0) {
                            value = `${Math.round(parseFloat(value) * 100)}%`;
                        }

                        subValues[planHeader] = value;
                    }

                    const subItem = {
                        name: col1,
                        identifier: col0,
                        values: subValues
                    };

                    currentBenefit.subItems.push(subItem);
                    const firstSubValue = subValues[result.planHeaders[0]] || '';
                    console.log(`      └─ Sub-item: "${col1.substring(0, 30)}..." → "${firstSubValue.substring(0, 20)}"`);
                }
            }
        }
    }

    console.log(`  ✅ Extracted ${result.benefits.length} GMM benefit items with ${result.planHeaders.length} plan types`);
    return result;
}

/**
 * Extract all sheet data from workbook for future phases
 * @param {Object} workbook - XLSX workbook object
 * @returns {Object} Object with data from each sheet
 */
function extractAllSheetData(workbook) {
    const result = {};

    for (const sheetName of workbook.SheetNames) {
        const sheet = workbook.Sheets[sheetName];
        const data = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: '' });

        result[sheetName] = {
            rawData: data,
            periodOfInsurance: extractPeriodOfInsurance(sheet),
            rowCount: data.length
        };
    }

    return result;
}

/**
 * Main function to process a placement slip Excel file
 * @param {Buffer} buffer - Excel file buffer
 * @returns {Object} Extracted data ready for PowerPoint update
 */
function processPlacementSlip(buffer) {
    console.log('📊 Processing placement slip Excel file...');

    const workbook = parseExcelBuffer(buffer);

    console.log(`📋 Found sheets: ${workbook.SheetNames.join(', ')}`);

    // Extract Period of Insurance from first sheet (GTL)
    const firstSheetName = workbook.SheetNames[0];
    const firstSheet = workbook.Sheets[firstSheetName];
    const rawPeriod = extractPeriodOfInsurance(firstSheet);

    console.log(`📅 Raw Period of Insurance from ${firstSheetName}: "${rawPeriod}"`);

    const periodOfInsurance = formatDateRange(rawPeriod);

    if (periodOfInsurance) {
        console.log(`✅ Formatted Period: ${periodOfInsurance.formatted}`);
    } else {
        console.log('⚠️ Could not extract Period of Insurance');
    }

    // Extract data from all sheets for comprehensive processing
    const allSheetData = extractAllSheetData(workbook);

    // Extract GTL-specific data for Slide 8
    const gtlSheet = workbook.Sheets['GTL'];
    const gtlData = extractGTLData(gtlSheet);

    if (gtlData) {
        console.log('✅ GTL Data extracted successfully');
        console.log(`   - Eligibility: ${gtlData.eligibility ? 'Found' : 'Not found'}`);
        console.log(`   - Last Entry Age: ${gtlData.lastEntryAge ? 'Found' : 'Not found'}`);
        console.log(`   - Basis of Cover: ${gtlData.basisOfCover?.length || 0} entries`);
        console.log(`   - Non-Evidence Limit: ${gtlData.nonEvidenceLimit ? 'Found' : 'Not found'}`);
    }

    // Extract GDD-specific data for Slide 9 (note: sheet name has trailing space)
    const gddSheet = workbook.Sheets['GDD '] || workbook.Sheets['GDD'];
    const gddData = extractGDDData(gddSheet);

    if (gddData) {
        console.log('✅ GDD Data extracted successfully');
        console.log(`   - Eligibility: ${gddData.eligibility ? 'Found' : 'Not found'}`);
        console.log(`   - Last Entry Age: ${gddData.lastEntryAge ? 'Found' : 'Not found'}`);
        console.log(`   - Basis of Cover: ${gddData.basisOfCover?.length || 0} entries`);
        console.log(`   - Non-Evidence Limit: ${gddData.nonEvidenceLimit ? 'Found' : 'Not found'}`);
    }

    // Extract GHS-specific data for Slide 12
    const ghsSheet = workbook.Sheets['GHS'];
    const ghsData = extractGHSData(ghsSheet);

    if (ghsData) {
        console.log('✅ GHS Data extracted successfully');
        console.log(`   - Eligibility: ${ghsData.eligibility ? 'Found' : 'Not found'}`);
        console.log(`   - Last Entry Age: ${ghsData.lastEntryAge ? 'Found' : 'Not found'}`);
        console.log(`   - Category/Plans: ${ghsData.categoryPlans?.length || 0} entries`);
        console.log(`   - Schedule of Benefits: ${ghsData.scheduleOfBenefits?.benefits?.length || 0} items`);
        console.log(`   - Qualification Period: ${ghsData.qualificationPeriodDays || 'Not found'}`);
        console.log(`   - Room & Board Sections: ${ghsData.roomAndBoardEntitlements?.length || 0} sections`);
    }

    // Extract GPA-specific data for Slide 10
    const gpaSheet = workbook.Sheets['GPA'];
    const gpaData = extractGPAData(gpaSheet);

    if (gpaData) {
        console.log('✅ GPA Data extracted successfully');
        console.log(`   - Eligibility: ${gpaData.eligibility ? 'Found' : 'Not found'}`);
        console.log(`   - Last Entry Age: ${gpaData.lastEntryAge ? 'Found' : 'Not found'}`);
        console.log(`   - Basis of Cover: ${gpaData.basisOfCover?.length || 0} entries`);
    }

    // Extract GMM-specific data for Slides 19-20
    const gmmSheet = workbook.Sheets['GMM'];
    const gmmData = extractGMMData(gmmSheet);

    if (gmmData) {
        console.log('✅ GMM Data extracted successfully');
        console.log(`   - Eligibility: ${gmmData.eligibility ? 'Found' : 'Not found'}`);
        console.log(`   - Last Entry Age: ${gmmData.lastEntryAge ? 'Found' : 'Not found'}`);
        console.log(`   - Schedule of Benefits: ${gmmData.scheduleOfBenefits?.benefits?.length || 0} items`);
        console.log(`   - Plan Types: ${gmmData.scheduleOfBenefits?.planHeaders?.join(', ') || 'None'}`);
    }

    return {
        success: true,
        periodOfInsurance: periodOfInsurance,
        sheets: workbook.SheetNames,
        sheetData: allSheetData,
        gtlData: gtlData,
        gddData: gddData,
        ghsData: ghsData,
        gpaData: gpaData,
        gmmData: gmmData,
        slide1Data: {
            periodOfInsurance: periodOfInsurance
        },
        slide8Data: {
            eligibility: gtlData?.eligibility,
            lastEntryAge: gtlData?.lastEntryAge,
            basisOfCover: gtlData?.basisOfCover,
            nonEvidenceLimit: gtlData?.nonEvidenceLimit
        },
        slide9Data: {
            eligibility: gddData?.eligibility,
            lastEntryAge: gddData?.lastEntryAge,
            basisOfCover: gddData?.basisOfCover,
            nonEvidenceLimit: gddData?.nonEvidenceLimit
        },
        slide10Data: {
            eligibility: gpaData?.eligibility,
            lastEntryAge: gpaData?.lastEntryAge,
            basisOfCover: gpaData?.basisOfCover
            // Note: GPA does not have Non-evidence Limit
        },
        slide12Data: {
            eligibility: ghsData?.eligibility,
            lastEntryAge: ghsData?.lastEntryAge,
            categoryPlans: ghsData?.categoryPlans
        },
        // Slides 15-16: GHS Schedule of Benefits table
        slide15Data: {
            scheduleOfBenefits: ghsData?.scheduleOfBenefits
        },
        slide16Data: {
            scheduleOfBenefits: ghsData?.scheduleOfBenefits
        },
        // Slide 17: GHS Qualification Period (14 days)
        slide17Data: {
            qualificationPeriodDays: ghsData?.qualificationPeriodDays
        },
        // Slide 18: GHS Room & Board Entitlements
        slide18Data: {
            roomAndBoardEntitlements: ghsData?.roomAndBoardEntitlements
        },
        // Slide 19: GMM Overview (Eligibility, Last Entry Age)
        slide19Data: {
            eligibility: gmmData?.eligibility,
            lastEntryAge: gmmData?.lastEntryAge,
            categoryPlans: gmmData?.categoryPlans
        },
        // Slide 20: GMM Schedule of Benefits
        slide20Data: {
            scheduleOfBenefits: gmmData?.scheduleOfBenefits
        }
    };
}

/**
 * Extract GHS Schedule of Benefits table data for Slides 15-16
 * Extracts plan headers and all benefit rows with their values
 * @param {Array} data - Sheet data as 2D array
 * @returns {Object} { planHeaders, benefits, qualificationPeriodDays }
 */
function extractGHSScheduleOfBenefits(data) {
    console.log('  🔍 Extracting GHS Schedule of Benefits...');

    const result = {
        planHeaders: [], // e.g., ["Plan 1A/1B", "Plan 2A/2B", "Plan 3"]
        benefits: [],    // Array of benefit rows
        qualificationPeriodDays: null // "14 DAYS" value for slide 17
    };

    let foundScheduleHeader = false;
    let scheduleStartRow = -1;

    for (let i = 0; i < data.length; i++) {
        const row = data[i];
        if (!row) continue;

        const col0 = String(row[0] || '').trim();
        const col1 = String(row[1] || '').trim();
        const col0Lower = col0.toLowerCase();

        // Find the "SCHEDULE OF BENEFITS / INSURER / PLAN" header row
        if (col0Lower.includes('schedule of benefits') && col0Lower.includes('plan')) {
            foundScheduleHeader = true;
            scheduleStartRow = i;

            // Extract plan headers from columns 6, 7, 8
            result.planHeaders = [
                String(row[6] || '').trim(),
                String(row[7] || '').trim(),
                String(row[8] || '').trim()
            ].filter(h => h);

            console.log(`    📍 Found Schedule of Benefits header at row ${i + 1}`);
            console.log(`    📋 Plan headers: ${result.planHeaders.join(', ')}`);
            continue;
        }

        // After finding header, extract benefit rows
        if (foundScheduleHeader && i > scheduleStartRow) {
            // Stop at Endorsements section or end markers
            if (col0Lower.includes('endorsement') || col0Lower.includes('additional arrangement')) {
                console.log(`    🛑 Stopping at row ${i + 1} (found: "${col0.substring(0, 30)}")`);
                break;
            }

            // Extract "All disabilities..." row for qualification period (Slide 17)
            if (col0Lower.includes('all disabilities') && col0Lower.includes('qualification period')) {
                result.qualificationPeriodDays = String(row[6] || '').trim();
                console.log(`    📅 Qualification period: "${result.qualificationPeriodDays}"`);
            }

            // Extract numbered benefit rows (1-15)
            const rowNumber = parseInt(col0, 10);
            if (!isNaN(rowNumber) && rowNumber >= 1 && rowNumber <= 15) {
                let plan1Value = String(row[6] || '').trim();
                let plan2Value = String(row[7] || '').trim();
                let plan3Value = String(row[8] || '').trim();

                // Handle merged cells: if Plan1 has value but Plan2/Plan3 are empty,
                // the cell is likely merged and applies to all plans
                if (plan1Value && !plan2Value && !plan3Value) {
                    plan2Value = plan1Value;
                    plan3Value = plan1Value;
                    console.log(`    📊 Benefit ${rowNumber}: "${col1.substring(0, 40)}..." → All plans: "${plan1Value.substring(0, 20)}" (merged cell)`);
                } else {
                    console.log(`    📊 Benefit ${rowNumber}: "${col1.substring(0, 40)}..." → Plan1: "${plan1Value.substring(0, 20)}"`);
                }

                const benefitItem = {
                    number: rowNumber,
                    name: col1,
                    plan1Value: plan1Value,
                    plan2Value: plan2Value,
                    plan3Value: plan3Value,
                    subItems: []
                };

                result.benefits.push(benefitItem);
            }

            // Extract sub-items (Maximum no. of days, Qualification period, Hospital Misc, etc.)
            const col1Lower = col1.toLowerCase();
            const isSubItem = col1Lower.includes('maximum no. of days') ||
                col1Lower.includes('qualification period') ||
                col1Lower.includes('hospital miscellaneous') ||
                col1Lower.includes('surgical fees') ||
                col1Lower.includes('surgical schedule') ||
                col1Lower.includes('pre-existing') || col1Lower.includes('pre- existing') ||
                col1Lower.includes('daily in hospital doctor') ||
                col0.match(/^\s*\(\s*[a-d]\s*\)\s*$/i); // Match (a), (b), (c), (d)

            if (isSubItem) {
                let subPlan1 = String(row[6] || '').trim();
                let subPlan2 = String(row[7] || '').trim();
                let subPlan3 = String(row[8] || '').trim();

                // Handle merged cells for sub-items too
                if (subPlan1 && !subPlan2 && !subPlan3) {
                    subPlan2 = subPlan1;
                    subPlan3 = subPlan1;
                }

                const subItem = {
                    name: col1,
                    identifier: col0, // Keep the (a), (b), etc. identifier
                    plan1Value: subPlan1,
                    plan2Value: subPlan2,
                    plan3Value: subPlan3
                };

                // Add to the last benefit item
                if (result.benefits.length > 0) {
                    result.benefits[result.benefits.length - 1].subItems.push(subItem);
                    console.log(`      └─ Sub-item: "${col1.substring(0, 30)}..." → "${subPlan1.substring(0, 20)}"`);
                }
            }
        }
    }

    console.log(`  ✅ Extracted ${result.benefits.length} benefit items`);
    return result;
}

/**
 * Extract qualification period (days) for Slide 17
 * Specifically looks for "All disabilities including any and all complications..."
 * @param {Array} data - Sheet data as 2D array
 * @returns {string|null} The days value (e.g., "14 DAYS")
 */
function extractGHSQualificationPeriod(data) {
    console.log('  🔍 Extracting GHS Qualification Period for Slide 17...');

    for (let i = 0; i < data.length; i++) {
        const row = data[i];
        if (!row) continue;

        const col0 = String(row[0] || '').toLowerCase().trim();

        // Find the "All disabilities including any and all complications..." row
        if (col0.includes('all disabilities') &&
            (col0.includes('qualification period') || col0.includes('complications'))) {
            const daysValue = String(row[6] || '').trim();
            console.log(`    📍 Found at row ${i + 1}: "${daysValue}"`);
            return daysValue;
        }
    }

    console.log('    ⚠️ Qualification period not found');
    return null;
}

/**
 * Extract Room & Board entitlement sections for Slide 18
 * Extracts multiple bedded classification sections with ward classes and benefits
 * @param {Array} data - Sheet data as 2D array
 * @returns {Array} Array of entitlement sections with ward data
 */
function extractGHSRoomAndBoardEntitlements(data) {
    console.log('  🔍 Extracting GHS Room & Board Entitlements for Slide 18...');

    const entitlements = [];
    let currentSection = null;

    for (let i = 0; i < data.length; i++) {
        const row = data[i];
        if (!row) continue;

        const col1 = String(row[1] || '').trim();
        const col2 = String(row[2] || '').trim();

        // Check for GHS Entitlement section headers
        if (col1.includes('GHS Entitlement : Room & Board')) {
            // Save previous section if exists
            if (currentSection && currentSection.wards.length > 0) {
                entitlements.push(currentSection);
            }

            // Determine bedded type from header
            let beddedType = 'Unknown';
            if (col1.includes('1 & 2 Bedded') || col1.includes('1 &amp; 2 Bedded')) {
                beddedType = '1 & 2 Bedded';
            } else if (col1.includes('4 Bedded')) {
                beddedType = '4 Bedded';
            } else if (col1.includes('1 Bedded')) {
                beddedType = '1 Bedded';
            } else if (col1.includes('2 Bedded')) {
                beddedType = '2 Bedded';
            }

            currentSection = {
                title: col1,
                beddedType: beddedType,
                wards: []
            };

            console.log(`    📍 Found section: "${beddedType}" at row ${i + 1}`);
            continue;
        }

        // Check for section end markers
        if (col1.toLowerCase().includes('section iv') ||
            col1.toLowerCase().includes('pre - existing') ||
            (String(row[0] || '').trim() && !isNaN(parseInt(String(row[0] || '').trim())))) {
            // Save current section if we hit a new numbered item or section marker
            if (currentSection && currentSection.wards.length > 0) {
                entitlements.push(currentSection);
                currentSection = null;
            }
        }

        // Extract ward class data within a section
        if (currentSection) {
            // Skip header rows
            if (col1.toLowerCase() === 'class of ward' || col1.toLowerCase().includes('hospital cash benefit')) {
                continue;
            }

            // Skip "All Restructured Hospitals" header row
            if (col2.toLowerCase().includes('all restructured hospitals')) {
                continue;
            }

            // Extract ward class and benefit
            if (col1 && col2 && (col1.includes('B1') || col1.includes('B2') || col1 === 'C')) {
                currentSection.wards.push({
                    classOfWard: col1,
                    benefit: col2
                });
                console.log(`    📊 Ward: "${col1}" → Benefit: "${col2}"`);
            }
        }
    }

    // Don't forget the last section
    if (currentSection && currentSection.wards.length > 0) {
        entitlements.push(currentSection);
    }

    console.log(`  ✅ Extracted ${entitlements.length} Room & Board entitlement sections`);
    return entitlements;
}

/**
 * Validate if buffer is a valid Excel file
 * @param {Buffer} buffer - File buffer
 * @returns {boolean} True if valid Excel file
 */
function isValidExcelBuffer(buffer) {
    try {
        const workbook = XLSX.read(buffer, { type: 'buffer' });
        return workbook && workbook.SheetNames && workbook.SheetNames.length > 0;
    } catch (error) {
        return false;
    }
}

module.exports = {
    parseExcelBuffer,
    extractPeriodOfInsurance,
    formatDateRange,
    extractAllSheetData,
    extractGTLData,
    extractGDDData,
    extractGHSData,
    extractGHSCategoryPlans,
    extractGHSScheduleOfBenefits,
    extractGHSQualificationPeriod,
    extractGHSRoomAndBoardEntitlements,
    extractGPAData,
    extractGMMData,
    extractGMMScheduleOfBenefits,
    extractFieldByLabel,
    extractBasisOfCover,
    extractGPABasisOfCover,
    processPlacementSlip,
    isValidExcelBuffer,
    SHEET_NAMES
};
