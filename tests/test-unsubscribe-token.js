/**
 * Unsubscribe Token System Diagnostic Script
 * Tests token generation and decryption to verify UNSUBSCRIBE_SECRET_KEY setup
 */

require('dotenv').config();
const tokenManager = require('../utils/unsubscribeTokenManager');

console.log('═══════════════════════════════════════════════════════════════');
console.log('🔍 Unsubscribe Token System Diagnostics');
console.log('═══════════════════════════════════════════════════════════════\n');

// Step 1: Check environment configuration
console.log('📋 Step 1: Environment Configuration Check');
console.log('─────────────────────────────────────────');

const secretKey = process.env.UNSUBSCRIBE_SECRET_KEY;

if (!secretKey) {
    console.error('❌ UNSUBSCRIBE_SECRET_KEY is NOT set in environment');
    console.error('❌ This is the ROOT CAUSE of token decryption failures\n');
    console.log('💡 Solution:');
    console.log('   1. Generate a secure key:');
    console.log('      node -e "console.log(require(\'crypto\').randomBytes(32).toString(\'hex\'))"');
    console.log('   2. Add to .env file:');
    console.log('      UNSUBSCRIBE_SECRET_KEY=<generated_key>');
    console.log('   3. Add to Render environment variables (Dashboard → Environment)');
    console.log('   4. Restart the server\n');
    process.exit(1);
}

console.log(`✅ UNSUBSCRIBE_SECRET_KEY is set`);

// Validate key format
try {
    const keyBuffer = Buffer.from(secretKey, 'hex');
    console.log(`✅ Key format: Valid hex string`);
    console.log(`✅ Key length: ${keyBuffer.length} bytes (${secretKey.length} hex chars)`);

    if (keyBuffer.length !== 32) {
        console.warn(`⚠️  WARNING: Expected 32 bytes (64 hex chars), got ${keyBuffer.length} bytes`);
        console.warn(`⚠️  This may cause encryption issues\n`);
    } else {
        console.log(`✅ Key size: Correct (256-bit for AES-256-GCM)\n`);
    }
} catch (error) {
    console.error(`❌ Key format: Invalid hex string`);
    console.error(`❌ Error: ${error.message}\n`);
    process.exit(1);
}

// Step 2: Test token generation
console.log('📋 Step 2: Token Generation Test');
console.log('─────────────────────────────────────────');

const testEmail = 'test@example.com';
let generatedToken;

try {
    generatedToken = tokenManager.generateToken(testEmail);
    console.log(`✅ Token generated successfully`);
    console.log(`📝 Test email: ${testEmail}`);
    console.log(`🔑 Generated token: ${generatedToken}`);
    console.log(`📏 Token length: ${generatedToken.length} characters`);
    console.log(`📋 Token parts: ${generatedToken.split('.').length} (should be 3)\n`);
} catch (error) {
    console.error(`❌ Token generation FAILED`);
    console.error(`❌ Error: ${error.message}\n`);
    process.exit(1);
}

// Step 3: Test token decryption
console.log('📋 Step 3: Token Decryption Test');
console.log('─────────────────────────────────────────');

try {
    const decryptedEmail = tokenManager.getEmailFromToken(generatedToken);

    if (decryptedEmail === testEmail) {
        console.log(`✅ Token decrypted successfully`);
        console.log(`📧 Original email: ${testEmail}`);
        console.log(`📧 Decrypted email: ${decryptedEmail}`);
        console.log(`✅ Emails match: PASS\n`);
    } else {
        console.error(`❌ Token decryption MISMATCH`);
        console.error(`📧 Expected: ${testEmail}`);
        console.error(`📧 Got: ${decryptedEmail}\n`);
        process.exit(1);
    }
} catch (error) {
    console.error(`❌ Token decryption FAILED`);
    console.error(`❌ Error: ${error.message}\n`);
    process.exit(1);
}

// Step 4: Test with real-world scenarios
console.log('📋 Step 4: Real-World Scenario Tests');
console.log('─────────────────────────────────────────');

const testCases = [
    'user@example.com',
    'User@Example.COM', // Test case insensitivity
    'user+tag@example.com', // Test special characters
    'user.name@example.co.uk', // Test dots and multiple TLDs
];

let allPassed = true;

for (const email of testCases) {
    try {
        const token = tokenManager.generateToken(email);
        const decrypted = tokenManager.getEmailFromToken(token);
        const normalizedOriginal = email.toLowerCase().trim();

        if (decrypted === normalizedOriginal) {
            console.log(`✅ ${email.padEnd(30)} → PASS`);
        } else {
            console.error(`❌ ${email.padEnd(30)} → FAIL (got: ${decrypted})`);
            allPassed = false;
        }
    } catch (error) {
        console.error(`❌ ${email.padEnd(30)} → ERROR: ${error.message}`);
        allPassed = false;
    }
}

console.log();

// Step 5: Test invalid token handling
console.log('📋 Step 5: Invalid Token Handling Test');
console.log('─────────────────────────────────────────');

const invalidTokens = [
    { name: 'Null token', token: null },
    { name: 'Empty string', token: '' },
    { name: 'Random string', token: 'invalidtoken123' },
    { name: 'Tampered token', token: generatedToken.slice(0, -5) + 'XXXXX' },
];

for (const test of invalidTokens) {
    const result = tokenManager.getEmailFromToken(test.token);
    if (result === null) {
        console.log(`✅ ${test.name.padEnd(20)} → Correctly rejected`);
    } else {
        console.error(`❌ ${test.name.padEnd(20)} → Should reject but got: ${result}`);
        allPassed = false;
    }
}

console.log();

// Final summary
console.log('═══════════════════════════════════════════════════════════════');
console.log('📊 Diagnostic Summary');
console.log('═══════════════════════════════════════════════════════════════');

if (allPassed) {
    console.log('✅ All tests PASSED');
    console.log('✅ Token system is working correctly');
    console.log('\n💡 If unsubscribe still fails on Render:');
    console.log('   1. Verify UNSUBSCRIBE_SECRET_KEY is set in Render dashboard');
    console.log('   2. Ensure the key in Render matches your local .env');
    console.log('   3. Restart the Render service after adding the key');
    console.log('   4. Test with a newly generated unsubscribe link');
} else {
    console.error('❌ Some tests FAILED');
    console.error('❌ Review errors above and fix issues');
}

console.log('═══════════════════════════════════════════════════════════════');
