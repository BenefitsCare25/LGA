/**
 * Slide Detector Module
 * Detects slide positions by content patterns instead of hardcoded slide numbers
 * Uses multi-signal fingerprinting with confidence scoring
 */

const fs = require('fs');
const path = require('path');

// Load signature configuration
const signaturesPath = path.join(__dirname, '..', 'config', 'slideSignatures.json');
let signaturesConfig = null;

/**
 * Load or reload signatures configuration
 * @returns {Object} Signatures configuration
 */
function loadSignatures() {
    if (!signaturesConfig) {
        try {
            const configContent = fs.readFileSync(signaturesPath, 'utf8');
            signaturesConfig = JSON.parse(configContent);
            console.log(`📋 Loaded ${Object.keys(signaturesConfig.signatures).length} slide signatures`);
        } catch (error) {
            console.error('❌ Failed to load slide signatures:', error.message);
            throw new Error(`Failed to load slide signatures: ${error.message}`);
        }
    }
    return signaturesConfig;
}

/**
 * Extract all text content from slide XML
 * @param {string} xml - Slide XML content
 * @returns {string[]} Array of text elements
 */
function extractTextContent(xml) {
    const textPattern = /<a:t>([^<]*)<\/a:t>/g;
    const texts = [];
    let match;

    while ((match = textPattern.exec(xml)) !== null) {
        if (match[1].trim()) {
            texts.push(match[1].trim());
        }
    }

    return texts;
}

/**
 * Extract all text from a slide as a single concatenated string
 * @param {Object} zip - PizZip instance
 * @param {number} slideNumber - Slide number (1-indexed)
 * @returns {Object} Slide data with text content
 */
function extractSlideData(zip, slideNumber) {
    const slidePath = `ppt/slides/slide${slideNumber}.xml`;
    const file = zip.file(slidePath);

    if (!file) {
        return null;
    }

    const xml = file.asText();
    const textElements = extractTextContent(xml);
    const allText = textElements.join(' ');

    return {
        slideNumber,
        xml,
        textElements,
        allText,
        allTextLower: allText.toLowerCase()
    };
}

/**
 * Extract data from all slides in the presentation
 * @param {Object} zip - PizZip instance
 * @returns {Object} Map of slide numbers to slide data
 */
function extractAllSlideData(zip) {
    const slideData = {};
    const files = Object.keys(zip.files);

    // Find all slide files
    const slideFiles = files.filter(f => f.match(/^ppt\/slides\/slide\d+\.xml$/));

    for (const slideFile of slideFiles) {
        const slideNum = parseInt(slideFile.match(/slide(\d+)\.xml/)[1]);
        const data = extractSlideData(zip, slideNum);
        if (data) {
            slideData[slideNum] = data;
        }
    }

    console.log(`📊 Extracted data from ${Object.keys(slideData).length} slides`);
    return slideData;
}

/**
 * Check if text matches a pattern (case-insensitive, word boundary aware)
 * @param {string} text - Text to search in
 * @param {string} pattern - Pattern to match
 * @returns {boolean} True if pattern matches
 */
function matchPattern(text, pattern) {
    const textLower = text.toLowerCase();
    const patternLower = pattern.toLowerCase();

    // Check for exact phrase match (word boundaries)
    const escapedPattern = patternLower.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const regex = new RegExp(`\\b${escapedPattern}\\b`, 'i');

    return regex.test(text);
}

/**
 * Score how well a slide matches a signature
 * @param {Object} slideData - Slide data with text content
 * @param {Object} signature - Signature definition
 * @returns {Object} Score details
 */
