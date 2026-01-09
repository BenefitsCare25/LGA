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

    while ((match = rowPattern.exec(xml)) !== null) {
        rowIndex++;
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

        // Need at least 2 cells (label + value)
        if (cells.length < 2) continue;

        // Extract text from first cell (label cell)
        const labelCell = cells[0].content;
        const textPattern = /<a:t>([^<]*)<\/a:t>/g;
        let labelCellText = '';
        let textMatch;

        while ((textMatch = textPattern.exec(labelCell)) !== null) {
            labelCellText += textMatch[1];
        }

        // Normalize label cell text for comparison
        const normalizedLabel = labelCellText.toLowerCase().trim();

        // More precise matching: check if the cell text STARTS WITH or EQUALS the label
        // This prevents "Eligibility" from matching "Eligibility Date"
        const isExactMatch = normalizedLabel === labelLower ||
                            normalizedLabel === labelLower + ':' ||
                            normalizedLabel.startsWith(labelLower + ' ') ||
                            normalizedLabel.startsWith(labelLower + ':');

        if (isExactMatch) {
            console.log(`    📍 Row ${rowIndex}: Found exact match for "${labelText}" - cell text: "${labelCellText.trim()}"`);

            // Get the value cell (second cell)
            const valueCell = cells[1];
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
                    const newRowContent = rowContent.replace(valueCell.full, newValueCell);
                    const newFullRow = fullRow.replace(rowContent, newRowContent);

                    // Replace in the XML
                    updatedXml = updatedXml.replace(fullRow, newFullRow);
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

    return { xml: updatedXml, success };
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

        // 1. Update Eligibility value using cell-based mapping
        if (slide8Data.eligibility) {
            const eligibilityValue = escapeXml(slide8Data.eligibility);
            console.log(`  🔍 Updating Eligibility cell with: "${eligibilityValue.substring(0, 50)}..."`);

            // Find row with "Eligibility" label and replace value in adjacent cell
            const eligibilityResult = replaceTableCellByLabel(slideXml, 'Eligibility', eligibilityValue);

            if (eligibilityResult.success) {
                slideXml = eligibilityResult.xml;
                console.log(`  ✅ Updated Eligibility`);
                results.updated.push({ field: 'Eligibility', value: slide8Data.eligibility.substring(0, 50) + '...' });
            } else {
                console.log(`  ⚠️ Eligibility row not found in table`);
                results.errors.push({ field: 'Eligibility', error: 'Row not found in table' });
            }
        }

        // 2. Update Last Entry Age value using cell-based mapping
        if (slide8Data.lastEntryAge) {
            const lastEntryAgeValue = escapeXml(slide8Data.lastEntryAge);
            console.log(`  🔍 Updating Last Entry Age cell with: "${lastEntryAgeValue}"`);

            // Find row with "Last Entry Age" label and replace value in adjacent cell
            const lastEntryAgeResult = replaceTableCellByLabel(slideXml, 'Last Entry Age', lastEntryAgeValue);

            if (lastEntryAgeResult.success) {
                slideXml = lastEntryAgeResult.xml;
                console.log(`  ✅ Updated Last Entry Age`);
                results.updated.push({ field: 'Last Entry Age', value: slide8Data.lastEntryAge });
            } else {
                console.log(`  ⚠️ Last Entry Age row not found in table`);
                results.errors.push({ field: 'Last Entry Age', error: 'Row not found in table' });
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
                error: error.error
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

module.exports = {
    readPPTX,
    getSlideFiles,
    getSlideXML,
    setSlideXML,
    findAndReplaceText,
    updateSlide1PeriodOfInsurance,
    updateSlide8GTLTable,
    generateBasisOfCoverParagraph,
    generateBasisOfCoverCellContent,
    escapeXml,
    findTextInSlide,
    extractTextContent,
    writePPTX,
    getPPTXInfo,
    processPPTX,
    isValidPPTXBuffer,
    inspectSlide
};
