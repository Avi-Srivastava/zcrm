import 'dotenv/config';
import { initGmail, fetchEmailsFromPastDays, groupEmailsByContact, getMonitoredEmails } from './services/gmail.js';
import { initSheets, ensureCRMSheet, addInvestor, findInvestorByEmail, updateInvestor, appendNotes, sortByMeetingDate, clearCRMData } from './services/sheets.js';
import { initCalendar, getNextMeetingWithAttendee, getLastMeetingWithAttendee } from './services/calendar.js';
import { initClaude, analyzeEmail, summarizeEmailThread } from './services/claude.js';

// Configuration from environment
const config = {
  serviceAccountPath: process.env.GOOGLE_SERVICE_ACCOUNT_PATH || './service-account.json',
  sheetId: process.env.GOOGLE_SHEET_ID,
  claudeApiKey: process.env.CLAUDE_API_KEY,
  monitoredEmails: (process.env.MONITORED_EMAILS || '').split(',').map(e => e.trim()).filter(Boolean)
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
    console.error('Missing required environment variables:');
    errors.forEach(name => console.error(`  - ${name}`));
    process.exit(1);
  }
}

/**
 * Initialize all services
 */
async function initialize() {
  console.log('========================================');
  console.log('CRM BACKFILL');
  console.log('========================================\n');

  validateConfig();

  console.log(`[Init] Monitoring emails: ${config.monitoredEmails.join(', ')}`);

  initClaude(config.claudeApiKey);
  initGmail(config.serviceAccountPath, config.monitoredEmails);
  initCalendar(config.serviceAccountPath, config.monitoredEmails);
  initSheets(config.serviceAccountPath, config.sheetId);

  await ensureCRMSheet();

  console.log('[Init] All services initialized\n');
}

/**
 * Process a contact and add/update in CRM
 */
async function processContact(contactEmail, emails) {
  console.log(`\n[Backfill] Processing: ${contactEmail} (${emails.length} emails)`);

  // Check if already in CRM
  const existing = await findInvestorByEmail(contactEmail);

  // Get calendar info for this contact
  const nextMeeting = await getNextMeetingWithAttendee(contactEmail);
  const lastMeeting = await getLastMeetingWithAttendee(contactEmail);

  // Sort emails by date (oldest first for analysis)
  emails.sort((a, b) => new Date(a.date) - new Date(b.date));

  // Get the most recent email for primary analysis
  const latestEmail = emails[emails.length - 1];

  // Analyze latest email
  const analysis = await analyzeEmail(latestEmail, existing);

  if (!analysis || !analysis.isRelevant) {
    console.log(`[Backfill] Skipping ${contactEmail} - not relevant`);
    return { action: 'skipped', reason: 'not_relevant' };
  }

  // Determine meeting status from calendar + email analysis
  let meetingStatus = analysis.meetingStatus;
  let meetingDate = analysis.meetingDate;

  if (nextMeeting) {
    // Has upcoming meeting
    meetingStatus = 'Scheduled';
    meetingDate = nextMeeting.start.split('T')[0];
    console.log(`[Backfill] Found upcoming meeting: ${nextMeeting.title} on ${meetingDate}`);
  } else if (lastMeeting) {
    // Had a past meeting
    if (!meetingStatus || meetingStatus === 'New Contact') {
      meetingStatus = 'Completed';
      meetingDate = lastMeeting.start.split('T')[0];
      console.log(`[Backfill] Found past meeting: ${lastMeeting.title} on ${meetingDate}`);
    }
  }

  // Generate summary of all emails
  let notes = analysis.noteSummary || '';
  if (emails.length > 1) {
    const threadSummary = await summarizeEmailThread(emails);
    if (threadSummary) {
      notes = threadSummary;
    }
  }

  // Get last contact date
  const lastContact = new Date(latestEmail.date).toISOString().split('T')[0];

  if (existing) {
    // Update existing
    const updates = { lastContact };

    if (meetingStatus) updates.meetingStatus = meetingStatus;
    if (meetingDate) updates.meetingDate = meetingDate;
    if (analysis.company && !existing.company) updates.company = analysis.company;

    await updateInvestor(existing.rowIndex, updates);

    if (notes) {
      await appendNotes(existing.rowIndex, notes, existing.notes);
    }

    console.log(`[Backfill] Updated: ${existing.name}`);
    return { action: 'updated', investor: existing.name };
  } else {
    // Add new
    await addInvestor({
      name: analysis.investorName || latestEmail.fromName,
      email: contactEmail,
      company: analysis.company || '',
      meetingStatus: meetingStatus || 'New Contact',
      meetingDate: meetingDate || '',
      lastContact,
      notes
    });

    console.log(`[Backfill] Added: ${analysis.investorName || latestEmail.fromName}`);
    return { action: 'added', investor: analysis.investorName || latestEmail.fromName };
  }
}

/**
 * Main backfill function
 */
async function runBackfill(days = 7, clearFirst = false) {
  try {
    await initialize();

    if (clearFirst) {
      console.log('[Backfill] Clearing existing CRM data...');
      await clearCRMData();
    }

    // Fetch all emails from past week
    console.log(`[Backfill] Fetching emails from past ${days} days...`);
    const emails = await fetchEmailsFromPastDays(days);
    console.log(`[Backfill] Found ${emails.length} total emails`);

    // Group by contact
    const monitoredEmails = getMonitoredEmails();
    const byContact = groupEmailsByContact(emails, monitoredEmails);
    console.log(`[Backfill] Found ${byContact.size} unique contacts`);

    const results = {
      added: 0,
      updated: 0,
      skipped: 0
    };

    // Process each contact
    for (const [contactEmail, contactEmails] of byContact) {
      try {
        const result = await processContact(contactEmail, contactEmails);

        if (result.action === 'added') results.added++;
        else if (result.action === 'updated') results.updated++;
        else results.skipped++;

        // Small delay to avoid rate limits
        await new Promise(r => setTimeout(r, 500));
      } catch (error) {
        console.error(`[Backfill] Error processing ${contactEmail}:`, error.message);
        results.skipped++;
      }
    }

    // Sort sheet by meeting date
    console.log('\n[Backfill] Sorting CRM by meeting date...');
    await sortByMeetingDate();

    console.log('\n========================================');
    console.log('BACKFILL COMPLETE');
    console.log('========================================');
    console.log(`Added: ${results.added}`);
    console.log(`Updated: ${results.updated}`);
    console.log(`Skipped: ${results.skipped}`);
    console.log('========================================\n');

  } catch (error) {
    console.error('[Backfill] Fatal error:', error);
    process.exit(1);
  }
}

// Parse args
const args = process.argv.slice(2);
const days = parseInt(args.find(a => a.match(/^\d+$/)) || '7', 10);
const clearFirst = args.includes('--clear');

runBackfill(days, clearFirst);
