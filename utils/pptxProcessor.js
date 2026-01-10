/**
 * PowerPoint Processor
 * Reads, modifies, and writes PPTX files using PizZip for XML manipulation
 * Preserves original formatting while updating specific text content
 */

const PizZip = require('pizzip');
const slideDetector = require('./slideDetector');

/**
 * Read PPTX buffer and extract ZIP structure
 * @param {Buffer} buffer - PPTX file buffer
 * @returns {Object} PizZip instance with PPTX contents
 */
function readPPTX(buffer) {
    try {
        // Validate input type
        if (!buffer) {
            throw new Error('No buffer provided');
        }
        if (!Buffer.isBuffer(buffer) && !(buffer instanceof Uint8Array) && !(buffer instanceof ArrayBuffer)) {
            const dataType = typeof buffer;
            const constructorName = buffer?.constructor?.name || 'unknown';
            throw new Error(`Expected Buffer but received ${dataType} (${constructorName}). Buffer length: ${buffer?.length || buffer?.byteLength || 'N/A'}`);
        }
        console.log(`📦 Reading PPTX buffer: ${buffer.length || buffer.byteLength} bytes, type: ${buffer.constructor.name}`);
        const zip = new PizZip(buffer);
        return zip;
    } catch (error) {
        console.error('❌ Error reading PPTX file:', error.message);
        throw new Error(`Failed to read PPTX file: ${error.message}`);
    }
}

/**
 * Get list of slide files in the PPTX
 * @param {Object} zip - PizZip instance
 * @returns {string[]} Array of slide file paths
 */
function getSlideFiles(zip) {
    const slideFiles = [];
    const files = Object.keys(zip.files);

    for (const file of files) {
        if (file.match(/^ppt\/slides\/slide\d+\.xml$/)) {
            slideFiles.push(file);
        }
    }

    // Sort by slide number
    slideFiles.sort((a, b) => {
        const numA = parseInt(a.match(/slide(\d+)\.xml/)[1]);
        const numB = parseInt(b.match(/slide(\d+)\.xml/)[1]);
        return numA - numB;
    });

    return slideFiles;
}

/**
 * Get XML content of a specific slide
 * @param {Object} zip - PizZip instance
 * @param {number} slideNumber - Slide number (1-indexed)
 * @returns {string} XML content of the slide
 */
function getSlideXML(zip, slideNumber) {
    const slidePath = `ppt/slides/slide${slideNumber}.xml`;
    const file = zip.file(slidePath);

    if (!file) {
        throw new Error(`Slide ${slideNumber} not found in PPTX`);
    }

    return file.asText();
}

/**
 * Update XML content of a specific slide
 * @param {Object} zip - PizZip instance
 * @param {number} slideNumber - Slide number (1-indexed)
 * @param {string} xmlContent - New XML content
 */
function setSlideXML(zip, slideNumber, xmlContent) {
    const slidePath = `ppt/slides/slide${slideNumber}.xml`;
    zip.file(slidePath, xmlContent);
}

/**
 * Find and replace text in slide XML while preserving formatting
 * Handles text split across multiple <a:t> elements
 * @param {string} xml - Slide XML content
 * @param {string} searchText - Text to find
 * @param {string} replaceText - Text to replace with
 * @returns {Object} Object with updated XML and whether replacement was made
 */
function findAndReplaceText(xml, searchText, replaceText) {
    let replaced = false;
    let updatedXml = xml;

    // Simple approach: direct text replacement
    if (updatedXml.includes(searchText)) {
        updatedXml = updatedXml.replace(searchText, replaceText);
        replaced = true;
    }

    return { xml: updatedXml, replaced };
}

/**
 * Update Period of Insurance text in Slide 1
 * Handles text split across multiple <a:t> elements
 * @param {Object} zip - PizZip instance
 * @param {Object} dateRange - Object with formatted date string
 * @returns {boolean} True if update was successful
 */
function updateSlide1PeriodOfInsurance(zip, dateRange, slideNumber = 1) {
    console.log(`📝 Updating Slide ${slideNumber} Period of Insurance...`);

    try {
        let slideXml = getSlideXML(zip, slideNumber);

        // Pattern 1: Date range in same element with "Period of Insurance:"
        const combinedPattern = /(Period of Insurance:\s*)(\d{1,2}\s+\w+\s+\d{4}\s+to\s+\d{1,2}\s+\w+\s+\d{4})/gi;
        if (combinedPattern.test(slideXml)) {
            slideXml = slideXml.replace(combinedPattern, `$1${dateRange.formatted}`);
            setSlideXML(zip, slideNumber, slideXml);
            console.log(`✅ Updated Period of Insurance to: ${dateRange.formatted}`);
            return true;
        }

        // Pattern 2: Date range in separate <a:t> element (most common case)
        // Matches: <a:t>1 July 2025 to 30 June 2026</a:t>
        const separateDatePattern = /<a:t>(\d{1,2}\s+\w+\s+\d{4}\s+to\s+\d{1,2}\s+\w+\s+\d{4})<\/a:t>/gi;
        if (separateDatePattern.test(slideXml)) {
            slideXml = slideXml.replace(separateDatePattern, `<a:t>${dateRange.formatted}</a:t>`);
            setSlideXML(zip, slideNumber, slideXml);
            console.log(`✅ Updated Period of Insurance to: ${dateRange.formatted}`);
            return true;
        }

        // Pattern 3: Try to find and replace any date range in "D Month YYYY to D Month YYYY" format
        const genericDatePattern = /(\d{1,2}\s+(?:January|February|March|April|May|June|July|August|September|October|November|December)\s+\d{4})\s+to\s+(\d{1,2}\s+(?:January|February|March|April|May|June|July|August|September|October|November|December)\s+\d{4})/gi;
        if (genericDatePattern.test(slideXml)) {
            slideXml = slideXml.replace(genericDatePattern, dateRange.formatted);
            setSlideXML(zip, slideNumber, slideXml);
            console.log(`✅ Updated Period of Insurance to: ${dateRange.formatted}`);
            return true;
        }

        console.log(`⚠️ Period of Insurance date pattern not found in Slide ${slideNumber}`);
        return false;

    } catch (error) {
        console.error(`❌ Error updating Slide ${slideNumber}:`, error.message);
        return false;
    }
}

/**
 * Escape special XML characters
 * @param {string} text - Text to escape
 * @returns {string} XML-safe text
 */
function escapeXml(text) {
    if (!text) return '';
    return text
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&apos;');
}

/**
 * Calculate fuzzy match score between template and Excel category text
 * Uses token overlap (Jaccard similarity) and substring containment
 * @param {string} template - Category text from template
 * @param {string} excel - Category text from Excel
 * @returns {Object} { isMatch, similarity, matchedTokens }
 */
function calculateCategoryMatchScore(template, excel) {
    // Normalize: lowercase, replace ampersands, remove extra whitespace
    const normalize = (str) => str.toLowerCase()
        .replace(/&amp;/g, '&')
        .replace(/&/g, ' and ')
        .replace(/\s+/g, ' ')
        .trim();

    const templateNorm = normalize(template);
    const excelNorm = normalize(excel);

    // Tokenize (words with length > 2 to filter out articles/prepositions)
    const templateTokens = new Set(templateNorm.split(/\s+/).filter(t => t.length > 2));
    const excelTokens = new Set(excelNorm.split(/\s+/).filter(t => t.length > 2));

    // Calculate Jaccard similarity (intersection / union)
    const intersection = [...templateTokens].filter(t => excelTokens.has(t));
    const union = new Set([...templateTokens, ...excelTokens]);
    const similarity = union.size > 0 ? intersection.length / union.size : 0;

    // Also check substring containment (handles cases like "Management Staff" vs "Mgmt Staff")
    const containsCheck = templateNorm.includes(excelNorm.substring(0, 15)) ||
                          excelNorm.includes(templateNorm.substring(0, 15));

    // First 3 words match (original logic, kept as fallback)
    const templateWords = templateNorm.split(/\s+/).slice(0, 3).join(' ');
    const excelWords = excelNorm.split(/\s+/).slice(0, 3).join(' ');
    const first3Match = templateWords === excelWords;

    // Match if any condition is met
    const isMatch = similarity >= 0.6 || containsCheck || first3Match;

    return {
        isMatch,
        similarity,
        matchedTokens: intersection,
        method: similarity >= 0.6 ? 'jaccard' : (containsCheck ? 'substring' : (first3Match ? 'first3words' : 'none'))
    };
}

/**
 * Replace table cell value by finding row with matching label
 * Finds table row where first cell contains the label, then replaces content in value cell
 * @param {string} xml - Slide XML content
 * @param {string} labelText - Text to find in label cell (case-insensitive, exact word match)
 * @param {string} newValue - New value to insert in the value cell
 * @returns {Object} { xml: updatedXml, success: boolean }
 */
function replaceTableCellByLabel(xml, labelText, newValue) {
    const labelLower = labelText.toLowerCase().trim();
    console.log(`    🔎 Searching for row with label: "${labelText}"`);

    // Pattern to match table rows: <a:tr>...<a:tc>label cell</a:tc><a:tc>value cell</a:tc>...</a:tr>
    const rowPattern = /<a:tr\b[^>]*>([\s\S]*?)<\/a:tr>/g;

    let match;
    let updatedXml = xml;
    let success = false;
    let rowIndex = 0;
    let totalRows = 0;

    // First pass: count and log all rows for debugging
    const allRows = [];
    while ((match = rowPattern.exec(xml)) !== null) {
        totalRows++;
        const rowContent = match[1];
        const fullRow = match[0];

        // Extract all cells from this row
        const cellPattern = /<a:tc\b[^>]*>([\s\S]*?)<\/a:tc>/g;
        const cells = [];
        let cellMatch;

        while ((cellMatch = cellPattern.exec(rowContent)) !== null) {
            cells.push({
                full: cellMatch[0],
                content: cellMatch[1]
            });
        }

        // Extract text from first cell
        let labelCellText = '';
        if (cells.length > 0) {
            const textPattern = /<a:t>([^<]*)<\/a:t>/g;
            let textMatch;
            while ((textMatch = textPattern.exec(cells[0].content)) !== null) {
                labelCellText += textMatch[1];
            }
        }

        allRows.push({
            fullRow,
            rowContent,
            cells,
            labelCellText: labelCellText.trim(),
            cellCount: cells.length
        });
    }

    console.log(`    📊 Total rows found: ${totalRows}`);
    allRows.forEach((row, idx) => {
        console.log(`       Row ${idx + 1}: ${row.cellCount} cells, label="${row.labelCellText.substring(0, 30)}${row.labelCellText.length > 30 ? '...' : ''}"`);
    });

    // Second pass: find and replace
    for (const row of allRows) {
        rowIndex++;

        // Need at least 2 cells (label + value)
        if (row.cellCount < 2) continue;

        // Normalize label cell text for comparison
        const normalizedLabel = row.labelCellText.toLowerCase().trim();

        // More precise matching: check if the cell text STARTS WITH or EQUALS the label
        // This prevents "Eligibility" from matching "Eligibility Date"
        const isExactMatch = normalizedLabel === labelLower ||
                            normalizedLabel === labelLower + ':' ||
                            normalizedLabel.startsWith(labelLower + ' ') ||
                            normalizedLabel.startsWith(labelLower + ':');

        if (isExactMatch) {
            console.log(`    📍 Row ${rowIndex}: Found exact match for "${labelText}" - cell text: "${row.labelCellText}"`);

            // Get the value cell (second cell)
            const valueCell = row.cells[1];
            const valueCellContent = valueCell.content;

            // Find all <a:t> elements in value cell
            const valueTextPattern = /<a:t>([^<]*)<\/a:t>/g;
            const textElements = [];
            let vtMatch;

            while ((vtMatch = valueTextPattern.exec(valueCellContent)) !== null) {
                textElements.push({
                    full: vtMatch[0],
                    text: vtMatch[1],
                    index: vtMatch.index
                });
            }

            console.log(`    📝 Value cell has ${textElements.length} text elements: ${textElements.map(e => `"${e.text}"`).join(', ')}`);

            if (textElements.length > 0) {
                // Find the element that contains the actual value (not just ": " prefix)
                let targetElement = null;

                for (const elem of textElements) {
                    const trimmed = elem.text.trim();
                    // Skip elements that are just punctuation or whitespace
                    if (trimmed === ':' || trimmed === ': ' || trimmed === '' || trimmed === '-') {
                        continue;
                    }
                    // Take the first substantial text element as the value
                    targetElement = elem;
                    break;
                }

                if (targetElement) {
                    const oldText = targetElement.full;
                    const newText = `<a:t>${newValue}</a:t>`;

                    console.log(`    🔄 Replacing: "${targetElement.text.substring(0, 50)}..." → "${newValue.substring(0, 50)}..."`);

                    // Replace in the value cell
                    const newValueCellContent = valueCellContent.replace(oldText, newText);
                    const newValueCell = valueCell.full.replace(valueCellContent, newValueCellContent);

                    // Replace in the row
                    const newRowContent = row.rowContent.replace(valueCell.full, newValueCell);
                    const newFullRow = row.fullRow.replace(row.rowContent, newRowContent);

                    // Replace in the XML
                    updatedXml = updatedXml.replace(row.fullRow, newFullRow);
                    success = true;
                    console.log(`    ✅ Successfully updated "${labelText}" cell`);
                    break;
                } else {
                    console.log(`    ⚠️ No substantial text element found in value cell`);
                }
            } else {
                console.log(`    ⚠️ No text elements found in value cell`);
            }
        }
    }

    if (!success) {
        console.log(`    ❌ Could not find row with label "${labelText}" (searched ${rowIndex} rows)`);
    }

    // Return available labels for debugging
    const availableLabels = allRows
        .filter(r => r.cellCount >= 2 && r.labelCellText)
        .map(r => r.labelCellText.substring(0, 40));

    return { xml: updatedXml, success, availableLabels };
}

/**
 * Generate XML for a single bullet point paragraph in Basis of Cover
 * @param {string} category - Category name (bold)
 * @param {string} basis - Basis value
 * @returns {string} XML paragraph string
 */
function generateBasisOfCoverParagraph(category, basis) {
    const escapedCategory = escapeXml(category);
    const escapedBasis = escapeXml(basis);

    return `<a:p><a:pPr marL="285750" indent="-285750"><a:lnSpc><a:spcPct val="107000"/></a:lnSpc><a:spcAft><a:spcPts val="0"/></a:spcAft><a:buFont typeface="Arial" panose="020B0604020202020204" pitchFamily="34" charset="0"/><a:buChar char="•"/></a:pPr><a:r><a:rPr lang="en-US" sz="2000" b="1" dirty="0"><a:effectLst/><a:highlight><a:srgbClr val="FFFF00"/></a:highlight><a:latin typeface="Arial" panose="020B0604020202020204" pitchFamily="34" charset="0"/><a:ea typeface="Calibri" panose="020F0502020204030204" pitchFamily="34" charset="0"/><a:cs typeface="Arial" panose="020B0604020202020204" pitchFamily="34" charset="0"/></a:rPr><a:t>${escapedCategory}</a:t></a:r><a:r><a:rPr lang="en-US" sz="2000" dirty="0"><a:effectLst/><a:highlight><a:srgbClr val="FFFF00"/></a:highlight><a:latin typeface="Arial" panose="020B0604020202020204" pitchFamily="34" charset="0"/><a:ea typeface="Calibri" panose="020F0502020204030204" pitchFamily="34" charset="0"/><a:cs typeface="Arial" panose="020B0604020202020204" pitchFamily="34" charset="0"/></a:rPr><a:t>: ${escapedBasis}</a:t></a:r></a:p>`;
}

/**
 * Generate complete cell content XML for Basis of Cover
 * @param {Array} basisOfCover - Array of {category, basis} objects
 * @returns {string} Complete txBody XML content
 */
function generateBasisOfCoverCellContent(basisOfCover) {
    if (!basisOfCover || basisOfCover.length === 0) {
        return null;
    }

    const paragraphs = basisOfCover.map(item =>
        generateBasisOfCoverParagraph(item.category, item.basis)
    ).join('');

    // Add required empty ending paragraph for valid PPTX table cell structure
    const emptyEndParagraph = '<a:p><a:pPr marL="285750" indent="-285750"><a:lnSpc><a:spcPct val="107000"/></a:lnSpc><a:spcAft><a:spcPts val="0"/></a:spcAft><a:buFont typeface="Arial" panose="020B0604020202020204" pitchFamily="34" charset="0"/><a:buChar char="•"/></a:pPr><a:endParaRPr lang="en-US" sz="2000" dirty="0"><a:effectLst/><a:latin typeface="Arial" panose="020B0604020202020204" pitchFamily="34" charset="0"/><a:ea typeface="Calibri" panose="020F0502020204030204" pitchFamily="34" charset="0"/><a:cs typeface="Arial" panose="020B0604020202020204" pitchFamily="34" charset="0"/></a:endParaRPr></a:p>';

    return paragraphs + emptyEndParagraph;
}

/**
 * Replace the entire Basis of Cover cell content in a slide
 * Finds the row with "Basis of Cover" label and replaces the value cell's txBody
 * @param {string} xml - Slide XML content
 * @param {Array} basisOfCover - Array of {category, basis} objects
 * @returns {Object} { xml: updatedXml, success: boolean }
 */
