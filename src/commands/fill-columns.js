import 'dotenv/config';
import { initSheets, getInvestors, updateInvestor, discoverColumns, columnMap } from '../services/sheets.js';
import { initClaude, researchInvestor } from '../services/claude.js';

const SHEET_ID = process.env.GOOGLE_SHEET_ID;
const SERVICE_ACCOUNT_PATH = process.env.GOOGLE_SERVICE_ACCOUNT_PATH || './service-account.json';
const CLAUDE_API_KEY = process.env.CLAUDE_API_KEY;

async function fillColumns() {
  console.log('========================================');
  console.log('FILL EMPTY COLUMNS');
  console.log('========================================\n');

  // Initialize services
  await initSheets(SERVICE_ACCOUNT_PATH, SHEET_ID);
  await discoverColumns();
  initClaude(CLAUDE_API_KEY);

  const investors = await getInvestors();
  console.log(`Found ${investors.length} investors\n`);

  // Find columns that have empty values
  const allColumns = Object.keys(columnMap);

  for (const inv of investors) {
    const emptyFields = [];

    for (const field of allColumns) {
      if (!inv[field] || inv[field].trim() === '') {
        emptyFields.push(field);
      }
    }

    if (emptyFields.length === 0) continue;

    console.log(`\n[Fill] ${inv.name} - filling: ${emptyFields.join(', ')}`);

    try {
      const research = await researchInvestor(inv, emptyFields);

      if (research) {
        const updates = {};
        for (const field of emptyFields) {
          if (research[field]) {
            updates[field] = research[field];
          }
        }

        if (Object.keys(updates).length > 0) {
          await updateInvestor(inv.rowIndex, updates);
          console.log(`[Fill] Updated: ${JSON.stringify(updates)}`);
        }
      }
    } catch (error) {
      console.error(`[Fill] Error for ${inv.name}:`, error.message);
    }
  }

  console.log('\n[Fill] Complete!');
}

fillColumns().catch(console.error);
