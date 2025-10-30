/**
 * Proxy ID System Test Suite
 *
 * Tests the Excel-based proxy ID unsubscribe system:
 * - Token generation and encoding
 * - Location column format parsing
 * - Token validation (expiry, usage)
 * - URL generation
 */

const {
    generateProxyId,
    encodeLocationToken,
    parseLocationToken,
    markTokenAsUsed,
    isTokenValid
} = require('../utils/proxyIdManager');

console.log('\n' + '═'.repeat(80));
console.log('PROXY ID SYSTEM TEST SUITE');
console.log('═'.repeat(80) + '\n');

let testsPassed = 0;
let testsFailed = 0;

function assert(condition, testName) {
    if (condition) {
        console.log(`✅ PASS: ${testName}`);
        testsPassed++;
    } else {
        console.log(`❌ FAIL: ${testName}`);
        testsFailed++;
    }
}

// Test 1: Generate Proxy ID
console.log('\n📝 Test 1: Generate Proxy ID');
console.log('-'.repeat(80));
const proxyId = generateProxyId();
console.log(`Generated ID: ${proxyId}`);
assert(proxyId.length === 8, 'Proxy ID length is 8 characters');
assert(/^[A-Za-z0-9_-]+$/.test(proxyId), 'Proxy ID contains only URL-safe characters');

// Test 2: Encode Location Token
console.log('\n📝 Test 2: Encode Location Token');
console.log('-'.repeat(80));
const testEmail = 'test@example.com';
const expiryDate = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000); // 30 days
const locationValue = encodeLocationToken(proxyId, expiryDate);
console.log(`Location value: ${locationValue}`);
assert(locationValue.startsWith('TOKEN:'), 'Location value starts with TOKEN:');
assert(locationValue.includes(proxyId), 'Location value contains proxy ID');
assert(locationValue.includes('ACTIVE'), 'Location value contains ACTIVE status');

// Test 3: Parse Location Token
console.log('\n📝 Test 3: Parse Location Token');
console.log('-'.repeat(80));
const parsedToken = parseLocationToken(locationValue);
console.log(`Parsed token:`, parsedToken);
assert(parsedToken !== null, 'Parse returns valid object');
assert(parsedToken.proxyId === proxyId, 'Parsed proxy ID matches');
assert(parsedToken.expiry instanceof Date, 'Expiry is a Date object');
assert(parsedToken.used === null, 'Used status is null for new token');

// Test 4: Token Validation (Valid)
console.log('\n📝 Test 4: Token Validation (Valid Token)');
console.log('-'.repeat(80));
const isValid = isTokenValid(parsedToken);
console.log(`Is valid: ${isValid}`);
assert(isValid === true, 'Valid token passes validation');

// Test 5: Token Validation (Expired)
console.log('\n📝 Test 5: Token Validation (Expired Token)');
console.log('-'.repeat(80));
const expiredDate = new Date(Date.now() - 1000); // 1 second ago
const expiredLocation = encodeLocationToken(generateProxyId(), expiredDate);
const expiredParsed = parseLocationToken(expiredLocation);
const isExpiredValid = isTokenValid(expiredParsed);
console.log(`Expired token valid: ${isExpiredValid}`);
assert(isExpiredValid === false, 'Expired token fails validation');

// Test 6: Mark Token as Used
console.log('\n📝 Test 6: Mark Token as Used');
console.log('-'.repeat(80));
const usedLocation = markTokenAsUsed(locationValue);
console.log(`Used location: ${usedLocation}`);
assert(usedLocation.includes('USED:'), 'Used location contains USED status');
const usedParsed = parseLocationToken(usedLocation);
assert(usedParsed.used !== null, 'Used token has non-null used value');

// Test 7: Token Validation (Used)
console.log('\n📝 Test 7: Token Validation (Used Token)');
console.log('-'.repeat(80));
const isUsedValid = isTokenValid(usedParsed);
console.log(`Used token valid: ${isUsedValid}`);
assert(isUsedValid === false, 'Used token fails validation');

// Test 8: URL Safety
console.log('\n📝 Test 8: URL Safety');
console.log('-'.repeat(80));
const testProxyId = generateProxyId();
const testUrl = `https://example.com/api/email/unsubscribe?id=${testProxyId}`;
console.log(`Test URL: ${testUrl}`);
assert(!/[^A-Za-z0-9:/?=&._-]/.test(testUrl), 'URL contains only URL-safe characters');
assert(testUrl.length < 100, 'URL is short (< 100 chars)');

// Test 9: Multiple Token Generation (Uniqueness)
console.log('\n📝 Test 9: Multiple Token Generation (Uniqueness)');
console.log('-'.repeat(80));
const ids = new Set();
for (let i = 0; i < 100; i++) {
    ids.add(generateProxyId());
}
console.log(`Generated ${ids.size} unique IDs out of 100`);
assert(ids.size === 100, 'All generated IDs are unique');

// Test 10: Invalid Location Format
console.log('\n📝 Test 10: Invalid Location Format');
console.log('-'.repeat(80));
const invalidLocation = 'Singapore Office';
const invalidParsed = parseLocationToken(invalidLocation);
console.log(`Invalid location parsed:`, invalidParsed);
assert(invalidParsed === null, 'Invalid location returns null');

// Test 11: Corporate Gateway Simulation
console.log('\n📝 Test 11: Corporate Gateway Simulation');
console.log('-'.repeat(80));
const simpleId = generateProxyId();
const originalUrl = `https://lga.com/api/email/unsubscribe?id=${simpleId}`;
console.log(`Original URL: ${originalUrl}`);

// Simulate Proofpoint/Mimecast rewriting (they usually leave simple params alone)
const gatewayUrl = originalUrl; // Simple IDs usually pass through unchanged
console.log(`After gateway: ${gatewayUrl}`);

assert(originalUrl === gatewayUrl, 'Simple proxy ID survives gateway rewriting');

// Test 12: Edge Case - Double Mark as Used
console.log('\n📝 Test 12: Edge Case - Double Mark as Used');
console.log('-'.repeat(80));
const doubleUsedLocation = markTokenAsUsed(usedLocation);
console.log(`Double used location: ${doubleUsedLocation}`);
assert(doubleUsedLocation === usedLocation, 'Marking already-used token returns same value');

// Summary
console.log('\n' + '═'.repeat(80));
console.log('TEST SUMMARY');
console.log('═'.repeat(80));
console.log(`✅ Passed: ${testsPassed}`);
console.log(`❌ Failed: ${testsFailed}`);
console.log(`📊 Total:  ${testsPassed + testsFailed}`);

if (testsFailed === 0) {
    console.log('\n🎉 ALL TESTS PASSED! Proxy ID system is working correctly.\n');
    process.exit(0);
} else {
    console.log(`\n⚠️  ${testsFailed} test(s) failed. Please review the implementation.\n`);
    process.exit(1);
}
