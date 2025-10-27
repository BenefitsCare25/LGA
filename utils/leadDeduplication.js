/**
 * Lead Deduplication Utility
 *
 * Provides consistent deduplication logic for Apollo leads across the application.
 * Uses email as primary identifier, LinkedIn URL as secondary, and name+company as fallback.
 */

/**
 * Removes duplicate leads from an array using hierarchical identification
 *
 * Identification hierarchy:
 * 1. Email (primary) - most reliable unique identifier
 * 2. LinkedIn URL (secondary) - reliable when email is missing
 * 3. Name + Company (fallback) - last resort when both email and LinkedIn are missing
 *
 * @param {Array} leads - Array of lead objects to deduplicate
 * @param {Object} options - Configuration options
 * @param {boolean} options.debug - Enable debug logging for first 3 leads (default: false)
 * @returns {Object} - { uniqueLeads: Array, duplicatesRemoved: number, seen: Set }
 */
function deduplicateLeads(leads, options = {}) {
    const { debug = false } = options;

    const uniqueLeads = [];
    const seen = new Set();

    leads.forEach((lead, index) => {
        const email = (lead.email || '').toLowerCase().trim();
        const linkedin = (lead.linkedin_url || '').toLowerCase().trim();
        const name = (lead.name || '').toLowerCase().trim();
        const company = (lead.organization_name || lead['Company Name'] || '').toLowerCase().trim();

        let identifier;
        let identifierType;

        if (email && email !== '') {
            identifier = email;
            identifierType = 'email';
        } else if (linkedin && linkedin !== '') {
            identifier = linkedin;
            identifierType = 'linkedin';
        } else {
            identifier = `${name}|${company}`;
            identifierType = 'name+company';
        }

        // Debug first few leads if enabled
        if (debug && index < 3) {
            console.log(`🔍 Lead ${index}: ${lead.name} - ${identifierType}: "${identifier}"`);
        }

        if (!seen.has(identifier)) {
            seen.add(identifier);
            uniqueLeads.push(lead);
        } else {
            if (debug) {
                console.log(`🔄 Duplicate ${index}: ${lead.name} - ${identifierType}: "${identifier}"`);
            }
        }
    });

    const duplicatesRemoved = leads.length - uniqueLeads.length;

    return {
        uniqueLeads,
        duplicatesRemoved,
        seen // Return the Set for potential reuse
    };
}

/**
 * Creates a unique identifier for a lead using the hierarchical logic
 * Useful for single-lead identification or custom deduplication scenarios
 *
 * @param {Object} lead - Lead object
 * @returns {Object} - { identifier: string, identifierType: string }
 */
function getLeadIdentifier(lead) {
    const email = (lead.email || '').toLowerCase().trim();
    const linkedin = (lead.linkedin_url || '').toLowerCase().trim();
    const name = (lead.name || '').toLowerCase().trim();
    const company = (lead.organization_name || lead['Company Name'] || '').toLowerCase().trim();

    if (email && email !== '') {
        return { identifier: email, identifierType: 'email' };
    } else if (linkedin && linkedin !== '') {
        return { identifier: linkedin, identifierType: 'linkedin' };
    } else {
        return { identifier: `${name}|${company}`, identifierType: 'name+company' };
    }
}

module.exports = {
    deduplicateLeads,
    getLeadIdentifier
};
