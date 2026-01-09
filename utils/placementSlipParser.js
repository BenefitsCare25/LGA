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
 * @returns {Object} GHS data including eligibility, last entry age, categoryPlans
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

    return {
        eligibility: eligibility,
        lastEntryAge: lastEntryAge,
        categoryPlans: categoryPlans
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

    return {
        success: true,
        periodOfInsurance: periodOfInsurance,
        sheets: workbook.SheetNames,
        sheetData: allSheetData,
        gtlData: gtlData,
        gddData: gddData,
        ghsData: ghsData,
        gpaData: gpaData,
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
        }
    };
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
    extractGPAData,
    extractFieldByLabel,
    extractBasisOfCover,
    extractGPABasisOfCover,
    processPlacementSlip,
    isValidExcelBuffer,
    SHEET_NAMES
};