function scoreSlideMatch(slideData, signature) {
    let score = 0;
    const maxScore = 100;
    const details = {
        primaryMatches: [],
        secondaryMatches: [],
        uniqueMatches: [],
        excludeMatches: []
    };

    // Primary pattern match (50 points max)
    const primaryPatterns = signature.primaryPatterns || [];
    for (const pattern of primaryPatterns) {
        if (matchPattern(slideData.allText, pattern)) {
            details.primaryMatches.push(pattern);
        }
    }
    if (details.primaryMatches.length > 0) {
        score += 50;
    }

    // Secondary signals (30 points max, proportional to matches)
    const secondarySignals = signature.secondarySignals || [];
    for (const signal of secondarySignals) {
        if (slideData.allTextLower.includes(signal.toLowerCase())) {
            details.secondaryMatches.push(signal);
        }
    }
    if (secondarySignals.length > 0) {
        const secondaryRatio = details.secondaryMatches.length / secondarySignals.length;
        score += Math.round(secondaryRatio * 30);
    }

    // Unique signals bonus (20 points max - helps differentiate similar slides)
    const uniqueSignals = signature.uniqueSignals || [];
    for (const signal of uniqueSignals) {
        if (slideData.allTextLower.includes(signal.toLowerCase())) {
            details.uniqueMatches.push(signal);
        }
    }
    if (uniqueSignals.length > 0 && details.uniqueMatches.length > 0) {
        const uniqueRatio = details.uniqueMatches.length / uniqueSignals.length;
        score += Math.round(uniqueRatio * 20);
    } else if (uniqueSignals.length === 0) {
        // No unique signals defined, award full points if primary matched
        if (details.primaryMatches.length > 0) {
            score += 20;
        }
    }

    // Exclude patterns (disqualify if matched)
    const excludePatterns = signature.excludePatterns || [];
    for (const pattern of excludePatterns) {
        if (matchPattern(slideData.allText, pattern)) {
            details.excludeMatches.push(pattern);
        }
    }
    if (details.excludeMatches.length > 0) {
        score = Math.max(0, score - 40); // Heavy penalty for exclude matches
    }

    const confidence = score / maxScore;

    return {
        score,
        maxScore,
        confidence,
        details
    };
}

/**
 * Detect slide positions based on content signatures
 * @param {Object} zip - PizZip instance
 * @returns {Object} Detection results with slide map and warnings
 */
function detectSlidePositions(zip) {
    const config = loadSignatures();
    const slideData = extractAllSlideData(zip);
    const signatures = config.signatures;
    const thresholds = config.confidenceThresholds;

    const slideMap = {};
    const warnings = [];
    const detectionResults = {};

    // First pass: Score all slides against all signatures
    const allScores = {};
    for (const [slideType, signature] of Object.entries(signatures)) {
        allScores[slideType] = {};
        for (const [slideNum, data] of Object.entries(slideData)) {
            const scoreResult = scoreSlideMatch(data, signature);
            allScores[slideType][slideNum] = scoreResult;
        }
    }

    // Second pass: Find best match for each signature, respecting groups
    const assignedSlides = new Set();
    const groupAssignments = {};

    // Process signatures by group to maintain sequence order
    for (const [groupName, slideTypes] of Object.entries(config.groups)) {
        // Sort by sequence order if defined
        const sortedTypes = [...slideTypes].sort((a, b) => {
            const sigA = signatures[a];
            const sigB = signatures[b];
            return (sigA.sequenceOrder || 0) - (sigB.sequenceOrder || 0);
        });

        for (const slideType of sortedTypes) {
            const signature = signatures[slideType];
            const scores = allScores[slideType];

            // Find best unassigned slide
            let bestMatch = {
                slideNum: signature.fallbackPosition,
                confidence: 0,
                usedFallback: true,
                details: null
            };

            for (const [slideNum, scoreResult] of Object.entries(scores)) {
                const slideNumInt = parseInt(slideNum);

                // Skip already assigned slides
                if (assignedSlides.has(slideNumInt)) continue;

                // Check if this is a better match
                if (scoreResult.confidence > bestMatch.confidence) {
                    bestMatch = {
                        slideNum: slideNumInt,
                        confidence: scoreResult.confidence,
                        usedFallback: false,
                        details: scoreResult.details
                    };
                }
            }

            // Apply confidence thresholds
            if (bestMatch.confidence < thresholds.medium) {
                // Low confidence - use fallback
                bestMatch.slideNum = signature.fallbackPosition;
                bestMatch.usedFallback = true;

                warnings.push({
                    slideType,
                    displayName: signature.displayName,
                    message: `${signature.displayName} could not be detected (confidence: ${Math.round(bestMatch.confidence * 100)}%). Using fallback position: Slide ${signature.fallbackPosition}`,
                    confidence: bestMatch.confidence,
                    fallbackPosition: signature.fallbackPosition
                });
            } else if (bestMatch.confidence < thresholds.high) {
                // Medium confidence - use detected but warn
                warnings.push({
                    slideType,
                    displayName: signature.displayName,
                    message: `${signature.displayName} detected with medium confidence (${Math.round(bestMatch.confidence * 100)}%) at Slide ${bestMatch.slideNum}`,
                    confidence: bestMatch.confidence,
                    detectedPosition: bestMatch.slideNum
                });
            }

            // Mark slide as assigned (unless using fallback for an already-assigned slide)
            if (!bestMatch.usedFallback) {
                assignedSlides.add(bestMatch.slideNum);
            }

            // Store results
            slideMap[slideType] = bestMatch.slideNum;
            detectionResults[slideType] = {
                detected: !bestMatch.usedFallback,
                slideNum: bestMatch.slideNum,
                confidence: bestMatch.confidence,
                usedFallback: bestMatch.usedFallback,
                details: bestMatch.details
            };

            // Track group assignments
            if (!groupAssignments[groupName]) {
                groupAssignments[groupName] = [];
            }
            groupAssignments[groupName].push({
                slideType,
                slideNum: bestMatch.slideNum
            });
        }
    }

    // Log detection summary
    console.log('\n📍 Slide Detection Results:');
    for (const [slideType, result] of Object.entries(detectionResults)) {
        const status = result.detected ? '✅' : '⚠️';
        const fallbackNote = result.usedFallback ? ' (fallback)' : '';
        console.log(`  ${status} ${slideType}: Slide ${result.slideNum} (${Math.round(result.confidence * 100)}% confidence)${fallbackNote}`);
    }

    if (warnings.length > 0) {
        console.log(`\n⚠️ ${warnings.length} detection warning(s)`);
    }

    return {
        slideMap,
        detectionResults,
        warnings,
        totalSlides: Object.keys(slideData).length
    };
}

