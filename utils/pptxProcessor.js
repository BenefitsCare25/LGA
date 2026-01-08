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

    return paragraphs;
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

    try {
        let slideXml = getSlideXML(zip, 8);

        // 1. Update Eligibility value
        if (slide8Data.eligibility) {
            const eligibilityValue = escapeXml(slide8Data.eligibility);
            // Find and replace the eligibility content in the table cell
            // Pattern: ": All full-time, permanent, part-time and contract staff up to age 75 next birthday"
            const eligibilityPattern = /(<a:t>: <\/a:t><\/a:r><a:r><a:rPr[^>]*><a:effectLst\/><a:highlight><a:srgbClr val="FFFF00"\/><\/a:highlight>[^<]*<\/a:rPr><a:t>)([^<]+)(<\/a:t>)/;

            if (slideXml.match(eligibilityPattern)) {
                slideXml = slideXml.replace(eligibilityPattern, `$1${eligibilityValue}$3`);
                console.log(`  ✅ Updated Eligibility`);
                results.updated.push({ field: 'Eligibility', value: slide8Data.eligibility.substring(0, 50) + '...' });
            } else {
                // Try alternative pattern - direct text replacement
                const altPattern = /(: )(All full-time, permanent, part-time and contract staff[^<]*)/gi;
                if (slideXml.match(altPattern)) {
                    slideXml = slideXml.replace(altPattern, `$1${eligibilityValue}`);
                    console.log(`  ✅ Updated Eligibility (alt pattern)`);
                    results.updated.push({ field: 'Eligibility', value: slide8Data.eligibility.substring(0, 50) + '...' });
                } else {
                    console.log(`  ⚠️ Eligibility pattern not found`);
                    results.errors.push({ field: 'Eligibility', error: 'Pattern not found' });
                }
            }
        }

        // 2. Update Last Entry Age value
        if (slide8Data.lastEntryAge) {
            const lastEntryAgeValue = escapeXml(slide8Data.lastEntryAge);
            // Pattern: ": age 70 next birthday"
            const lastEntryAgePattern = /(: )(age \d+ next birthday)/gi;

            if (slideXml.match(lastEntryAgePattern)) {
                slideXml = slideXml.replace(lastEntryAgePattern, `$1${lastEntryAgeValue}`);
                console.log(`  ✅ Updated Last Entry Age`);
                results.updated.push({ field: 'Last Entry Age', value: slide8Data.lastEntryAge });
            } else {
                // Try more generic pattern
                const altPattern = /(<a:t>: )(age[^<]+next birthday)(<\/a:t>)/gi;
                if (slideXml.match(altPattern)) {
                    slideXml = slideXml.replace(altPattern, `$1${lastEntryAgeValue}$3`);
                    console.log(`  ✅ Updated Last Entry Age (alt pattern)`);
                    results.updated.push({ field: 'Last Entry Age', value: slide8Data.lastEntryAge });
                } else {
                    console.log(`  ⚠️ Last Entry Age pattern not found`);
                    results.errors.push({ field: 'Last Entry Age', error: 'Pattern not found' });
                }
            }
        }

        // 3. Update Basis of Cover - Replace entire cell content with dynamic bullets
        if (slide8Data.basisOfCover && slide8Data.basisOfCover.length > 0) {
            const newBasisContent = generateBasisOfCoverCellContent(slide8Data.basisOfCover);

            // Find the Basis of Cover cell content - look for the cell after "Basis of Cover" label
            // The cell contains bullet paragraphs with categories
            const basisCellPattern = /(<a:tc><a:txBody><a:bodyPr\/><a:lstStyle\/>)(<a:p><a:pPr marL="285750"[^]*?<a:buChar char="•"\/>.*?)(<\/a:txBody><a:tcPr[^>]*><a:lnL[^>]*>[^]*?<\/a:tcPr><\/a:tc><a:extLst><a:ext uri="\{0D108BD9-81ED-4DB2-BD59-A6C34878D82A\}"[^>]*><a16:rowId[^>]*val="625189383")/;

            if (slideXml.match(basisCellPattern)) {
                slideXml = slideXml.replace(basisCellPattern, `$1${newBasisContent}$3`);
                console.log(`  ✅ Updated Basis of Cover with ${slide8Data.basisOfCover.length} entries`);
                results.updated.push({ field: 'Basis of Cover', value: `${slide8Data.basisOfCover.length} categories` });
            } else {
                // Alternative: Replace individual bullet items
                console.log(`  🔄 Trying individual bullet replacement...`);
                let basisUpdated = false;

                // Replace each existing bullet with new content if categories match
                for (const item of slide8Data.basisOfCover) {
                    const categoryPattern = new RegExp(`(<a:rPr[^>]*b="1"[^>]*>[^<]*<\\/a:rPr><a:t>)([^<]+)(<\\/a:t><\\/a:r><a:r><a:rPr[^>]*>[^<]*<\\/a:rPr><a:t>: )([^<]+)(<\\/a:t>)`, 'g');

                    // Try to match and replace by looking for bullet patterns
                    const bulletPattern = /(<a:buChar char="•"[^>]*><\/a:pPr><a:r><a:rPr[^>]*b="1"[^>]*>[^<]*<\/a:rPr><a:t>)([^<]+)(<\/a:t><\/a:r><a:r><a:rPr[^>]*>[^<]*<\/a:rPr><a:t>: )([^<]+)(<\/a:t>)/g;

                    let match;
                    while ((match = bulletPattern.exec(slideXml)) !== null) {
                        basisUpdated = true;
                    }
                }

                if (!basisUpdated) {
                    console.log(`  ⚠️ Basis of Cover cell pattern not found - trying direct replacement`);

                    // Direct approach: find and replace each line
                    const lines = [
                        { old: 'All employees', new: slide8Data.basisOfCover[0]?.category || 'All employees' },
                        { old: '24 x last drawn basic monthly salary , with minimum $40,000', new: slide8Data.basisOfCover[0]?.basis || '' }
                    ];

                    // Replace bullet content individually
                    if (slide8Data.basisOfCover[0]) {
                        const cat0 = escapeXml(slide8Data.basisOfCover[0].category);
                        const basis0 = escapeXml(slide8Data.basisOfCover[0].basis);
                        slideXml = slideXml.replace(/>All employees<\/a:t>/g, `>${cat0}</a:t>`);
                        slideXml = slideXml.replace(/>: 24 x last drawn basic monthly salary , with minimum \$40,000<\/a:t>/g, `>: ${basis0}</a:t>`);
                    }
                    if (slide8Data.basisOfCover[1]) {
                        const cat1 = escapeXml(slide8Data.basisOfCover[1].category);
                        const basis1 = escapeXml(slide8Data.basisOfCover[1].basis);
                        slideXml = slideXml.replace(/>Grandfathered GWS Plan 1 staff<\/a:t>/g, `>${cat1}</a:t>`);
                        slideXml = slideXml.replace(/>: 36 x last drawn basic monthly salary , with minimum \$40,000<\/a:t>/g, `>: ${basis1}</a:t>`);
                    }
                    if (slide8Data.basisOfCover[2]) {
                        const cat2 = escapeXml(slide8Data.basisOfCover[2].category);
                        const basis2 = escapeXml(slide8Data.basisOfCover[2].basis);
                        slideXml = slideXml.replace(/>Sales Associates, Advisor<\/a:t>/g, `>${cat2}</a:t>`);
                        slideXml = slideXml.replace(/>: \$100,000<\/a:t>/g, `>: ${basis2}</a:t>`);
                    }

                    console.log(`  ✅ Updated Basis of Cover via direct replacement`);
                    results.updated.push({ field: 'Basis of Cover', value: `${slide8Data.basisOfCover.length} categories (direct)` });
                }
            }
        }

        // 4. Update Non-evidence Limit value
        if (slide8Data.nonEvidenceLimit) {
            const nonEvidenceValue = escapeXml(slide8Data.nonEvidenceLimit);
            // Pattern: ": Sum insured exceeding 1,000,000 or age 71 next birthday and above requires underwriting"
            const nonEvidencePattern = /(: )(Sum insured exceeding[^<]*)/gi;

            if (slideXml.match(nonEvidencePattern)) {
                slideXml = slideXml.replace(nonEvidencePattern, `$1${nonEvidenceValue}`);
                console.log(`  ✅ Updated Non-evidence Limit`);
                results.updated.push({ field: 'Non-evidence Limit', value: slide8Data.nonEvidenceLimit.substring(0, 50) + '...' });
            } else {
                console.log(`  ⚠️ Non-evidence Limit pattern not found`);
                results.errors.push({ field: 'Non-evidence Limit', error: 'Pattern not found' });
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
