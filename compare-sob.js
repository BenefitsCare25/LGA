const fs = require('fs');
const path = require('path');
const PizZip = require('pizzip');
const placementSlipParser = require('./utils/placementSlipParser');

// Parse Excel data
const excelFile = path.resolve('C:/Users/huien/Desktop/Placement Slips - CBRE Group (2025-2026).xlsx');
const excelBuffer = fs.readFileSync(excelFile);
const placementData = placementSlipParser.processPlacementSlip(excelBuffer);

// Read generated PPTX
const pptxFile = path.resolve('C:/Users/huien/Desktop/CBRE Staff Communication 2025.pptx');
const pptxBuffer = fs.readFileSync(pptxFile);
const zip = new PizZip(pptxBuffer);

console.log('='.repeat(80));
console.log('SCHEDULE OF BENEFITS - EXCEL vs PPTX COMPARISON');
console.log('='.repeat(80));

const scheduleData = placementData.slide15Data?.scheduleOfBenefits;

if (scheduleData && scheduleData.benefits) {
    console.log('\n### EXCEL DATA ###\n');

    for (const benefit of scheduleData.benefits) {
        console.log(`\nBenefit ${benefit.number}: ${benefit.name.substring(0, 50)}`);
        console.log(`  Plan1: "${benefit.plan1Value || '(empty)'}" | Plan2: "${benefit.plan2Value || '(empty)'}" | Plan3: "${benefit.plan3Value || '(empty)'}"`);

        if (benefit.subItems && benefit.subItems.length > 0) {
            for (const sub of benefit.subItems) {
                const p1 = sub.plan1Value || '(empty)';
                const p2 = sub.plan2Value || '(empty)';
                const p3 = sub.plan3Value || '(empty)';
                console.log(`  ${sub.identifier || '   '} ${sub.name.substring(0, 40)}`);
                console.log(`      Plan1: "${p1}" | Plan2: "${p2}" | Plan3: "${p3}"`);
            }
        }
    }
}

// Now check PPTX slide 15
console.log('\n' + '='.repeat(80));
console.log('### PPTX SLIDE 15 DATA ###');
console.log('='.repeat(80));

const slide15 = zip.file('ppt/slides/slide15.xml').asText();
const tablePattern = /<a:tbl\b[^>]*>([\s\S]*?)<\/a:tbl>/;
const tableMatch = slide15.match(tablePattern);

if (tableMatch) {
    const rowPattern = /<a:tr\b[^>]*>([\s\S]*?)<\/a:tr>/g;
    let match;
    let rowNum = 0;

    while ((match = rowPattern.exec(tableMatch[0])) !== null) {
        rowNum++;
        const row = match[0];

        // Extract all cell texts
        const cellPattern = /<a:tc\b[^>]*>([\s\S]*?)<\/a:tc>/g;
        let cellMatch;
        const cellTexts = [];

        while ((cellMatch = cellPattern.exec(row)) !== null) {
            const textPattern = /<a:t>([^<]*)<\/a:t>/g;
            let cellText = '';
            let tm;
            while ((tm = textPattern.exec(cellMatch[0])) !== null) {
                cellText += tm[1];
            }
            cellTexts.push(cellText.trim());
        }

        // Only show rows with content in first 2 cells (benefit/sub-item rows)
        if (cellTexts[0] || cellTexts[1]) {
            const label = (cellTexts[0] + ' ' + (cellTexts[1] || '')).trim().substring(0, 50);

            // Get plan columns (10, 11, 12 for slide 15)
            const plan1 = cellTexts[10] || '(empty)';
            const plan2 = cellTexts[11] || '(empty)';
            const plan3 = cellTexts[12] || '(empty)';

            // Check if this is a benefit or sub-item row
            const isBenefit = /^\d+$/.test(cellTexts[0]);
            const isSubItem = /^\([a-d]\)$/.test(cellTexts[0].replace(/\s/g, ''));

            if (isBenefit || isSubItem || cellTexts[0].toLowerCase().includes('maximum') ||
                cellTexts[0].toLowerCase().includes('qualification') ||
                cellTexts[1]?.toLowerCase().includes('surgical schedule')) {
                console.log(`\nRow ${rowNum}: ${label}`);
                console.log(`  Plan1: "${plan1}" | Plan2: "${plan2}" | Plan3: "${plan3}"`);
            }
        }
    }
}

// Check slide 16
console.log('\n' + '='.repeat(80));
console.log('### PPTX SLIDE 16 DATA ###');
console.log('='.repeat(80));

const slide16 = zip.file('ppt/slides/slide16.xml').asText();
const tableMatch16 = slide16.match(tablePattern);

if (tableMatch16) {
    const rowPattern = /<a:tr\b[^>]*>([\s\S]*?)<\/a:tr>/g;
    let match;
    let rowNum = 0;

    while ((match = rowPattern.exec(tableMatch16[0])) !== null) {
        rowNum++;
        const row = match[0];

        const cellPattern = /<a:tc\b[^>]*>([\s\S]*?)<\/a:tc>/g;
        let cellMatch;
        const cellTexts = [];

        while ((cellMatch = cellPattern.exec(row)) !== null) {
            const textPattern = /<a:t>([^<]*)<\/a:t>/g;
            let cellText = '';
            let tm;
            while ((tm = textPattern.exec(cellMatch[0])) !== null) {
                cellText += tm[1];
            }
            cellTexts.push(cellText.trim());
        }

        if (cellTexts[0] || cellTexts[1]) {
            const label = (cellTexts[0] + ' ' + (cellTexts[1] || '')).trim().substring(0, 50);

            // Slide 16 uses columns 12, 13, 14 for plan values
            const plan1 = cellTexts[12] || '(empty)';
            const plan2 = cellTexts[13] || '(empty)';
            const plan3 = cellTexts[14] || '(empty)';

            const isBenefit = /^\d+$/.test(cellTexts[0]) && parseInt(cellTexts[0]) >= 7;
            const isSubItem = /^\([a-d]\)$/.test(cellTexts[0].replace(/\s/g, ''));

            if (isBenefit || isSubItem || cellTexts[1]?.toLowerCase().includes('pre-existing') ||
                cellTexts[1]?.toLowerCase().includes('pre- existing')) {
                console.log(`\nRow ${rowNum}: ${label}`);
                console.log(`  Plan1: "${plan1}" | Plan2: "${plan2}" | Plan3: "${plan3}"`);
            }
        }
    }
}
