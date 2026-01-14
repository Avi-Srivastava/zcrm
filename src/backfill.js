import 'dotenv/config';
import { initGmail, fetchEmailsFromPastDays, groupEmailsByContact, getMonitoredEmails } from './services/gmail.js';
import { initSheets, ensureCRMSheet, addInvestor, findInvestorByEmail, updateInvestor, appendNotes, sortByMeetingDate, clearCRMData, formatMeetingDate, formatMeetingTime, updateRowColors } from './services/sheets.js';
import { initCalendar, getNextMeetingWithAttendee, getLastMeetingWithAttendee } from './services/calendar.js';
import { initClaude, analyzeEmail, summarizeEmailThread } from './services/claude.js';
import { log, error } from './utils/logger.js';

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
    error('Missing required environment variables:');
    errors.forEach(name => error(`  - ${name}`));
    process.exit(1);
  }
}

/**
 * Initialize all services
 */
async function initialize() {
  log('========================================');
  log('CRM BACKFILL');
  log('========================================\n');

  validateConfig();

  log(`[Init] Monitoring emails: ${config.monitoredEmails.join(', ')}`);

  initClaude(config.claudeApiKey);
  initGmail(config.serviceAccountPath, config.monitoredEmails);
  initCalendar(config.serviceAccountPath, config.monitoredEmails);
  initSheets(config.serviceAccountPath, config.sheetId);

  await ensureCRMSheet();

  log('[Init] All services initialized\n');
}

/**
 * Determine who the meeting/email is with based on recipients
 */
function determineWith(emails) {
  let hasAvi = false;
  let hasYuval = false;

  for (const email of emails) {
    const to = (email.to || '').toLowerCase();
    const from = (email.from || '').toLowerCase();
    if (to.includes('avi@') || from.includes('avi@')) hasAvi = true;
    if (to.includes('yuval@') || from.includes('yuval@')) hasYuval = true;
  }

  if (hasAvi && hasYuval) return 'Both';
  if (hasAvi) return 'Avi';
  if (hasYuval) return 'Yuval';
  return 'Both';
}

/**
 * Process a contact and add/update in CRM
 */
async function processContact(contactEmail, emails) {
  log(`\n[Backfill] Processing: ${contactEmail} (${emails.length} emails)`);

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
    log(`[Backfill] Skipping ${contactEmail} - not relevant`);
    return { action: 'skipped', reason: 'not_relevant' };
  }

  // Only track VC investors
  if (!analysis.isVCInvestor) {
    log(`[Backfill] Skipping ${contactEmail} - not a VC investor`);
    return { action: 'skipped', reason: 'not_vc_investor' };
  }

  // Determine meeting status from calendar + email analysis
  let meetingStatus = analysis.meetingStatus;
  let meetingDate = analysis.meetingDate;
  let meetingTime = '';
  let calendarLink = '';
  let meetLink = '';
  let needsResponse = false;

  if (nextMeeting) {
    // Has upcoming meeting
    meetingStatus = 'Scheduled';
    meetingDate = nextMeeting.start.split('T')[0];
    meetingTime = formatMeetingTime(nextMeeting.start);
    calendarLink = nextMeeting.calendarLink || '';
    meetLink = nextMeeting.meetLink || '';
    needsResponse = nextMeeting.needsResponse || false;
    log(`[Backfill] Found upcoming meeting: ${nextMeeting.title} on ${meetingDate} at ${meetingTime}${needsResponse ? ' (needs response)' : ''}`);
  } else if (lastMeeting) {
    // Had a past meeting
    if (!meetingStatus || meetingStatus === 'New Contact') {
      meetingStatus = 'Completed';
      meetingDate = lastMeeting.start.split('T')[0];
      meetingTime = formatMeetingTime(lastMeeting.start);
      calendarLink = lastMeeting.calendarLink || '';
      meetLink = lastMeeting.meetLink || '';
      log(`[Backfill] Found past meeting: ${lastMeeting.title} on ${meetingDate} at ${meetingTime}`);
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

  // Determine who the meeting is with
  const meetingWith = determineWith(emails);

  // Format meeting date as "11 Jan 2025"
  const formattedMeetingDate = meetingDate ? formatMeetingDate(meetingDate) : '';

  if (existing) {
    // Update existing
    const updates = { lastContact, with: meetingWith };

    if (meetingStatus) updates.meetingStatus = meetingStatus;
    if (formattedMeetingDate) updates.meetingDate = formattedMeetingDate;
    if (meetingTime) updates.meetingTime = meetingTime;
    if (calendarLink) updates.calendarLink = calendarLink;
    if (meetLink) updates.meetLink = meetLink;
    if (analysis.company && !existing.company) updates.company = analysis.company;
    updates.needsResponse = needsResponse ? 'Yes' : 'No';

    await updateInvestor(existing.rowIndex, updates);

    if (notes) {
      await appendNotes(existing.rowIndex, notes, existing.notes);
    }

    log(`[Backfill] Updated: ${existing.name}`);
    return { action: 'updated', investor: existing.name };
  } else {
    // Add new
    await addInvestor({
      name: analysis.investorName || latestEmail.fromName,
      email: contactEmail,
      company: analysis.company || '',
      meetingStatus: meetingStatus || 'Follow-up',
      meetingDate: formattedMeetingDate,
      meetingTime: meetingTime || '',
      lastContact,
      with: meetingWith,
      calendarLink: calendarLink || '',
      meetLink: meetLink || '',
      needsResponse: needsResponse ? 'Yes' : 'No',
      notes
    });

    log(`[Backfill] Added: ${analysis.investorName || latestEmail.fromName}`);
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
      log('[Backfill] Clearing existing CRM data...');
      await clearCRMData();
    }

    // Fetch all emails from past week
    log(`[Backfill] Fetching emails from past ${days} days...`);
    const emails = await fetchEmailsFromPastDays(days);
    log(`[Backfill] Found ${emails.length} total emails`);

    // Group by contact
    const monitoredEmails = getMonitoredEmails();
    const byContact = groupEmailsByContact(emails, monitoredEmails);
    log(`[Backfill] Found ${byContact.size} unique contacts`);

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
      } catch (err) {
        error(`[Backfill] Error processing ${contactEmail}:`, err.message);
        results.skipped++;
      }
    }

    // Sort sheet by meeting date
    log('\n[Backfill] Sorting CRM by meeting date...');
    await sortByMeetingDate();

    // Color upcoming meetings green
    log('[Backfill] Coloring upcoming meetings green...');
    await updateRowColors();

    log('\n========================================');
    log('BACKFILL COMPLETE');
    log('========================================');
    log(`Added: ${results.added}`);
    log(`Updated: ${results.updated}`);
    log(`Skipped: ${results.skipped}`);
    log('========================================\n');

  } catch (err) {
    error('[Backfill] Fatal error:', err);
    process.exit(1);
  }
}

// Parse args
const args = process.argv.slice(2);
const days = parseInt(args.find(a => a.match(/^\d+$/)) || '7', 10);
const clearFirst = args.includes('--clear');

runBackfill(days, clearFirst);
