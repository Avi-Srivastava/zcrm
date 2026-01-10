import { google } from 'googleapis';

let calendar = null;
let auth = null;

/**
 * Initialize Google Calendar API client
 */
export function initCalendar(credentials, tokens) {
  auth = new google.auth.OAuth2(
    credentials.client_id,
    credentials.client_secret,
    credentials.redirect_uri
  );

  auth.setCredentials(tokens);

  calendar = google.calendar({ version: 'v3', auth });

  return calendar;
}

/**
 * Get upcoming meetings from calendar
 * @param {number} daysAhead - How many days ahead to look
 * @returns {Array} Array of meeting objects
 */
export async function getUpcomingMeetings(daysAhead = 30) {
  if (!calendar) {
    throw new Error('Calendar not initialized. Call initCalendar first.');
  }

  const now = new Date();
  const future = new Date();
  future.setDate(future.getDate() + daysAhead);

  try {
    const response = await calendar.events.list({
      calendarId: 'primary',
      timeMin: now.toISOString(),
      timeMax: future.toISOString(),
      singleEvents: true,
      orderBy: 'startTime',
      maxResults: 100
    });

    const events = response.data.items || [];

    return events.map(event => ({
      id: event.id,
      title: event.summary || '',
      description: event.description || '',
      start: event.start?.dateTime || event.start?.date,
      end: event.end?.dateTime || event.end?.date,
      attendees: (event.attendees || []).map(a => ({
        email: a.email,
        name: a.displayName || a.email,
        response: a.responseStatus
      })),
      meetLink: event.hangoutLink || event.conferenceData?.entryPoints?.[0]?.uri || '',
      location: event.location || '',
      status: event.status
    }));
  } catch (error) {
    console.error('[Calendar] Error fetching events:', error.message);
    throw error;
  }
}

/**
 * Get past meetings from calendar
 * @param {number} daysBack - How many days back to look
 * @returns {Array} Array of meeting objects
 */
export async function getPastMeetings(daysBack = 7) {
  if (!calendar) {
    throw new Error('Calendar not initialized. Call initCalendar first.');
  }

  const now = new Date();
  const past = new Date();
  past.setDate(past.getDate() - daysBack);

  try {
    const response = await calendar.events.list({
      calendarId: 'primary',
      timeMin: past.toISOString(),
      timeMax: now.toISOString(),
      singleEvents: true,
      orderBy: 'startTime',
      maxResults: 100
    });

    const events = response.data.items || [];

    return events.map(event => ({
      id: event.id,
      title: event.summary || '',
      description: event.description || '',
      start: event.start?.dateTime || event.start?.date,
      end: event.end?.dateTime || event.end?.date,
      attendees: (event.attendees || []).map(a => ({
        email: a.email,
        name: a.displayName || a.email,
        response: a.responseStatus
      })),
      meetLink: event.hangoutLink || event.conferenceData?.entryPoints?.[0]?.uri || '',
      location: event.location || '',
      status: event.status
    }));
  } catch (error) {
    console.error('[Calendar] Error fetching past events:', error.message);
    throw error;
  }
}

/**
 * Find meetings with a specific attendee email
 * @param {string} email - Attendee email to search for
 * @param {number} daysBack - Days to look back
 * @param {number} daysAhead - Days to look ahead
 */
export async function findMeetingsWithAttendee(email, daysBack = 30, daysAhead = 30) {
  if (!calendar) {
    throw new Error('Calendar not initialized. Call initCalendar first.');
  }

  const past = new Date();
  past.setDate(past.getDate() - daysBack);

  const future = new Date();
  future.setDate(future.getDate() + daysAhead);

  try {
    const response = await calendar.events.list({
      calendarId: 'primary',
      timeMin: past.toISOString(),
      timeMax: future.toISOString(),
      singleEvents: true,
      orderBy: 'startTime',
      maxResults: 250,
      q: email // Search by email
    });

    const events = response.data.items || [];

    // Filter to only events where this email is an attendee
    const filtered = events.filter(event => {
      const attendees = event.attendees || [];
      return attendees.some(a => a.email?.toLowerCase() === email.toLowerCase());
    });

    return filtered.map(event => {
      const eventStart = new Date(event.start?.dateTime || event.start?.date);
      const now = new Date();
      const isPast = eventStart < now;

      return {
        id: event.id,
        title: event.summary || '',
        description: event.description || '',
        start: event.start?.dateTime || event.start?.date,
        end: event.end?.dateTime || event.end?.date,
        isPast,
        status: event.status,
        attendees: (event.attendees || []).map(a => ({
          email: a.email,
          name: a.displayName || a.email,
          response: a.responseStatus
        }))
      };
    });
  } catch (error) {
    console.error('[Calendar] Error finding meetings:', error.message);
    return [];
  }
}

/**
 * Get the next upcoming meeting with an attendee
 */
export async function getNextMeetingWithAttendee(email) {
  const meetings = await findMeetingsWithAttendee(email, 0, 60);
  const upcoming = meetings.filter(m => !m.isPast && m.status !== 'cancelled');

  if (upcoming.length === 0) return null;

  // Return the soonest one
  return upcoming[0];
}

/**
 * Get the most recent past meeting with an attendee
 */
export async function getLastMeetingWithAttendee(email) {
  const meetings = await findMeetingsWithAttendee(email, 60, 0);
  const past = meetings.filter(m => m.isPast && m.status !== 'cancelled');

  if (past.length === 0) return null;

  // Return the most recent one (last in array since sorted by startTime)
  return past[past.length - 1];
}
