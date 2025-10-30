/**
 * Token Corruption Analyzer
 *
 * This utility analyzes how email security gateways are transforming JWT tokens.
 * It helps identify the cipher/transformation algorithm being used.
 */

// Sample data from Render logs
const originalToken = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJlbWFpbCI6InJheUBnb29kam9iY3JlYXRpb25zLmNvbS5zZyIsInR5cGUiOiJ1bnN1YnNjcmliZSIsImlhdCI6MTc2MTc4ODE2MCwiZXhwIjoxNzY0MzgwMTYwfQ.0PBfqLpiCHBrDbVDh4BAnKzCA8N85frCXd90yQgW-F0';
const corruptedToken = 'flWucTdvBvWVHmV4AvVfVaE8dDV9VxcKIDW2.flWycJAccDV9V';

console.log('\n' + '='.repeat(80));
console.log('JWT TOKEN CORRUPTION ANALYSIS');
console.log('='.repeat(80) + '\n');

console.log('Original Token:');
console.log(originalToken);
console.log(`\nLength: ${originalToken.length} characters\n`);

console.log('Corrupted Token (received):');
console.log(corruptedToken);
console.log(`\nLength: ${corruptedToken.length} characters\n`);

console.log('='.repeat(80));
console.log('CHARACTER-BY-CHARACTER ANALYSIS');
console.log('='.repeat(80) + '\n');

// Analyze first 50 characters
const compareLength = Math.min(originalToken.length, corruptedToken.length);

console.log('Position | Original | Corrupted | ASCII Orig | ASCII Corr | Shift');
console.log('-'.repeat(80));

const shifts = [];

for (let i = 0; i < Math.min(50, compareLength); i++) {
    const orig = originalToken[i];
    const corr = corruptedToken[i];
    const origCode = orig.charCodeAt(0);
    const corrCode = corr.charCodeAt(0);
    const shift = corrCode - origCode;

    shifts.push(shift);

    console.log(`${String(i).padStart(8)} | ${orig.padEnd(8)} | ${corr.padEnd(9)} | ${String(origCode).padStart(10)} | ${String(corrCode).padStart(10)} | ${shift > 0 ? '+' : ''}${shift}`);
}

console.log('\n' + '='.repeat(80));
console.log('SHIFT PATTERN ANALYSIS');
console.log('='.repeat(80) + '\n');

// Calculate shift statistics
const uniqueShifts = [...new Set(shifts)];
const shiftCounts = {};

shifts.forEach(shift => {
    shiftCounts[shift] = (shiftCounts[shift] || 0) + 1;
});

console.log('Shift Value | Count | Percentage');
console.log('-'.repeat(50));

Object.entries(shiftCounts)
    .sort((a, b) => b[1] - a[1])
    .forEach(([shift, count]) => {
        const percentage = ((count / shifts.length) * 100).toFixed(1);
        console.log(`${String(shift).padStart(11)} | ${String(count).padStart(5)} | ${percentage}%`);
    });

console.log('\n' + '='.repeat(80));
console.log('CIPHER DETECTION');
console.log('='.repeat(80) + '\n');

// Check for common patterns
const avgShift = shifts.reduce((a, b) => a + b, 0) / shifts.length;
console.log(`Average shift: ${avgShift.toFixed(2)}`);

// Check if it's a simple Caesar cipher
const isCaesar = uniqueShifts.length === 1;
console.log(`\nIs Caesar cipher (single shift)? ${isCaesar ? 'YES' : 'NO'}`);

if (!isCaesar) {
    console.log(`Different shift values detected: ${uniqueShifts.length}`);
    console.log(`Shift values: ${uniqueShifts.sort((a, b) => a - b).join(', ')}`);
}

// Detect ROT13 variant
const hasROT13Pattern = shifts.some(s => Math.abs(s) === 13);
console.log(`\nContains ROT13 shifts (±13)? ${hasROT13Pattern ? 'YES' : 'NO'}`);

// Check for alphabetic vs numeric shifts
const alphabeticShifts = [];
const numericShifts = [];

for (let i = 0; i < Math.min(50, compareLength); i++) {
    const orig = originalToken[i];
    const shift = shifts[i];

    if (/[a-zA-Z]/.test(orig)) {
        alphabeticShifts.push(shift);
    } else if (/[0-9]/.test(orig)) {
        numericShifts.push(shift);
    }
}