function replaceBasisOfCoverCell(xml, basisOfCover) {
    if (!basisOfCover || basisOfCover.length === 0) {
        return { xml, success: false };
    }

    console.log(`    🔄 Replacing Basis of Cover cell content with ${basisOfCover.length} entries...`);

    // Find the row containing "Basis of Cover"
    const rowPattern = /<a:tr\b[^>]*>([\s\S]*?)<\/a:tr>/g;
    let rowMatch;
    let updatedXml = xml;
    let success = false;

    while ((rowMatch = rowPattern.exec(xml)) !== null) {
        const rowContent = rowMatch[1];
        const fullRow = rowMatch[0];

        // Check if this row contains "Basis of Cover" label
        if (rowContent.includes('>Basis of Cover<')) {
            console.log(`    📍 Found Basis of Cover row`);

            // Extract cells from this row
            const cellPattern = /<a:tc\b[^>]*>([\s\S]*?)<\/a:tc>/g;
            const cells = [];
            let cellMatch;

            while ((cellMatch = cellPattern.exec(rowContent)) !== null) {
                cells.push({
                    full: cellMatch[0],
                    content: cellMatch[1]
                });
            }

            if (cells.length >= 2) {
                const valueCell = cells[1];

                // Find and replace the txBody content
                const txBodyPattern = /<a:txBody>([\s\S]*?)<\/a:txBody>/;
                const txBodyMatch = valueCell.content.match(txBodyPattern);

                if (txBodyMatch) {
                    // Generate new content
                    const newParagraphs = generateBasisOfCoverCellContent(basisOfCover);
                    const newTxBody = `<a:txBody><a:bodyPr/><a:lstStyle/>${newParagraphs}</a:txBody>`;

                    // Replace in value cell
                    const newValueCellContent = valueCell.content.replace(txBodyMatch[0], newTxBody);
                    const newValueCell = valueCell.full.replace(valueCell.content, newValueCellContent);

                    // Replace in row
                    const newRowContent = rowContent.replace(valueCell.full, newValueCell);
                    const newFullRow = fullRow.replace(rowContent, newRowContent);

                    // Replace in XML
                    updatedXml = updatedXml.replace(fullRow, newFullRow);
                    success = true;

                    console.log(`    ✅ Replaced Basis of Cover cell with ${basisOfCover.length} bullet points`);
                    basisOfCover.forEach((item, i) => {
                        console.log(`       ${i + 1}. ${item.category}: ${item.basis.substring(0, 30)}...`);
                    });
                } else {
                    console.log(`    ⚠️ Could not find txBody in value cell`);
                }
            }
            break;
        }
    }

    if (!success) {
        console.log(`    ⚠️ Basis of Cover row not found in table`);
    }

    return { xml: updatedXml, success };
}

/**
 * Update Slide 8 GTL table with data from placement slip
 * @param {Object} zip - PizZip instance
 * @param {Object} slide8Data - Data for slide 8 (eligibility, lastEntryAge, basisOfCover, nonEvidenceLimit)
 * @returns {Object} Results of the update operation
 */
function updateSlide8GTLTable(zip, slide8Data, slideNumber = 8) {
    console.log(`📝 Updating Slide ${slideNumber} GTL Table...`);

    const results = {
        updated: [],
        errors: []
    };

    if (!slide8Data) {
        console.log(`⚠️ No GTL data provided for slide ${slideNumber}`);
        return results;
    }

    // Debug: Log all incoming data
    console.log(`📋 Slide ${slideNumber} GTL Data received:`);
    console.log(`   - eligibility: "${slide8Data.eligibility?.substring(0, 60) || 'null'}..."`);
    console.log(`   - lastEntryAge: "${slide8Data.lastEntryAge || 'null'}"`);
    console.log(`   - basisOfCover: ${slide8Data.basisOfCover?.length || 0} items`);
    console.log(`   - nonEvidenceLimit: "${slide8Data.nonEvidenceLimit?.substring(0, 60) || 'null'}..."`);

    try {
        let slideXml = getSlideXML(zip, slideNumber);

        // 1. Update Eligibility & Last Entry Age - Replace as separate text elements to avoid duplication
        if (slide8Data.eligibility || slide8Data.lastEntryAge) {
            const eligResult = replaceEligibilityAndLastEntryAgeSeparately(
                slideXml,
                slide8Data.eligibility,
                slide8Data.lastEntryAge
            );

            if (eligResult.success) {
                slideXml = eligResult.xml;
                console.log(`  ✅ Updated Eligibility & Last Entry Age`);
                if (slide8Data.eligibility) {
                    results.updated.push({ field: 'Eligibility', value: slide8Data.eligibility.substring(0, 50) + '...' });
                }
                if (slide8Data.lastEntryAge) {
                    results.updated.push({ field: 'Last Entry Age', value: slide8Data.lastEntryAge });
                }
            } else {
                console.log(`  ⚠️ Could not update Eligibility/Last Entry Age`);
                if (slide8Data.eligibility) {
                    results.errors.push({ field: 'Eligibility', error: 'Cell not found' });
                }
            }
        }

        // 3. Update Basis of Cover - Replace bullet point content individually
        if (slide8Data.basisOfCover && slide8Data.basisOfCover.length > 0) {
            console.log(`  🔄 Updating Basis of Cover with ${slide8Data.basisOfCover.length} entries...`);
            let basisUpdated = false;

            // Strategy: Find and replace bullet point text content directly
            // Look for bullet paragraphs with bold category followed by ": basis"
            const bulletContentPattern = /(<a:buChar char="•"[^>]*\/><\/a:pPr><a:r><a:rPr[^>]*b="1"[^>]*>(?:[^<]*<\/[^>]+>)*<a:t>)([^<]+)(<\/a:t><\/a:r><a:r><a:rPr[^>]*>(?:[^<]*<\/[^>]+>)*<a:t>: )([^<]+)(<\/a:t>)/g;

            // Collect all matches first
            const matches = [];
            let match;
            const tempXml = slideXml;
            while ((match = bulletContentPattern.exec(tempXml)) !== null) {
                matches.push({
                    fullMatch: match[0],
                    prefix: match[1],
                    category: match[2],
                    separator: match[3],
                    basis: match[4],
                    suffix: match[5],
                    index: match.index
                });
            }

            console.log(`  📊 Found ${matches.length} bullet points in template`);

            // Replace each bullet with corresponding data
            if (matches.length > 0) {
                for (let i = 0; i < Math.min(matches.length, slide8Data.basisOfCover.length); i++) {
                    const matchInfo = matches[i];
                    const newData = slide8Data.basisOfCover[i];
                    const newCategory = escapeXml(newData.category);
                    const newBasis = escapeXml(newData.basis);

                    // Create replacement string
                    const oldText = matchInfo.fullMatch;
                    const newText = `${matchInfo.prefix}${newCategory}${matchInfo.separator}${newBasis}${matchInfo.suffix}`;

                    slideXml = slideXml.replace(oldText, newText);
                    console.log(`    ✅ Bullet ${i + 1}: "${newData.category.substring(0, 30)}..."`);
                    basisUpdated = true;
                }
                results.updated.push({ field: 'Basis of Cover', value: `${slide8Data.basisOfCover.length} categories` });
            }

            // Fallback: Try direct text replacement if pattern didn't match
            if (!basisUpdated) {
                console.log(`  🔄 Trying direct text replacement fallback...`);

                // Common template text patterns to replace
                const replacements = [
                    { oldCat: 'All employees', oldBasis: '24 x last drawn basic monthly salary , with minimum $40,000' },
                    { oldCat: 'Grandfathered GWS Plan 1 staff', oldBasis: '36 x last drawn basic monthly salary , with minimum $40,000' },
                    { oldCat: 'Sales Associates, Advisor', oldBasis: '$100,000' }
                ];

                for (let i = 0; i < Math.min(replacements.length, slide8Data.basisOfCover.length); i++) {
                    const repl = replacements[i];
                    const newData = slide8Data.basisOfCover[i];
                    const newCat = escapeXml(newData.category);
                    const newBasis = escapeXml(newData.basis);

                    // Replace category
                    const catPattern = new RegExp(`>${repl.oldCat.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}</a:t>`, 'g');
                    if (slideXml.match(catPattern)) {
                        slideXml = slideXml.replace(catPattern, `>${newCat}</a:t>`);
                        basisUpdated = true;
                    }

                    // Replace basis (escape $ for regex)
                    const basisPattern = new RegExp(`>: ${repl.oldBasis.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}</a:t>`, 'g');
                    if (slideXml.match(basisPattern)) {
                        slideXml = slideXml.replace(basisPattern, `>: ${newBasis}</a:t>`);
                    }
                }

                if (basisUpdated) {
                    console.log(`  ✅ Updated Basis of Cover via direct replacement`);
                    results.updated.push({ field: 'Basis of Cover', value: `${slide8Data.basisOfCover.length} categories (direct)` });
                } else {
                    console.log(`  ⚠️ Could not find Basis of Cover patterns to replace`);
                    results.errors.push({ field: 'Basis of Cover', error: 'Pattern not found in template' });
                }
            }
        }

        // 4. Update Non-evidence Limit value using cell-based mapping
        if (slide8Data.nonEvidenceLimit) {
            const nonEvidenceValue = escapeXml(slide8Data.nonEvidenceLimit);

            // Find row with "Non-evidence Limit" label and replace value in adjacent cell
            const nonEvidenceResult = replaceTableCellByLabel(slideXml, 'Non-evidence Limit', nonEvidenceValue);

            if (nonEvidenceResult.success) {
                slideXml = nonEvidenceResult.xml;
                console.log(`  ✅ Updated Non-evidence Limit`);
                results.updated.push({ field: 'Non-evidence Limit', value: slide8Data.nonEvidenceLimit.substring(0, 50) + '...' });
            } else {
                console.log(`  ⚠️ Non-evidence Limit row not found in table`);
                results.errors.push({ field: 'Non-evidence Limit', error: 'Row not found in table' });
            }
        }

        // Save updated XML
        setSlideXML(zip, slideNumber, slideXml);
        console.log(`📝 Slide ${slideNumber} GTL update complete: ${results.updated.length} fields updated, ${results.errors.length} errors`);

    } catch (error) {
        console.error(`❌ Error updating Slide ${slideNumber} GTL:`, error.message);
        results.errors.push({ field: `Slide ${slideNumber} GTL`, error: error.message });
    }

    return results;
}

/**
 * Update Slide 9 GDD table with data from placement slip
 * Structure is identical to Slide 8: EligibilityLast Entry Age, Basis of Cover, Non-evidence Limit
 * @param {Object} zip - PizZip instance
 * @param {Object} slide9Data - Data for slide 9 (eligibility, lastEntryAge, basisOfCover, nonEvidenceLimit)
 * @returns {Object} Results of the update operation
 */
function updateSlide9GDDTable(zip, slide9Data, slideNumber = 9) {
    console.log(`📝 Updating Slide ${slideNumber} GDD Table...`);

    const results = {
        updated: [],
        errors: []
    };

    if (!slide9Data) {
        console.log('⚠️ No slide 9 data provided');
        return results;
    }

    // Debug: Log all incoming data
    console.log('📋 Slide 9 Data received:');
    console.log(`   - eligibility: "${slide9Data.eligibility?.substring(0, 60) || 'null'}..."`);
    console.log(`   - lastEntryAge: "${slide9Data.lastEntryAge || 'null'}"`);
    console.log(`   - basisOfCover: ${slide9Data.basisOfCover?.length || 0} items`);
    console.log(`   - nonEvidenceLimit: "${slide9Data.nonEvidenceLimit?.substring(0, 60) || 'null'}..."`);

    try {
        let slideXml = getSlideXML(zip, slideNumber);

        // 1. Update Eligibility & Last Entry Age - Replace as separate text elements to avoid duplication
        if (slide9Data.eligibility || slide9Data.lastEntryAge) {
            const eligResult = replaceEligibilityAndLastEntryAgeSeparately(
                slideXml,
                slide9Data.eligibility,
                slide9Data.lastEntryAge
            );

            if (eligResult.success) {
                slideXml = eligResult.xml;
                console.log(`  ✅ Updated Eligibility & Last Entry Age`);
                if (slide9Data.eligibility) {
                    results.updated.push({ field: 'Eligibility', value: slide9Data.eligibility.substring(0, 50) + '...' });
                }
                if (slide9Data.lastEntryAge) {
                    results.updated.push({ field: 'Last Entry Age', value: slide9Data.lastEntryAge });
                }
            } else {
                console.log(`  ⚠️ Could not update Eligibility/Last Entry Age`);
                if (slide9Data.eligibility) {
                    results.errors.push({ field: 'Eligibility', error: 'Cell not found' });
                }
            }
        }

        // 2. Update Basis of Cover - Use cell replacement approach
        if (slide9Data.basisOfCover && slide9Data.basisOfCover.length > 0) {
            console.log(`  🔄 Updating Basis of Cover with ${slide9Data.basisOfCover.length} entries...`);

            const basisResult = replaceBasisOfCoverCell(slideXml, slide9Data.basisOfCover);

            if (basisResult.success) {
                slideXml = basisResult.xml;
                results.updated.push({ field: 'Basis of Cover', value: `${slide9Data.basisOfCover.length} categories` });
            } else {
                console.log(`  ⚠️ Could not update Basis of Cover in Slide 9`);
                results.errors.push({ field: 'Basis of Cover', error: 'Cell not found in table' });
            }
        }

        // 3. Update Non-evidence Limit
        if (slide9Data.nonEvidenceLimit) {
            const nonEvidenceValue = escapeXml(slide9Data.nonEvidenceLimit);

            const nonEvidenceResult = replaceTableCellByLabel(slideXml, 'Non-evidence Limit', nonEvidenceValue);

            if (nonEvidenceResult.success) {
                slideXml = nonEvidenceResult.xml;
                console.log(`  ✅ Updated Non-evidence Limit`);
                results.updated.push({ field: 'Non-evidence Limit', value: slide9Data.nonEvidenceLimit.substring(0, 50) + '...' });
            } else {
                console.log(`  ⚠️ Non-evidence Limit row not found in Slide 9`);
                results.errors.push({ field: 'Non-evidence Limit', error: 'Row not found in table' });
            }
        }

        setSlideXML(zip, slideNumber, slideXml);
        console.log(`📝 Slide ${slideNumber} GDD update complete: ${results.updated.length} fields updated, ${results.errors.length} errors`);

    } catch (error) {
        console.error(`❌ Error updating Slide ${slideNumber} GDD:`, error.message);
        results.errors.push({ field: `Slide ${slideNumber} GDD`, error: error.message });
    }

    return results;
}

/**
 * Replace eligibility and last entry age as separate text elements in the cell
 * The template cell has 3 text elements: ": " + eligibility + ": age XX next birthday"
 * This function replaces them separately to avoid duplication
 * @param {string} xml - Slide XML content
 * @param {string} eligibility - Eligibility text
 * @param {string} lastEntryAge - Last entry age text
 * @returns {Object} { xml: updatedXml, success: boolean }
 */
function replaceEligibilityAndLastEntryAgeSeparately(xml, eligibility, lastEntryAge) {
    console.log(`    🔎 Replacing eligibility and last entry age separately...`);

    const rowPattern = /<a:tr\b[^>]*>([\s\S]*?)<\/a:tr>/g;
    let match;
    let updatedXml = xml;
    let success = false;

    while ((match = rowPattern.exec(xml)) !== null) {
        const rowContent = match[1];
        const fullRow = match[0];

        // Check if this row contains "EligibilityLast Entry Age" label
        // Row must contain Eligibility AND Last Entry Age references
        const hasEligibility = rowContent.includes('EligibilityLast Entry Age') ||
                              rowContent.includes('>Eligibility<') ||
                              rowContent.toLowerCase().includes('eligibility');
        const hasLastEntryAge = rowContent.includes('>Last Entry Age<') ||
                               rowContent.toLowerCase().includes('entry age');

        if (!hasEligibility || !hasLastEntryAge) {
            continue;
        }

        // Found the row - now find and update the value cell
        const cellPattern = /<a:tc\b[^>]*>([\s\S]*?)<\/a:tc>/g;
        const cells = [];
        let cellMatch;

        while ((cellMatch = cellPattern.exec(rowContent)) !== null) {
            cells.push({
                full: cellMatch[0],
                content: cellMatch[1]
            });
        }

        if (cells.length < 2) continue;

        // Value cell is the second cell
        const valueCell = cells[1];
        let updatedCellContent = valueCell.content;

        // Find all text elements in the value cell
        const textElementPattern = /<a:t>([^<]*)<\/a:t>/g;
        const textElements = [];
        let textMatch;

        while ((textMatch = textElementPattern.exec(valueCell.content)) !== null) {
            textElements.push({
                full: textMatch[0],
                text: textMatch[1],
                index: textMatch.index
            });
        }

        console.log(`    📝 Found ${textElements.length} text elements in value cell`);
        textElements.forEach((elem, i) => {
            console.log(`       Element ${i + 1}: "${elem.text.substring(0, 40)}${elem.text.length > 40 ? '...' : ''}"`);
        });

        // Replace elements:
        // Element 1: ": " (keep as is - colon prefix)
        // Element 2: eligibility text (replace with new eligibility)
        // Element 3: ": age XX next birthday" (replace with new age - starts with ": age")

        // First, find and replace the Last Entry Age element (starts with ": age")
        if (lastEntryAge) {
            for (const elem of textElements) {
                // Last Entry Age element starts with ": age" (colon + space + age)
                if (elem.text.trim().startsWith(': age') || elem.text.trim().startsWith(':age')) {
                    const newAgeText = `<a:t>: age ${escapeXml(lastEntryAge)}</a:t>`;
                    updatedCellContent = updatedCellContent.replace(elem.full, newAgeText);
                    console.log(`    ✅ Replaced last entry age element: "${elem.text.substring(0, 30)}..." → ": age ${lastEntryAge}"`);
                    success = true;
                    break;
                }
            }
        }

        // Then, find and replace the eligibility element (the main text, not starting with ":")
        // Use position-based detection instead of length assumption
        if (eligibility) {
            let eligibilityElement = null;
            for (let i = 0; i < textElements.length; i++) {
                const elem = textElements[i];
                const trimmed = elem.text.trim();

                // Skip if it's just punctuation (colon prefix)
                if (trimmed === ':' || trimmed === ': ' || trimmed === '') {
                    continue;
                }
                // Skip if it starts with ": age" (that's the Last Entry Age)
                if (trimmed.startsWith(': age') || trimmed.startsWith(':age')) {
                    continue;
                }
                // First meaningful content element is eligibility (position-based, not length-based)
                eligibilityElement = elem;
                break;
            }

            if (eligibilityElement) {
                const newEligibilityText = `<a:t>${escapeXml(eligibility)}</a:t>`;
                updatedCellContent = updatedCellContent.replace(eligibilityElement.full, newEligibilityText);
                console.log(`    ✅ Replaced eligibility element: "${eligibilityElement.text.substring(0, 40)}${eligibilityElement.text.length > 40 ? '...' : ''}" → "${eligibility.substring(0, 40)}${eligibility.length > 40 ? '...' : ''}"`);
                success = true;
            }
        }

        if (success) {
            // Update the cell in the row
            const updatedValueCell = valueCell.full.replace(valueCell.content, updatedCellContent);
            const updatedRowContent = rowContent.replace(valueCell.full, updatedValueCell);
            const updatedFullRow = fullRow.replace(rowContent, updatedRowContent);
            updatedXml = updatedXml.replace(fullRow, updatedFullRow);
            break;
        }
    }

    return { xml: updatedXml, success };
}

