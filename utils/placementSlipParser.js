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

    // Search for "Period of Insurance" in the first 15 rows
    for (let i = 0; i < Math.min(15, data.length); i++) {
        const row = data[i];
        if (row && row[0]) {
            const cellA = String(row[0]).trim().toLowerCase();
            if (cellA.includes('period of insurance')) {
                // Try columns 1, 2, 3 (handles merged cells and different layouts)
                for (let col = 1; col <= 3; col++) {
                    const cellValue = row[col] ? String(row[col]).trim() : '';
                    // Check if this looks like a date range
                    if (cellValue && cellValue.match(/\d{2}\/\d{2}\/\d{4}/)) {
                        return cellValue;
                    }
                }
                // If no date pattern found, just return first non-empty cell
                for (let col = 1; col <= 3; col++) {
                    const cellValue = row[col] ? String(row[col]).trim() : '';
                    if (cellValue) {
                        return cellValue;
                    }
                }
            }
        }
    }

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

    return {
        success: true,
        periodOfInsurance: periodOfInsurance,
        sheets: workbook.SheetNames,
        sheetData: allSheetData,
        slide1Data: {
            periodOfInsurance: periodOfInsurance
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
    processPlacementSlip,
    isValidExcelBuffer,
    SHEET_NAMES
};
