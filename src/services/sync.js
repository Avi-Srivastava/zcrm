import { fetchNewEmails } from './gmail.js';
import { findInvestorByEmail, addInvestor, updateInvestor, appendNotes, getInvestors, sortByMeetingDate } from './sheets.js';
import { analyzeEmail } from './claude.js';
import { getNextMeetingWithAttendee, getLastMeetingWithAttendee } from './calendar.js';

/**
 * Process a single email and update CRM accordingly
 */
export async function processEmail(email) {
  console.log(`\n[Sync] Processing email: "${email.subject}" from ${email.from}`);

  // Find if investor already exists
  const existingInvestor = await findInvestorByEmail(email.from);

  // Analyze email with Claude
  const analysis = await analyzeEmail(email, existingInvestor);

  if (!analysis) {
    console.log('[Sync] Could not analyze email, skipping');
    return { action: 'skipped', reason: 'analysis_failed' };
  }

  if (!analysis.isRelevant) {
    console.log('[Sync] Email not relevant for CRM, skipping');
    return { action: 'skipped', reason: 'not_relevant' };
  }

  const today = new Date().toISOString().split('T')[0];

  // Check calendar for this contact
  const contactEmail = existingInvestor ? existingInvestor.email : email.from;
  let meetingStatus = analysis.meetingStatus;
  let meetingDate = analysis.meetingDate;

  try {
    const nextMeeting = await getNextMeetingWithAttendee(contactEmail);
    const lastMeeting = await getLastMeetingWithAttendee(contactEmail);

    if (nextMeeting) {
      meetingStatus = 'Scheduled';
      meetingDate = nextMeeting.start.split('T')[0];
      console.log(`[Sync] Found upcoming meeting on ${meetingDate}`);
    } else if (lastMeeting && !meetingStatus) {
      meetingStatus = 'Completed';
      meetingDate = lastMeeting.start.split('T')[0];
    }
  } catch (calError) {
    console.log(`[Sync] Calendar check skipped: ${calError.message}`);
  }

  if (existingInvestor) {
    // Update existing investor
    const updates = {
      lastContact: today
    };

    // Update meeting status if changed
    if (meetingStatus && meetingStatus !== existingInvestor.meetingStatus) {
      updates.meetingStatus = meetingStatus;
    }

    // Update meeting date if provided
    if (meetingDate) {
      updates.meetingDate = meetingDate;
    }

    // Update company if we didn't have it
    if (analysis.company && !existingInvestor.company) {
      updates.company = analysis.company;
    }

    await updateInvestor(existingInvestor.rowIndex, updates);

    // Append notes
    if (analysis.noteSummary) {
      await appendNotes(existingInvestor.rowIndex, analysis.noteSummary, existingInvestor.notes);
    }

    console.log(`[Sync] Updated investor: ${existingInvestor.name}`);
    return { action: 'updated', investor: existingInvestor.name };
  } else {
    // Add new investor
    await addInvestor({
      name: analysis.investorName || email.fromName,
      email: email.from,
      company: analysis.company || '',
      meetingStatus: meetingStatus || 'New Contact',
      meetingDate: meetingDate || '',
      lastContact: today,
      notes: analysis.noteSummary || `Initial contact via email: "${email.subject}"`
    });

    console.log(`[Sync] Added new investor: ${analysis.investorName || email.fromName}`);
    return { action: 'added', investor: analysis.investorName || email.fromName };
  }
}

/**
 * Run a full sync cycle - check for new emails and process them
 */
export async function runSyncCycle() {
  console.log('\n========================================');
  console.log(`[Sync] Starting sync cycle at ${new Date().toISOString()}`);
  console.log('========================================');

  try {
    // Fetch new emails
    const emails = await fetchNewEmails();
    console.log(`[Sync] Found ${emails.length} new email(s)`);

    if (emails.length === 0) {
      console.log('[Sync] No new emails to process');
      return { processed: 0, added: 0, updated: 0, skipped: 0 };
    }

    const results = {
      processed: 0,
      added: 0,
      updated: 0,
      skipped: 0
    };

    // Process each email
    for (const email of emails) {
      try {
        const result = await processEmail(email);
        results.processed++;

        if (result.action === 'added') results.added++;
        else if (result.action === 'updated') results.updated++;
        else if (result.action === 'skipped') results.skipped++;
      } catch (error) {
        console.error(`[Sync] Error processing email "${email.subject}":`, error.message);
        results.skipped++;
      }
    }

    // Sort by meeting date after updates
    if (results.added > 0 || results.updated > 0) {
      await sortByMeetingDate();
    }

    console.log('\n[Sync] Cycle complete:', results);
    return results;
  } catch (error) {
    console.error('[Sync] Sync cycle failed:', error.message);
    throw error;
  }
}

/**
 * Start the continuous sync process
 */
export function startContinuousSync(intervalMinutes = 5) {
  console.log(`[Sync] Starting continuous sync every ${intervalMinutes} minutes`);

  // Run immediately
  runSyncCycle().catch(err => console.error('[Sync] Initial cycle error:', err));

  // Then run on interval
  const intervalMs = intervalMinutes * 60 * 1000;
  const intervalId = setInterval(() => {
    runSyncCycle().catch(err => console.error('[Sync] Cycle error:', err));
  }, intervalMs);

  // Return function to stop sync
  return () => {
    clearInterval(intervalId);
    console.log('[Sync] Continuous sync stopped');
  };
}

/**
 * Print current CRM status
 */
export async function printCRMStatus() {
  const investors = await getInvestors();

  console.log('\n========================================');
  console.log('CURRENT CRM STATUS');
  console.log('========================================');
  console.log(`Total investors: ${investors.length}\n`);

  for (const inv of investors) {
    console.log(`${inv.name} (${inv.email})`);
    console.log(`  Company: ${inv.company || 'N/A'}`);
    console.log(`  Status: ${inv.meetingStatus || 'N/A'}`);
    console.log(`  Meeting Date: ${inv.meetingDate || 'N/A'}`);
    console.log(`  Last Contact: ${inv.lastContact || 'N/A'}`);
    console.log('');
  }
}
