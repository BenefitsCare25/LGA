/**
 * Test script for domain duplicate checking
 * Usage: node scripts/test-domain-check.js
 */

require('dotenv').config();
const DomainDuplicateChecker = require('../utils/domainDuplicateChecker');
const { getDelegatedAuthProvider } = require('../middleware/delegatedGraphAuth');
const readline = require('readline');

async function testDomainCheck() {
    try {
        console.log('🚀 Starting domain duplicate check...\n');

        // Path to the local Excel file
        const localFilePath = 'C:\\Users\\huien\\Desktop\\Domain Contact List.xlsx';

        // Get Microsoft Graph authentication provider
        console.log('🔐 Setting up Microsoft Graph authentication...');
        const authProvider = getDelegatedAuthProvider();

        // Get session ID from user
        const rl = readline.createInterface({
            input: process.stdin,
            output: process.stdout
        });

        const sessionId = await new Promise((resolve) => {
            rl.question('Enter your session ID (from browser after authentication): ', (answer) => {
                rl.close();
                resolve(answer.trim());
            });
        });

        console.log(`Using session ID: ${sessionId}`);

        // Get Microsoft Graph client
        const graphClient = await authProvider.getGraphClient(sessionId);

        if (!graphClient) {
            console.error('❌ Failed to get Microsoft Graph client');
            console.error('💡 Please authenticate via the web interface first');
            process.exit(1);
        }

        console.log('✅ Authentication successful\n');

        // Run the duplicate checker
        const checker = new DomainDuplicateChecker();
        const report = await checker.generateDuplicateReport(localFilePath, graphClient);

        // Display summary
        console.log('\n\n╔════════════════════════════════════════════╗');
        console.log('║         DOMAIN DUPLICATE REPORT           ║');
        console.log('╚════════════════════════════════════════════╝\n');

        console.log(`📁 Local File: ${report.localFile}`);
        console.log(`☁️  OneDrive File: ${report.onedriveFile}`);
        console.log(`⏰ Timestamp: ${new Date(report.timestamp).toLocaleString()}\n`);

        console.log('📊 STATISTICS:');
        console.log(`   Total domains in local file: ${report.totalLocalDomains}`);
        console.log(`   Total domains in OneDrive: ${report.totalOneDriveDomains}`);
        console.log(`   Duplicate domains: ${report.duplicateCount}`);
        console.log(`   Unique to local: ${report.uniqueToLocalCount}`);
        console.log(`   Unique to OneDrive: ${report.uniqueToOneDriveCount}\n`);

        // Save report to file
        const fs = require('fs');
        const path = require('path');
        const reportDir = path.join(__dirname, '..', 'reports');

        // Create reports directory if it doesn't exist
        if (!fs.existsSync(reportDir)) {
            fs.mkdirSync(reportDir, { recursive: true });
        }

        const reportFileName = `domain-duplicate-report-${Date.now()}.json`;
        const reportPath = path.join(reportDir, reportFileName);

        fs.writeFileSync(reportPath, JSON.stringify(report, null, 2));

        console.log(`💾 Full report saved to: ${reportPath}\n`);

        // Display duplicates if any
        if (report.duplicateCount > 0) {
            console.log('⚠️  DUPLICATE DOMAINS (showing first 50):');
            report.duplicates.slice(0, 50).forEach((domain, index) => {
                console.log(`   ${(index + 1).toString().padStart(3)}. ${domain}`);
            });
            if (report.duplicateCount > 50) {
                console.log(`   ... and ${report.duplicateCount - 50} more duplicates`);
            }
        } else {
            console.log('✅ NO DUPLICATES FOUND - All domains are unique!');
        }

        console.log('\n✅ Domain duplicate check completed successfully');

    } catch (error) {
        console.error('\n❌ Error during domain duplicate check:');
        console.error(error);
        process.exit(1);
    }
}

// Run the test
testDomainCheck();