/**
 * Update Category/Plan table (Table 2) in Slide 12 with plan codes from Excel
 * @param {string} xml - Slide XML content
 * @param {Array} categoryPlans - Array of {category, plan} objects from Excel
 * @returns {Object} { xml: updatedXml, success: boolean, updatedCount: number }
 */
function updateCategoryPlanTable(xml, categoryPlans) {
    if (!categoryPlans || categoryPlans.length === 0) {
        return { xml, success: false, updatedCount: 0 };
    }

    console.log(`    🔄 Updating Category/Plan table with ${categoryPlans.length} entries...`);

    let updatedXml = xml;
    let updatedCount = 0;

    // Find all tables - we need Table 2 (Category/Plan table)
    const tablePattern = /<a:tbl\b[^>]*>([\s\S]*?)<\/a:tbl>/g;
    let tableMatch;
    let tableNum = 0;

    while ((tableMatch = tablePattern.exec(xml)) !== null) {
        tableNum++;

        // Table 2 is the Category/Plan table
        if (tableNum !== 2) continue;

        const tableContent = tableMatch[1];
        const fullTable = tableMatch[0];
        let updatedTableContent = tableContent;

        // Find all rows in this table
        const rowPattern = /<a:tr\b[^>]*>([\s\S]*?)<\/a:tr>/g;
        let rowMatch;
        let rowNum = 0;

        while ((rowMatch = rowPattern.exec(tableContent)) !== null) {
            rowNum++;
            if (rowNum === 1) continue; // Skip header row

            const rowContent = rowMatch[1];
            const fullRow = rowMatch[0];

            // Extract cells
            const cellPattern = /<a:tc\b[^>]*>([\s\S]*?)<\/a:tc>/g;
            const cells = [];
            let cellMatch;

            while ((cellMatch = cellPattern.exec(rowContent)) !== null) {
                const textPattern = /<a:t>([^<]*)<\/a:t>/g;
                let cellText = '';
                let textMatch;
                while ((textMatch = textPattern.exec(cellMatch[1])) !== null) {
                    cellText += textMatch[1];
                }
                cells.push({
                    full: cellMatch[0],
                    content: cellMatch[1],
                    text: cellText.trim()
                });
            }

            if (cells.length < 2) continue;

            const categoryCell = cells[0];
            const planCell = cells[1];

            // Find matching category in Excel data
            const categoryTextLower = categoryCell.text.toLowerCase().replace(/&amp;/g, '&');

            console.log(`    📋 Row ${rowNum}: Template category="${categoryTextLower.substring(0, 40)}..."`);

            for (const excelData of categoryPlans) {
                // Use fuzzy matching for better accuracy with category variations
                const matchResult = calculateCategoryMatchScore(categoryCell.text, excelData.category);

                if (matchResult.isMatch) {
                    console.log(`       Match method: ${matchResult.method}, similarity: ${Math.round(matchResult.similarity * 100)}%`);
                    // Found a match - update the plan cell
                    const oldPlanText = planCell.text;
                    const newPlan = excelData.plan;

                    console.log(`       ✓ Matched with Excel: "${excelData.category.substring(0, 40)}${excelData.category.length > 40 ? '...' : ''}"`);
                    console.log(`       Plan: "${oldPlanText}" → "${newPlan}"`);

                    // Always update (even if same) to ensure correct value
                    const planTextPattern = /<a:t>([^<]*)<\/a:t>/;
                    const planTextMatch = planCell.content.match(planTextPattern);

                    if (planTextMatch) {
                        const newPlanCellContent = planCell.content.replace(
                            planTextMatch[0],
                            `<a:t>${escapeXml(newPlan)}</a:t>`
                        );
                        const newPlanCell = planCell.full.replace(planCell.content, newPlanCellContent);
                        const newRowContent = rowContent.replace(planCell.full, newPlanCell);
                        const newFullRow = fullRow.replace(rowContent, newRowContent);
                        updatedTableContent = updatedTableContent.replace(fullRow, newFullRow);

                        console.log(`    ✅ Updated Plan: "${categoryCell.text.substring(0, 30)}..." → ${newPlan}`);
                        updatedCount++;
                    }
                    break;
                }
            }
        }

        // Update the table in the XML
        const updatedFullTable = fullTable.replace(tableContent, updatedTableContent);
        updatedXml = updatedXml.replace(fullTable, updatedFullTable);
        break;
    }

    return { xml: updatedXml, success: updatedCount > 0, updatedCount };
}

/**
 * Update Slide 12 GHS table with data from placement slip
 * Note: GHS is on Slide 12, not Slide 10 (Slide 10 is GPA)
 * Slide 12 has TWO tables: Table 1 (Eligibility) and Table 2 (Category/Plan)
 * @param {Object} zip - PizZip instance
 * @param {Object} slide12Data - Data for slide 12 (eligibility, lastEntryAge, categoryPlans)
 * @returns {Object} Results of the update operation
 */
function updateSlide12GHSTable(zip, slide12Data, slideNumber = 12) {
    console.log('📝 Updating Slide 12 GHS Table...');

    const results = {
        updated: [],
        errors: []
    };

    if (!slide12Data) {
        console.log('⚠️ No slide 12 data provided');
        return results;
    }

    // Debug: Log all incoming data
    console.log('📋 Slide 12 Data received:');
    console.log(`   - eligibility: "${slide12Data.eligibility?.substring(0, 60) || 'null'}..."`);
    console.log(`   - lastEntryAge: "${slide12Data.lastEntryAge || 'null'}"`);
    console.log(`   - categoryPlans: ${slide12Data.categoryPlans?.length || 0} items`);

    try {
        let slideXml = getSlideXML(zip, slideNumber);

        // 1. Update Eligibility & Last Entry Age - Replace separately to avoid duplication
        if (slide12Data.eligibility || slide12Data.lastEntryAge) {
            const eligResult = replaceEligibilityAndLastEntryAgeSeparately(
                slideXml,
                slide12Data.eligibility,
                slide12Data.lastEntryAge
            );

            if (eligResult.success) {
                slideXml = eligResult.xml;
                console.log(`  ✅ Updated Eligibility & Last Entry Age`);
                if (slide12Data.eligibility) {
                    results.updated.push({ field: 'Eligibility', value: slide12Data.eligibility.substring(0, 50) + '...' });
                }
                if (slide12Data.lastEntryAge) {
                    results.updated.push({ field: 'Last Entry Age', value: slide12Data.lastEntryAge });
                }
            } else {
                console.log(`  ⚠️ Could not update Eligibility/Last Entry Age`);
                if (slide12Data.eligibility) {
                    results.errors.push({ field: 'Eligibility', error: 'Cell not found' });
                }
            }
        }

        // 2. Update Category/Plan table (Table 2)
        if (slide12Data.categoryPlans && slide12Data.categoryPlans.length > 0) {
            console.log(`  🔄 Updating Category/Plan table with ${slide12Data.categoryPlans.length} entries...`);

            const planResult = updateCategoryPlanTable(slideXml, slide12Data.categoryPlans);

            if (planResult.success) {
                slideXml = planResult.xml;
                results.updated.push({ field: 'Category/Plan', value: `${planResult.updatedCount} plans updated` });
            } else {
                console.log(`  ⚠️ Could not update Category/Plan table`);
            }
        }

        setSlideXML(zip, slideNumber, slideXml);
        console.log(`📝 Slide 12 update complete: ${results.updated.length} fields updated, ${results.errors.length} errors`);

    } catch (error) {
        console.error('❌ Error updating Slide 12:', error.message);
        results.errors.push({ field: 'Slide 12', error: error.message });
    }

    return results;
}

/**
 * Update Slide 10 GPA table with data from placement slip
 * Note: GPA is on Slide 10, structure is similar to GTL/GDD/GHS but NO Non-evidence Limit
 * Slide 11 is static informational content (no data mapping needed)
 * @param {Object} zip - PizZip instance
 * @param {Object} slide10Data - Data for slide 10 (eligibility, lastEntryAge, basisOfCover)
 * @returns {Object} Results of the update operation
 */
function updateSlide10GPATable(zip, slide10Data, slideNumber = 10) {
    console.log('📝 Updating Slide 10 GPA Table...');

    const results = {
        updated: [],
        errors: []
    };

    if (!slide10Data) {
        console.log('⚠️ No slide 10 data provided');
        return results;
    }

    // Debug: Log all incoming data
    console.log('📋 Slide 10 Data received:');
    console.log(`   - eligibility: "${slide10Data.eligibility?.substring(0, 60) || 'null'}..."`);
    console.log(`   - lastEntryAge: "${slide10Data.lastEntryAge || 'null'}"`);
    console.log(`   - basisOfCover: ${slide10Data.basisOfCover?.length || 0} items`);

    try {
        let slideXml = getSlideXML(zip, slideNumber);

        // 1. Update Eligibility & Last Entry Age - Replace as separate text elements to avoid duplication
        if (slide10Data.eligibility || slide10Data.lastEntryAge) {
            const eligResult = replaceEligibilityAndLastEntryAgeSeparately(
                slideXml,
                slide10Data.eligibility,
                slide10Data.lastEntryAge
            );

            if (eligResult.success) {
                slideXml = eligResult.xml;
                console.log(`  ✅ Updated Eligibility & Last Entry Age`);
                if (slide10Data.eligibility) {
                    results.updated.push({ field: 'Eligibility', value: slide10Data.eligibility.substring(0, 50) + '...' });
                }
                if (slide10Data.lastEntryAge) {
                    results.updated.push({ field: 'Last Entry Age', value: slide10Data.lastEntryAge });
                }
            } else {
                console.log(`  ⚠️ Could not update Eligibility/Last Entry Age`);
                if (slide10Data.eligibility) {
                    results.errors.push({ field: 'Eligibility', error: 'Cell not found' });
                }
            }
        }

        // 2. Update Basis of Cover - Use cell replacement approach
        if (slide10Data.basisOfCover && slide10Data.basisOfCover.length > 0) {
            console.log(`  🔄 Updating Basis of Cover with ${slide10Data.basisOfCover.length} entries...`);

            const basisResult = replaceBasisOfCoverCell(slideXml, slide10Data.basisOfCover);

            if (basisResult.success) {
                slideXml = basisResult.xml;
                results.updated.push({ field: 'Basis of Cover', value: `${slide10Data.basisOfCover.length} categories` });
            } else {
                console.log(`  ⚠️ Could not update Basis of Cover in Slide 10`);
                results.errors.push({ field: 'Basis of Cover', error: 'Cell not found in table' });
            }
        }

        // Note: GPA does NOT have Non-evidence Limit (unlike GTL, GDD, GHS)

        setSlideXML(zip, slideNumber, slideXml);
        console.log(`📝 Slide 10 update complete: ${results.updated.length} fields updated, ${results.errors.length} errors`);

    } catch (error) {
        console.error('❌ Error updating Slide 10:', error.message);
        results.errors.push({ field: 'Slide 10', error: error.message });
    }

    return results;
}

/**
 * Find text in slide XML and return its location
 * @param {string} xml - Slide XML content
 * @param {string} searchText - Text to find
 * @returns {Object[]} Array of found locations with context
 */
function findTextInSlide(xml, searchText) {
    const results = [];
    let index = 0;

    while (true) {
        const pos = xml.indexOf(searchText, index);
        if (pos === -1) break;

        // Get surrounding context
        const start = Math.max(0, pos - 50);
        const end = Math.min(xml.length, pos + searchText.length + 50);
        const context = xml.substring(start, end);

        results.push({
            position: pos,
            context: context,
            searchText: searchText
        });

        index = pos + 1;
    }

    return results;
}

/**
 * Extract all text content from slide XML for debugging
 * @param {string} xml - Slide XML content
 * @returns {string[]} Array of text content found in <a:t> elements
 */
function extractTextContent(xml) {
    const textPattern = /<a:t>([^<]*)<\/a:t>/g;
    const texts = [];
    let match;

    while ((match = textPattern.exec(xml)) !== null) {
        if (match[1].trim()) {
            texts.push(match[1]);
        }
    }

    return texts;
}

/**
 * Write PPTX buffer from PizZip instance
 * @param {Object} zip - PizZip instance with updated content
 * @returns {Buffer} PPTX file buffer
 */
function writePPTX(zip) {
    try {
        return zip.generate({
            type: 'nodebuffer',
            compression: 'DEFLATE',
            compressionOptions: { level: 6 }
        });
    } catch (error) {
        console.error('❌ Error writing PPTX file:', error.message);
        throw new Error(`Failed to write PPTX file: ${error.message}`);
    }
}

/**
 * Get information about the PPTX structure
 * @param {Object} zip - PizZip instance
 * @returns {Object} PPTX metadata
 */
function getPPTXInfo(zip) {
    const slides = getSlideFiles(zip);
    const files = Object.keys(zip.files);

    return {
        totalSlides: slides.length,
        slides: slides,
        hasCustomProperties: files.includes('docProps/custom.xml'),
        hasCoreProperties: files.includes('docProps/core.xml'),
        totalFiles: files.length
    };
}

/**
 * Main function to process and update PPTX
 * @param {Buffer} pptxBuffer - Original PPTX file buffer
 * @param {Object} placementData - Data extracted from placement slip
 * @returns {Object} Object with updated buffer and processing results
 */
