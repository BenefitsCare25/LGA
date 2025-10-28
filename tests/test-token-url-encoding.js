/**
 * Test token URL encoding issues
 * Verifies that tokens can survive URL encoding/decoding
 */

require('dotenv').config();
const tokenManager = require('../utils/unsubscribeTokenManager');

console.log('═══════════════════════════════════════════════════════════════');
console.log('🔍 Token URL Encoding Test');
console.log('═══════════════════════════════════════════════════════════════\n');

const testEmail = 'test@example.com';

console.log('📋 Step 1: Generate Token');
console.log('─────────────────────────────────────────');

const token = tokenManager.generateToken(testEmail);
console.log(`✅ Generated token for: ${testEmail}`);
console.log(`📏 Token length: ${token.length} characters`);
console.log(`🔑 Full token: ${token}`);
console.log(`📋 Token parts: ${token.split('.').length}\n`);

console.log('📋 Step 2: URL Encoding Test');
console.log('─────────────────────────────────────────');

// Simulate what happens when token goes through URL
const encodedToken = encodeURIComponent(token);
console.log(`🔗 URL encoded: ${encodedToken}`);
console.log(`📏 Encoded length: ${encodedToken.length}`);
console.log(`🔄 Changed: ${token === encodedToken ? 'No (already URL-safe)' : 'Yes (needed encoding)'}\n`);

console.log('📋 Step 3: URL Decoding Test');
console.log('─────────────────────────────────────────');

const decodedToken = decodeURIComponent(encodedToken);
console.log(`🔓 URL decoded: ${decodedToken}`);
console.log(`✅ Matches original: ${token === decodedToken ? 'Yes' : 'No'}\n`);

console.log('📋 Step 4: Token Decryption After URL Round-trip');
console.log('─────────────────────────────────────────');

const decryptedEmail = tokenManager.getEmailFromToken(decodedToken);
console.log(`📧 Decrypted email: ${decryptedEmail}`);
console.log(`✅ Matches original: ${decryptedEmail === testEmail ? 'Yes' : 'No'}\n`);

console.log('📋 Step 5: Test Short Token (Like in Logs)');
console.log('─────────────────────────────────────────');

const shortToken = 'HB8cC5B4';
console.log(`🔑 Testing short token from logs: ${shortToken}`);
const result = tokenManager.getEmailFromToken(shortToken);
console.log(`📧 Result: ${result === null ? 'NULL (correctly rejected)' : result}`);
console.log(`📋 Analysis: ${shortToken} has only ${shortToken.split('.').length} part(s), expected 3\n`);

console.log('═══════════════════════════════════════════════════════════════');
console.log('📊 Diagnosis');
console.log('═══════════════════════════════════════════════════════════════');

if (decryptedEmail === testEmail) {
    console.log('✅ Tokens survive URL encoding/decoding correctly');
    console.log('⚠️  Problem likely: Token being truncated or corrupted before reaching server');
    console.log('\n💡 Possible causes:');
    console.log('   1. Email client truncating long URLs');
    console.log('   2. URL parameter being parsed incorrectly (& vs ? confusion)');
    console.log('   3. Token generated with DIFFERENT encryption key than Render');
    console.log('   4. Web server/proxy truncating query parameters');
} else {
    console.error('❌ Token corruption detected during URL encoding/decoding');
}

console.log('═══════════════════════════════════════════════════════════════');
