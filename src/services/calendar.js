import { google } from 'googleapis';
import fs from 'fs';

let calendarClients = new Map(); // email -> calendar client

/**
 * Initialize Google Calendar API clients for multiple users using Service Account
 */
export function initCalendar(serviceAccountPath, emails) {
  const serviceAccount = JSON.parse(fs.readFileSync(serviceAccountPath, 'utf8'));

  for (const email of emails) {
    const auth = new google.auth.JWT({
      email: serviceAccount.client_email,
      key: serviceAccount.private_key,
      scopes: ['https://www.googleapis.com/auth/calendar.readonly'],
      subject: email // Impersonate this user
    });

    const calendar = google.calendar({ version: 'v3', auth });
    calendarClients.set(email, calendar);
    console.log(`[Calendar] Initialized client for ${email}`);
  }

  return calendarClients;
}

/**
 * Get Calendar client for a specific user
 */
function getCalendarClient(email) {
  const client = calendarClients.get(email);
  if (!client) {
    throw new Error(`Calendar client not initialized for ${email}`);
  }
  return client;
}

/**
 * Get upcoming meetings from all monitored calendars
 */
export async function getUpcomingMeetings(daysAhead = 30) {
  const allMeetings = [];

  for (const email of calendarClients.keys()) {
    try {
      const meetings = await getUpcomingMeetingsForUser(email, daysAhead);
      allMeetings.push(...meetings);
    } catch (error) {
      console.error(`[Calendar] Error fetching meetings for ${email}:`, error.message);
    }
  }

  return allMeetings;
}

/**
 * Get upcoming meetings for a specific user
 */
async function getUpcomingMeetingsForUser(email, daysAhead = 30) {
  const calendar = getCalendarClient(email);

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
      calendarOwner: email,
      attendees: (event.attendees || []).map(a => ({
        email: a.email?.toLowerCase(),
        name: a.displayName || a.email,
        response: a.responseStatus
      })),
      meetLink: event.hangoutLink || event.conferenceData?.entryPoints?.[0]?.uri || '',
      location: event.location || '',
      status: event.status
    }));
  } catch (error) {
    console.error(`[Calendar] Error fetching events for ${email}:`, error.message);
    throw error;
  }
}

/**
 * Find meetings with a specific attendee email across all calendars
 */
export async function findMeetingsWithAttendee(attendeeEmail, daysBack = 30, daysAhead = 30) {
  const allMeetings = [];

  for (const calendarEmail of calendarClients.keys()) {
    try {
      const meetings = await findMeetingsWithAttendeeForUser(calendarEmail, attendeeEmail, daysBack, daysAhead);
      allMeetings.push(...meetings);
    } catch (error) {
      console.error(`[Calendar] Error finding meetings for ${attendeeEmail} in ${calendarEmail}:`, error.message);
    }
  }

  // Deduplicate by event ID (same meeting might appear in both calendars)
  const uniqueMeetings = [...new Map(allMeetings.map(m => [m.id, m])).values()];

  return uniqueMeetings;
}

/**
 * Find meetings with a specific attendee for a specific calendar
 */
async function findMeetingsWithAttendeeForUser(calendarEmail, attendeeEmail, daysBack = 30, daysAhead = 30) {
  const calendar = getCalendarClient(calendarEmail);

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
      q: attendeeEmail
    });

    const events = response.data.items || [];

    // Filter to only events where this email is an attendee
    const filtered = events.filter(event => {
      const attendees = event.attendees || [];
      return attendees.some(a => a.email?.toLowerCase() === attendeeEmail.toLowerCase());
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
        calendarOwner: calendarEmail,
        isPast,
        status: event.status,
        attendees: (event.attendees || []).map(a => ({
          email: a.email?.toLowerCase(),
          name: a.displayName || a.email,
          response: a.responseStatus
        }))
      };
    });
  } catch (error) {
    console.error(`[Calendar] Error finding meetings:`, error.message);
    return [];
  }
}

/**
 * Get the next upcoming meeting with an attendee
 */
export async function getNextMeetingWithAttendee(attendeeEmail) {
  const meetings = await findMeetingsWithAttendee(attendeeEmail, 0, 60);
  const upcoming = meetings.filter(m => !m.isPast && m.status !== 'cancelled');

  if (upcoming.length === 0) return null;

  // Sort by start time and return soonest
  upcoming.sort((a, b) => new Date(a.start) - new Date(b.start));
  return upcoming[0];
}

/**
 * Get the most recent past meeting with an attendee
 */
export async function getLastMeetingWithAttendee(attendeeEmail) {
  const meetings = await findMeetingsWithAttendee(attendeeEmail, 60, 0);
  const past = meetings.filter(m => m.isPast && m.status !== 'cancelled');

  if (past.length === 0) return null;

  // Sort by start time descending and return most recent
  past.sort((a, b) => new Date(b.start) - new Date(a.start));
  return past[0];
}

/**
 * Get past meetings from all calendars
 */
export async function getPastMeetings(daysBack = 7) {
  const allMeetings = [];

  for (const email of calendarClients.keys()) {
    try {
      const meetings = await getPastMeetingsForUser(email, daysBack);
      allMeetings.push(...meetings);
    } catch (error) {
      console.error(`[Calendar] Error fetching past meetings for ${email}:`, error.message);
    }
  }

  return allMeetings;
}

/**
 * Get past meetings for a specific user
 */
async function getPastMeetingsForUser(email, daysBack = 7) {
  const calendar = getCalendarClient(email);

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
      calendarOwner: email,
      attendees: (event.attendees || []).map(a => ({
        email: a.email?.toLowerCase(),
        name: a.displayName || a.email,
        response: a.responseStatus
      })),
      meetLink: event.hangoutLink || event.conferenceData?.entryPoints?.[0]?.uri || '',
      location: event.location || '',
      status: event.status
    }));
  } catch (error) {
    console.error(`[Calendar] Error fetching past events for ${email}:`, error.message);
    throw error;
  }
}
