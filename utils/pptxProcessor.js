/**
 * PowerPoint Processor
 * Reads, modifies, and writes PPTX files using PizZip for XML manipulation
 * Preserves original formatting while updating specific text content
 */

const PizZip = require('pizzip');

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
function updateSlide1PeriodOfInsurance(zip, dateRange) {
    console.log('📝 Updating Slide 1 Period of Insurance...');

    try {
        let slideXml = getSlideXML(zip, 1);

        // Pattern 1: Date range in same element with "Period of Insurance:"
        const combinedPattern = /(Period of Insurance:\s*)(\d{1,2}\s+\w+\s+\d{4}\s+to\s+\d{1,2}\s+\w+\s+\d{4})/gi;
        if (combinedPattern.test(slideXml)) {
            slideXml = slideXml.replace(combinedPattern, `$1${dateRange.formatted}`);
            setSlideXML(zip, 1, slideXml);
            console.log(`✅ Updated Period of Insurance to: ${dateRange.formatted}`);
            return true;
        }

        // Pattern 2: Date range in separate <a:t> element (most common case)
        // Matches: <a:t>1 July 2025 to 30 June 2026</a:t>
        const separateDatePattern = /<a:t>(\d{1,2}\s+\w+\s+\d{4}\s+to\s+\d{1,2}\s+\w+\s+\d{4})<\/a:t>/gi;
        if (separateDatePattern.test(slideXml)) {
            slideXml = slideXml.replace(separateDatePattern, `<a:t>${dateRange.formatted}</a:t>`);
            setSlideXML(zip, 1, slideXml);
            console.log(`✅ Updated Period of Insurance to: ${dateRange.formatted}`);
            return true;
        }

        // Pattern 3: Try to find and replace any date range in "D Month YYYY to D Month YYYY" format
        const genericDatePattern = /(\d{1,2}\s+(?:January|February|March|April|May|June|July|August|September|October|November|December)\s+\d{4})\s+to\s+(\d{1,2}\s+(?:January|February|March|April|May|June|July|August|September|October|November|December)\s+\d{4})/gi;
        if (genericDatePattern.test(slideXml)) {
            slideXml = slideXml.replace(genericDatePattern, dateRange.formatted);
            setSlideXML(zip, 1, slideXml);
            console.log(`✅ Updated Period of Insurance to: ${dateRange.formatted}`);
            return true;
        }

        console.log('⚠️ Period of Insurance date pattern not found in Slide 1');
        return false;

    } catch (error) {
        console.error('❌ Error updating Slide 1:', error.message);
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
 * Update Slide 8 GTL table with data from placement slip
 * @param {Object} zip - PizZip instance
 * @param {Object} slide8Data - Data for slide 8 (eligibility, lastEntryAge, basisOfCover, nonEvidenceLimit)
 * @returns {Object} Results of the update operation
 */
function updateSlide8GTLTable(zip, slide8Data) {
    console.log('📝 Updating Slide 8 GTL Table...');

    const results = {
        updated: [],
        errors: []
    };

    if (!slide8Data) {
        console.log('⚠️ No slide 8 data provided');
        return results;
    }

    // Debug: Log all incoming data
    console.log('📋 Slide 8 Data received:');
    console.log(`   - eligibility: "${slide8Data.eligibility?.substring(0, 60) || 'null'}..."`);
    console.log(`   - lastEntryAge: "${slide8Data.lastEntryAge || 'null'}"`);
    console.log(`   - basisOfCover: ${slide8Data.basisOfCover?.length || 0} items`);
    console.log(`   - nonEvidenceLimit: "${slide8Data.nonEvidenceLimit?.substring(0, 60) || 'null'}..."`);

    try {
        let slideXml = getSlideXML(zip, 8);

        // 1. Update Eligibility & Last Entry Age - Template has combined row "EligibilityLast Entry Age"
        if (slide8Data.eligibility || slide8Data.lastEntryAge) {
            console.log(`  🔍 Updating Eligibility/Last Entry Age combined row...`);

            // Build combined value: "Eligibility value\nLast Entry Age: age value"
            let combinedValue = '';
            if (slide8Data.eligibility) {
                combinedValue = escapeXml(slide8Data.eligibility);
            }
            if (slide8Data.lastEntryAge) {
                if (combinedValue) combinedValue += '\nLast Entry Age: ';
                combinedValue += escapeXml(slide8Data.lastEntryAge);
            }

            // Try to find combined label first, then fall back to individual
            const combinedLabels = ['EligibilityLast Entry Age', 'Eligibility Last Entry Age', 'Eligibility/Last Entry Age'];
            let combinedResult = { success: false, xml: slideXml };

            for (const label of combinedLabels) {
                combinedResult = replaceTableCellByLabel(slideXml, label, combinedValue);
                if (combinedResult.success) {
                    console.log(`  📍 Found combined row with label: "${label}"`);
                    break;
                }
            }

            if (combinedResult.success) {
                slideXml = combinedResult.xml;
                console.log(`  ✅ Updated Eligibility & Last Entry Age (combined row)`);
                if (slide8Data.eligibility) {
                    results.updated.push({ field: 'Eligibility', value: slide8Data.eligibility.substring(0, 50) + '...' });
                }
                if (slide8Data.lastEntryAge) {
                    results.updated.push({ field: 'Last Entry Age', value: slide8Data.lastEntryAge });
                }
            } else {
                // Fall back to separate rows
                console.log(`  🔄 Combined row not found, trying separate rows...`);

                // Try Eligibility separately
                if (slide8Data.eligibility) {
                    const eligibilityValue = escapeXml(slide8Data.eligibility);
                    const eligibilityLabels = ['Eligibility', 'Eligibility:'];
                    let eligibilityResult = { success: false, xml: slideXml };

                    for (const label of eligibilityLabels) {
                        eligibilityResult = replaceTableCellByLabel(slideXml, label, eligibilityValue);
                        if (eligibilityResult.success) break;
                    }

                    if (eligibilityResult.success) {
                        slideXml = eligibilityResult.xml;
                        console.log(`  ✅ Updated Eligibility`);
                        results.updated.push({ field: 'Eligibility', value: slide8Data.eligibility.substring(0, 50) + '...' });
                    } else {
                        const availableLabels = eligibilityResult.availableLabels || [];
                        console.log(`  ⚠️ Eligibility row not found. Available: ${availableLabels.join(', ')}`);
                        results.errors.push({
                            field: 'Eligibility',
                            error: 'Row not found in table',
                            hint: availableLabels.length > 0 ? `Available: ${availableLabels.slice(0, 5).join(', ')}` : 'No table rows found'
                        });
                    }
                }

                // Try Last Entry Age separately
                if (slide8Data.lastEntryAge) {
                    const lastEntryAgeValue = escapeXml(slide8Data.lastEntryAge);
                    const lastEntryAgeLabels = ['Last Entry Age', 'Last Entry Age:'];
                    let lastEntryAgeResult = { success: false, xml: slideXml };

                    for (const label of lastEntryAgeLabels) {
                        lastEntryAgeResult = replaceTableCellByLabel(slideXml, label, lastEntryAgeValue);
                        if (lastEntryAgeResult.success) break;
                    }

                    if (lastEntryAgeResult.success) {
                        slideXml = lastEntryAgeResult.xml;
                        console.log(`  ✅ Updated Last Entry Age`);
                        results.updated.push({ field: 'Last Entry Age', value: slide8Data.lastEntryAge });
                    } else {
                        const availableLabels = lastEntryAgeResult.availableLabels || [];
                        console.log(`  ⚠️ Last Entry Age row not found. Available: ${availableLabels.join(', ')}`);
                        results.errors.push({
                            field: 'Last Entry Age',
                            error: 'Row not found in table',
                            hint: availableLabels.length > 0 ? `Available: ${availableLabels.slice(0, 5).join(', ')}` : 'No table rows found'
                        });
                    }
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
            console.log(`  🔍 Updating Non-evidence Limit cell with: "${nonEvidenceValue.substring(0, 50)}..."`);

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
        setSlideXML(zip, 8, slideXml);
        console.log(`📝 Slide 8 update complete: ${results.updated.length} fields updated, ${results.errors.length} errors`);

    } catch (error) {
        console.error('❌ Error updating Slide 8:', error.message);
        results.errors.push({ field: 'Slide 8', error: error.message });
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
function updateSlide9GDDTable(zip, slide9Data) {
    console.log('📝 Updating Slide 9 GDD Table...');

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
        let slideXml = getSlideXML(zip, 9);

        // 1. Update Eligibility & Last Entry Age - Template has combined row "EligibilityLast Entry Age"
        if (slide9Data.eligibility || slide9Data.lastEntryAge) {
            console.log(`  🔍 Updating Eligibility/Last Entry Age combined row...`);

            let combinedValue = '';
            if (slide9Data.eligibility) {
                combinedValue = escapeXml(slide9Data.eligibility);
            }
            if (slide9Data.lastEntryAge) {
                if (combinedValue) combinedValue += '\nLast Entry Age: ';
                combinedValue += escapeXml(slide9Data.lastEntryAge);
            }

            const combinedLabels = ['EligibilityLast Entry Age', 'Eligibility Last Entry Age', 'Eligibility/Last Entry Age'];
            let combinedResult = { success: false, xml: slideXml };

            for (const label of combinedLabels) {
                combinedResult = replaceTableCellByLabel(slideXml, label, combinedValue);
                if (combinedResult.success) {
                    console.log(`  📍 Found combined row with label: "${label}"`);
                    break;
                }
            }

            if (combinedResult.success) {
                slideXml = combinedResult.xml;
                console.log(`  ✅ Updated Eligibility & Last Entry Age (combined row)`);
                if (slide9Data.eligibility) {
                    results.updated.push({ field: 'Eligibility', value: slide9Data.eligibility.substring(0, 50) + '...' });
                }
                if (slide9Data.lastEntryAge) {
                    results.updated.push({ field: 'Last Entry Age', value: slide9Data.lastEntryAge });
                }
            } else {
                console.log(`  ⚠️ Combined row not found in Slide 9`);
                if (slide9Data.eligibility) {
                    results.errors.push({ field: 'Eligibility', error: 'Combined row not found in table' });
                }
                if (slide9Data.lastEntryAge) {
                    results.errors.push({ field: 'Last Entry Age', error: 'Combined row not found in table' });
                }
            }
        }

        // 2. Update Basis of Cover
        if (slide9Data.basisOfCover && slide9Data.basisOfCover.length > 0) {
            console.log(`  🔄 Updating Basis of Cover with ${slide9Data.basisOfCover.length} entries...`);
            let basisUpdated = false;

            const bulletContentPattern = /(<a:buChar char="•"[^>]*\/><\/a:pPr><a:r><a:rPr[^>]*b="1"[^>]*>(?:[^<]*<\/[^>]+>)*<a:t>)([^<]+)(<\/a:t><\/a:r><a:r><a:rPr[^>]*>(?:[^<]*<\/[^>]+>)*<a:t>: )([^<]+)(<\/a:t>)/g;

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
                    suffix: match[5]
                });
            }

            console.log(`  📊 Found ${matches.length} bullet points in template`);

            if (matches.length > 0) {
                for (let i = 0; i < Math.min(matches.length, slide9Data.basisOfCover.length); i++) {
                    const matchInfo = matches[i];
                    const newData = slide9Data.basisOfCover[i];
                    const newCategory = escapeXml(newData.category);
                    const newBasis = escapeXml(newData.basis);

                    const oldText = matchInfo.fullMatch;
                    const newText = `${matchInfo.prefix}${newCategory}${matchInfo.separator}${newBasis}${matchInfo.suffix}`;

                    slideXml = slideXml.replace(oldText, newText);
                    console.log(`    ✅ Bullet ${i + 1}: "${newData.category.substring(0, 30)}..."`);
                    basisUpdated = true;
                }
                results.updated.push({ field: 'Basis of Cover', value: `${slide9Data.basisOfCover.length} categories` });
            }

            if (!basisUpdated) {
                console.log(`  ⚠️ Could not find Basis of Cover patterns in Slide 9`);
                results.errors.push({ field: 'Basis of Cover', error: 'Pattern not found in template' });
            }
        }

        // 3. Update Non-evidence Limit
        if (slide9Data.nonEvidenceLimit) {
            const nonEvidenceValue = escapeXml(slide9Data.nonEvidenceLimit);
            console.log(`  🔍 Updating Non-evidence Limit cell with: "${nonEvidenceValue.substring(0, 50)}..."`);

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

        setSlideXML(zip, 9, slideXml);
        console.log(`📝 Slide 9 update complete: ${results.updated.length} fields updated, ${results.errors.length} errors`);

    } catch (error) {
        console.error('❌ Error updating Slide 9:', error.message);
        results.errors.push({ field: 'Slide 9', error: error.message });
    }

    return results;
}

/**
 * Update Slide 10 GHS table with data from placement slip
 * Structure is identical to Slides 8-9: EligibilityLast Entry Age, Basis of Cover, Non-evidence Limit
 * @param {Object} zip - PizZip instance
 * @param {Object} slide10Data - Data for slide 10 (eligibility, lastEntryAge, basisOfCover, nonEvidenceLimit)
 * @returns {Object} Results of the update operation
 */
function updateSlide10GHSTable(zip, slide10Data) {
    console.log('📝 Updating Slide 10 GHS Table...');

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
    console.log(`   - nonEvidenceLimit: "${slide10Data.nonEvidenceLimit?.substring(0, 60) || 'null'}..."`);

    try {
        let slideXml = getSlideXML(zip, 10);

        // 1. Update Eligibility & Last Entry Age - Template has combined row "EligibilityLast Entry Age"
        if (slide10Data.eligibility || slide10Data.lastEntryAge) {
            console.log(`  🔍 Updating Eligibility/Last Entry Age combined row...`);

            let combinedValue = '';
            if (slide10Data.eligibility) {
                combinedValue = escapeXml(slide10Data.eligibility);
            }
            if (slide10Data.lastEntryAge) {
                if (combinedValue) combinedValue += '\nLast Entry Age: ';
                combinedValue += escapeXml(slide10Data.lastEntryAge);
            }

            const combinedLabels = ['EligibilityLast Entry Age', 'Eligibility Last Entry Age', 'Eligibility/Last Entry Age'];
            let combinedResult = { success: false, xml: slideXml };

            for (const label of combinedLabels) {
                combinedResult = replaceTableCellByLabel(slideXml, label, combinedValue);
                if (combinedResult.success) {
                    console.log(`  📍 Found combined row with label: "${label}"`);
                    break;
                }
            }

            if (combinedResult.success) {
                slideXml = combinedResult.xml;
                console.log(`  ✅ Updated Eligibility & Last Entry Age (combined row)`);
                if (slide10Data.eligibility) {
                    results.updated.push({ field: 'Eligibility', value: slide10Data.eligibility.substring(0, 50) + '...' });
                }
                if (slide10Data.lastEntryAge) {
                    results.updated.push({ field: 'Last Entry Age', value: slide10Data.lastEntryAge });
                }
            } else {
                console.log(`  ⚠️ Combined row not found in Slide 10`);
                if (slide10Data.eligibility) {
                    results.errors.push({ field: 'Eligibility', error: 'Combined row not found in table' });
                }
                if (slide10Data.lastEntryAge) {
                    results.errors.push({ field: 'Last Entry Age', error: 'Combined row not found in table' });
                }
            }
        }

        // 2. Update Basis of Cover - GHS may have more complex multi-tier structure
        if (slide10Data.basisOfCover && slide10Data.basisOfCover.length > 0) {
            console.log(`  🔄 Updating Basis of Cover with ${slide10Data.basisOfCover.length} entries...`);
            let basisUpdated = false;

            const bulletContentPattern = /(<a:buChar char="•"[^>]*\/><\/a:pPr><a:r><a:rPr[^>]*b="1"[^>]*>(?:[^<]*<\/[^>]+>)*<a:t>)([^<]+)(<\/a:t><\/a:r><a:r><a:rPr[^>]*>(?:[^<]*<\/[^>]+>)*<a:t>: )([^<]+)(<\/a:t>)/g;

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
                    suffix: match[5]
                });
            }

            console.log(`  📊 Found ${matches.length} bullet points in template`);

            if (matches.length > 0) {
                for (let i = 0; i < Math.min(matches.length, slide10Data.basisOfCover.length); i++) {
                    const matchInfo = matches[i];
                    const newData = slide10Data.basisOfCover[i];
                    const newCategory = escapeXml(newData.category);
                    const newBasis = escapeXml(newData.basis);

                    const oldText = matchInfo.fullMatch;
                    const newText = `${matchInfo.prefix}${newCategory}${matchInfo.separator}${newBasis}${matchInfo.suffix}`;

                    slideXml = slideXml.replace(oldText, newText);
                    console.log(`    ✅ Bullet ${i + 1}: "${newData.category.substring(0, 30)}..."`);
                    basisUpdated = true;
                }
                results.updated.push({ field: 'Basis of Cover', value: `${slide10Data.basisOfCover.length} categories` });
            }

            if (!basisUpdated) {
                console.log(`  ⚠️ Could not find Basis of Cover patterns in Slide 10`);
                results.errors.push({ field: 'Basis of Cover', error: 'Pattern not found in template' });
            }
        }

        // 3. Update Non-evidence Limit (may not exist in Slide 10)
        if (slide10Data.nonEvidenceLimit) {
            const nonEvidenceValue = escapeXml(slide10Data.nonEvidenceLimit);
            console.log(`  🔍 Updating Non-evidence Limit cell with: "${nonEvidenceValue.substring(0, 50)}..."`);

            const nonEvidenceResult = replaceTableCellByLabel(slideXml, 'Non-evidence Limit', nonEvidenceValue);

            if (nonEvidenceResult.success) {
                slideXml = nonEvidenceResult.xml;
                console.log(`  ✅ Updated Non-evidence Limit`);
                results.updated.push({ field: 'Non-evidence Limit', value: slide10Data.nonEvidenceLimit.substring(0, 50) + '...' });
            } else {
                console.log(`  ⚠️ Non-evidence Limit row not found in Slide 10 (may not exist)`);
                // Don't add to errors for slide 10 as this field may not exist
            }
        }

        setSlideXML(zip, 10, slideXml);
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

    const results = {
        success: true,
        totalSlides: info.totalSlides,
        updatedSlides: [],
        errors: []
    };

    // Phase 1: Update Slide 1 - Period of Insurance
    if (placementData.periodOfInsurance) {
        const slide1Updated = updateSlide1PeriodOfInsurance(zip, placementData.periodOfInsurance);
        if (slide1Updated) {
            results.updatedSlides.push({
                slide: 1,
                field: 'Period of Insurance',
                value: placementData.periodOfInsurance.formatted
            });
        } else {
            results.errors.push({
                slide: 1,
                field: 'Period of Insurance',
                error: 'Pattern not found in slide'
            });
        }
    }

    // Phase 2: Update Slide 8 - GTL Table (Eligibility, Last Entry Age, Basis of Cover, Non-evidence Limit)
    if (placementData.slide8Data) {
        console.log('📊 Processing Slide 8 GTL data...');
        const slide8Results = updateSlide8GTLTable(zip, placementData.slide8Data);

        for (const update of slide8Results.updated) {
            results.updatedSlides.push({
                slide: 8,
                field: update.field,
                value: update.value
            });
        }

        for (const error of slide8Results.errors) {
            results.errors.push({
                slide: 8,
                field: error.field,
                error: error.error,
                hint: error.hint || null
            });
        }
    }

    // Phase 3: Update Slide 9 - GDD Table (Group Dread Disease)
    if (placementData.slide9Data) {
        console.log('📊 Processing Slide 9 GDD data...');
        const slide9Results = updateSlide9GDDTable(zip, placementData.slide9Data);

        for (const update of slide9Results.updated) {
            results.updatedSlides.push({
                slide: 9,
                field: update.field,
                value: update.value
            });
        }

        for (const error of slide9Results.errors) {
            results.errors.push({
                slide: 9,
                field: error.field,
                error: error.error,
                hint: error.hint || null
            });
        }
    }

    // Phase 4: Update Slide 10 - GHS Table (Group Hospital & Surgical)
    if (placementData.slide10Data) {
        console.log('📊 Processing Slide 10 GHS data...');
        const slide10Results = updateSlide10GHSTable(zip, placementData.slide10Data);

        for (const update of slide10Results.updated) {
            results.updatedSlides.push({
                slide: 10,
                field: update.field,
                value: update.value
            });
        }

        for (const error of slide10Results.errors) {
            results.errors.push({
                slide: 10,
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

module.exports = {
    readPPTX,
    getSlideFiles,
    getSlideXML,
    setSlideXML,
    findAndReplaceText,
    updateSlide1PeriodOfInsurance,
    updateSlide8GTLTable,
    updateSlide9GDDTable,
    updateSlide10GHSTable,
    generateBasisOfCoverParagraph,
    generateBasisOfCoverCellContent,
    escapeXml,
    findTextInSlide,
    extractTextContent,
    writePPTX,
    getPPTXInfo,
    processPPTX,
    isValidPPTXBuffer,
    inspectSlide,
    inspectSlide8Tables
};