function processPPTX(pptxBuffer, placementData) {
    console.log('📊 Processing PowerPoint presentation...');

    const zip = readPPTX(pptxBuffer);
    const info = getPPTXInfo(zip);

    console.log(`📋 PPTX has ${info.totalSlides} slides`);

    // Detect slide positions by content
    console.log('🔍 Detecting slide positions by content...');
    const detection = slideDetector.detectSlidePositions(zip);
    const slideMap = detection.slideMap;

    // Validate detection results before proceeding
    const dataKeyToSlideType = {
        'periodOfInsurance': 'PERIOD_OF_INSURANCE',
        'slide8Data': 'GTL_OVERVIEW',
        'slide9Data': 'GDD_OVERVIEW',
        'slide10Data': 'GPA_OVERVIEW',
        'slide12Data': 'GHS_OVERVIEW',
        'slide15Data': 'GHS_SOB_1',
        'slide16Data': 'GHS_SOB_2',
        'slide17Data': 'GHS_NOTES',
        'slide18Data': 'GHS_ROOM_BOARD',
        'slide19Data': 'GMM_OVERVIEW',
        'slide20Data': 'GMM_SOB',
        'slide24Data': 'GP_OVERVIEW',
        'slide25Data': 'GP_SOB',
        'slide26Data': 'SP_OVERVIEW',
        'slide27Data': 'SP_SOB',
        'slide30Data': 'DENTAL_OVERVIEW',
        'slide31Data': 'DENTAL_SOB_1',
        'slide32Data': 'DENTAL_SOB_2'
    };

    const requiredSlideTypes = Object.keys(placementData)
        .filter(key => placementData[key] && dataKeyToSlideType[key])
        .map(key => dataKeyToSlideType[key]);

    const validation = slideDetector.validateDetection(detection.detectionResults, requiredSlideTypes);

    if (!validation.valid) {
        console.error(`⚠️ DETECTION VALIDATION FAILED: ${validation.message}`);
    }

    if (validation.lowConfidence.length > 0) {
        console.warn(`⚠️ Low confidence detection for: ${validation.lowConfidence.map(l => l.slideType).join(', ')}`);
    }

    const results = {
        success: true,
        totalSlides: info.totalSlides,
        updatedSlides: [],
        errors: [],
        slideDetection: {
            results: detection.detectionResults,
            warnings: detection.warnings,
            validation: validation
        }
    };

    // Add validation errors to results if detection failed
    if (!validation.valid || validation.lowConfidence.length > 0) {
        results.errors.push({
            field: 'SlideDetection',
            error: validation.message,
            missingSlides: validation.missing,
            lowConfidenceSlides: validation.lowConfidence
        });
    }

    // Phase 1: Update Period of Insurance
    if (placementData.periodOfInsurance) {
        const slideNum = slideMap.PERIOD_OF_INSURANCE || 1;
        const slide1Updated = updateSlide1PeriodOfInsurance(zip, placementData.periodOfInsurance, slideNum);
        if (slide1Updated) {
            results.updatedSlides.push({
                slide: slideNum,
                field: 'Period of Insurance',
                value: placementData.periodOfInsurance.formatted
            });
        } else {
            results.errors.push({
                slide: slideNum,
                field: 'Period of Insurance',
                error: 'Pattern not found in slide'
            });
        }
    }

    // Phase 2: Update GTL Table (Eligibility, Last Entry Age, Basis of Cover, Non-evidence Limit)
    if (placementData.slide8Data) {
        const slideNum = slideMap.GTL_OVERVIEW || 8;
        console.log(`📊 Processing Slide ${slideNum} GTL data...`);
        const slide8Results = updateSlide8GTLTable(zip, placementData.slide8Data, slideNum);

        for (const update of slide8Results.updated) {
            results.updatedSlides.push({
                slide: slideNum,
                field: update.field,
                value: update.value
            });
        }

        for (const error of slide8Results.errors) {
            results.errors.push({
                slide: slideNum,
                field: error.field,
                error: error.error,
                hint: error.hint || null
            });
        }
    }

    // Phase 3: Update GDD Table (Group Dread Disease)
    if (placementData.slide9Data) {
        const slideNum = slideMap.GDD_OVERVIEW || 9;
        console.log(`📊 Processing Slide ${slideNum} GDD data...`);
        const slide9Results = updateSlide9GDDTable(zip, placementData.slide9Data, slideNum);

        for (const update of slide9Results.updated) {
            results.updatedSlides.push({
                slide: slideNum,
                field: update.field,
                value: update.value
            });
        }

        for (const error of slide9Results.errors) {
            results.errors.push({
                slide: slideNum,
                field: error.field,
                error: error.error,
                hint: error.hint || null
            });
        }
    }

    // Phase 4: Update GPA Table (Group Personal Accident)
    if (placementData.slide10Data) {
        const slideNum = slideMap.GPA_OVERVIEW || 10;
        console.log(`📊 Processing Slide ${slideNum} GPA data...`);
        const slide10Results = updateSlide10GPATable(zip, placementData.slide10Data, slideNum);

        for (const update of slide10Results.updated) {
            results.updatedSlides.push({
                slide: slideNum,
                field: update.field,
                value: update.value
            });
        }

        for (const error of slide10Results.errors) {
            results.errors.push({
                slide: slideNum,
                field: error.field,
                error: error.error,
                hint: error.hint || null
            });
        }
    }

    // Phase 5: Update GHS Table (Group Hospital & Surgical)
    if (placementData.slide12Data) {
        const slideNum = slideMap.GHS_OVERVIEW || 12;
        console.log(`📊 Processing Slide ${slideNum} GHS data...`);
        const slide12Results = updateSlide12GHSTable(zip, placementData.slide12Data, slideNum);

        for (const update of slide12Results.updated) {
            results.updatedSlides.push({
                slide: slideNum,
                field: update.field,
                value: update.value
            });
        }

        for (const error of slide12Results.errors) {
            results.errors.push({
                slide: slideNum,
                field: error.field,
                error: error.error,
                hint: error.hint || null
            });
        }
    }

    // Phase 6: Update GHS Schedule of Benefits (Items 1-6)
    if (placementData.slide15Data) {
        const slideNum = slideMap.GHS_SOB_1 || 15;
        console.log(`📊 Processing Slide ${slideNum} GHS Schedule of Benefits...`);
        const slide15Results = updateSlide15ScheduleOfBenefits(zip, placementData.slide15Data, slideNum);

        for (const update of slide15Results.updated) {
            results.updatedSlides.push({
                slide: slideNum,
                field: update.field,
                value: update.value
            });
        }

        for (const error of slide15Results.errors) {
            results.errors.push({
                slide: slideNum,
                field: error.field,
                error: error.error,
                hint: error.hint || null
            });
        }
    }

    // Phase 7: Update GHS Schedule of Benefits (Items 7-15)
    if (placementData.slide16Data) {
        const slideNum = slideMap.GHS_SOB_2 || 16;
        console.log(`📊 Processing Slide ${slideNum} GHS Schedule of Benefits...`);
        const slide16Results = updateSlide16ScheduleOfBenefits(zip, placementData.slide16Data, slideNum);

        for (const update of slide16Results.updated) {
            results.updatedSlides.push({
                slide: slideNum,
                field: update.field,
                value: update.value
            });
        }

        for (const error of slide16Results.errors) {
            results.errors.push({
                slide: slideNum,
                field: error.field,
                error: error.error,
                hint: error.hint || null
            });
        }
    }

    // Phase 8: Update GHS Qualification Period (14 days)
    if (placementData.slide17Data) {
        const slideNum = slideMap.GHS_NOTES || 17;
        console.log(`📊 Processing Slide ${slideNum} GHS Qualification Period...`);
        const slide17Results = updateSlide17QualificationPeriod(zip, placementData.slide17Data, slideNum);

        for (const update of slide17Results.updated) {
            results.updatedSlides.push({
                slide: slideNum,
                field: update.field,
                value: update.value
            });
        }

        for (const error of slide17Results.errors) {
            results.errors.push({
                slide: slideNum,
                field: error.field,
                error: error.error,
                hint: error.hint || null
            });
        }
    }

    // Phase 9: Update GHS Room & Board Entitlements
    if (placementData.slide18Data) {
        const slideNum = slideMap.GHS_ROOM_BOARD || 18;
        console.log(`📊 Processing Slide ${slideNum} GHS Room & Board...`);
        const slide18Results = updateSlide18RoomAndBoard(zip, placementData.slide18Data, slideNum);

        for (const update of slide18Results.updated) {
            results.updatedSlides.push({
                slide: slideNum,
                field: update.field,
                value: update.value
            });
        }

        for (const error of slide18Results.errors) {
            results.errors.push({
                slide: slideNum,
                field: error.field,
                error: error.error,
                hint: error.hint || null
            });
        }
    }

    // Phase 10: Update GMM Overview (Eligibility, Last Entry Age)
    if (placementData.slide19Data) {
        const slideNum = slideMap.GMM_OVERVIEW || 19;
        console.log(`📊 Processing Slide ${slideNum} GMM Overview...`);
        const slide19Results = updateSlide19GMMOverview(zip, placementData.slide19Data, slideNum);

        for (const update of slide19Results.updated) {
            results.updatedSlides.push({
                slide: slideNum,
                field: update.field,
                value: update.value
            });
        }

        for (const error of slide19Results.errors) {
            results.errors.push({
                slide: slideNum,
                field: error.field,
                error: error.error,
                hint: error.hint || null
            });
        }
    }

    // Phase 11: Update GMM Schedule of Benefits
    if (placementData.slide20Data) {
        const slideNum = slideMap.GMM_SOB || 20;
        console.log(`📊 Processing Slide ${slideNum} GMM Schedule of Benefits...`);
        const slide20Results = updateSlide20GMMScheduleOfBenefits(zip, placementData.slide20Data, slideNum);

        for (const update of slide20Results.updated) {
            results.updatedSlides.push({
                slide: slideNum,
                field: update.field,
                value: update.value
            });
        }

        for (const error of slide20Results.errors) {
            results.errors.push({
                slide: slideNum,
                field: error.field,
                error: error.error,
                hint: error.hint || null
            });
        }
    }

    // Phase 12: Update GP Overview
    if (placementData.slide24Data) {
        const slideNum = slideMap.GP_OVERVIEW || 24;
        console.log(`📊 Processing Slide ${slideNum} GP Overview...`);
        const slide24Results = updateSlide24GPOverview(zip, placementData.slide24Data, slideNum);

        for (const update of slide24Results.updated) {
            results.updatedSlides.push({
                slide: slideNum,
                field: update.field,
                value: update.value
            });
        }

        for (const error of slide24Results.errors) {
            results.errors.push({
                slide: slideNum,
                field: error.field,
                error: error.error,
                hint: error.hint || null
            });
        }
    }

    // Phase 13: Update GP Schedule of Benefits
    if (placementData.slide25Data) {
        const slideNum = slideMap.GP_SOB || 25;
        console.log(`📊 Processing Slide ${slideNum} GP Schedule of Benefits...`);
        const slide25Results = updateSlide25GPScheduleOfBenefits(zip, placementData.slide25Data, slideNum);

        for (const update of slide25Results.updated) {
            results.updatedSlides.push({
                slide: slideNum,
                field: update.field,
                value: update.value
            });
        }

        for (const error of slide25Results.errors) {
            results.errors.push({
                slide: slideNum,
                field: error.field,
                error: error.error,
                hint: error.hint || null
            });
        }
    }

    // Phase 14: Update SP Overview
    if (placementData.slide26Data) {
        const slideNum = slideMap.SP_OVERVIEW || 26;
        console.log(`📊 Processing Slide ${slideNum} SP Overview...`);
        const slide26Results = updateSlide26SPOverview(zip, placementData.slide26Data, slideNum);

        for (const update of slide26Results.updated) {
            results.updatedSlides.push({
                slide: slideNum,
                field: update.field,
                value: update.value
            });
        }

        for (const error of slide26Results.errors) {
            results.errors.push({
                slide: slideNum,
                field: error.field,
                error: error.error,
                hint: error.hint || null
            });
        }
    }

    // Phase 15: Update SP Schedule of Benefits
    if (placementData.slide27Data) {
        const slideNum = slideMap.SP_SOB || 27;
        console.log(`📊 Processing Slide ${slideNum} SP Schedule of Benefits...`);
        const slide27Results = updateSlide27SPScheduleOfBenefits(zip, placementData.slide27Data, slideNum);

        for (const update of slide27Results.updated) {
            results.updatedSlides.push({
                slide: slideNum,
                field: update.field,
                value: update.value
            });
        }

        for (const error of slide27Results.errors) {
            results.errors.push({
                slide: slideNum,
                field: error.field,
                error: error.error,
                hint: error.hint || null
            });
        }
    }

    // Phase 16: Update Dental Overview (Eligibility, Last Entry Age)
    if (placementData.slide30Data) {
        const slideNum = slideMap.DENTAL_OVERVIEW || 30;
        console.log(`📊 Processing Slide ${slideNum} Dental Overview...`);
        const slide30Results = updateSlide30DentalOverview(zip, placementData.slide30Data, slideNum);

        for (const update of slide30Results.updated) {
            results.updatedSlides.push({
                slide: slideNum,
                field: update.field,
                value: update.value
            });
        }

        for (const error of slide30Results.errors) {
            results.errors.push({
                slide: slideNum,
                field: error.field,
                error: error.error,
                hint: error.hint || null
            });
        }
    }

    // Phase 17: Update Dental SOB Part 1 (Overall Limit)
    if (placementData.slide31Data) {
        const slideNum = slideMap.DENTAL_SOB_1 || 31;
        console.log(`📊 Processing Slide ${slideNum} Dental SOB Part 1...`);
        const slide31Results = updateSlide31DentalSOB(zip, placementData.slide31Data, slideNum);

        for (const update of slide31Results.updated) {
            results.updatedSlides.push({
                slide: slideNum,
                field: update.field,
                value: update.value
            });
        }

        for (const error of slide31Results.errors) {
            results.errors.push({
                slide: slideNum,
                field: error.field,
                error: error.error,
                hint: error.hint || null
            });
        }
    }

    // Phase 18: Update Dental SOB Part 2 (Overall Limit)
    if (placementData.slide32Data) {
        const slideNum = slideMap.DENTAL_SOB_2 || 32;
        console.log(`📊 Processing Slide ${slideNum} Dental SOB Part 2...`);
        const slide32Results = updateSlide32DentalSOB(zip, placementData.slide32Data, slideNum);

        for (const update of slide32Results.updated) {
            results.updatedSlides.push({
                slide: slideNum,
                field: update.field,
                value: update.value
            });
        }

        for (const error of slide32Results.errors) {
            results.errors.push({
                slide: slideNum,
                field: error.field,
                error: error.error,
                hint: error.hint || null
            });
        }
    }

    // Generate updated PPTX buffer
    const updatedBuffer = writePPTX(zip);

    results.buffer = updatedBuffer;
    results.bufferSize = updatedBuffer.length;

    console.log(`✅ PPTX processing complete. Buffer size: ${updatedBuffer.length} bytes`);

    return results;
}

/**
 * Validate if buffer is a valid PPTX file
 * @param {Buffer} buffer - File buffer
 * @returns {boolean} True if valid PPTX file
 */
function isValidPPTXBuffer(buffer) {
    try {
        const zip = new PizZip(buffer);
        const files = Object.keys(zip.files);

        // PPTX should have specific structure
        const requiredPaths = [
            'ppt/presentation.xml',
            '[Content_Types].xml'
        ];

        return requiredPaths.every(path => files.includes(path));
    } catch (error) {
        return false;
    }
}

/**
 * Debug function to inspect slide content
 * @param {Buffer} buffer - PPTX file buffer
 * @param {number} slideNumber - Slide number to inspect
 * @returns {Object} Debug information about the slide
 */
function inspectSlide(buffer, slideNumber) {
    const zip = readPPTX(buffer);
    const xml = getSlideXML(zip, slideNumber);
    const texts = extractTextContent(xml);

    return {
        slideNumber,
        textElements: texts,
        xmlLength: xml.length,
        containsPeriodOfInsurance: xml.toLowerCase().includes('period of insurance')
    };
}

/**
 * Inspect slide 8 table structure for debugging
 * @param {Buffer} buffer - PPTX file buffer
 * @returns {Object} Table structure information
 */
function inspectSlide8Tables(buffer) {
    const zip = readPPTX(buffer);
    const xml = getSlideXML(zip, 8);

    const result = {
        tables: [],
        relevantRows: []
    };

    // Find all tables
    const tablePattern = /<a:tbl\b[^>]*>([\s\S]*?)<\/a:tbl>/g;
    let tableMatch;
    let tableNum = 0;

    while ((tableMatch = tablePattern.exec(xml)) !== null) {
        tableNum++;
        const tableContent = tableMatch[1];
        const tableInfo = {
            tableNumber: tableNum,
            rows: []
        };

        // Find all rows in this table
        const rowPattern = /<a:tr\b[^>]*>([\s\S]*?)<\/a:tr>/g;
        let rowMatch;

        while ((rowMatch = rowPattern.exec(tableContent)) !== null) {
            const rowContent = rowMatch[1];

            // Extract cells from this row
            const cellPattern = /<a:tc\b[^>]*>([\s\S]*?)<\/a:tc>/g;
            const cells = [];
            let cellMatch;

            while ((cellMatch = cellPattern.exec(rowContent)) !== null) {
                // Extract text from cell
                const textPattern = /<a:t>([^<]*)<\/a:t>/g;
                let cellText = '';
                let textMatch;
                while ((textMatch = textPattern.exec(cellMatch[1])) !== null) {
                    cellText += textMatch[1];
                }
                cells.push(cellText.trim());
            }

            if (cells.length > 0) {
                const rowInfo = {
                    label: cells[0] || '',
                    value: cells[1] || '',
                    cellCount: cells.length
                };
                tableInfo.rows.push(rowInfo);

                // Check for relevant fields
                const labelLower = rowInfo.label.toLowerCase();
                if (labelLower.includes('eligibility') ||
                    labelLower.includes('entry age') ||
                    labelLower.includes('evidence') ||
                    labelLower.includes('basis')) {
                    result.relevantRows.push({
                        table: tableNum,
                        ...rowInfo
                    });
                }
            }
        }

        result.tables.push(tableInfo);
    }

    return result;
}

/**
 * Update Slide 15 Schedule of Benefits table with data from placement slip
 * Slide 15 contains benefit items 1-6 with plan values in columns 10, 11, 12
 * @param {Object} zip - PizZip instance
 * @param {Object} slide15Data - Data for slide 15 (scheduleOfBenefits)
 * @returns {Object} Results of the update operation
 */
