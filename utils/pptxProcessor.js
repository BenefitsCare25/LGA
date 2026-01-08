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
    findTextInSlide,
    extractTextContent,
    writePPTX,
    getPPTXInfo,
    processPPTX,
    isValidPPTXBuffer,
    inspectSlide
};
