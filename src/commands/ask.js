import 'dotenv/config';
import { initSheets, getInvestors, discoverColumns } from '../services/sheets.js';
import { initClaude, askAboutSheet } from '../services/claude.js';

const SHEET_ID = process.env.GOOGLE_SHEET_ID;
const SERVICE_ACCOUNT_PATH = process.env.GOOGLE_SERVICE_ACCOUNT_PATH || './service-account.json';
const CLAUDE_API_KEY = process.env.CLAUDE_API_KEY;

// Get the question from arguments
const question = process.argv.slice(2).join(' ');

if (!question) {
  console.log('Usage: npm run ask -- "your question"');
  console.log('\nExamples:');
  console.log('  npm run ask -- "Who are the most engaged investors?"');
  console.log('  npm run ask -- "What is Sequoia known for investing in?"');
  console.log('  npm run ask -- "Which investors have meetings scheduled?"');
  console.log('  npm run ask -- "Tell me about John Smith from a]16z"');
  process.exit(1);
}

async function ask() {
  console.log('========================================');
  console.log('ASK ABOUT CRM');
  console.log('========================================');
  console.log(`Question: ${question}\n`);

  // Initialize services
  await initSheets(SERVICE_ACCOUNT_PATH, SHEET_ID);
  await discoverColumns();
  initClaude(CLAUDE_API_KEY);

  const investors = await getInvestors();

  console.log('[Ask] Analyzing your CRM and searching the web...\n');

  try {
    const answer = await askAboutSheet(investors, question);
    console.log('========================================');
    console.log('ANSWER');
    console.log('========================================');
    console.log(answer);
  } catch (error) {
    console.error('Error:', error.message);
  }
}

ask().catch(console.error);