function updateSlide15ScheduleOfBenefits(zip, slide15Data, slideNumber = 15) {
    console.log('📝 Updating Slide 15 Schedule of Benefits...');

    const results = {
        updated: [],
        errors: []
    };

    if (!slide15Data || !slide15Data.scheduleOfBenefits) {
        console.log('⚠️ No slide 15 data provided');
        return results;
    }

    const scheduleData = slide15Data.scheduleOfBenefits;
    console.log(`📋 Schedule data: ${scheduleData.benefits?.length || 0} benefits, plans: ${scheduleData.planHeaders?.join(', ')}`);

    try {
        let slideXml = getSlideXML(zip, slideNumber);

        // Find and update table rows
        const tablePattern = /<a:tbl\b[^>]*>([\s\S]*?)<\/a:tbl>/g;
        let tableMatch = tablePattern.exec(slideXml);

        if (tableMatch) {
            let tableContent = tableMatch[1];
            let updatedTableContent = tableContent;

            // Find all rows in the table
            const rowPattern = /<a:tr\b[^>]*>([\s\S]*?)<\/a:tr>/g;
            let rowMatch;
            let rowNum = 0;
            const rows = [];

            while ((rowMatch = rowPattern.exec(tableContent)) !== null) {
                rows.push({
                    full: rowMatch[0],
                    content: rowMatch[1],
                    index: rowMatch.index
                });
            }

            console.log(`  📊 Found ${rows.length} rows in table`);

            // Track current benefit section for proper sub-item matching
            let currentBenefitNumber = null;

            // Process each row and update plan values
            for (let i = 0; i < rows.length; i++) {
                const row = rows[i];
                const cells = extractCellsFromRow(row.content);

                if (cells.length >= 13) {
                    // Get first cell text to identify the row
                    const firstCellText = cells[0].text.toLowerCase();

                    // Update "14 DAYS" row (qualification period)
                    if (firstCellText.includes('all disabilities')) {
                        const qualDays = scheduleData.qualificationPeriodDays;
                        if (qualDays) {
                            let newRow = row.full;
                            // Update cells 10, 11, 12 (which may all have the same value)
                            newRow = updateCellTextByIndex(newRow, cells, 10, qualDays);
                            updatedTableContent = updatedTableContent.replace(row.full, newRow);
                            results.updated.push({ field: 'Qualification Period', value: qualDays });
                            console.log(`    ✅ Updated "All disabilities" row: ${qualDays}`);
                        }
                    }

                    // Update benefit rows by matching row number and track current section
                    for (const benefit of scheduleData.benefits || []) {
                        if (cells[0].text.trim() === String(benefit.number)) {
                            // Track that we're now in this benefit's section
                            currentBenefitNumber = benefit.number;

                            let newRow = row.full;

                            // Update plan values in cells 10, 11, 12
                            if (benefit.plan1Value) {
                                newRow = updateCellTextByIndex(newRow, cells, 10, formatBenefitValue(benefit.plan1Value));
                            }
                            if (benefit.plan2Value) {
                                newRow = updateCellTextByIndex(newRow, cells, 11, formatBenefitValue(benefit.plan2Value));
                            }
                            if (benefit.plan3Value) {
                                newRow = updateCellTextByIndex(newRow, cells, 12, formatBenefitValue(benefit.plan3Value));
                            }

                            updatedTableContent = updatedTableContent.replace(row.full, newRow);
                            results.updated.push({ field: `Benefit ${benefit.number}`, value: benefit.name.substring(0, 30) });
                            console.log(`    ✅ Updated Benefit ${benefit.number}: ${benefit.name.substring(0, 30)}...`);
                            break;
                        }
                    }

                    // Update sub-item rows (Maximum no. of days, Hospital Misc, etc.)
                    // Only match sub-items from the current benefit section to avoid cross-contamination
                    const rowText = cells.map(c => c.text).join(' ').toLowerCase();
                    const cell0Text = cells[0].text.trim().toLowerCase();
                    const cell1Text = cells[1]?.text.trim().toLowerCase() || '';

                    // Find the current benefit's sub-items
                    const currentBenefit = currentBenefitNumber
                        ? (scheduleData.benefits || []).find(b => b.number === currentBenefitNumber)
                        : null;

                    if (currentBenefit && currentBenefit.subItems) {
                        for (const subItem of currentBenefit.subItems) {
                            const subNameLower = subItem.name.toLowerCase();
                            const subIdentifier = (subItem.identifier || '').toLowerCase().replace(/\s/g, '');
                            const cell0Normalized = cell0Text.replace(/\s/g, '');

                            // Match by identifier (a), (b), (c), (d) or by keywords
                            const identifierMatch = subIdentifier && cell0Normalized === subIdentifier;
                            const keywordMatch = (
                                (subNameLower.includes('maximum no. of days') && rowText.includes('maximum no. of days')) ||
                                (subNameLower.includes('hospital miscellaneous') && rowText.includes('hospital miscellaneous')) ||
                                (subNameLower.includes('surgical fees') && rowText.includes('surgical fees')) ||
                                (subNameLower.includes('surgical schedule') && rowText.includes('surgical schedule')) ||
                                (subNameLower.includes('qualification period') && rowText.includes('qualification period') && !rowText.includes('all disabilities')) ||
                                (subNameLower.includes('daily in hospital doctor') && rowText.includes('daily in hospital doctor')) ||
                                ((subNameLower.includes('pre-existing') || subNameLower.includes('pre- existing')) && (rowText.includes('pre-existing') || rowText.includes('pre- existing')))
                            );

                            if (identifierMatch || keywordMatch) {
                                let newRow = row.full;
                                if (subItem.plan1Value) {
                                    newRow = updateCellTextByIndex(newRow, cells, 10, formatBenefitValue(subItem.plan1Value));
                                }
                                if (subItem.plan2Value) {
                                    newRow = updateCellTextByIndex(newRow, cells, 11, formatBenefitValue(subItem.plan2Value));
                                }
                                if (subItem.plan3Value) {
                                    newRow = updateCellTextByIndex(newRow, cells, 12, formatBenefitValue(subItem.plan3Value));
                                }
                                updatedTableContent = updatedTableContent.replace(row.full, newRow);
                                console.log(`    ✅ Updated sub-item: ${subItem.name.substring(0, 40)}...`);
                                break;
                            }
                        }
                    }
                }
            }

            // Direct value replacements for rows where label and value are split
            // PPT sometimes has "(a) Hospital Misc" in one row, and "Include Implants" value in the next row
            const directReplacements = [];

            // Collect replacement pairs from sub-items
            for (const benefit of scheduleData.benefits || []) {
                for (const subItem of benefit.subItems || []) {
                    const subNameLower = subItem.name.toLowerCase();

                    // Hospital Miscellaneous: Remove standalone "Include Implants" placeholder
                    // (The actual value is already set in the plan columns via sub-item matching)
                    if (subNameLower.includes('hospital miscellaneous') && subItem.plan1Value) {
                        // Remove the standalone placeholder text, don't replace it
                        directReplacements.push({ from: 'Include Implants', to: '' });
                    }

                    // Surgical Schedule: "S$1,500" -> actual value
                    if (subNameLower.includes('surgical schedule') && subItem.plan1Value) {
                        const surgicalMatch = subItem.plan1Value.match(/S\$[\d,]+/);
                        if (surgicalMatch) {
                            directReplacements.push({ from: 'S$1,500', to: surgicalMatch[0] });
                        }
                    }

                    // Maximum no. of days replacements
                    if (subNameLower.includes('maximum no. of days') && subItem.plan1Value) {
                        const daysVal = subItem.plan1Value;
                        // Map common template values to actual values
                        if (daysVal.includes('121')) {
                            directReplacements.push({ from: '120 days', to: '121 days' });
                        }
                        if (daysVal.includes('31')) {
                            directReplacements.push({ from: '30 days', to: '31 days' });
                        }
                    }

                    // Qualification period days
                    if (subNameLower.includes('qualification period') && subItem.plan1Value) {
                        const daysVal = subItem.plan1Value;
                        if (daysVal.includes('121')) {
                            directReplacements.push({ from: '120 days', to: '121 days' });
                        }
                    }
                }
            }

            // Apply direct replacements to table content
            for (const repl of directReplacements) {
                if (updatedTableContent.includes(repl.from)) {
                    updatedTableContent = updatedTableContent.split(repl.from).join(repl.to);
                    console.log(`    ✅ Direct replacement: "${repl.from}" → "${repl.to}"`);
                }
            }

            // Replace table in XML
            const updatedTable = tableMatch[0].replace(tableContent, updatedTableContent);
            slideXml = slideXml.replace(tableMatch[0], updatedTable);
        }

        setSlideXML(zip, slideNumber, slideXml);
        console.log(`📝 Slide 15 update complete: ${results.updated.length} fields updated`);

    } catch (error) {
        console.error('❌ Error updating Slide 15:', error.message);
        results.errors.push({ field: 'Slide 15', error: error.message });
    }

    return results;
}

/**
 * Update Slide 16 Schedule of Benefits table (continuation)
 * Slide 16 contains benefit items 7-15 with plan values in columns 12, 13, 14
 * @param {Object} zip - PizZip instance
 * @param {Object} slide16Data - Data for slide 16 (scheduleOfBenefits)
 * @returns {Object} Results of the update operation
 */
function updateSlide16ScheduleOfBenefits(zip, slide16Data, slideNumber = 16) {
    console.log('📝 Updating Slide 16 Schedule of Benefits...');

    const results = {
        updated: [],
        errors: []
    };

    if (!slide16Data || !slide16Data.scheduleOfBenefits) {
        console.log('⚠️ No slide 16 data provided');
        return results;
    }

    const scheduleData = slide16Data.scheduleOfBenefits;

    try {
        let slideXml = getSlideXML(zip, slideNumber);

        // Find and update table rows
        const tablePattern = /<a:tbl\b[^>]*>([\s\S]*?)<\/a:tbl>/g;
        let tableMatch = tablePattern.exec(slideXml);

        if (tableMatch) {
            let tableContent = tableMatch[1];
            let updatedTableContent = tableContent;

            // Find all rows in the table
            const rowPattern = /<a:tr\b[^>]*>([\s\S]*?)<\/a:tr>/g;
            let rowMatch;
            const rows = [];

            while ((rowMatch = rowPattern.exec(tableContent)) !== null) {
                rows.push({
                    full: rowMatch[0],
                    content: rowMatch[1],
                    index: rowMatch.index
                });
            }

            console.log(`  📊 Found ${rows.length} rows in table`);

            // Track current benefit section for proper sub-item matching
            let currentBenefitNumber = null;

            // Process each row and update plan values
            for (let i = 0; i < rows.length; i++) {
                const row = rows[i];
                const cells = extractCellsFromRow(row.content);

                if (cells.length >= 15) {
                    // Update benefit rows by matching row number (7-15) and track current section
                    for (const benefit of scheduleData.benefits || []) {
                        if (benefit.number >= 7 && cells[0].text.trim() === String(benefit.number)) {
                            // Track that we're now in this benefit's section
                            currentBenefitNumber = benefit.number;

                            let newRow = row.full;

                            // Slide 16 uses columns 12, 13, 14 for plan values
                            if (benefit.plan1Value) {
                                newRow = updateCellTextByIndex(newRow, cells, 12, formatBenefitValue(benefit.plan1Value));
                            }
                            if (benefit.plan2Value) {
                                newRow = updateCellTextByIndex(newRow, cells, 13, formatBenefitValue(benefit.plan2Value));
                            }
                            if (benefit.plan3Value) {
                                newRow = updateCellTextByIndex(newRow, cells, 14, formatBenefitValue(benefit.plan3Value));
                            }

                            updatedTableContent = updatedTableContent.replace(row.full, newRow);
                            results.updated.push({ field: `Benefit ${benefit.number}`, value: benefit.name.substring(0, 30) });
                            console.log(`    ✅ Updated Benefit ${benefit.number}: ${benefit.name.substring(0, 30)}...`);
                            break;
                        }
                    }

                    // Update sub-item rows for current benefit section only
                    const rowText = cells.map(c => c.text).join(' ').toLowerCase();
                    const cell0Text = cells[0].text.trim().toLowerCase();

                    // Find the current benefit's sub-items (only for benefits 7-15)
                    const currentBenefit = (currentBenefitNumber && currentBenefitNumber >= 7)
                        ? (scheduleData.benefits || []).find(b => b.number === currentBenefitNumber)
                        : null;

                    if (currentBenefit && currentBenefit.subItems) {
                        for (const subItem of currentBenefit.subItems) {
                            const subNameLower = subItem.name.toLowerCase();
                            const subIdentifier = (subItem.identifier || '').toLowerCase().replace(/\s/g, '');
                            const cell0Normalized = cell0Text.replace(/\s/g, '');

                            // Match by identifier (a), (b), (c), (d) or by keywords
                            const identifierMatch = subIdentifier && cell0Normalized === subIdentifier;
                            const keywordMatch = (
                                (subNameLower.includes('maximum no. of days') && rowText.includes('maximum no. of days')) ||
                                ((subNameLower.includes('pre-existing') || subNameLower.includes('pre- existing')) && (rowText.includes('pre-existing') || rowText.includes('pre- existing')))
                            );

                            if (identifierMatch || keywordMatch) {
                                let newRow = row.full;
                                // Slide 16 uses columns 12, 13, 14 for plan values
                                if (subItem.plan1Value) {
                                    newRow = updateCellTextByIndex(newRow, cells, 12, formatBenefitValue(subItem.plan1Value));
                                }
                                if (subItem.plan2Value) {
                                    newRow = updateCellTextByIndex(newRow, cells, 13, formatBenefitValue(subItem.plan2Value));
                                }
                                if (subItem.plan3Value) {
                                    newRow = updateCellTextByIndex(newRow, cells, 14, formatBenefitValue(subItem.plan3Value));
                                }
                                updatedTableContent = updatedTableContent.replace(row.full, newRow);
                                console.log(`    ✅ Updated sub-item: ${subItem.name.substring(0, 40)}...`);
                                break;
                            }
                        }
                    }
                }
            }

            // Replace table in XML
            const updatedTable = tableMatch[0].replace(tableContent, updatedTableContent);
            slideXml = slideXml.replace(tableMatch[0], updatedTable);
        }

        setSlideXML(zip, slideNumber, slideXml);
        console.log(`📝 Slide 16 update complete: ${results.updated.length} fields updated`);

    } catch (error) {
        console.error('❌ Error updating Slide 16:', error.message);
        results.errors.push({ field: 'Slide 16', error: error.message });
    }

    return results;
}

/**
 * Update Slide 17 qualification period (days) text
 * Replaces "14 days" placeholder with actual value from Excel
 * @param {Object} zip - PizZip instance
 * @param {Object} slide17Data - Data for slide 17 (qualificationPeriodDays)
 * @returns {Object} Results of the update operation
 */
function updateSlide17QualificationPeriod(zip, slide17Data, slideNumber = 17) {
    console.log('📝 Updating Slide 17 Qualification Period...');

    const results = {
        updated: [],
        errors: []
    };

    if (!slide17Data || !slide17Data.qualificationPeriodDays) {
        console.log('⚠️ No slide 17 data provided');
        return results;
    }

    const daysValue = slide17Data.qualificationPeriodDays;
    console.log(`📋 Qualification period value: "${daysValue}"`);

    try {
        let slideXml = getSlideXML(zip, slideNumber);

        // Extract just the number from "14 DAYS" format
        const daysMatch = daysValue.match(/(\d+)/);
        const daysNumber = daysMatch ? daysMatch[1] : daysValue;

        // Pattern 1: Replace "14 days  (CELL: G43)" placeholder
        const placeholderPattern = /(\d+)\s*days?\s*\(CELL:\s*G43\)/gi;
        if (placeholderPattern.test(slideXml)) {
            slideXml = slideXml.replace(placeholderPattern, `${daysNumber} days`);
            results.updated.push({ field: 'Qualification Period', value: `${daysNumber} days` });
            console.log(`  ✅ Updated placeholder to: ${daysNumber} days`);
        }

        // Pattern 2: Replace standalone "14 days" text followed by note
        const standalonePattern = /<a:t>(\d+)\s*days?\s*<\/a:t>/gi;
        if (standalonePattern.test(slideXml)) {
            slideXml = slideXml.replace(standalonePattern, `<a:t>${daysNumber} days</a:t>`);
            if (results.updated.length === 0) {
                results.updated.push({ field: 'Qualification Period', value: `${daysNumber} days` });
            }
            console.log(`  ✅ Updated standalone text to: ${daysNumber} days`);
        }

        setSlideXML(zip, slideNumber, slideXml);
        console.log(`📝 Slide 17 update complete: ${results.updated.length} fields updated`);

    } catch (error) {
        console.error('❌ Error updating Slide 17:', error.message);
        results.errors.push({ field: 'Slide 17', error: error.message });
    }

    return results;
}

/**
 * Update Slide 18 Room & Board entitlement tables
 * Maps multiple bedded classification sections with ward classes and benefits
 * @param {Object} zip - PizZip instance
 * @param {Object} slide18Data - Data for slide 18 (roomAndBoardEntitlements)
 * @returns {Object} Results of the update operation
 */