if (alphabeticShifts.length > 0) {
    const avgAlpha = alphabeticShifts.reduce((a, b) => a + b, 0) / alphabeticShifts.length;
    console.log(`\nAverage shift for letters: ${avgAlpha.toFixed(2)}`);
    console.log(`Letter shifts: ${[...new Set(alphabeticShifts)].sort((a, b) => a - b).join(', ')}`);
}

if (numericShifts.length > 0) {
    const avgNum = numericShifts.reduce((a, b) => a + b, 0) / numericShifts.length;
    console.log(`\nAverage shift for numbers: ${avgNum.toFixed(2)}`);
    console.log(`Number shifts: ${[...new Set(numericShifts)].sort((a, b) => a - b).join(', ')}`);
}

console.log('\n' + '='.repeat(80));
console.log('DECRYPTION ATTEMPT');
console.log('='.repeat(80) + '\n');

// Try reverse shift
console.log('Attempting to reverse the transformation...\n');

function reverseTransform(corrupted, originalSample, corruptedSample) {
    // Build shift map from sample
    const shiftMap = {};

    for (let i = 0; i < Math.min(originalSample.length, corruptedSample.length); i++) {
        const orig = originalSample[i];
        const corr = corruptedSample[i];
        if (!shiftMap[corr]) {
            shiftMap[corr] = orig;
        }
    }

    // Apply reverse transformation
    let reversed = '';
    for (let char of corrupted) {
        reversed += shiftMap[char] || char;
    }

    return reversed;
}

const reversed = reverseTransform(corruptedToken, originalToken, corruptedToken);
console.log('Reversed token:');
console.log(reversed);

console.log('\n='.repeat(80));
console.log('CONCLUSIONS & RECOMMENDATIONS');
console.log('='.repeat(80) + '\n');

console.log('📊 Analysis Results:');
console.log(`   - Token was shortened: ${originalToken.length} → ${corruptedToken.length} chars`);
console.log(`   - Character transformation detected: ${uniqueShifts.length} different shift patterns`);
console.log(`   - This is likely an email security gateway "safe link" transformation`);

console.log('\n🚨 Problem:');
console.log('   - Email security gateways are rewriting URLs with character transformations');
console.log('   - Even JWT tokens with base64url encoding are being modified');
console.log('   - This breaks cryptographic signatures and makes tokens unverifiable');

console.log('\n💡 Solution Options:');
console.log('\n   1. ✅ RECOMMENDED: Database-Backed Proxy ID System');
console.log('      - Generate short random IDs (e.g., 8-12 alphanumeric characters)');
console.log('      - Store mapping: ID → email + campaign + expiration');
console.log('      - Use URL: /api/email/unsubscribe?id=abc123xyz');
console.log('      - Benefits: Simple characters less likely to be transformed');
console.log('      - Implementation: Use Redis or database table for storage');
console.log('');
console.log('   2. ⚠️  Alternative: Email in URL (Less Secure)');
console.log('      - URL: /api/email/unsubscribe?email=base64EncodedEmail');
console.log('      - Drawback: No HMAC verification, can be spoofed');
console.log('      - Only use if database storage is not available');
console.log('');
console.log('   3. ❌ NOT RECOMMENDED: Try to decode gateway transformation');
console.log('      - Transformation patterns may vary by gateway/version');
console.log('      - Unreliable and hard to maintain');
console.log('');

console.log('\n📋 Implementation Plan for Proxy ID System:');
console.log('   1. Create unsubscribe_tokens table with columns:');
console.log('      - id (varchar 12, primary key)');
console.log('      - email (varchar 255)');
console.log('      - campaign_id (varchar 255, nullable)');
console.log('      - created_at (timestamp)');
console.log('      - expires_at (timestamp)');
console.log('      - used_at (timestamp, nullable)');
console.log('');
console.log('   2. Generate tokens:');
console.log('      - Use crypto.randomBytes(6).toString(\'base64url\') for 8-char IDs');
console.log('      - Set expiration to 30 days');
console.log('');
console.log('   3. On unsubscribe click:');
console.log('      - Look up ID in database');
console.log('      - Check not expired and not already used');
console.log('      - Mark as unsubscribed and set used_at timestamp');
console.log('');
console.log('   4. Cleanup:');
console.log('      - Run daily cron to delete expired tokens (older than 30 days)');
console.log('');

console.log('\n' + '='.repeat(80));
console.log('\n💻 Next Steps:');
console.log('   1. Review analysis results above');
console.log('   2. Decide on proxy ID vs email-in-URL approach');
console.log('   3. If using database: Set up table schema');
console.log('   4. Implement new token generation/verification logic');
console.log('   5. Deploy and test with actual email gateways\n');
