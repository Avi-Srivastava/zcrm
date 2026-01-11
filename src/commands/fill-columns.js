import 'dotenv/config';
import { initSheets, getInvestors, updateInvestor, discoverColumns, columnMap } from '../services/sheets.js';
import { initClaude, researchInvestor } from '../services/claude.js';
import { log, error } from '../utils/logger.js';

const SHEET_ID = process.env.GOOGLE_SHEET_ID;
const SERVICE_ACCOUNT_PATH = process.env.GOOGLE_SERVICE_ACCOUNT_PATH || './service-account.json';
const CLAUDE_API_KEY = process.env.CLAUDE_API_KEY;

async function fillColumns() {
  log('========================================');
  log('FILL EMPTY COLUMNS');
  log('========================================\n');

  // Initialize services
  await initSheets(SERVICE_ACCOUNT_PATH, SHEET_ID);
  await discoverColumns();
  initClaude(CLAUDE_API_KEY);

  const investors = await getInvestors();
  log(`Found ${investors.length} investors\n`);

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

    log(`\n[Fill] ${inv.name} - filling: ${emptyFields.join(', ')}`);

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
          log(`[Fill] Updated: ${JSON.stringify(updates)}`);
        }
      }
    } catch (err) {
      error(`[Fill] Error for ${inv.name}:`, err.message);
    }
  }

  log('\n[Fill] Complete!');
}

fillColumns().catch(err => error(err));