function updateSlide18RoomAndBoard(zip, slide18Data, slideNumber = 18) {
    console.log('📝 Updating Slide 18 Room & Board...');

    const results = {
        updated: [],
        errors: []
    };

    if (!slide18Data || !slide18Data.roomAndBoardEntitlements) {
        console.log('⚠️ No slide 18 data provided');
        return results;
    }

    const entitlements = slide18Data.roomAndBoardEntitlements;
    console.log(`📋 Room & Board entitlements: ${entitlements.length} sections`);

    try {
        let slideXml = getSlideXML(zip, slideNumber);

        // Find the first entitlement section to use for mapping
        const firstEntitlement = entitlements[0];
        if (!firstEntitlement) {
            console.log('⚠️ No entitlement sections found');
            return results;
        }

        console.log(`  📊 Mapping first section: "${firstEntitlement.beddedType}" with ${firstEntitlement.wards.length} ward classes`);

        // Update the table header to reflect the bedded type
        const headerPattern = />Room\s*&amp;\s*Board\s*\d*\s*Bedded</gi;
        if (headerPattern.test(slideXml)) {
            // Escape the beddedType to handle ampersands like "1 & 2 Bedded"
            const escapedBeddedType = escapeXml(firstEntitlement.beddedType);
            const newHeader = `>Room &amp; Board ${escapedBeddedType}<`;
            slideXml = slideXml.replace(headerPattern, newHeader);
            results.updated.push({ field: 'Table Header', value: firstEntitlement.beddedType });
            console.log(`  ✅ Updated table header to: Room & Board ${firstEntitlement.beddedType}`);
        }

        // Find and update the table
        const tablePattern = /<a:tbl\b[^>]*>([\s\S]*?)<\/a:tbl>/g;
        let tableMatch = tablePattern.exec(slideXml);

        if (tableMatch) {
            let tableContent = tableMatch[1];
            let updatedTableContent = tableContent;

            // Find all rows
            const rowPattern = /<a:tr\b[^>]*>([\s\S]*?)<\/a:tr>/g;
            let rowMatch;
            const rows = [];

            while ((rowMatch = rowPattern.exec(tableContent)) !== null) {
                rows.push({
                    full: rowMatch[0],
                    content: rowMatch[1],
                    index: rowMatch.index
                });
            }

            console.log(`  📊 Found ${rows.length} rows in table`);

            // Map ward classes from Excel to PowerPoint table
            for (const row of rows) {
                const cells = extractCellsFromRow(row.content);

                if (cells.length >= 2) {
                    const wardClass = cells[0].text.trim();
                    const wardClassLower = wardClass.toLowerCase();

                    // Skip header rows - don't update rows that say "Class of Ward" or "Room & Board"
                    if (wardClassLower.includes('class of ward') ||
                        wardClassLower.includes('room') ||
                        wardClassLower.includes('board') ||
                        wardClassLower.includes('bedded')) {
                        continue;
                    }

                    // Find matching ward in Excel data
                    for (const ward of firstEntitlement.wards) {
                        // Normalize ward class names for comparison
                        const normalizedExcel = ward.classOfWard.replace(/\s+/g, ' ').trim();
                        const normalizedPpt = wardClass.replace(/\s+/g, ' ').trim();

                        // Use stricter matching - exact match or contains only for longer strings (>2 chars)
                        const exactMatch = normalizedExcel === normalizedPpt;
                        const containsMatch = normalizedPpt.length > 2 &&
                            (normalizedExcel.includes(normalizedPpt) || normalizedPpt.includes(normalizedExcel));

                        if (exactMatch || containsMatch) {
                            // Update benefit value in second cell
                            const newRow = updateCellTextByIndex(row.full, cells, 1, ward.benefit);
                            updatedTableContent = updatedTableContent.replace(row.full, newRow);
                            results.updated.push({ field: wardClass, value: ward.benefit });
                            console.log(`    ✅ Updated ward "${wardClass}": ${ward.benefit}`);
                            break;
                        }
                    }
                }
            }

            // Replace table in XML
            const updatedTable = tableMatch[0].replace(tableContent, updatedTableContent);
            slideXml = slideXml.replace(tableMatch[0], updatedTable);
        }

        // Add second section for 4 Bedded classification if available
        if (entitlements.length > 1) {
            const secondEntitlement = entitlements[1];
            console.log(`  📊 Adding second section: "${secondEntitlement.beddedType}" with ${secondEntitlement.wards.length} ward classes`);

            // Find the table again (it may have been modified)
            const tablePattern2 = /<a:tbl\b[^>]*>([\s\S]*?)<\/a:tbl>/;
            const tableMatch2 = tablePattern2.exec(slideXml);

            if (tableMatch2) {
                // Extract existing row templates from the table
                const rowPattern = /<a:tr\b[^>]*>([\s\S]*?)<\/a:tr>/g;
                const existingRows = [];
                let rowMatch;
                while ((rowMatch = rowPattern.exec(tableMatch2[1])) !== null) {
                    existingRows.push(rowMatch[0]);
                }

                if (existingRows.length >= 3) {
                    // Use existing rows as templates:
                    // Row 0: Header (merged cells) - use for new section header
                    // Row 1: Sub-header (Class of Ward | Hospital Cash Benefit)
                    // Row 2+: Ward data rows (Ward | Benefit)

                    const headerRowTemplate = existingRows[0];
                    const subHeaderRowTemplate = existingRows[1];
                    const wardRowTemplate = existingRows[2]; // Use B1 row as template

                    // Create new rows for 4 Bedded section
                    let newRows = '\n';

                    // 1. Empty separator row (optional - just add spacing in header)
                    // 2. Header row: "Room & Board 4 Bedded"
                    const escapedBeddedType2 = escapeXml(secondEntitlement.beddedType);
                    let newHeaderRow = headerRowTemplate.replace(
                        />Room\s*&amp;\s*Board[^<]*</gi,
                        `>Room &amp; Board ${escapedBeddedType2}<`
                    );
                    newRows += newHeaderRow;

                    // 3. Sub-header row: "Class of Ward" | "Hospital Cash Benefit..."
                    newRows += subHeaderRowTemplate;

                    // 4. Ward rows for second section
                    for (const ward of secondEntitlement.wards) {
                        // Clone and modify ward row template
                        let newWardRow = wardRowTemplate;

                        // Escape values for XML and regex replacement ($ has special meaning)
                        const safeWardClass = escapeXml(ward.classOfWard).replace(/\$/g, '$$$$');
                        const safeBenefit = escapeXml(ward.benefit).replace(/\$/g, '$$$$');

                        // Replace ward class name (first cell text)
                        const wardClassPattern = /(<a:tc\b[^>]*>[\s\S]*?<a:t>)[^<]*(<\/a:t>)/;
                        newWardRow = newWardRow.replace(wardClassPattern, `$1${safeWardClass}$2`);

                        // Replace benefit value (second cell text)
                        // Find second <a:tc> and update its text
                        const cells = newWardRow.match(/<a:tc\b[^>]*>[\s\S]*?<\/a:tc>/g);
                        if (cells && cells.length >= 2) {
                            const oldSecondCell = cells[1];
                            const newSecondCell = oldSecondCell.replace(
                                /(<a:t>)[^<]*(<\/a:t>)/,
                                `$1${safeBenefit}$2`
                            );
                            newWardRow = newWardRow.replace(oldSecondCell, newSecondCell);
                        }

                        newRows += newWardRow;
                        console.log(`    ✅ Added ward "${ward.classOfWard}": ${ward.benefit}`);
                        results.updated.push({ field: `4 Bedded ${ward.classOfWard}`, value: ward.benefit });
                    }

                    // Insert new rows before closing </a:tbl>
                    const updatedTableXml = tableMatch2[0].replace('</a:tbl>', newRows + '</a:tbl>');
                    slideXml = slideXml.replace(tableMatch2[0], updatedTableXml);
                    console.log(`  ✅ Added ${secondEntitlement.beddedType} section with ${secondEntitlement.wards.length} wards`);
                }
            }
        }

        setSlideXML(zip, slideNumber, slideXml);
        console.log(`📝 Slide 18 update complete: ${results.updated.length} fields updated`);

    } catch (error) {
        console.error('❌ Error updating Slide 18:', error.message);
        results.errors.push({ field: 'Slide 18', error: error.message });
    }

    return results;
}

/**
 * Helper function to extract cells from a table row
 * @param {string} rowContent - Row XML content
 * @returns {Array} Array of cell objects with text and content
 */
function extractCellsFromRow(rowContent) {
    const cellPattern = /<a:tc\b[^>]*>([\s\S]*?)<\/a:tc>/g;
    const cells = [];
    let cellMatch;

    while ((cellMatch = cellPattern.exec(rowContent)) !== null) {
        const cellContent = cellMatch[1];
        const textPattern = /<a:t>([^<]*)<\/a:t>/g;
        let cellText = '';
        let textMatch;

        while ((textMatch = textPattern.exec(cellContent)) !== null) {
            cellText += textMatch[1];
        }

        cells.push({
            full: cellMatch[0],
            content: cellContent,
            text: cellText.trim()
        });
    }

    return cells;
}

/**
 * Helper function to update text in a specific cell by index
 * Handles cells with multiple <a:t> elements by replacing ALL of them with the new value
 * Also handles empty cells by inserting text into the first <a:r> run
 * @param {string} rowXml - Full row XML
 * @param {Array} cells - Array of cells from extractCellsFromRow
 * @param {number} cellIndex - Index of cell to update
 * @param {string} newValue - New text value
 * @returns {string} Updated row XML
 */
function updateCellTextByIndex(rowXml, cells, cellIndex, newValue) {
    if (cellIndex >= cells.length) return rowXml;

    // Re-extract the cell at this index from the current rowXml
    // This handles cases where earlier updates shifted positions
    const cellPattern = /<a:tc\b[^>]*>([\s\S]*?)<\/a:tc>/g;
    let match;
    let currentIdx = 0;
    let pos = -1;
    let cell = null;

    while ((match = cellPattern.exec(rowXml)) !== null) {
        if (currentIdx === cellIndex) {
            pos = match.index;
            cell = {
                full: match[0],
                content: match[1]
            };
            break;
        }
        currentIdx++;
    }

    if (pos === -1 || !cell) return rowXml; // Cell not found

    const escapedValue = escapeXml(newValue);
    // Escape $ for replacement strings ($ has special meaning in String.replace)
    const safeValue = escapedValue.replace(/\$/g, '$$$$');

    // Find ALL text elements in the cell
    const textPattern = /<a:t>([^<]*)<\/a:t>/g;
    const textMatches = cell.content.match(textPattern);

    let newCellContent = cell.content;

    if (textMatches && textMatches.length > 0) {
        if (textMatches.length === 1) {
            // Single text element - simple replacement
            // Use safeValue to handle $ in currency values like S$100
            newCellContent = cell.content.replace(textPattern, `<a:t>${safeValue}</a:t>`);
        } else {
            // Multiple text elements - need to consolidate into first run and remove others
            // Strategy: Find all <a:r> runs, keep only the first one with updated text
            const runPattern = /<a:r>([\s\S]*?)<\/a:r>/g;
            const runs = [];
            let runMatch;
            while ((runMatch = runPattern.exec(cell.content)) !== null) {
                // Check if this run contains a text element
                if (runMatch[0].includes('<a:t>')) {
                    runs.push({
                        full: runMatch[0],
                        content: runMatch[1],
                        index: runMatch.index
                    });
                }
            }

            if (runs.length > 0) {
                // Update the first run's text
                // Use safeValue to handle $ in currency values like S$100
                const firstRun = runs[0];
                const updatedFirstRun = firstRun.full.replace(/<a:t>[^<]*<\/a:t>/, `<a:t>${safeValue}</a:t>`);
                newCellContent = cell.content.replace(firstRun.full, updatedFirstRun);

                // Remove subsequent runs (they contain the split text)
                for (let i = 1; i < runs.length; i++) {
                    newCellContent = newCellContent.replace(runs[i].full, '');
                }
            } else {
                // Fallback: just replace first text element
                // Use safeValue to handle $ in currency values like S$100
                let isFirst = true;
                newCellContent = cell.content.replace(textPattern, (match) => {
                    if (isFirst) {
                        isFirst = false;
                        return `<a:t>${safeValue}</a:t>`;
                    }
                    // Keep existing content if we couldn't find runs
                    return match;
                });
            }
        }
    } else {
        // No text elements found - try to insert into existing <a:r> run
        const runPattern = /(<a:r>[\s\S]*?)(<\/a:r>)/;
        const runMatch = cell.content.match(runPattern);

        if (runMatch) {
            // Insert <a:t> before the closing </a:r> - use safeValue for $ escaping
            newCellContent = cell.content.replace(runPattern, `$1<a:t>${safeValue}</a:t>$2`);
        } else {
            // No run element - insert a new <a:r> with <a:t> before <a:endParaRPr>
            const endParaPattern = /(<a:endParaRPr)/;
            const endParaMatch = cell.content.match(endParaPattern);

            if (endParaMatch) {
                // Insert run with text before the end paragraph properties - use safeValue
                newCellContent = cell.content.replace(
                    endParaPattern,
                    `<a:r><a:rPr lang="en-SG" sz="1000" dirty="0"/><a:t>${safeValue}</a:t></a:r>$1`
                );
            } else {
                // Last resort: try inserting before </a:p> - use safeValue
                const paraEndPattern = /(<\/a:p>)/;
                if (cell.content.match(paraEndPattern)) {
                    newCellContent = cell.content.replace(
                        paraEndPattern,
                        `<a:r><a:rPr lang="en-SG" sz="1000" dirty="0"/><a:t>${safeValue}</a:t></a:r>$1`
                    );
                } else {
                    // Can't update this cell
                    return rowXml;
                }
            }
        }
    }

    const newCell = cell.full.replace(cell.content, newCellContent);
    // Use substring replacement at the correct position (pos was calculated earlier)
    return rowXml.substring(0, pos) + newCell + rowXml.substring(pos + cell.full.length);
}

/**
 * Update a cell with multiple paragraphs - one value per paragraph
 * Used for rows that have main benefit + sub-item combined (e.g., "Post Hospitalisation" + "from")
 * @param {string} rowXml - Full row XML
 * @param {Array} cells - Array of cell objects from extractCellsFromRow
 * @param {number} cellIndex - Index of cell to update
 * @param {Array} values - Array of values, one per paragraph
 * @returns {string} Updated row XML
 */
function updateCellWithMultipleParagraphs(rowXml, cells, cellIndex, values) {
    if (cellIndex >= cells.length || !values || values.length === 0) return rowXml;

    // Re-extract the cell at this index from the current rowXml
    const cellPattern = /<a:tc\b[^>]*>([\s\S]*?)<\/a:tc>/g;
    let match;
    let currentIdx = 0;
    let pos = -1;
    let cell = null;

    while ((match = cellPattern.exec(rowXml)) !== null) {
        if (currentIdx === cellIndex) {
            pos = match.index;
            cell = {
                full: match[0],
                content: match[1]
            };
            break;
        }
        currentIdx++;
    }

    if (pos === -1 || !cell) return rowXml;

    // Find all paragraphs in the cell
    const paraPattern = /<a:p\b[^>]*>([\s\S]*?)<\/a:p>/g;
    const paragraphs = [];
    let paraMatch;

    while ((paraMatch = paraPattern.exec(cell.content)) !== null) {
        // Check if paragraph has any text runs
        if (paraMatch[0].includes('<a:r>')) {
            paragraphs.push({
                full: paraMatch[0],
                content: paraMatch[1],
                index: paraMatch.index
            });
        }
    }

    if (paragraphs.length === 0) return rowXml;

    let newCellContent = cell.content;

    // Update each paragraph with corresponding value
    for (let i = 0; i < paragraphs.length && i < values.length; i++) {
        const para = paragraphs[i];
        const value = values[i];

        if (!value) continue;

        const escapedValue = escapeXml(value);
        const safeValue = escapedValue.replace(/\$/g, '$$$$');

        // Find all runs in this paragraph
        const runPattern = /<a:r>([\s\S]*?)<\/a:r>/g;
        const runs = [];
        let runMatch;

        while ((runMatch = runPattern.exec(para.full)) !== null) {
            if (runMatch[0].includes('<a:t>')) {
                runs.push({
                    full: runMatch[0],
                    content: runMatch[1]
                });
            }
        }

        if (runs.length > 0) {
            // Update first run with new value
            const firstRun = runs[0];
            const updatedFirstRun = firstRun.full.replace(/<a:t>[^<]*<\/a:t>/, `<a:t>${safeValue}</a:t>`);
            let newPara = para.full.replace(firstRun.full, updatedFirstRun);

            // Remove subsequent runs in this paragraph (consolidate text)
            for (let j = 1; j < runs.length; j++) {
                newPara = newPara.replace(runs[j].full, '');
            }

            newCellContent = newCellContent.replace(para.full, newPara);
        }
    }

    const newCell = cell.full.replace(cell.content, newCellContent);
    return rowXml.substring(0, pos) + newCell + rowXml.substring(pos + cell.full.length);
}

/**
 * Helper function to format benefit values (add thousands separators if numeric)
 * @param {string} value - Raw value from Excel
 * @returns {string} Formatted value
 */
function formatBenefitValue(value) {
    if (!value) return value;

    // Check if it's a pure number
    const cleanValue = value.replace(/,/g, '').trim();
    if (/^\d+$/.test(cleanValue)) {
        const num = parseInt(cleanValue, 10);
        return num.toLocaleString('en-US');
    }

    return value;
}

/**
 * Update Slide 19 GMM Overview with eligibility and last entry age
 * @param {Object} zip - PizZip instance
 * @param {Object} slide19Data - Data for slide 19 (eligibility, lastEntryAge)
 * @returns {Object} Results of the update operation
 */
function updateSlide19GMMOverview(zip, slide19Data, slideNumber = 19) {
    console.log('📝 Updating Slide 19 GMM Overview...');

    const results = {
        updated: [],
        errors: []
    };

    if (!slide19Data) {
        console.log('⚠️ No slide 19 data provided');
        return results;
    }

    console.log('📋 Slide 19 Data received:');
    console.log(`   - eligibility: "${slide19Data.eligibility?.substring(0, 60) || 'null'}..."`);
    console.log(`   - lastEntryAge: "${slide19Data.lastEntryAge || 'null'}"`);
    console.log(`   - categoryPlans: ${slide19Data.categoryPlans?.length || 0} entries`);

    try {
        let slideXml = getSlideXML(zip, slideNumber);

        // Update Eligibility & Last Entry Age - Replace as separate text elements
        if (slide19Data.eligibility || slide19Data.lastEntryAge) {
            const eligResult = replaceEligibilityAndLastEntryAgeSeparately(
                slideXml,
                slide19Data.eligibility,
                slide19Data.lastEntryAge
            );

            if (eligResult.success) {
                slideXml = eligResult.xml;
                console.log(`  ✅ Updated Eligibility & Last Entry Age`);
                if (slide19Data.eligibility) {
                    results.updated.push({ field: 'Eligibility', value: slide19Data.eligibility.substring(0, 50) + '...' });
                }
                if (slide19Data.lastEntryAge) {
                    results.updated.push({ field: 'Last Entry Age', value: slide19Data.lastEntryAge });
                }
            } else {
                console.log(`  ⚠️ Could not update Eligibility/Last Entry Age`);
                if (slide19Data.eligibility) {
                    results.errors.push({ field: 'Eligibility', error: 'Cell not found' });
                }
            }
        }

        // Update Category/Plan table
        if (slide19Data.categoryPlans && slide19Data.categoryPlans.length > 0) {
            console.log(`  🔄 Updating Category/Plan table with ${slide19Data.categoryPlans.length} entries...`);

            // Find the Category/Plan table (second table, contains "Category" and "Plan" headers)
            const tablePattern = /<a:tbl\b[^>]*>([\s\S]*?)<\/a:tbl>/g;
            let tableMatch;
            let tableIdx = 0;

            while ((tableMatch = tablePattern.exec(slideXml)) !== null) {
                const tableContent = tableMatch[1];

                // Check if this table has Category/Plan headers
                if (tableContent.toLowerCase().includes('category') && tableContent.toLowerCase().includes('plan')) {
                    console.log(`    📍 Found Category/Plan table (table ${tableIdx})`);

                    let updatedTableContent = tableContent;
                    const rowPattern = /<a:tr\b[^>]*>([\s\S]*?)<\/a:tr>/g;
                    let rowMatch;
                    let rowIdx = 0;
                    let dataRowIdx = 0;

                    while ((rowMatch = rowPattern.exec(tableContent)) !== null) {
                        const row = {
                            full: rowMatch[0],
                            content: rowMatch[1]
                        };

                        // Extract cells from row
                        const cells = extractCellsFromRow(row.full);

                        // Skip header row (row 0)
                        if (rowIdx === 0) {
                            rowIdx++;
                            continue;
                        }

                        // Update data rows with Excel category/plan data
                        if (dataRowIdx < slide19Data.categoryPlans.length) {
                            const excelData = slide19Data.categoryPlans[dataRowIdx];
                            let newRow = row.full;

                            // Update category (column 0)
                            if (excelData.category) {
                                newRow = updateCellTextByIndex(newRow, cells, 0, excelData.category);
                            }

                            // Update plan (last column)
                            if (excelData.plan) {
                                const planColIndex = cells.length - 1;
                                newRow = updateCellTextByIndex(newRow, cells, planColIndex, excelData.plan);
                            }

                            updatedTableContent = updatedTableContent.replace(row.full, newRow);
                            console.log(`    ✅ Row ${rowIdx}: "${excelData.category.substring(0, 40)}..." → ${excelData.plan}`);
                            results.updated.push({ field: `Category ${dataRowIdx + 1}`, value: excelData.plan });
                            dataRowIdx++;
                        }

                        rowIdx++;
                    }

                    // Replace table in XML
                    const updatedTable = tableMatch[0].replace(tableContent, updatedTableContent);
                    slideXml = slideXml.replace(tableMatch[0], updatedTable);
                    break;
                }
                tableIdx++;
            }
        }

        setSlideXML(zip, slideNumber, slideXml);
        console.log(`📝 Slide 19 update complete: ${results.updated.length} fields updated, ${results.errors.length} errors`);

    } catch (error) {
        console.error('❌ Error updating Slide 19:', error.message);
        results.errors.push({ field: 'Slide 19', error: error.message });
    }

    return results;
}

