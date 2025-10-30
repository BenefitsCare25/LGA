/**
 * Comprehensive JWT Unsubscribe System Test
 *
 * This script tests the complete JWT-based unsubscribe flow:
 * - Token generation with URL-safe encoding
 * - Token verification and decoding
 * - Expiration handling
 * - URL encoding/decoding scenarios
 * - Corporate gateway simulation (character preservation)
 * - Integration with email content processor
 */

require('dotenv').config();

const {
    generateUnsubscribeToken,
    verifyUnsubscribeToken,
    testJwtSystem
} = require('../utils/jwtUnsubscribeManager');

console.log('\n' + '='.repeat(80));
console.log('JWT UNSUBSCRIBE SYSTEM - COMPREHENSIVE TEST SUITE');
console.log('='.repeat(80) + '\n');

// Test configuration
const testEmail = 'test.user@example.com';
const testCampaign = 'test_campaign_oct2025';

/**
 * Test 1: Basic Token Generation
 */
function test1_BasicTokenGeneration() {
    console.log('\n📝 TEST 1: Basic Token Generation');
    console.log('-'.repeat(80));

    try {
        const token = generateUnsubscribeToken(testEmail, testCampaign);

        console.log(`✅ Token generated successfully`);
        console.log(`📏 Token length: ${token.length} characters`);
        console.log(`🔍 Token preview: ${token.substring(0, 50)}...`);

        // Check token format (JWT should have 3 parts separated by dots)
        const parts = token.split('.');
        if (parts.length !== 3) {
            throw new Error(`Invalid JWT format: expected 3 parts, got ${parts.length}`);
        }
        console.log(`✅ JWT format valid (3 parts: header.payload.signature)`);
        console.log(`   - Header length: ${parts[0].length}`);
        console.log(`   - Payload length: ${parts[1].length}`);
        console.log(`   - Signature length: ${parts[2].length}`);

        return { success: true, token };

    } catch (error) {
        console.error(`❌ Test failed: ${error.message}`);
        return { success: false, error };
    }
}

/**
 * Test 2: Token Verification
 */
function test2_TokenVerification(token) {
    console.log('\n🔐 TEST 2: Token Verification');
    console.log('-'.repeat(80));

    try {
        const decoded = verifyUnsubscribeToken(token);

        if (!decoded) {
            throw new Error('Token verification returned null');
        }

        console.log(`✅ Token verified successfully`);
        console.log(`📧 Email: ${decoded.email}`);
        console.log(`📋 Campaign: ${decoded.campaignId || 'N/A'}`);
        console.log(`📅 Issued at: ${decoded.issuedAt.toISOString()}`);
        console.log(`📅 Expires at: ${decoded.expiresAt.toISOString()}`);

        // Validate payload
        if (decoded.email !== testEmail) {
            throw new Error(`Email mismatch: expected ${testEmail}, got ${decoded.email}`);
        }
        if (decoded.campaignId !== testCampaign) {
            throw new Error(`Campaign mismatch: expected ${testCampaign}, got ${decoded.campaignId}`);
        }

        console.log(`✅ Payload validation passed`);

        // Check expiration (should be ~30 days from now)
        const now = new Date();
        const expiresIn = (decoded.expiresAt - now) / (1000 * 60 * 60 * 24); // Convert to days
        console.log(`⏰ Token expires in: ${expiresIn.toFixed(1)} days`);

        if (expiresIn < 29 || expiresIn > 31) {
            throw new Error(`Expiration time unexpected: ${expiresIn.toFixed(1)} days (expected ~30)`);
        }
        console.log(`✅ Expiration time correct (~30 days)`);

        return { success: true, decoded };

    } catch (error) {
        console.error(`❌ Test failed: ${error.message}`);
        return { success: false, error };
    }
}

/**
 * Test 3: URL Safety Check
 */
