import { fetchNewEmails } from './gmail.js';
import { findInvestorByEmail, findInvestorByName, addInvestor, updateInvestor, appendNotes, getInvestors, sortByMeetingDate, formatMeetingDate, formatMeetingTime, updateRowColors } from './sheets.js';
import { analyzeEmail } from './claude.js';
import { getNextMeetingWithAttendee, getLastMeetingWithAttendee } from './calendar.js';
import { log, error } from '../utils/logger.js';

/**
 * Determine who the meeting/email is with based on recipients
 */
function determineWith(email) {
  const to = (email.to || '').toLowerCase();
  const from = (email.from || '').toLowerCase();

  const hasAvi = to.includes('avi@') || from.includes('avi@');
  const hasYuval = to.includes('yuval@') || from.includes('yuval@');

  if (hasAvi && hasYuval) return 'Both';
  if (hasAvi) return 'Avi';
  if (hasYuval) return 'Yuval';
  return 'Both'; // Default
}

/**
 * Process a single email and update CRM accordingly
 */
export async function processEmail(email) {
  log(`\n[Sync] Processing email: "${email.subject}" from ${email.from}`);

  // Find if investor already exists
  const existingInvestor = await findInvestorByEmail(email.from);

  // Analyze email with Claude
  const analysis = await analyzeEmail(email, existingInvestor);

  if (!analysis) {
    log('[Sync] Could not analyze email, skipping');
    return { action: 'skipped', reason: 'analysis_failed' };
  }

  if (!analysis.isRelevant) {
    log('[Sync] Email not relevant for CRM, skipping');
    return { action: 'skipped', reason: 'not_relevant' };
  }

  // Only track VC investors
  if (!analysis.isVCInvestor) {
    log('[Sync] Not a VC investor, skipping');
    return { action: 'skipped', reason: 'not_vc_investor' };
  }

  const today = new Date().toISOString().split('T')[0];

  // Check calendar for this contact
  const contactEmail = existingInvestor ? existingInvestor.email : email.from;
  let meetingStatus = analysis.meetingStatus;
  let meetingDate = analysis.meetingDate;
  let meetingTime = '';
  let calendarLink = '';
  let meetLink = '';
  let needsResponse = false;

  try {
    const nextMeeting = await getNextMeetingWithAttendee(contactEmail);
    const lastMeeting = await getLastMeetingWithAttendee(contactEmail);

    if (nextMeeting) {
      meetingStatus = 'Scheduled';
      meetingDate = nextMeeting.start.split('T')[0];
      meetingTime = formatMeetingTime(nextMeeting.start);
      calendarLink = nextMeeting.calendarLink || '';
      meetLink = nextMeeting.meetLink || '';
      needsResponse = nextMeeting.needsResponse || false;
      log(`[Sync] Found upcoming meeting on ${meetingDate} at ${meetingTime}${needsResponse ? ' (needs response)' : ''}`);
    } else if (lastMeeting && !meetingStatus) {
      meetingStatus = 'Completed';
      meetingDate = lastMeeting.start.split('T')[0];
      meetingTime = formatMeetingTime(lastMeeting.start);
      calendarLink = lastMeeting.calendarLink || '';
      meetLink = lastMeeting.meetLink || '';
    }
  } catch (calError) {
    log(`[Sync] Calendar check skipped: ${calError.message}`);
  }

  // Determine who the meeting is with
  const meetingWith = determineWith(email);

  // Format meeting date as "11 Jan 2025"
  const formattedMeetingDate = meetingDate ? formatMeetingDate(meetingDate) : '';

  if (existingInvestor) {
    // Update existing investor
    const updates = {
      lastContact: today
    };

    // Update meeting status if changed
    if (meetingStatus && meetingStatus !== existingInvestor.meetingStatus) {
      updates.meetingStatus = meetingStatus;
    }

    // Update meeting date and time if provided
    if (formattedMeetingDate) {
      updates.meetingDate = formattedMeetingDate;
    }
    if (meetingTime) {
      updates.meetingTime = meetingTime;
    }

    // Update "with" field
    updates.with = meetingWith;

    // Update calendar/meet links if available
    if (calendarLink) updates.calendarLink = calendarLink;
    if (meetLink) updates.meetLink = meetLink;

    // Update needs response status
    updates.needsResponse = needsResponse ? 'Yes' : 'No';

    // Update company if we didn't have it
    if (analysis.company && !existingInvestor.company) {
      updates.company = analysis.company;
    }

    await updateInvestor(existingInvestor.rowIndex, updates);

    // Append notes (bullet points only, no timestamp header)
    if (analysis.noteSummary) {
      const existingNotes = existingInvestor.notes || '';
      const updatedNotes = existingNotes
        ? `${existingNotes}\n${analysis.noteSummary}`
        : analysis.noteSummary;
      await updateInvestor(existingInvestor.rowIndex, { notes: updatedNotes });
    }

    log(`[Sync] Updated investor: ${existingInvestor.name}`);
    return { action: 'updated', investor: existingInvestor.name };
  } else {
    // Double-check for duplicates by name before adding
    const investorName = analysis.investorName || email.fromName;
    const existingByName = await findInvestorByName(investorName);

    if (existingByName) {
      // Found by name - update instead of add
      log(`[Sync] Found existing investor by name: ${existingByName.name}`);
      const updates = {
        lastContact: today,
        email: existingByName.email || email.from // Update email if missing
      };
      if (meetingStatus) updates.meetingStatus = meetingStatus;
      if (formattedMeetingDate) updates.meetingDate = formattedMeetingDate;
      if (meetingTime) updates.meetingTime = meetingTime;
      if (calendarLink) updates.calendarLink = calendarLink;
      if (meetLink) updates.meetLink = meetLink;
      updates.with = meetingWith;
      updates.needsResponse = needsResponse ? 'Yes' : 'No';

      await updateInvestor(existingByName.rowIndex, updates);

      if (analysis.noteSummary) {
        const existingNotes = existingByName.notes || '';
        const updatedNotes = existingNotes
          ? `${existingNotes}\n${analysis.noteSummary}`
          : analysis.noteSummary;
        await updateInvestor(existingByName.rowIndex, { notes: updatedNotes });
      }

      return { action: 'updated', investor: existingByName.name };
    }

    // Add new investor
    await addInvestor({
      name: investorName,
      email: email.from,
      company: analysis.company || '',
      meetingStatus: meetingStatus || 'Follow-up',
      meetingDate: formattedMeetingDate,
      meetingTime: meetingTime || '',
      lastContact: today,
      with: meetingWith,
      calendarLink: calendarLink || '',
      meetLink: meetLink || '',
      needsResponse: needsResponse ? 'Yes' : 'No',
      notes: analysis.noteSummary || `- Initial contact via email`
    });

    log(`[Sync] Added new investor: ${investorName}`);
    return { action: 'added', investor: investorName };
  }
}

