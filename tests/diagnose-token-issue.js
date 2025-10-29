/**
 * Diagnostic script to identify unsubscribe token issues
 * Tests encryption key, token generation, and URL encoding
 */

require('dotenv').config();
const crypto = require('crypto');

console.log('═══════════════════════════════════════════════════════════════');
console.log('🔍 UNSUBSCRIBE TOKEN DIAGNOSTIC');
console.log('═══════════════════════════════════════════════════════════════\n');

// Test 1: Check environment variable
console.log('TEST 1: Environment Variable Check');
console.log('─────────────────────────────────────');
const secretKey = process.env.UNSUBSCRIBE_SECRET_KEY;

if (!secretKey) {
    console.log('❌ CRITICAL: UNSUBSCRIBE_SECRET_KEY is NOT SET in environment');
    console.log('   Action: Add UNSUBSCRIBE_SECRET_KEY to .env file');
    console.log('   Generate with: node -e "console.log(require(\'crypto\').randomBytes(32).toString(\'hex\'))"');
    process.exit(1);
}

console.log(`✅ UNSUBSCRIBE_SECRET_KEY is set`);
console.log(`   Length: ${secretKey.length} characters`);
console.log(`   First 16 chars: ${secretKey.substring(0, 16)}...`);
console.log(`   Last 16 chars: ...${secretKey.substring(secretKey.length - 16)}`);

// Test 2: Validate key format
console.log('\nTEST 2: Key Format Validation');
console.log('─────────────────────────────────────');

try {
    const keyBuffer = Buffer.from(secretKey, 'hex');
    console.log(`   Key decodes as hex: ✅`);
    console.log(`   Buffer length: ${keyBuffer.length} bytes`);

    if (keyBuffer.length !== 32) {
        console.log(`❌ CRITICAL: Key must be exactly 32 bytes (64 hex characters)`);
        console.log(`   Current: ${keyBuffer.length} bytes`);
        console.log(`   Action: Generate new key with: node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"`);
        process.exit(1);
    }

    console.log(`✅ Key has correct length (32 bytes = 256 bits for AES-256)`);
} catch (error) {
    console.log(`❌ CRITICAL: Key is not valid hex format`);
    console.log(`   Error: ${error.message}`);
    console.log(`   Action: Generate new key with: node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"`);
    process.exit(1);
}

// Test 3: Test token generation and decryption
console.log('\nTEST 3: Token Generation & Decryption');
console.log('─────────────────────────────────────');

const testEmail = 'test@example.com';
console.log(`   Test email: ${testEmail}`);

try {
    const tokenManager = require('../utils/unsubscribeTokenManager');

    // Generate token
    const token = tokenManager.generateToken(testEmail);
    console.log(`✅ Token generated successfully`);
    console.log(`   Token length: ${token.length} characters`);
    console.log(`   Token parts: ${token.split('.').length}`);
    console.log(`   Full token: ${token}`);

    // Decrypt token
    const decryptedEmail = tokenManager.getEmailFromToken(token);

    if (decryptedEmail === testEmail) {
        console.log(`✅ Token decryption successful`);
        console.log(`   Decrypted email: ${decryptedEmail}`);
        console.log(`   Match: ✅ ${testEmail} === ${decryptedEmail}`);
    } else {
        console.log(`❌ CRITICAL: Token decryption mismatch`);
        console.log(`   Original: ${testEmail}`);
        console.log(`   Decrypted: ${decryptedEmail}`);
        process.exit(1);
    }
} catch (error) {
    console.log(`❌ CRITICAL: Token generation/decryption failed`);
    console.log(`   Error: ${error.message}`);
    console.log(`   Stack: ${error.stack}`);
    process.exit(1);
}

// Test 4: Test URL encoding/decoding
console.log('\nTEST 4: URL Encoding Safety');
console.log('─────────────────────────────────────');

try {
    const tokenManager = require('../utils/unsubscribeTokenManager');
    const token = tokenManager.generateToken(testEmail);

    // Simulate URL encoding (what happens when token is in URL)
    const encodedToken = encodeURIComponent(token);
    const decodedToken = decodeURIComponent(encodedToken);

    console.log(`   Original token: ${token}`);
    console.log(`   URL encoded: ${encodedToken}`);
    console.log(`   URL decoded: ${decodedToken}`);
    console.log(`   Tokens match: ${token === decodedToken ? '✅' : '❌'}`);

    if (token === encodedToken) {
        console.log(`✅ Token is URL-safe (no encoding needed)`);
    } else {
        console.log(`⚠️  Token gets URL-encoded (base64url should prevent this)`);
    }

    // Try to decrypt the decoded token
    const decryptedEmail = tokenManager.getEmailFromToken(decodedToken);
    if (decryptedEmail === testEmail) {
        console.log(`✅ URL-decoded token decrypts correctly`);
    } else {
        console.log(`❌ CRITICAL: URL-decoded token fails to decrypt`);
        process.exit(1);
    }
} catch (error) {
    console.log(`❌ CRITICAL: URL encoding test failed`);
    console.log(`   Error: ${error.message}`);
    process.exit(1);
}

// Test 5: Test the actual problematic token from logs
console.log('\nTEST 5: Analyze Problematic Token from Logs');
console.log('─────────────────────────────────────');

const problematicToken = '7dA6LcTvKi3wcv-UJBE3aj.XelfcJbe5MaakBz8CEdMAeyIIaVuEIbUeDb.g7damIM2CCGVAdKfUcfDdB';
console.log(`   Token from logs: ${problematicToken}`);
console.log(`   Length: ${problematicToken.length}`);
console.log(`   Parts: ${problematicToken.split('.').length}`);

const parts = problematicToken.split('.');
console.log(`   Part 1 (IV): ${parts[0]} (${parts[0].length} chars)`);
console.log(`   Part 2 (Encrypted): ${parts[1]} (${parts[1].length} chars)`);
console.log(`   Part 3 (AuthTag): ${parts[2]} (${parts[2].length} chars)`);

try {
    const tokenManager = require('../utils/unsubscribeTokenManager');
    const decryptedEmail = tokenManager.getEmailFromToken(problematicToken);

    if (decryptedEmail) {
        console.log(`✅ Problematic token decrypts successfully!`);
        console.log(`   Decrypted email: ${decryptedEmail}`);
        console.log(`   Conclusion: Token is valid, issue must be elsewhere`);
    } else {
        console.log(`❌ Problematic token fails to decrypt`);
        console.log(`   Conclusion: Token was created with different key or is corrupted`);
    }
} catch (error) {
    console.log(`❌ Problematic token decryption error: ${error.message}`);
    console.log(`   Conclusion: Token was created with different encryption key`);
}

console.log('\n═══════════════════════════════════════════════════════════════');
console.log('🎯 DIAGNOSTIC COMPLETE');
console.log('═══════════════════════════════════════════════════════════════');
