/**
 * Domain Duplicate Checker
 * Compares domains from local Excel file with OneDrive master Excel file
 */

const XLSX = require('xlsx');
const { getLeadsViaGraphAPI } = require('./excelGraphAPI');

class DomainDuplicateChecker {
    constructor() {
        this.localDomains = new Set();
        this.onedriveDomains = new Set();
        this.duplicates = [];
    }

    /**
     * Extract domain from email address
     * @param {string} email - Email address
     * @returns {string|null} Domain or null
     */
    extractDomain(email) {
        if (!email || typeof email !== 'string') return null;

        // Clean up the email
        const cleaned = email.toLowerCase().trim();

        // Handle email format (user@domain.com)
        if (cleaned.includes('@')) {
            const domain = cleaned.split('@')[1];
            return domain || null;
        }

        // Handle direct domain format (domain.com)
        if (cleaned.includes('.')) {
            return cleaned;
        }

        return null;
    }

    /**
     * Read local Excel file and extract domains
     * @param {string} filePath - Path to local Excel file
     * @returns {Promise<Array>} Array of unique domains
     */
    async readLocalExcelDomains(filePath) {
        try {
            console.log(`📂 Reading local Excel file: ${filePath}`);

            const workbook = XLSX.readFile(filePath);
            const domains = new Set();

            // Process all sheets
            for (const sheetName of workbook.SheetNames) {
                console.log(`📊 Processing sheet: "${sheetName}"`);
                const worksheet = workbook.Sheets[sheetName];
                const data = XLSX.utils.sheet_to_json(worksheet);

                if (data.length === 0) {
                    console.log(`⚠️ Sheet "${sheetName}" is empty, skipping...`);
                    continue;
                }

                // Log available headers for debugging
                const headers = Object.keys(data[0] || {});
                console.log(`📋 Available columns: ${headers.join(', ')}`);

                // Check if this looks like the Domain Contact List format
                const hasEmptyColumn = headers.some(h => h.includes('__EMPTY'));
                const hasContactColumn = headers.some(h => h.toLowerCase().includes('contact'));

                if (hasEmptyColumn && hasContactColumn) {
                    console.log(`✅ Detected Domain Contact List format`);

                    // Skip first row (header row: "Entity", "domain Email Address")
                    const dataRows = data.slice(1);
                    console.log(`📊 Processing ${dataRows.length} data rows (skipped header)`);

                    dataRows.forEach((row, index) => {
                        // Find the __EMPTY column (contains domain emails)
                        const emptyCol = headers.find(h => h.includes('__EMPTY'));
                        const domainValue = row[emptyCol];

                        if (domainValue && typeof domainValue === 'string') {
                            // Split by newlines to handle multiple domains per cell
                            const domainLines = domainValue.split(/[\r\n]+/).map(line => line.trim()).filter(line => line);

                            domainLines.forEach(line => {
                                // Remove @ symbol and clean up
                                const cleaned = line.replace(/^@+/, '').trim();

                                if (cleaned && cleaned.includes('.') && !cleaned.includes(' ')) {
                                    domains.add(cleaned.toLowerCase());
                                }
                            });
                        }
                    });
                } else {
                    // Fallback to generic domain extraction
                    console.log(`⚠️ Using generic domain extraction`);

                    // Find domain-related columns
                    const domainColumns = headers.filter(header => {
                        const lowerHeader = header.toLowerCase();
                        return lowerHeader.includes('domain') ||
                               lowerHeader.includes('email') ||
                               header.includes('__EMPTY');
                    });

                    console.log(`🔍 Domain-related columns found: ${domainColumns.join(', ')}`);

                    // Extract domains from all domain-related columns
                    data.forEach((row, index) => {
                        domainColumns.forEach(col => {
                            const value = row[col];
                            if (value) {
                                // Handle multiple domains in one cell (comma, newline, space separated)
                                const values = String(value).split(/[\r\n,;\s]+/);

                                values.forEach(val => {
                                    const domain = this.extractDomain(val.trim());
                                    if (domain) {
                                        domains.add(domain);
                                    }
                                });
                            }
                        });
                    });
                }
            }

            const uniqueDomains = Array.from(domains).sort();
            console.log(`✅ Extracted ${uniqueDomains.length} unique domains from local file`);

            return uniqueDomains;

        } catch (error) {
            console.error('❌ Error reading local Excel file:', error.message);
            throw error;
        }
    }