/**
 * Run a full sync cycle - check for new emails and process them
 */
export async function runSyncCycle() {
  log('\n========================================');
  log(`[Sync] Starting sync cycle at ${new Date().toISOString()}`);
  log('========================================');

  try {
    // Fetch new emails
    const emails = await fetchNewEmails();
    log(`[Sync] Found ${emails.length} new email(s)`);

    if (emails.length === 0) {
      log('[Sync] No new emails to process');
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
      } catch (err) {
        error(`[Sync] Error processing email "${email.subject}":`, err.message);
        results.skipped++;
      }
    }

    // Sort by meeting date after updates
    if (results.added > 0 || results.updated > 0) {
      await sortByMeetingDate();
      // Color upcoming meetings green
      await updateRowColors();
    }

    log('\n[Sync] Cycle complete:', results);
    return results;
  } catch (err) {
    error('[Sync] Sync cycle failed:', err.message);
    throw err;
  }
}

/**
 * Start the continuous sync process
 */
export function startContinuousSync(intervalMinutes = 5) {
  log(`[Sync] Starting continuous sync every ${intervalMinutes} minutes`);

  // Run immediately
  runSyncCycle().catch(err => error('[Sync] Initial cycle error:', err));

  // Then run on interval
  const intervalMs = intervalMinutes * 60 * 1000;
  const intervalId = setInterval(() => {
    runSyncCycle().catch(err => error('[Sync] Cycle error:', err));
  }, intervalMs);

  // Return function to stop sync
  return () => {
    clearInterval(intervalId);
    log('[Sync] Continuous sync stopped');
  };
}

/**
 * Print current CRM status
 */
export async function printCRMStatus() {
  const investors = await getInvestors();

  log('\n========================================');
  log('CURRENT CRM STATUS');
  log('========================================');
  log(`Total investors: ${investors.length}\n`);

  for (const inv of investors) {
    log(`${inv.name} (${inv.email})`);
    log(`  Company: ${inv.company || 'N/A'}`);
    log(`  Status: ${inv.meetingStatus || 'N/A'}`);
    log(`  Meeting Date: ${inv.meetingDate || 'N/A'}`);
    log(`  Last Contact: ${inv.lastContact || 'N/A'}`);
    log('');
  }
}
