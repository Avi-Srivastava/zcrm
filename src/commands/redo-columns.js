import 'dotenv/config';
import { initSheets, getInvestors, updateInvestor, discoverColumns, columnMap } from '../services/sheets.js';
import { initClaude, redoColumnForInvestor } from '../services/claude.js';
import { log, error } from '../utils/logger.js';

const SHEET_ID = process.env.GOOGLE_SHEET_ID;
const SERVICE_ACCOUNT_PATH = process.env.GOOGLE_SERVICE_ACCOUNT_PATH || './service-account.json';
const CLAUDE_API_KEY = process.env.CLAUDE_API_KEY;

// Parse arguments
const args = process.argv.slice(2);
let columns = [];
let prompt = '';

for (let i = 0; i < args.length; i++) {
  if (args[i] === '--columns' && args[i + 1]) {
    columns = args[i + 1].split(',').map(c => c.trim().toLowerCase());
    i++;
  } else if (args[i] === '--prompt' && args[i + 1]) {
    prompt = args[i + 1];
    i++;
  }
}

if (columns.length === 0) {
  log('Usage: npm run redo-columns -- --columns "meeting,name" --prompt "your guidance"');
  log('\nExample:');
  log('  npm run redo-columns -- --columns "notes" --prompt "Focus on investment interest and next steps"');
  log('  npm run redo-columns -- --columns "company" --prompt "Find their VC firm name"');
  process.exit(1);
}

async function redoColumns() {
  log('========================================');
  log('REDO COLUMNS');
  log('========================================');
  log(`Columns: ${columns.join(', ')}`);
  log(`Prompt: ${prompt || '(none)'}\n`);

  // Initialize services
  await initSheets(SERVICE_ACCOUNT_PATH, SHEET_ID);
  await discoverColumns();
  initClaude(CLAUDE_API_KEY);

  const investors = await getInvestors();
  log(`Found ${investors.length} investors\n`);

  // Map column names to actual field names
  const fieldMap = {
    'meeting': 'meetingDate',
    'meetingdate': 'meetingDate',
    'meeting date': 'meetingDate',
    'status': 'meetingStatus',
    'meetingstatus': 'meetingStatus',
    'meeting status': 'meetingStatus',
    'name': 'name',
    'company': 'company',
    'email': 'email',
    'notes': 'notes',
    'with': 'with',
    'lastcontact': 'lastContact',
    'last contact': 'lastContact'
  };

  const targetFields = columns.map(c => fieldMap[c.toLowerCase()] || c);

  for (const inv of investors) {
    log(`\n[Redo] Processing: ${inv.name}`);

    try {
      const result = await redoColumnForInvestor(inv, targetFields, prompt);

      if (result) {
        const updates = {};
        for (const field of targetFields) {
          if (result[field] !== undefined) {
            updates[field] = result[field];
          }
        }

        if (Object.keys(updates).length > 0) {
          await updateInvestor(inv.rowIndex, updates);
          log(`[Redo] Updated: ${JSON.stringify(updates)}`);
        }
      }
    } catch (err) {
      error(`[Redo] Error for ${inv.name}:`, err.message);
    }
  }

  log('\n[Redo] Complete!');
}

redoColumns().catch(err => error(err));
