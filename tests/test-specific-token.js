/**
 * Test the specific problematic token from Render logs
 * with the current UNSUBSCRIBE_SECRET_KEY from Render
 */

const crypto = require('crypto');

// This is the key from Render (from screenshot)
const RENDER_KEY = '383fed0912d2d45ac42c4598e83c67e1fb780fb9e692d658163d77dbf828df3a';

// This is the token from Render logs that's failing
const PROBLEMATIC_TOKEN = '7dA6LcTvKi3wcv-UJBE3aj.XelfcJbe5MaakBz8CEdMAeyIIaVuEIbUeDb.g7damIM2CCGVAdKfUcfDdB';

console.log('═══════════════════════════════════════════════════════════════');
console.log('🔍 Testing Specific Token from Render Logs');
console.log('═══════════════════════════════════════════════════════════════\n');

console.log('Token from logs:', PROBLEMATIC_TOKEN);
console.log('Token length:', PROBLEMATIC_TOKEN.length);
console.log('Token parts:', PROBLEMATIC_TOKEN.split('.').length);
console.log('\nUsing key from Render:', RENDER_KEY.substring(0, 16) + '...\n');

// Attempt decryption
try {
    const parts = PROBLEMATIC_TOKEN.split('.');
    if (parts.length !== 3) {
        console.log('❌ Invalid token format');
        process.exit(1);
    }

    const [ivBase64, encrypted, authTagBase64] = parts;

    console.log('Part breakdown:');
    console.log('  IV (part 1):', ivBase64, `(${ivBase64.length} chars)`);
    console.log('  Encrypted (part 2):', encrypted, `(${encrypted.length} chars)`);
    console.log('  AuthTag (part 3):', authTagBase64, `(${authTagBase64.length} chars)`);
    console.log('');

    // Decode components
    const iv = Buffer.from(ivBase64, 'base64url');
    const authTag = Buffer.from(authTagBase64, 'base64url');
    const key = Buffer.from(RENDER_KEY, 'hex');

    console.log('Buffer sizes:');
    console.log('  IV:', iv.length, 'bytes');
    console.log('  AuthTag:', authTag.length, 'bytes');
    console.log('  Key:', key.length, 'bytes');
    console.log('');

    // Create decipher
    const algorithm = 'aes-256-gcm';
    const decipher = crypto.createDecipheriv(algorithm, key, iv);
    decipher.setAuthTag(authTag);

    // Decrypt
    let decrypted = decipher.update(encrypted, 'base64url', 'utf8');
    decrypted += decipher.final('utf8');

    console.log('✅ DECRYPTION SUCCESSFUL!');
    console.log('   Decrypted email:', decrypted);
    console.log('\n🎯 CONCLUSION: Token is valid and matches the Render key');
    console.log('   The issue must be something else (URL encoding, different deployment, etc.)');

} catch (error) {
    console.log('❌ DECRYPTION FAILED');
    console.log('   Error:', error.message);
    console.log('\n🎯 CONCLUSION: Token was NOT created with the current Render key');
    console.log('   Possible causes:');
    console.log('   1. Token was created before you set the key in Render');
    console.log('   2. Token was created by a different deployment/environment');
    console.log('   3. The key in Render was changed after this token was created');
    console.log('\n💡 SOLUTION:');
    console.log('   - Old tokens will not work (this is expected security behavior)');
    console.log('   - New emails will generate tokens with the current key');
    console.log('   - Users can still unsubscribe from new emails');
}

console.log('\n═══════════════════════════════════════════════════════════════');