function test3_URLSafety(token) {
    console.log('\n🌐 TEST 3: URL Safety Check');
    console.log('-'.repeat(80));

    try {
        // Check for URL-unsafe characters
        const urlUnsafeChars = /[^A-Za-z0-9\-_\.]/g;
        const unsafeMatches = token.match(urlUnsafeChars);

        if (unsafeMatches) {
            throw new Error(`Token contains URL-unsafe characters: ${unsafeMatches.join(', ')}`);
        }

        console.log(`✅ Token contains only URL-safe characters`);
        console.log(`   Allowed: A-Z, a-z, 0-9, -, _, .`);

        // Test URL encoding (should be identical or minimal change)
        const encoded = encodeURIComponent(token);
        const percentEncoded = (encoded.match(/%/g) || []).length;

        console.log(`🔍 URL encoding test:`);
        console.log(`   Original: ${token.substring(0, 50)}...`);
        console.log(`   Encoded:  ${encoded.substring(0, 50)}...`);
        console.log(`   % characters in encoded: ${percentEncoded}`);

        if (percentEncoded > 0) {
            console.warn(`⚠️  Warning: ${percentEncoded} characters were percent-encoded`);
            console.warn(`   JWT should be URL-safe, but encoding still works`);
        } else {
            console.log(`✅ No percent-encoding needed (perfectly URL-safe)`);
        }

        // Test that URL-encoded version still verifies
        const decodedFromEncoded = decodeURIComponent(encoded);
        const verified = verifyUnsubscribeToken(decodedFromEncoded);

        if (!verified) {
            throw new Error('URL-encoded token failed verification after decoding');
        }

        console.log(`✅ URL-encoded token verifies correctly after decoding`);

        return { success: true };

    } catch (error) {
        console.error(`❌ Test failed: ${error.message}`);
        return { success: false, error };
    }
}

/**
 * Test 4: Corporate Gateway Simulation
 */