/**
 * Update Slide 20 GMM Schedule of Benefits with dynamic plan columns
 * @param {Object} zip - PizZip instance
 * @param {Object} slide20Data - Data for slide 20 (scheduleOfBenefits with planHeaders, planColumns, benefits)
 * @returns {Object} Results of the update operation
 */
function updateSlide20GMMScheduleOfBenefits(zip, slide20Data, slideNumber = 20) {
    console.log('📝 Updating Slide 20 GMM Schedule of Benefits...');

    const results = {
        updated: [],
        errors: []
    };

    if (!slide20Data || !slide20Data.scheduleOfBenefits) {
        console.log('⚠️ No slide 20 data provided');
        return results;
    }

    const scheduleData = slide20Data.scheduleOfBenefits;
    console.log(`📋 GMM Schedule data: ${scheduleData.benefits?.length || 0} benefits`);
    console.log(`📋 Dynamic plan headers: ${scheduleData.planHeaders?.join(', ') || 'None'}`);

    try {
        let slideXml = getSlideXML(zip, slideNumber);

        // Find and update table rows
        const tablePattern = /<a:tbl\b[^>]*>([\s\S]*?)<\/a:tbl>/g;
        let tableMatch = tablePattern.exec(slideXml);

        if (tableMatch) {
            let tableContent = tableMatch[1];
            let updatedTableContent = tableContent;

            // Find all rows in the table
            const rowPattern = /<a:tr\b[^>]*>([\s\S]*?)<\/a:tr>/g;
            let rowMatch;
            const rows = [];

            while ((rowMatch = rowPattern.exec(tableContent)) !== null) {
                rows.push({
                    full: rowMatch[0],
                    content: rowMatch[1],
                    index: rowMatch.index
                });
            }

            console.log(`  📊 Found ${rows.length} rows in Slide 20 table`);

            // Track current benefit for sub-item association
            let currentBenefit = null;

            // Process each row
            for (let i = 0; i < rows.length; i++) {
                const row = rows[i];
                const cells = extractCellsFromRow(row.content);

                if (cells.length < 7) continue; // Need at least benefit number + name + plan columns

                const cell0Text = cells[0].text.trim();
                const cell1Text = cells[1].text.trim().toLowerCase();
                const rowText = cell0Text + ' ' + cell1Text;

                // Check if this is the header row (contains "SCHEDULE OF BENEFITS")
                if (rowText.toLowerCase().includes('schedule of benefits')) {
                    // Update plan header cells (columns 6+) with dynamic plan names
                    if (scheduleData.planHeaders && scheduleData.planHeaders.length > 0) {
                        let newRow = row.full;
                        for (let p = 0; p < scheduleData.planHeaders.length && (6 + p) < cells.length; p++) {
                            const planHeader = scheduleData.planHeaders[p];
                            const pptxColIndex = 6 + p;
                            newRow = updateCellTextByIndex(newRow, cells, pptxColIndex, `Plan ${planHeader}`);
                        }
                        updatedTableContent = updatedTableContent.replace(row.full, newRow);
                        results.updated.push({ field: 'Plan Headers', value: scheduleData.planHeaders.join(', ') });
                        console.log(`    ✅ Updated plan headers: ${scheduleData.planHeaders.join(', ')}`);
                    }
                    continue;
                }

                // Check if this is a main benefit row (has number in column 0)
                const rowNumber = parseInt(cell0Text, 10);
                const isMainBenefitRow = !isNaN(rowNumber) && rowNumber >= 1 && rowNumber <= 20;

                if (isMainBenefitRow) {
                    // Find matching benefit by NAME first, then fall back to number
                    // This handles cases where PPTX and Excel have different benefit numbering
                    const matchedBenefit = scheduleData.benefits?.find(b => {
                        const benefitNameLower = (b.rawName || b.name || '').toLowerCase();
                        // Match by name pattern first (more reliable)
                        if (cell1Text.includes(benefitNameLower.substring(0, 15)) ||
                            benefitNameLower.includes(cell1Text.substring(0, 15))) {
                            return true;
                        }
                        // Fall back to number matching only if names don't match
                        return false;
                    }) || scheduleData.benefits?.find(b => b.number === rowNumber);

                    if (matchedBenefit) {
                        currentBenefit = matchedBenefit;
                        let newRow = row.full;

                        // Check if this row also contains a sub-item (combined row like "Post Hospitalisation" + "from")
                        // This happens when cell1 contains both benefit name AND sub-item name
                        const combinedSubItem = matchedBenefit.subItems?.find(si => {
                            const subNameLower = (si.name || '').toLowerCase();
                            // Check if the sub-item name appears in the row's description column
                            return cell1Text.includes(subNameLower.substring(0, 10));
                        });

                        // Update plan value columns (starting from column 6)
                        for (let p = 0; p < scheduleData.planHeaders.length && (6 + p) < cells.length; p++) {
                            const planHeader = scheduleData.planHeaders[p];
                            const mainValue = matchedBenefit.values?.[planHeader] || '';
                            const pptxColIndex = 6 + p;

                            if (combinedSubItem) {
                                // Combined row - use multi-paragraph update
                                const subValue = combinedSubItem.values?.[planHeader] || '';
                                const values = [
                                    formatBenefitValue(mainValue),
                                    formatBenefitValue(subValue)
                                ];
                                newRow = updateCellWithMultipleParagraphs(newRow, cells, pptxColIndex, values);
                            } else if (mainValue) {
                                // Single value row
                                newRow = updateCellTextByIndex(newRow, cells, pptxColIndex, formatBenefitValue(mainValue));
                            }
                        }

                        updatedTableContent = updatedTableContent.replace(row.full, newRow);
                        results.updated.push({ field: `Benefit ${rowNumber}`, value: matchedBenefit.name });
                        if (combinedSubItem) {
                            console.log(`    ✅ Updated Benefit ${rowNumber}: ${matchedBenefit.name.substring(0, 30)}... (with sub-item: ${combinedSubItem.name})`);
                        } else {
                            console.log(`    ✅ Updated Benefit ${rowNumber}: ${matchedBenefit.name.substring(0, 30)}...`);
                        }
                    }
                }
                // Check if this is a sub-item row (no number, but has content in col 1)
                else if (!cell0Text && cell1Text && currentBenefit) {
                    // Find matching sub-item
                    const matchedSubItem = currentBenefit.subItems?.find(si => {
                        const subNameLower = (si.name || '').toLowerCase();
                        return cell1Text.includes(subNameLower.substring(0, 10)) ||
                               subNameLower.includes(cell1Text.substring(0, 10));
                    });

                    if (matchedSubItem) {
                        let newRow = row.full;

                        // Update plan value columns for sub-item
                        for (let p = 0; p < scheduleData.planHeaders.length && (6 + p) < cells.length; p++) {
                            const planHeader = scheduleData.planHeaders[p];
                            const value = matchedSubItem.values?.[planHeader] || '';
                            if (value) {
                                const pptxColIndex = 6 + p;
                                newRow = updateCellTextByIndex(newRow, cells, pptxColIndex, formatBenefitValue(value));
                            }
                        }

                        updatedTableContent = updatedTableContent.replace(row.full, newRow);
                        console.log(`      └─ Updated sub-item: ${matchedSubItem.name.substring(0, 25)}...`);
                    }
                }
            }

            // Replace table in XML
            const updatedTable = tableMatch[0].replace(tableContent, updatedTableContent);
            slideXml = slideXml.replace(tableMatch[0], updatedTable);
        } else {
            console.log('  ⚠️ No table found in Slide 20');
            results.errors.push({ field: 'Slide 20 Table', error: 'Table not found' });
        }

        setSlideXML(zip, slideNumber, slideXml);
        console.log(`📝 Slide 20 update complete: ${results.updated.length} fields updated, ${results.errors.length} errors`);

    } catch (error) {
        console.error('❌ Error updating Slide 20:', error.message);
        results.errors.push({ field: 'Slide 20', error: error.message });
    }

    return results;
}

/**
 * Update Slide 24 GP Overview with Eligibility, Last Entry Age, and Category/Plan table
 * @param {Object} zip - PizZip instance
 * @param {Object} slide24Data - Data for slide 24 (eligibility, lastEntryAge, categoryPlans)
 * @returns {Object} Results of the update operation
 */
function updateSlide24GPOverview(zip, slide24Data, slideNumber = 24) {
    console.log('📝 Updating Slide 24 GP Overview...');

    const results = {
        updated: [],
        errors: []
    };

    if (!slide24Data) {
        console.log('⚠️ No slide 24 data provided');
        return results;
    }

    try {
        let slideXml = getSlideXML(zip, slideNumber);

        // 1. Update Eligibility & Last Entry Age
        if (slide24Data.eligibility || slide24Data.lastEntryAge) {
            const eligResult = replaceEligibilityAndLastEntryAgeSeparately(
                slideXml,
                slide24Data.eligibility,
                slide24Data.lastEntryAge
            );

            if (eligResult.success) {
                slideXml = eligResult.xml;
                console.log(`  ✅ Updated Eligibility & Last Entry Age`);
                if (slide24Data.eligibility) {
                    results.updated.push({ field: 'Eligibility', value: slide24Data.eligibility.substring(0, 50) + '...' });
                }
                if (slide24Data.lastEntryAge) {
                    results.updated.push({ field: 'Last Entry Age', value: slide24Data.lastEntryAge });
                }
            }
        }

        // 2. Update Category/Plan table (Table 1 - the second table)
        if (slide24Data.categoryPlans && slide24Data.categoryPlans.length > 0) {
            console.log(`  🔄 Updating Category/Plan table with ${slide24Data.categoryPlans.length} entries...`);

            const tablePattern = /<a:tbl\b[^>]*>([\s\S]*?)<\/a:tbl>/g;
            let tableMatch;
            let tableIdx = 0;

            while ((tableMatch = tablePattern.exec(slideXml)) !== null) {
                const tableContent = tableMatch[1];

                // Check if this table has Category/Plan headers
                if (tableContent.toLowerCase().includes('category') && tableContent.toLowerCase().includes('plan')) {
                    console.log(`    📍 Found Category/Plan table (table ${tableIdx})`);

                    let updatedTableContent = tableContent;
                    const rowPattern = /<a:tr\b[^>]*>([\s\S]*?)<\/a:tr>/g;
                    let rowMatch;
                    let rowIdx = 0;
                    let dataRowIdx = 0;

                    while ((rowMatch = rowPattern.exec(tableContent)) !== null) {
                        const row = {
                            full: rowMatch[0],
                            content: rowMatch[1]
                        };

                        const cells = extractCellsFromRow(row.full);

                        // Skip header row (row 0)
                        if (rowIdx === 0) {
                            rowIdx++;
                            continue;
                        }

                        // Update data rows with Excel category/plan data
                        if (dataRowIdx < slide24Data.categoryPlans.length) {
                            const excelData = slide24Data.categoryPlans[dataRowIdx];
                            let newRow = row.full;

                            // Update category (column 0)
                            if (excelData.category) {
                                newRow = updateCellTextByIndex(newRow, cells, 0, excelData.category);
                            }

                            // Update plan (last column)
                            if (excelData.plan) {
                                const planColIndex = cells.length - 1;
                                newRow = updateCellTextByIndex(newRow, cells, planColIndex, excelData.plan);
                            }

                            updatedTableContent = updatedTableContent.replace(row.full, newRow);
                            console.log(`    ✅ Row ${rowIdx}: "${excelData.category.substring(0, 40)}..." → ${excelData.plan}`);
                            results.updated.push({ field: `Category ${dataRowIdx + 1}`, value: excelData.plan });
                            dataRowIdx++;
                        }

                        rowIdx++;
                    }

                    const updatedTable = tableMatch[0].replace(tableContent, updatedTableContent);
                    slideXml = slideXml.replace(tableMatch[0], updatedTable);
                    break;
                }
                tableIdx++;
            }
        }

        setSlideXML(zip, slideNumber, slideXml);
        console.log(`📝 Slide 24 update complete: ${results.updated.length} fields updated, ${results.errors.length} errors`);

    } catch (error) {
        console.error('❌ Error updating Slide 24:', error.message);
        results.errors.push({ field: 'Slide 24', error: error.message });
    }

    return results;
}

/**
 * Update Slide 25 GP Schedule of Benefits
 * @param {Object} zip - PizZip instance
 * @param {Object} slide25Data - Data for slide 25 (scheduleOfBenefits)
 * @returns {Object} Results of the update operation
 */
function updateSlide25GPScheduleOfBenefits(zip, slide25Data, slideNumber = 25) {
    console.log('📝 Updating Slide 25 GP Schedule of Benefits...');

    const results = {
        updated: [],
        errors: []
    };

    if (!slide25Data || !slide25Data.scheduleOfBenefits) {
        console.log('⚠️ No slide 25 schedule data provided');
        return results;
    }

    const scheduleData = slide25Data.scheduleOfBenefits;

    try {
        let slideXml = getSlideXML(zip, slideNumber);

        // Find the Schedule of Benefits table
        const tablePattern = /<a:tbl\b[^>]*>([\s\S]*?)<\/a:tbl>/;
        const tableMatch = tablePattern.exec(slideXml);

        if (tableMatch) {
            let tableContent = tableMatch[1];
            let updatedTableContent = tableContent;

            // Extract all rows
            const rowPattern = /<a:tr\b[^>]*>([\s\S]*?)<\/a:tr>/g;
            let rowMatch;
            let currentBenefit = null;

            while ((rowMatch = rowPattern.exec(tableContent)) !== null) {
                const row = {
                    full: rowMatch[0],
                    content: rowMatch[1]
                };

                const cells = extractCellsFromRow(row.full);
                if (cells.length < 2) continue;

                const cell0Text = cells[0].text.trim().toLowerCase();
                const cell0Raw = cells[0].text.trim();
                const cell1Text = cells[1].text.trim().toLowerCase();

                // GP Slide 25 structure:
                // Row format: [( # )] [Benefit Name] [...merged...] [Plan1 Value] [Plan2 Value]
                // Plan columns are at indices 7 and 8
                // PPTX uses (1), (2), etc. but Excel uses -1, -2, etc.

                // Match benefit rows by identifier pattern: ( 1 ), ( 2 ), (1), (2), etc.
                const benefitMatch = cell0Text.match(/^\(?\s*(\d+)\s*\)?$/);

                if (benefitMatch) {
                    const benefitNum = parseInt(benefitMatch[1], 10);

                    // Find matching benefit in Excel data by identifier
                    // Excel uses -1, -2, etc. so PPTX (1) maps to Excel -1
                    const matchedBenefit = scheduleData.benefits?.find(b => {
                        const id = String(b.identifier || '').trim();
                        return id === `-${benefitNum}` || id === String(benefitNum) || id === `(${benefitNum})`;
                    });

                    if (matchedBenefit) {
                        currentBenefit = matchedBenefit;
                        let newRow = row.full;

                        // Dynamically determine plan columns based on actual table structure
                        // PPTX table has: [identifier] [name] [...plan values at end]
                        // Use last 2 cells for plan values (cells.length-2 and cells.length-1)
                        const planCols = cells.length >= 4
                            ? [cells.length - 2, cells.length - 1]
                            : cells.length >= 3 ? [2, 2] : [1, 1]; // Fallback for merged columns

                        for (let p = 0; p < scheduleData.planHeaders.length && p < planCols.length; p++) {
                            const planHeader = scheduleData.planHeaders[p];
                            const value = matchedBenefit.values?.[planHeader] || '';
                            if (value && planCols[p] < cells.length) {
                                newRow = updateCellTextByIndex(newRow, cells, planCols[p], formatBenefitValue(value));
                            }
                        }

                        updatedTableContent = updatedTableContent.replace(row.full, newRow);
                        console.log(`    ✅ Updated benefit (${benefitNum}): ${matchedBenefit.name?.substring(0, 30) || 'N/A'}...`);
                        results.updated.push({ field: `Benefit ${benefitNum}`, value: matchedBenefit.name?.substring(0, 30) || '' });
                    }
                }
                // Check for sub-items of current benefit
                else if (currentBenefit && !cell0Text && cell1Text) {
                    const matchedSubItem = currentBenefit.subItems?.find(si => {
                        const subNameLower = (si.name || '').toLowerCase();
                        return cell1Text.includes(subNameLower.substring(0, 10)) ||
                               subNameLower.includes(cell1Text.substring(0, 10));
                    });

                    if (matchedSubItem) {
                        let newRow = row.full;

                        // Use same dynamic plan column detection for sub-items
                        const planCols = cells.length >= 4
                            ? [cells.length - 2, cells.length - 1]
                            : cells.length >= 3 ? [2, 2] : [1, 1];

                        for (let p = 0; p < scheduleData.planHeaders.length && p < planCols.length; p++) {
                            const planHeader = scheduleData.planHeaders[p];
                            const value = matchedSubItem.values?.[planHeader] || '';
                            if (value && planCols[p] < cells.length) {
                                newRow = updateCellTextByIndex(newRow, cells, planCols[p], formatBenefitValue(value));
                            }
                        }

                        updatedTableContent = updatedTableContent.replace(row.full, newRow);
                        console.log(`      └─ Updated sub-item: ${matchedSubItem.name?.substring(0, 25) || 'N/A'}...`);
                    }
                }
            }

            const updatedTable = tableMatch[0].replace(tableContent, updatedTableContent);
            slideXml = slideXml.replace(tableMatch[0], updatedTable);
        } else {
            console.log('  ⚠️ No table found in Slide 25');
            results.errors.push({ field: 'Slide 25 Table', error: 'Table not found' });
        }

        setSlideXML(zip, slideNumber, slideXml);
        console.log(`📝 Slide 25 update complete: ${results.updated.length} fields updated, ${results.errors.length} errors`);

    } catch (error) {
        console.error('❌ Error updating Slide 25:', error.message);
        results.errors.push({ field: 'Slide 25', error: error.message });
    }

    return results;
}