/**
 * Get slide number for a specific slide type
 * @param {Object} slideMap - Slide map from detectSlidePositions
 * @param {string} slideType - Slide type identifier
 * @param {number} fallbackPosition - Fallback position if not found
 * @returns {number} Slide number
 */
function getSlideNumber(slideMap, slideType, fallbackPosition) {
    if (slideMap && slideMap[slideType] !== undefined) {
        return slideMap[slideType];
    }
    console.warn(`⚠️ Slide type ${slideType} not found in map, using fallback: ${fallbackPosition}`);
    return fallbackPosition;
}

/**
 * Get data key for a slide type (maps to placementData property)
 * @param {string} slideType - Slide type identifier
 * @returns {string|null} Data key or null if not found
 */
function getDataKey(slideType) {
    const config = loadSignatures();
    const signature = config.signatures[slideType];
    return signature ? signature.dataKey : null;
}

/**
 * Get all slide types for a specific group
 * @param {string} groupName - Group name (e.g., 'GHS', 'GMM')
 * @returns {string[]} Array of slide type identifiers
 */
function getGroupSlideTypes(groupName) {
    const config = loadSignatures();
    return config.groups[groupName] || [];
}

/**
 * Validate that all required slides were detected
 * @param {Object} detectionResults - Detection results from detectSlidePositions
 * @param {string[]} requiredSlideTypes - Array of required slide type identifiers
 * @returns {Object} Validation result with missing slides
 */
function validateDetection(detectionResults, requiredSlideTypes) {
    const missing = [];
    const lowConfidence = [];

    for (const slideType of requiredSlideTypes) {
        const result = detectionResults[slideType];
        if (!result) {
            missing.push(slideType);
        } else if (result.usedFallback) {
            lowConfidence.push({
                slideType,
                confidence: result.confidence
            });
        }
    }

    return {
        valid: missing.length === 0,
        missing,
        lowConfidence,
        message: missing.length > 0
            ? `Missing slide types: ${missing.join(', ')}`
            : lowConfidence.length > 0
                ? `Low confidence detection for: ${lowConfidence.map(l => l.slideType).join(', ')}`
                : 'All required slides detected successfully'
    };
}

module.exports = {
    loadSignatures,
    extractTextContent,
    extractSlideData,
    extractAllSlideData,
    detectSlidePositions,
    getSlideNumber,
    getDataKey,
    getGroupSlideTypes,
    validateDetection
};
