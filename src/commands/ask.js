import 'dotenv/config';
import { initSheets, getInvestors, discoverColumns } from '../services/sheets.js';
import { initClaude, askAboutSheet } from '../services/claude.js';
import { log, error } from '../utils/logger.js';

const SHEET_ID = process.env.GOOGLE_SHEET_ID;
const SERVICE_ACCOUNT_PATH = process.env.GOOGLE_SERVICE_ACCOUNT_PATH || './service-account.json';
const CLAUDE_API_KEY = process.env.CLAUDE_API_KEY;

// Get the question from arguments
const question = process.argv.slice(2).join(' ');

if (!question) {
  log('Usage: npm run ask -- "your question"');
  log('\nExamples:');
  log('  npm run ask -- "Who are the most engaged investors?"');
  log('  npm run ask -- "What is Sequoia known for investing in?"');
  log('  npm run ask -- "Which investors have meetings scheduled?"');
  log('  npm run ask -- "Tell me about John Smith from a]16z"');
  process.exit(1);
}

async function ask() {
  log('========================================');
  log('ASK ABOUT CRM');
  log('========================================');
  log(`Question: ${question}\n`);

  // Initialize services
  await initSheets(SERVICE_ACCOUNT_PATH, SHEET_ID);
  await discoverColumns();
  initClaude(CLAUDE_API_KEY);

  const investors = await getInvestors();

  log('[Ask] Analyzing your CRM and searching the web...\n');

  try {
    const answer = await askAboutSheet(investors, question);
    log('========================================');
    log('ANSWER');
    log('========================================');
    log(answer);
  } catch (err) {
    error('Error:', err.message);
  }
}

ask().catch(err => error(err));