/**
 * Update Slide 26 SP Overview with Eligibility, Last Entry Age, and Category/Plan table
 * @param {Object} zip - PizZip instance
 * @param {Object} slide26Data - Data for slide 26 (eligibility, lastEntryAge, categoryPlans)
 * @returns {Object} Results of the update operation
 */
function updateSlide26SPOverview(zip, slide26Data, slideNumber = 26) {
    console.log('📝 Updating Slide 26 SP Overview...');

    const results = {
        updated: [],
        errors: []
    };

    if (!slide26Data) {
        console.log('⚠️ No slide 26 data provided');
        return results;
    }

    try {
        let slideXml = getSlideXML(zip, slideNumber);

        // 1. Update Eligibility & Last Entry Age
        if (slide26Data.eligibility || slide26Data.lastEntryAge) {
            const eligResult = replaceEligibilityAndLastEntryAgeSeparately(
                slideXml,
                slide26Data.eligibility,
                slide26Data.lastEntryAge
            );

            if (eligResult.success) {
                slideXml = eligResult.xml;
                console.log(`  ✅ Updated Eligibility & Last Entry Age`);
                if (slide26Data.eligibility) {
                    results.updated.push({ field: 'Eligibility', value: slide26Data.eligibility.substring(0, 50) + '...' });
                }
                if (slide26Data.lastEntryAge) {
                    results.updated.push({ field: 'Last Entry Age', value: slide26Data.lastEntryAge });
                }
            }
        }

        // 2. Update Category/Plan table (Table 1 - the second table)
        if (slide26Data.categoryPlans && slide26Data.categoryPlans.length > 0) {
            console.log(`  🔄 Updating Category/Plan table with ${slide26Data.categoryPlans.length} entries...`);

            const tablePattern = /<a:tbl\b[^>]*>([\s\S]*?)<\/a:tbl>/g;
            let tableMatch;
            let tableIdx = 0;

            while ((tableMatch = tablePattern.exec(slideXml)) !== null) {
                const tableContent = tableMatch[1];

                // Check if this table has Category/Plan headers
                if (tableContent.toLowerCase().includes('category') && tableContent.toLowerCase().includes('plan')) {
                    console.log(`    📍 Found Category/Plan table (table ${tableIdx})`);

                    let updatedTableContent = tableContent;
                    const rowPattern = /<a:tr\b[^>]*>([\s\S]*?)<\/a:tr>/g;
                    let rowMatch;
                    let rowIdx = 0;
                    let dataRowIdx = 0;

                    while ((rowMatch = rowPattern.exec(tableContent)) !== null) {
                        const row = {
                            full: rowMatch[0],
                            content: rowMatch[1]
                        };

                        const cells = extractCellsFromRow(row.full);

                        // Skip header row (row 0)
                        if (rowIdx === 0) {
                            rowIdx++;
                            continue;
                        }

                        // Update data rows with Excel category/plan data
                        if (dataRowIdx < slide26Data.categoryPlans.length) {
                            const excelData = slide26Data.categoryPlans[dataRowIdx];
                            let newRow = row.full;

                            // Update category (column 0)
                            if (excelData.category) {
                                newRow = updateCellTextByIndex(newRow, cells, 0, excelData.category);
                            }

                            // Update plan (last column)
                            if (excelData.plan) {
                                const planColIndex = cells.length - 1;
                                newRow = updateCellTextByIndex(newRow, cells, planColIndex, excelData.plan);
                            }

                            updatedTableContent = updatedTableContent.replace(row.full, newRow);
                            console.log(`    ✅ Row ${rowIdx}: "${excelData.category.substring(0, 40)}..." → ${excelData.plan}`);
                            results.updated.push({ field: `Category ${dataRowIdx + 1}`, value: excelData.plan });
                            dataRowIdx++;
                        }

                        rowIdx++;
                    }

                    const updatedTable = tableMatch[0].replace(tableContent, updatedTableContent);
                    slideXml = slideXml.replace(tableMatch[0], updatedTable);
                    break;
                }
                tableIdx++;
            }
        }

        setSlideXML(zip, slideNumber, slideXml);
        console.log(`📝 Slide 26 update complete: ${results.updated.length} fields updated, ${results.errors.length} errors`);

    } catch (error) {
        console.error('❌ Error updating Slide 26:', error.message);
        results.errors.push({ field: 'Slide 26', error: error.message });
    }

    return results;
}

/**
 * Map PPT benefit numbers to Excel benefit numbers for SP Schedule of Benefits
 * PPT consolidates some Excel benefits - use primary Excel number for values
 */
const SP_PPT_TO_EXCEL_MAPPING = {
    1: 1,    // PPT "Panel & Non Panel Specialist" → Excel #1 (Panel Specialist)
    2: 3,    // PPT "TCM" → Excel #3
    3: 4,    // PPT "Diagnostic X-ray & Lab Test" → Excel #4 (Panel Diagnostic)
    4: 8,    // PPT "Outpatient therapy" → Excel #8
    5: null  // PPT "GST Extension" → Not in Excel, skip
};

/**
 * Update Slide 27 SP Schedule of Benefits
 * @param {Object} zip - PizZip instance
 * @param {Object} slide27Data - Data for slide 27 (scheduleOfBenefits)
 * @returns {Object} Results of the update operation
 */
function updateSlide27SPScheduleOfBenefits(zip, slide27Data, slideNumber = 27) {
    console.log('📝 Updating Slide 27 SP Schedule of Benefits...');

    const results = {
        updated: [],
        errors: []
    };

    if (!slide27Data || !slide27Data.scheduleOfBenefits) {
        console.log('⚠️ No slide 27 schedule data provided');
        return results;
    }

    const scheduleData = slide27Data.scheduleOfBenefits;

    try {
        let slideXml = getSlideXML(zip, slideNumber);

        // Find the Schedule of Benefits table
        const tablePattern = /<a:tbl\b[^>]*>([\s\S]*?)<\/a:tbl>/;
        const tableMatch = tablePattern.exec(slideXml);

        if (tableMatch) {
            let tableContent = tableMatch[1];
            let updatedTableContent = tableContent;

            // Extract all rows
            const rowPattern = /<a:tr\b[^>]*>([\s\S]*?)<\/a:tr>/g;
            let rowMatch;
            let currentBenefit = null;

            while ((rowMatch = rowPattern.exec(tableContent)) !== null) {
                const row = {
                    full: rowMatch[0],
                    content: rowMatch[1]
                };

                const cells = extractCellsFromRow(row.full);
                if (cells.length < 2) continue;

                const cell0Text = cells[0].text.trim();
                const cell1Text = cells[1].text.trim().toLowerCase();

                // SP Slide 27 structure:
                // Row format: [#] [Benefit Name] [Plan1 Value] [...] [Plan2 Value] [...]
                // Plan value columns are at indices 2 and 4

                // Match benefit rows by number (1, 2, 3, etc.)
                const benefitNum = parseInt(cell0Text, 10);

                if (!isNaN(benefitNum) && benefitNum >= 1) {
                    // Map PPT benefit number to Excel benefit number
                    const excelBenefitNum = SP_PPT_TO_EXCEL_MAPPING[benefitNum];

                    // Skip GST Extension (not in Excel - keep template default)
                    if (excelBenefitNum === null) {
                        console.log(`    ⏭️ Skipping benefit ${benefitNum} (GST Extension - not in Excel)`);
                        continue;
                    }

                    // Find matching benefit in Excel data using mapped number
                    const matchedBenefit = scheduleData.benefits?.find(b => b.number === excelBenefitNum);

                    if (matchedBenefit) {
                        currentBenefit = matchedBenefit;
                        let newRow = row.full;

                        // Update plan value columns (cols 2 and 4 for slide 27)
                        const planCols = [2, 4];
                        for (let p = 0; p < scheduleData.planHeaders.length && p < planCols.length; p++) {
                            const planHeader = scheduleData.planHeaders[p];
                            const value = matchedBenefit.values?.[planHeader] || '';
                            if (value && planCols[p] < cells.length) {
                                newRow = updateCellTextByIndex(newRow, cells, planCols[p], formatBenefitValue(value));
                            }
                        }

                        updatedTableContent = updatedTableContent.replace(row.full, newRow);
                        console.log(`    ✅ Updated benefit ${benefitNum} (Excel #${excelBenefitNum}): ${matchedBenefit.name?.substring(0, 30) || 'N/A'}...`);
                        results.updated.push({ field: `Benefit ${benefitNum}`, value: matchedBenefit.name?.substring(0, 30) || '' });
                    } else {
                        console.log(`    ⚠️ No Excel benefit found for PPT #${benefitNum} (mapped to Excel #${excelBenefitNum})`);
                    }
                }
                // Check for sub-items of current benefit
                else if (currentBenefit && !cell0Text && cell1Text) {
                    const matchedSubItem = currentBenefit.subItems?.find(si => {
                        const subNameLower = (si.name || '').toLowerCase();
                        return cell1Text.includes(subNameLower.substring(0, 10)) ||
                               subNameLower.includes(cell1Text.substring(0, 10));
                    });

                    if (matchedSubItem) {
                        let newRow = row.full;

                        const planCols = [2, 4];
                        for (let p = 0; p < scheduleData.planHeaders.length && p < planCols.length; p++) {
                            const planHeader = scheduleData.planHeaders[p];
                            const value = matchedSubItem.values?.[planHeader] || '';
                            if (value && planCols[p] < cells.length) {
                                newRow = updateCellTextByIndex(newRow, cells, planCols[p], formatBenefitValue(value));
                            }
                        }

                        updatedTableContent = updatedTableContent.replace(row.full, newRow);
                        console.log(`      └─ Updated sub-item: ${matchedSubItem.name?.substring(0, 25) || 'N/A'}...`);
                    }
                }
            }

            const updatedTable = tableMatch[0].replace(tableContent, updatedTableContent);
            slideXml = slideXml.replace(tableMatch[0], updatedTable);
        } else {
            console.log('  ⚠️ No table found in Slide 27');
            results.errors.push({ field: 'Slide 27 Table', error: 'Table not found' });
        }

        setSlideXML(zip, slideNumber, slideXml);
        console.log(`📝 Slide 27 update complete: ${results.updated.length} fields updated, ${results.errors.length} errors`);

    } catch (error) {
        console.error('❌ Error updating Slide 27:', error.message);
        results.errors.push({ field: 'Slide 27', error: error.message });
    }

    return results;
}

/**
 * Update Slide 30 Dental Overview with Eligibility and Last Entry Age
 * @param {Object} zip - PizZip instance
 * @param {Object} slide30Data - Data for slide 30 (eligibility, lastEntryAge)
 * @returns {Object} Results of the update operation
 */
function updateSlide30DentalOverview(zip, slide30Data, slideNumber = 30) {
    console.log('📝 Updating Slide 30 Dental Overview...');

    const results = {
        updated: [],
        errors: []
    };

    if (!slide30Data) {
        console.log('⚠️ No slide 30 data provided');
        return results;
    }

    try {
        let slideXml = getSlideXML(zip, slideNumber);

        // Update Eligibility & Last Entry Age
        if (slide30Data.eligibility || slide30Data.lastEntryAge) {
            const eligResult = replaceEligibilityAndLastEntryAgeSeparately(
                slideXml,
                slide30Data.eligibility,
                slide30Data.lastEntryAge
            );

            if (eligResult.success) {
                slideXml = eligResult.xml;
                console.log(`  ✅ Updated Eligibility & Last Entry Age`);
                if (slide30Data.eligibility) {
                    results.updated.push({ field: 'Eligibility', value: slide30Data.eligibility.substring(0, 50) + '...' });
                }
                if (slide30Data.lastEntryAge) {
                    results.updated.push({ field: 'Last Entry Age', value: slide30Data.lastEntryAge });
                }
            }
        }

        setSlideXML(zip, slideNumber, slideXml);
        console.log(`📝 Slide 30 update complete: ${results.updated.length} fields updated, ${results.errors.length} errors`);

    } catch (error) {
        console.error('❌ Error updating Slide 30:', error.message);
        results.errors.push({ field: 'Slide 30', error: error.message });
    }

    return results;
}

/**
 * Update Slide 31 Dental SOB Part 1 - Update Overall Limit text
 * @param {Object} zip - PizZip instance
 * @param {Object} slide31Data - Data for slide 31 (overallLimit)
 * @returns {Object} Results of the update operation
 */
function updateSlide31DentalSOB(zip, slide31Data, slideNumber = 31) {
    console.log('📝 Updating Slide 31 Dental SOB Part 1...');

    const results = {
        updated: [],
        errors: []
    };

    if (!slide31Data) {
        console.log('⚠️ No slide 31 data provided');
        return results;
    }

    try {
        let slideXml = getSlideXML(zip, slideNumber);

        // Update overall limit text (e.g., "S$500" → extracted value)
        if (slide31Data.overallLimit) {
            // Look for pattern "at S$XXX" or "at $XXX" and replace the dollar amount
            const limitPattern = /at\s+(S?\$[\d,]+)/gi;
            const newLimit = slide31Data.overallLimit.startsWith('$') ? 'S' + slide31Data.overallLimit : slide31Data.overallLimit;

            if (slideXml.match(limitPattern)) {
                slideXml = slideXml.replace(limitPattern, `at ${newLimit}`);
                results.updated.push({ field: 'Overall Limit', value: newLimit });
                console.log(`  ✅ Updated Overall Limit to ${newLimit}`);
            } else {
                // Try direct replacement of dollar amounts in "Overall limit" context
                const directPattern = /(Overall\s+limit[^<]*)(S?\$[\d,]+)/gi;
                if (slideXml.match(directPattern)) {
                    slideXml = slideXml.replace(directPattern, `$1${newLimit}`);
                    results.updated.push({ field: 'Overall Limit', value: newLimit });
                    console.log(`  ✅ Updated Overall Limit to ${newLimit}`);
                }
            }
        }

        setSlideXML(zip, slideNumber, slideXml);
        console.log(`📝 Slide 31 update complete: ${results.updated.length} fields updated, ${results.errors.length} errors`);

    } catch (error) {
        console.error('❌ Error updating Slide 31:', error.message);
        results.errors.push({ field: 'Slide 31', error: error.message });
    }

    return results;
}

/**
 * Update Slide 32 Dental SOB Part 2 - Update Overall Limit text
 * @param {Object} zip - PizZip instance
 * @param {Object} slide32Data - Data for slide 32 (overallLimit)
 * @returns {Object} Results of the update operation
 */
function updateSlide32DentalSOB(zip, slide32Data, slideNumber = 32) {
    console.log('📝 Updating Slide 32 Dental SOB Part 2...');

    const results = {
        updated: [],
        errors: []
    };

    if (!slide32Data) {
        console.log('⚠️ No slide 32 data provided');
        return results;
    }

    try {
        let slideXml = getSlideXML(zip, slideNumber);

        // Update overall limit text (e.g., "S$500" → extracted value)
        if (slide32Data.overallLimit) {
            // Look for pattern "at S$XXX" or "at $XXX" and replace the dollar amount
            const limitPattern = /at\s+(S?\$[\d,]+)/gi;
            const newLimit = slide32Data.overallLimit.startsWith('$') ? 'S' + slide32Data.overallLimit : slide32Data.overallLimit;

            if (slideXml.match(limitPattern)) {
                slideXml = slideXml.replace(limitPattern, `at ${newLimit}`);
                results.updated.push({ field: 'Overall Limit', value: newLimit });
                console.log(`  ✅ Updated Overall Limit to ${newLimit}`);
            } else {
                // Try direct replacement of dollar amounts in "Overall limit" context
                const directPattern = /(Overall\s+limit[^<]*)(S?\$[\d,]+)/gi;
                if (slideXml.match(directPattern)) {
                    slideXml = slideXml.replace(directPattern, `$1${newLimit}`);
                    results.updated.push({ field: 'Overall Limit', value: newLimit });
                    console.log(`  ✅ Updated Overall Limit to ${newLimit}`);
                }
            }
        }

        setSlideXML(zip, slideNumber, slideXml);
        console.log(`📝 Slide 32 update complete: ${results.updated.length} fields updated, ${results.errors.length} errors`);

    } catch (error) {
        console.error('❌ Error updating Slide 32:', error.message);
        results.errors.push({ field: 'Slide 32', error: error.message });
    }

    return results;
}

module.exports = {
    readPPTX,
    getSlideFiles,
    getSlideXML,
    setSlideXML,
    findAndReplaceText,
    updateSlide1PeriodOfInsurance,
    updateSlide8GTLTable,
    updateSlide9GDDTable,
    updateSlide10GPATable,
    updateSlide12GHSTable,
    updateSlide15ScheduleOfBenefits,
    updateSlide16ScheduleOfBenefits,
    updateSlide17QualificationPeriod,
    updateSlide18RoomAndBoard,
    updateSlide19GMMOverview,
    updateSlide20GMMScheduleOfBenefits,
    updateSlide24GPOverview,
    updateSlide25GPScheduleOfBenefits,
    updateSlide26SPOverview,
    updateSlide27SPScheduleOfBenefits,
    updateSlide30DentalOverview,
    updateSlide31DentalSOB,
    updateSlide32DentalSOB,
    generateBasisOfCoverParagraph,
    generateBasisOfCoverCellContent,
    escapeXml,
    findTextInSlide,
    extractTextContent,
    extractCellsFromRow,
    updateCellTextByIndex,
    formatBenefitValue,
    writePPTX,
    getPPTXInfo,
    processPPTX,
    isValidPPTXBuffer,
    inspectSlide,
    inspectSlide8Tables
};