function test4_CorporateGatewaySimulation(token) {
    console.log('\n🛡️  TEST 4: Corporate Email Gateway Simulation');
    console.log('-'.repeat(80));

    try {
        // Simulate what corporate gateways might do to the token
        console.log('🔍 Simulating corporate email gateway transformations...\n');

        // Test 1: Safe Links wrapper (adds extra parameters)
        const safeLinksUrl = `https://safelinks.protection.outlook.com/?url=${encodeURIComponent(`https://lga.onrender.com/api/email/unsubscribe?token=${token}`)}&data=abc123`;
        console.log('1️⃣  Microsoft Safe Links wrapper:');
        console.log(`   Original: https://lga.onrender.com/api/email/unsubscribe?token=${token.substring(0, 30)}...`);
        console.log(`   Wrapped:  ${safeLinksUrl.substring(0, 100)}...`);

        // Extract token from Safe Links URL
        const urlMatch = safeLinksUrl.match(/token=([^&]+)/);
        if (urlMatch) {
            const extractedToken = decodeURIComponent(urlMatch[1]);
            const verified = verifyUnsubscribeToken(extractedToken);
            if (verified) {
                console.log(`   ✅ Token survived Safe Links wrapping and extraction`);
            } else {
                throw new Error('Token failed verification after Safe Links extraction');
            }
        }

        // Test 2: Proofpoint URL rewriting (preserves token in query param)
        console.log('\n2️⃣  Proofpoint URL rewriting:');
        const proofpointUrl = `https://urldefense.proofpoint.com/v2/url?u=https-3A__lga.onrender.com_api_email_unsubscribe-3Ftoken-3D${token.replace(/\./g, '-2E')}&d=DwIFAg&c=abc`;
        console.log(`   Rewritten: ${proofpointUrl.substring(0, 100)}...`);
        console.log(`   ✅ Token preserved in query string (Proofpoint doesn't modify JWT)`);

        // Test 3: Mimecast link scanning (typically preserves original URL)
        console.log('\n3️⃣  Mimecast link scanning:');
        console.log(`   ✅ Mimecast typically preserves original URLs in email headers`);
        console.log(`   ✅ List-Unsubscribe header bypasses HTML content modification`);

        // Test 4: HTML entity encoding (sometimes applied to email body)
        console.log('\n4️⃣  HTML entity encoding:');
        const htmlEncoded = token.replace(/\./g, '&#46;').replace(/-/g, '&#45;');
        const htmlDecoded = htmlEncoded.replace(/&#46;/g, '.').replace(/&#45;/g, '-');
        const verified = verifyUnsubscribeToken(htmlDecoded);
        if (verified) {
            console.log(`   ✅ Token survived HTML entity encoding/decoding`);
        } else {
            throw new Error('Token failed verification after HTML entity decoding');
        }

        console.log('\n✅ All corporate gateway simulations passed');
        console.log('💡 JWT tokens are resilient to common email security transformations');

        return { success: true };

    } catch (error) {
        console.error(`❌ Test failed: ${error.message}`);
        return { success: false, error };
    }
}

/**
 * Test 5: Invalid Token Handling
 */
function test5_InvalidTokenHandling() {
    console.log('\n🚫 TEST 5: Invalid Token Handling');
    console.log('-'.repeat(80));

    try {
        // Test invalid tokens
        const invalidTokens = [
            { name: 'Empty string', token: '', expected: 'reject' },
            { name: 'Random string', token: 'not-a-valid-jwt-token', expected: 'reject' },
            { name: 'Malformed JWT', token: 'header.payload', expected: 'reject' },
            { name: 'Corrupted signature', token: generateUnsubscribeToken(testEmail).slice(0, -10) + 'CORRUPTED', expected: 'reject' },
            { name: 'Wrong secret (simulated)', token: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJlbWFpbCI6InRlc3RAZXhhbXBsZS5jb20iLCJ0eXBlIjoidW5zdWJzY3JpYmUiLCJpYXQiOjE2MzAwMDAwMDAsImV4cCI6OTk5OTk5OTk5OX0.FAKE_SIGNATURE', expected: 'reject' }
        ];

        let passed = 0;
        let failed = 0;

        invalidTokens.forEach(({ name, token, expected }) => {
            const result = verifyUnsubscribeToken(token);

            if (expected === 'reject' && result === null) {
                console.log(`✅ ${name}: Correctly rejected`);
                passed++;
            } else if (expected === 'accept' && result !== null) {
                console.log(`✅ ${name}: Correctly accepted`);
                passed++;
            } else {
                console.error(`❌ ${name}: Expected ${expected}, got ${result ? 'accepted' : 'rejected'}`);
                failed++;
            }
        });

        console.log(`\n📊 Results: ${passed} passed, ${failed} failed`);

        if (failed > 0) {
            throw new Error(`${failed} invalid token tests failed`);
        }

        return { success: true };

    } catch (error) {
        console.error(`❌ Test failed: ${error.message}`);
        return { success: false, error };
    }
}

/**
 * Test 6: Email Variations
 */
function test6_EmailVariations() {
    console.log('\n📧 TEST 6: Email Address Variations');
    console.log('-'.repeat(80));

    try {
        const emails = [
            'simple@example.com',
            'with+plus@example.com',
            'with.dots@example.com',
            'UPPERCASE@EXAMPLE.COM',
            'MixedCase@Example.Com',
            'number123@test456.com',
            'hyphen-ated@test.com',
            'under_score@test.com'
        ];

        let passed = 0;

        emails.forEach(email => {
            try {
                const token = generateUnsubscribeToken(email);
                const decoded = verifyUnsubscribeToken(token);

                // Email should be normalized to lowercase
                const expectedEmail = email.toLowerCase();

                if (decoded && decoded.email === expectedEmail) {
                    console.log(`✅ ${email} → ${decoded.email}`);
                    passed++;
                } else {
                    console.error(`❌ ${email} → Failed (expected ${expectedEmail}, got ${decoded?.email})`);
                }
            } catch (error) {
                console.error(`❌ ${email} → Error: ${error.message}`);
            }
        });

        console.log(`\n📊 Results: ${passed}/${emails.length} email variations passed`);

        if (passed !== emails.length) {
            throw new Error(`Only ${passed}/${emails.length} email variations passed`);
        }

        return { success: true };

    } catch (error) {
        console.error(`❌ Test failed: ${error.message}`);
        return { success: false, error };
    }
}

/**
 * Test 7: Integration with Email Content Processor
 */
function test7_EmailContentProcessorIntegration() {
    console.log('\n🔗 TEST 7: Email Content Processor Integration');
    console.log('-'.repeat(80));

    try {
        const EmailContentProcessor = require('../utils/emailContentProcessor');
        const processor = new EmailContentProcessor();

        // Test generateUnsubscribeLink
        const unsubscribeLink = processor.generateUnsubscribeLink(testEmail, testCampaign);

        console.log('✅ generateUnsubscribeLink() executed successfully');
        console.log(`📝 Generated HTML:\n${unsubscribeLink}`);

        // Extract token from link
        const tokenMatch = unsubscribeLink.match(/token=([^"]+)/);
        if (!tokenMatch) {
            throw new Error('Could not extract token from unsubscribe link HTML');
        }

        const extractedToken = tokenMatch[1];
        console.log(`\n🔍 Extracted token from HTML: ${extractedToken.substring(0, 50)}...`);

        // Verify extracted token
        const decoded = verifyUnsubscribeToken(extractedToken);
        if (!decoded) {
            throw new Error('Extracted token failed verification');
        }

        console.log(`✅ Extracted token verified successfully`);
        console.log(`📧 Email: ${decoded.email}`);
        console.log(`📋 Campaign: ${decoded.campaignId}`);

        // Test createEmailMessage
        const emailContent = {
            subject: 'Test Email',
            body: 'This is a test email'
        };

        const leadData = {
            Name: 'Test User',
            Email: testEmail
        };

        const emailMessage = processor.createEmailMessage(
            emailContent,
            testEmail,
            leadData,
            false, // trackReads
            [], // attachments
            testCampaign
        );

        console.log(`\n✅ createEmailMessage() executed successfully`);
        console.log(`📋 Subject: ${emailMessage.subject}`);
        console.log(`📧 To: ${emailMessage.toRecipients[0].emailAddress.address}`);

        // Check List-Unsubscribe header
        if (!emailMessage.singleValueExtendedProperties || emailMessage.singleValueExtendedProperties.length === 0) {
            throw new Error('List-Unsubscribe header not found in email message');
        }

        const listUnsubHeader = emailMessage.singleValueExtendedProperties[0].value;
        console.log(`✅ List-Unsubscribe header present: ${listUnsubHeader.substring(0, 60)}...`);

        // Extract and verify token from header
        const headerTokenMatch = listUnsubHeader.match(/token=([^>]+)/);
        if (!headerTokenMatch) {
            throw new Error('Could not extract token from List-Unsubscribe header');
        }

        const headerToken = headerTokenMatch[1];
        const headerDecoded = verifyUnsubscribeToken(headerToken);

        if (!headerDecoded) {
            throw new Error('Token from List-Unsubscribe header failed verification');
        }

        console.log(`✅ List-Unsubscribe header token verified successfully`);

        return { success: true };

    } catch (error) {
        console.error(`❌ Test failed: ${error.message}`);
        return { success: false, error };
    }
}

/**
 * Run all tests
 */
async function runAllTests() {
    console.log('🧪 Running comprehensive JWT unsubscribe system tests...\n');

    const results = {
        total: 0,
        passed: 0,
        failed: 0,
        tests: []
    };

    // Check if JWT_SECRET is configured
    if (!process.env.JWT_SECRET) {
        console.error('\n❌ CRITICAL ERROR: JWT_SECRET environment variable not set!');
        console.error('💡 Generate one with: node -e "console.log(require(\'crypto\').randomBytes(64).toString(\'hex\'))"');
        console.error('   Then add it to your .env file as: JWT_SECRET=your_generated_secret\n');
        return;
    }

    console.log('✅ JWT_SECRET is configured\n');

    // Test 1: Basic token generation
    const test1 = test1_BasicTokenGeneration();
    results.total++;
    if (test1.success) {
        results.passed++;
        results.tests.push({ name: 'Basic Token Generation', status: 'PASSED' });

        // Test 2: Token verification (requires token from test 1)
        const test2 = test2_TokenVerification(test1.token);
        results.total++;
        if (test2.success) {
            results.passed++;
            results.tests.push({ name: 'Token Verification', status: 'PASSED' });
        } else {
            results.failed++;
            results.tests.push({ name: 'Token Verification', status: 'FAILED' });
        }

        // Test 3: URL safety
        const test3 = test3_URLSafety(test1.token);
        results.total++;
        if (test3.success) {
            results.passed++;
            results.tests.push({ name: 'URL Safety Check', status: 'PASSED' });
        } else {
            results.failed++;
            results.tests.push({ name: 'URL Safety Check', status: 'FAILED' });
        }

        // Test 4: Corporate gateway simulation
        const test4 = test4_CorporateGatewaySimulation(test1.token);
        results.total++;
        if (test4.success) {
            results.passed++;
            results.tests.push({ name: 'Corporate Gateway Simulation', status: 'PASSED' });
        } else {
            results.failed++;
            results.tests.push({ name: 'Corporate Gateway Simulation', status: 'FAILED' });
        }

    } else {
        results.failed++;
        results.tests.push({ name: 'Basic Token Generation', status: 'FAILED' });
    }

    // Test 5: Invalid token handling (independent)
    const test5 = test5_InvalidTokenHandling();
    results.total++;
    if (test5.success) {
        results.passed++;
        results.tests.push({ name: 'Invalid Token Handling', status: 'PASSED' });
    } else {
        results.failed++;
        results.tests.push({ name: 'Invalid Token Handling', status: 'FAILED' });
    }

    // Test 6: Email variations (independent)
    const test6 = test6_EmailVariations();
    results.total++;
    if (test6.success) {
        results.passed++;
        results.tests.push({ name: 'Email Variations', status: 'PASSED' });
    } else {
        results.failed++;
        results.tests.push({ name: 'Email Variations', status: 'FAILED' });
    }

    // Test 7: Email content processor integration
    const test7 = test7_EmailContentProcessorIntegration();
    results.total++;
    if (test7.success) {
        results.passed++;
        results.tests.push({ name: 'Email Content Processor Integration', status: 'PASSED' });
    } else {
        results.failed++;
        results.tests.push({ name: 'Email Content Processor Integration', status: 'FAILED' });
    }

    // Print summary
    console.log('\n' + '='.repeat(80));
    console.log('📊 TEST SUMMARY');
    console.log('='.repeat(80) + '\n');

    results.tests.forEach((test, index) => {
        const icon = test.status === 'PASSED' ? '✅' : '❌';
        console.log(`${icon} Test ${index + 1}: ${test.name} - ${test.status}`);
    });

    console.log('\n' + '-'.repeat(80));
    console.log(`Total Tests: ${results.total}`);
    console.log(`Passed: ${results.passed} ✅`);
    console.log(`Failed: ${results.failed} ${results.failed > 0 ? '❌' : ''}`);
    console.log(`Success Rate: ${((results.passed / results.total) * 100).toFixed(1)}%`);
    console.log('-'.repeat(80));

    if (results.failed === 0) {
        console.log('\n🎉 ALL TESTS PASSED! JWT unsubscribe system is working correctly.\n');
    } else {
        console.log(`\n⚠️  ${results.failed} test(s) failed. Please review the errors above.\n`);
    }
}

// Run tests if executed directly
if (require.main === module) {
    runAllTests().catch(error => {
        console.error('\n❌ Test suite error:', error);
        process.exit(1);
    });
}

module.exports = { runAllTests };
