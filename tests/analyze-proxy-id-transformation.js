/**
 * Proxy ID Transformation Analyzer
 *
 * Analyzes character-by-character transformations applied by email gateways
 * to understand the cipher/encoding being used.
 */

console.log('\n' + '═'.repeat(80));
console.log('PROXY ID TRANSFORMATION ANALYZER');
console.log('═'.repeat(80) + '\n');

// Known transformation pairs from production logs
const transformations = [
    // First case (from earlier logs)
    { original: '8DZYwnfI', transformed: '1EMLjaaV' },

    // Second case (latest logs)
    { original: 'l3aJng_C', transformed: 'c8a58EmE' },

    // Source parameter transformation
    { original: 'html', transformed: 'ufbefe' },
    { original: 'header', transformed: 'ufbefe' }
];

function analyzeTransformation(original, transformed) {
    console.log(`\n📊 Analyzing: "${original}" → "${transformed}"`);
    console.log('─'.repeat(80));

    if (original.length !== transformed.length) {
        console.log(`⚠️  Length mismatch: ${original.length} → ${transformed.length}`);
        return;
    }

    const analysis = [];

    for (let i = 0; i < original.length; i++) {
        const origChar = original[i];
        const transChar = transformed[i];
        const origCode = origChar.charCodeAt(0);
        const transCode = transChar.charCodeAt(0);
        const shift = transCode - origCode;

        analysis.push({
            position: i,
            original: origChar,
            transformed: transChar,
            origCode,
            transCode,
            shift,
            shiftMod26: ((transCode - origCode) % 26 + 26) % 26
        });

        console.log(
            `[${i}] '${origChar}' (${origCode}) → '${transChar}' (${transCode}) | ` +
            `Shift: ${shift > 0 ? '+' : ''}${shift} | ` +
            `ROT: ${analysis[i].shiftMod26}`
        );
    }

    // Pattern analysis
    console.log('\n🔍 Pattern Analysis:');
    const shiftCounts = {};
    analysis.forEach(a => {
        shiftCounts[a.shift] = (shiftCounts[a.shift] || 0) + 1;
    });

    Object.entries(shiftCounts)
        .sort((a, b) => b[1] - a[1])
        .forEach(([shift, count]) => {
            const percentage = ((count / original.length) * 100).toFixed(1);
            console.log(`  Shift ${shift > 0 ? '+' : ''}${shift}: ${count} chars (${percentage}%)`);
        });

    // ROT13 detection
    const rot13Count = analysis.filter(a => Math.abs(a.shiftMod26) === 13).length;
    if (rot13Count > 0) {
        console.log(`\n⚠️  ROT13 detected: ${rot13Count}/${original.length} chars (${(rot13Count/original.length*100).toFixed(1)}%)`);
    }

    return analysis;
}

// Analyze all transformations
transformations.forEach(({ original, transformed }) => {
    analyzeTransformation(original, transformed);
});

// Cross-analysis: Look for positional patterns
console.log('\n' + '═'.repeat(80));
console.log('CROSS-ANALYSIS: Positional Patterns');
console.log('═'.repeat(80) + '\n');

console.log('Testing hypothesis: Does position affect transformation?\n');

// Compare same characters at different positions
const charMap = new Map();

transformations.forEach(({ original, transformed }) => {
    for (let i = 0; i < original.length; i++) {
        const origChar = original[i];
        const transChar = transformed[i];

        if (!charMap.has(origChar)) {
            charMap.set(origChar, []);
        }

        charMap.get(origChar).push({
            position: i,
            transformed: transChar,
            shift: transChar.charCodeAt(0) - origChar.charCodeAt(0),
            source: original
        });
    }
});

console.log('Character transformation consistency:');
charMap.forEach((transformations, origChar) => {
    if (transformations.length > 1) {
        const shifts = transformations.map(t => t.shift);
        const allSame = shifts.every(s => s === shifts[0]);

        console.log(`\n'${origChar}' appears ${transformations.length} times:`);
        transformations.forEach(t => {
            console.log(`  Position ${t.position} in "${t.source}": → '${t.transformed}' (shift ${t.shift > 0 ? '+' : ''}${t.shift})`);
        });

        if (allSame) {
            console.log(`  ✅ Consistent transformation (always shift ${shifts[0] > 0 ? '+' : ''}${shifts[0]})`);
        } else {
            console.log(`  ⚠️  INCONSISTENT transformation (position-dependent cipher)`);
        }
    }
});

// Test ROT13 hypothesis
console.log('\n' + '═'.repeat(80));
console.log('ROT13 REVERSE-ENGINEERING TEST');
console.log('═'.repeat(80) + '\n');

function rot13(str) {
    return str.replace(/[a-zA-Z]/g, char => {
        const base = char <= 'Z' ? 65 : 97;
        return String.fromCharCode(((char.charCodeAt(0) - base + 13) % 26) + base);
    });
}

transformations.forEach(({ original, transformed }) => {
    const rot13Result = rot13(transformed);
    const matchPercent = Array.from(original).filter((c, i) => c === rot13Result[i]).length / original.length * 100;

    console.log(`Original:    ${original}`);
    console.log(`Transformed: ${transformed}`);
    console.log(`ROT13(transformed): ${rot13Result}`);
    console.log(`Match: ${matchPercent.toFixed(1)}% ${matchPercent > 50 ? '✅ Likely ROT13-based' : '❌ Not ROT13'}\n`);
});

console.log('═'.repeat(80));
console.log('RECOMMENDATION');
console.log('═'.repeat(80) + '\n');

console.log('Based on this analysis:');
console.log('1. If transformation is CONSISTENT: We can reverse-engineer and decode');
console.log('2. If transformation is POSITION-DEPENDENT: Very difficult to reverse');
console.log('3. If transformation is RANDOM: Impossible to reverse, need alternative solution\n');