    /**
     * Get domains from OneDrive Excel file via Microsoft Graph API
     * @param {object} graphClient - Microsoft Graph client
     * @returns {Promise<Array>} Array of unique domains
     */
    async getOneDriveDomains(graphClient) {
        try {
            console.log(`📂 Fetching OneDrive Excel data via Microsoft Graph API...`);

            const leads = await getLeadsViaGraphAPI(graphClient);

            if (!leads || leads.length === 0) {
                console.log(`⚠️ No leads found in OneDrive Excel file`);
                return [];
            }

            console.log(`📊 Processing ${leads.length} leads from OneDrive`);

            const domains = new Set();

            leads.forEach(lead => {
                // Extract domain from email field
                const email = lead.Email || lead.email || '';
                const domain = this.extractDomain(email);

                if (domain) {
                    domains.add(domain);
                }

                // Also check Company Website field for domains
                const website = lead['Company Website'] || lead.website || '';
                if (website) {
                    const websiteDomain = this.extractDomain(
                        website.replace(/^https?:\/\//, '').replace(/^www\./, '').split('/')[0]
                    );
                    if (websiteDomain) {
                        domains.add(websiteDomain);
                    }
                }
            });

            const uniqueDomains = Array.from(domains).sort();
            console.log(`✅ Extracted ${uniqueDomains.length} unique domains from OneDrive`);

            return uniqueDomains;

        } catch (error) {
            console.error('❌ Error fetching OneDrive domains:', error.message);
            throw error;
        }
    }

    /**
     * Compare domains and find duplicates
     * @param {Array} localDomains - Domains from local file
     * @param {Array} onedriveDomains - Domains from OneDrive
     * @returns {object} Comparison results
     */
    compareDomains(localDomains, onedriveDomains) {
        console.log(`🔍 Comparing ${localDomains.length} local domains with ${onedriveDomains.length} OneDrive domains...`);

        const localSet = new Set(localDomains.map(d => d.toLowerCase()));
        const onedriveSet = new Set(onedriveDomains.map(d => d.toLowerCase()));

        const duplicates = [];
        const uniqueToLocal = [];
        const uniqueToOneDrive = [];

        // Find duplicates and unique to local
        localDomains.forEach(domain => {
            const lowerDomain = domain.toLowerCase();
            if (onedriveSet.has(lowerDomain)) {
                duplicates.push(domain);
            } else {
                uniqueToLocal.push(domain);
            }
        });

        // Find unique to OneDrive
        onedriveDomains.forEach(domain => {
            const lowerDomain = domain.toLowerCase();
            if (!localSet.has(lowerDomain)) {
                uniqueToOneDrive.push(domain);
            }
        });

        const results = {
            totalLocalDomains: localDomains.length,
            totalOneDriveDomains: onedriveDomains.length,
            duplicateCount: duplicates.length,
            duplicates: duplicates.sort(),
            uniqueToLocalCount: uniqueToLocal.length,
            uniqueToLocal: uniqueToLocal.sort(),
            uniqueToOneDriveCount: uniqueToOneDrive.length,
            uniqueToOneDrive: uniqueToOneDrive.sort()
        };

        console.log(`\n📊 COMPARISON RESULTS:`);
        console.log(`   Total local domains: ${results.totalLocalDomains}`);
        console.log(`   Total OneDrive domains: ${results.totalOneDriveDomains}`);
        console.log(`   Duplicates found: ${results.duplicateCount}`);
        console.log(`   Unique to local file: ${results.uniqueToLocalCount}`);
        console.log(`   Unique to OneDrive: ${results.uniqueToOneDriveCount}`);

        return results;
    }

    /**
     * Generate detailed duplicate report
     * @param {string} localFilePath - Path to local Excel file
     * @param {object} graphClient - Microsoft Graph client
     * @returns {Promise<object>} Detailed comparison report
     */
    async generateDuplicateReport(localFilePath, graphClient) {
        try {
            console.log(`\n🔍 DOMAIN DUPLICATE CHECKER STARTING...`);
            console.log(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n`);

            // Step 1: Read local file
            const localDomains = await this.readLocalExcelDomains(localFilePath);

            console.log(`\n`);

            // Step 2: Get OneDrive domains
            const onedriveDomains = await this.getOneDriveDomains(graphClient);

            console.log(`\n`);

            // Step 3: Compare
            const comparison = this.compareDomains(localDomains, onedriveDomains);

            console.log(`\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);

            // Generate detailed report
            const report = {
                timestamp: new Date().toISOString(),
                localFile: localFilePath,
                onedriveFile: 'LGA-Master-Email-List.xlsx',
                ...comparison
            };

            // Display duplicates if any
            if (comparison.duplicateCount > 0) {
                console.log(`\n⚠️ DUPLICATE DOMAINS FOUND:\n`);
                comparison.duplicates.slice(0, 20).forEach((domain, index) => {
                    console.log(`   ${index + 1}. ${domain}`);
                });
                if (comparison.duplicateCount > 20) {
                    console.log(`   ... and ${comparison.duplicateCount - 20} more`);
                }
            } else {
                console.log(`\n✅ NO DUPLICATES FOUND - All domains are unique!`);
            }

            return report;

        } catch (error) {
            console.error('❌ Error generating duplicate report:', error.message);
            throw error;
        }
    }
}

module.exports = DomainDuplicateChecker;
