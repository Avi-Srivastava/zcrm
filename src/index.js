import 'dotenv/config';
import { initGmail } from './services/gmail.js';
import { initSheets, ensureCRMSheet } from './services/sheets.js';
import { initClaude } from './services/claude.js';
import { startContinuousSync, runSyncCycle, printCRMStatus } from './services/sync.js';

// Configuration from environment
const config = {
  // Google OAuth credentials
  google: {
    clientId: process.env.GOOGLE_CLIENT_ID,
    clientSecret: process.env.GOOGLE_CLIENT_SECRET,
    redirectUri: process.env.GOOGLE_REDIRECT_URI || 'http://localhost:3000/oauth/callback'
  },
  // Google OAuth tokens (obtained after first auth)
  tokens: {
    access_token: process.env.GOOGLE_ACCESS_TOKEN,
    refresh_token: process.env.GOOGLE_REFRESH_TOKEN
  },
  // Google Sheet ID for CRM
  sheetId: process.env.GOOGLE_SHEET_ID,
  // Claude API key
  claudeApiKey: process.env.CLAUDE_API_KEY,
  // Your email address (to identify outgoing emails)
  myEmail: process.env.MY_EMAIL,
  // Sync interval in minutes
  syncInterval: parseInt(process.env.SYNC_INTERVAL_MINUTES || '5', 10)
};

/**
 * Validate required configuration
 */
function validateConfig() {
  const required = [
    ['GOOGLE_CLIENT_ID', config.google.clientId],
    ['GOOGLE_CLIENT_SECRET', config.google.clientSecret],
    ['GOOGLE_ACCESS_TOKEN', config.tokens.access_token],
    ['GOOGLE_REFRESH_TOKEN', config.tokens.refresh_token],
    ['GOOGLE_SHEET_ID', config.sheetId],
    ['CLAUDE_API_KEY', config.claudeApiKey],
    ['MY_EMAIL', config.myEmail]
  ];

  const missing = required.filter(([name, value]) => !value).map(([name]) => name);

  if (missing.length > 0) {
    console.error('Missing required environment variables:');
    missing.forEach(name => console.error(`  - ${name}`));
    console.error('\nSee .env.example for required configuration.');
    process.exit(1);
  }
}

/**
 * Initialize all services
 */
async function initialize() {
  console.log('========================================');
  console.log('EMAIL-CRM SYNC AGENT');
  console.log('========================================\n');

  console.log('[Init] Validating configuration...');
  validateConfig();

  console.log('[Init] Initializing Claude API...');
  initClaude(config.claudeApiKey);

  console.log('[Init] Initializing Gmail API...');
  const googleCredentials = {
    client_id: config.google.clientId,
    client_secret: config.google.clientSecret,
    redirect_uri: config.google.redirectUri
  };
  initGmail(googleCredentials, config.tokens);

  console.log('[Init] Initializing Google Sheets API...');
  initSheets(googleCredentials, config.tokens, config.sheetId);

  console.log('[Init] Ensuring CRM sheet exists...');
  await ensureCRMSheet();

  // Set MY_EMAIL for use in other modules
  process.env.MY_EMAIL = config.myEmail;

  console.log('[Init] All services initialized successfully!\n');
}

/**
 * Main entry point
 */
async function main() {
  try {
    await initialize();

    // Print current CRM status
    await printCRMStatus();

    // Check command line arguments
    const args = process.argv.slice(2);

    if (args.includes('--once')) {
      // Run single sync cycle
      console.log('[Main] Running single sync cycle...');
      await runSyncCycle();
      console.log('[Main] Done.');
      process.exit(0);
    } else {
      // Start continuous sync
      console.log(`[Main] Starting continuous sync (every ${config.syncInterval} minutes)`);
      console.log('[Main] Press Ctrl+C to stop\n');

      const stopSync = startContinuousSync(config.syncInterval);

      // Handle graceful shutdown
      process.on('SIGINT', () => {
        console.log('\n[Main] Shutting down...');
        stopSync();
        process.exit(0);
      });

      process.on('SIGTERM', () => {
        console.log('\n[Main] Shutting down...');
        stopSync();
        process.exit(0);
      });
    }
  } catch (error) {
    console.error('[Main] Fatal error:', error);
    process.exit(1);
  }
}

// Run
main();
