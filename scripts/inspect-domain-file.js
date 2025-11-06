/**
 * Inspect Domain Contact List.xlsx structure
 */

const XLSX = require('xlsx');

const filePath = 'C:\\Users\\huien\\Desktop\\Domain Contact List.xlsx';

try {
    console.log('📂 Reading Excel file:', filePath);

    const workbook = XLSX.readFile(filePath);

    console.log('\n📊 WORKBOOK STRUCTURE:');
    console.log('═══════════════════════════════════════\n');

    console.log('Sheet Names:', workbook.SheetNames);
    console.log('\n');

    // Inspect each sheet
    workbook.SheetNames.forEach((sheetName, index) => {
        console.log(`\n━━━ SHEET ${index + 1}: "${sheetName}" ━━━\n`);

        const worksheet = workbook.Sheets[sheetName];
        const data = XLSX.utils.sheet_to_json(worksheet);

        console.log(`Total rows: ${data.length}`);

        if (data.length > 0) {
            console.log('\nColumn Headers:');
            const headers = Object.keys(data[0]);
            headers.forEach((header, i) => {
                console.log(`  ${i + 1}. ${header}`);
            });

            console.log('\nFirst 5 Rows Sample:');
            data.slice(0, 5).forEach((row, i) => {
                console.log(`\n  Row ${i + 1}:`);
                Object.keys(row).forEach(key => {
                    const value = row[key];
                    if (value) {
                        console.log(`    ${key}: ${value}`);
                    }
                });
            });
        } else {
            console.log('⚠️  Sheet is empty');
        }

        console.log('\n' + '─'.repeat(60));
    });

    console.log('\n✅ Inspection complete');

} catch (error) {
    console.error('❌ Error reading Excel file:', error.message);
}
