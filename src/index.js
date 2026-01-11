import 'dotenv/config';
import { initGmail } from './services/gmail.js';
import { initSheets, ensureCRMSheet } from './services/sheets.js';
import { initCalendar } from './services/calendar.js';
import { initClaude } from './services/claude.js';
import { startContinuousSync, runSyncCycle, printCRMStatus } from './services/sync.js';
import { log, error } from './utils/logger.js';

// Configuration from environment
const config = {
  // Service Account path
  serviceAccountPath: process.env.GOOGLE_SERVICE_ACCOUNT_PATH || './service-account.json',
  // Google Sheet ID for CRM
  sheetId: process.env.GOOGLE_SHEET_ID,
  // Claude API key
  claudeApiKey: process.env.CLAUDE_API_KEY,
  // Email addresses to monitor (comma-separated)
  monitoredEmails: (process.env.MONITORED_EMAILS || '').split(',').map(e => e.trim()).filter(Boolean),
  // Sync interval in minutes
  syncInterval: parseInt(process.env.SYNC_INTERVAL_MINUTES || '5', 10)
};

/**
 * Validate required configuration
 */
function validateConfig() {
  const errors = [];

  if (!config.sheetId) errors.push('GOOGLE_SHEET_ID');
  if (!config.claudeApiKey) errors.push('CLAUDE_API_KEY');
  if (config.monitoredEmails.length === 0) errors.push('MONITORED_EMAILS');

  if (errors.length > 0) {
    error('Missing required environment variables:');
    errors.forEach(name => error(`  - ${name}`));
    error('See .env.example for required configuration.');
    process.exit(1);
  }
}

/**
 * Initialize all services
 */
async function initialize() {
  log('========================================');
  log('EMAIL-CRM SYNC AGENT');
  log('========================================');

  log('[Init] Validating configuration...');
  validateConfig();

  log(`[Init] Monitoring emails: ${config.monitoredEmails.join(', ')}`);

  log('[Init] Initializing Claude API...');
  initClaude(config.claudeApiKey);

  log('[Init] Initializing Gmail API...');
  initGmail(config.serviceAccountPath, config.monitoredEmails);

  log('[Init] Initializing Google Calendar API...');
  initCalendar(config.serviceAccountPath, config.monitoredEmails);

  log('[Init] Initializing Google Sheets API...');
  initSheets(config.serviceAccountPath, config.sheetId);

  log('[Init] Ensuring CRM sheet exists...');
  await ensureCRMSheet();

  log('[Init] All services initialized successfully!');
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
      log('[Main] Running single sync cycle...');
      await runSyncCycle();
      log('[Main] Done.');
      process.exit(0);
    } else {
      // Start continuous sync
      log(`[Main] Starting continuous sync (every ${config.syncInterval} minutes)`);
      log('[Main] Press Ctrl+C to stop');

      const stopSync = startContinuousSync(config.syncInterval);

      // Handle graceful shutdown
      process.on('SIGINT', () => {
        log('[Main] Shutting down...');
        stopSync();
        process.exit(0);
      });

      process.on('SIGTERM', () => {
        log('[Main] Shutting down...');
        stopSync();
        process.exit(0);
      });
    }
  } catch (err) {
    error('[Main] Fatal error:', err);
    process.exit(1);
  }
}

// Run
main();
