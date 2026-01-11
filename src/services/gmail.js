import { google } from 'googleapis';
import fs from 'fs';

let gmailClients = new Map(); // email -> gmail client
let historyIds = new Map(); // email -> lastHistoryId

/**
 * Initialize Gmail API clients for multiple users using Service Account
 */
export function initGmail(serviceAccountPath, emails) {
  const serviceAccount = JSON.parse(fs.readFileSync(serviceAccountPath, 'utf8'));

  for (const email of emails) {
    const auth = new google.auth.JWT({
      email: serviceAccount.client_email,
      key: serviceAccount.private_key,
      scopes: ['https://www.googleapis.com/auth/gmail.readonly'],
      subject: email // Impersonate this user
    });

    const gmail = google.gmail({ version: 'v1', auth });
    gmailClients.set(email, gmail);
    console.log(`[Gmail] Initialized client for ${email}`);
  }

  return gmailClients;
}

/**
 * Get Gmail client for a specific user
 */
export function getGmailClient(email) {
  const client = gmailClients.get(email);
  if (!client) {
    throw new Error(`Gmail client not initialized for ${email}`);
  }
  return client;
}

/**
 * Fetch new emails for a specific user since last check
 */
export async function fetchNewEmailsForUser(email) {
  const client = getGmailClient(email);
  const lastHistoryId = historyIds.get(email);

  // Get profile to check history ID
  const profile = await client.users.getProfile({ userId: 'me' });
  const currentHistoryId = profile.data.historyId;

  if (!lastHistoryId) {
    // First run - get recent emails from last 24 hours
    console.log(`[Gmail] First run for ${email} - fetching recent emails`);
    const oneDayAgo = Math.floor((Date.now() - 24 * 60 * 60 * 1000) / 1000);
    const response = await client.users.messages.list({
      userId: 'me',
      q: `after:${oneDayAgo}`,
      maxResults: 50
    });

    historyIds.set(email, currentHistoryId);

    if (!response.data.messages) {
      return [];
    }

    return await getEmailDetails(client, response.data.messages.map(m => m.id), email);
  }

  // Use history API for incremental updates
  try {
    const historyResponse = await client.users.history.list({
      userId: 'me',
      startHistoryId: lastHistoryId,
      historyTypes: ['messageAdded']
    });

    historyIds.set(email, currentHistoryId);

    if (!historyResponse.data.history) {
      return [];
    }

    // Extract message IDs from history
    const messageIds = new Set();
    for (const history of historyResponse.data.history) {
      if (history.messagesAdded) {
        for (const msg of history.messagesAdded) {
          messageIds.add(msg.message.id);
        }
      }
    }

    if (messageIds.size === 0) {
      return [];
    }

    return await getEmailDetails(client, [...messageIds], email);
  } catch (error) {
    if (error.code === 404) {
      // History ID expired, reset and fetch recent
      console.log(`[Gmail] History expired for ${email}, fetching recent emails`);
      historyIds.delete(email);
      return await fetchNewEmailsForUser(email);
    }
    throw error;
  }
}

/**
 * Fetch new emails from ALL monitored accounts
 */
export async function fetchNewEmails() {
  const allEmails = [];

  for (const email of gmailClients.keys()) {
    try {
      const emails = await fetchNewEmailsForUser(email);
      console.log(`[Gmail] Found ${emails.length} new emails for ${email}`);
      allEmails.push(...emails);
    } catch (error) {
      console.error(`[Gmail] Error fetching emails for ${email}:`, error.message);
    }
  }

  return allEmails;
}

/**
 * Fetch emails from past N days for a specific user
 */
export async function fetchEmailsFromPastDaysForUser(email, days = 7) {
  const client = getGmailClient(email);
  const daysAgo = Math.floor((Date.now() - days * 24 * 60 * 60 * 1000) / 1000);

  console.log(`[Gmail] Fetching emails from past ${days} days for ${email}...`);

  let allMessageIds = [];
  let pageToken = null;

  do {
    const response = await client.users.messages.list({
      userId: 'me',
      q: `after:${daysAgo}`,
      maxResults: 100,
      pageToken
    });

    if (response.data.messages) {
      allMessageIds = allMessageIds.concat(response.data.messages.map(m => m.id));
    }

    pageToken = response.data.nextPageToken;
  } while (pageToken);

  console.log(`[Gmail] Found ${allMessageIds.length} emails for ${email}`);

  return await getEmailDetails(client, allMessageIds, email);
}

/**
 * Fetch emails from past N days for ALL monitored accounts
 */
export async function fetchEmailsFromPastDays(days = 7) {
  const allEmails = [];

  for (const email of gmailClients.keys()) {
    try {
      const emails = await fetchEmailsFromPastDaysForUser(email, days);
      allEmails.push(...emails);
    } catch (error) {
      console.error(`[Gmail] Error fetching past emails for ${email}:`, error.message);
    }
  }

  return allEmails;
}

/**
 * Get full email details for a list of message IDs
 */
async function getEmailDetails(client, messageIds, accountEmail) {
  const emails = [];

  for (const messageId of messageIds) {
    try {
      const message = await client.users.messages.get({
        userId: 'me',
        id: messageId,
        format: 'full'
      });

      const parsed = parseEmail(message.data, accountEmail);
      if (parsed) {
        emails.push(parsed);
      }
    } catch (error) {
      console.error(`[Gmail] Error fetching message ${messageId}:`, error.message);
    }
  }

  return emails;
}

/**
 * Parse raw Gmail message into structured format
 */
function parseEmail(message, accountEmail) {
  const headers = message.payload.headers;

  const getHeader = (name) => {
    const header = headers.find(h => h.name.toLowerCase() === name.toLowerCase());
    return header ? header.value : null;
  };

  const from = getHeader('From');
  const to = getHeader('To');
  const subject = getHeader('Subject');
  const date = getHeader('Date');

  // Extract email body
  let body = '';

  function extractBody(part) {
    if (part.mimeType === 'text/plain' && part.body.data) {
      return Buffer.from(part.body.data, 'base64').toString('utf-8');
    }
    if (part.parts) {
      for (const subPart of part.parts) {
        const result = extractBody(subPart);
        if (result) return result;
      }
    }
    return null;
  }

  body = extractBody(message.payload) || '';

  // Parse sender email and name
  const fromMatch = from?.match(/(?:"?([^"<]*)"?\s*)?<?([^>]+@[^>]+)>?/);
  const senderName = fromMatch?.[1]?.trim() || fromMatch?.[2]?.split('@')[0] || 'Unknown';
  const senderEmail = fromMatch?.[2]?.trim()?.toLowerCase() || from?.toLowerCase();

  // Determine if this is incoming or outgoing based on the account it came from
  const isIncoming = senderEmail !== accountEmail.toLowerCase();

  return {
    id: message.id,
    threadId: message.threadId,
    from: senderEmail,
    fromName: senderName,
    to,
    subject,
    body,
    date: date ? new Date(date) : new Date(),
    isIncoming,
    accountEmail, // Which monitored account this came from
    labels: message.labelIds || []
  };
}

/**
 * Parse email address from "Name <email@domain.com>" format
 */
export function parseEmailAddress(emailString) {
  if (!emailString) return { name: 'Unknown', email: '' };

  const match = emailString.match(/(?:"?([^"<]*)"?\s*)?<?([^>]+@[^>]+)>?/);
  return {
    name: match?.[1]?.trim() || match?.[2]?.split('@')[0] || 'Unknown',
    email: match?.[2]?.trim()?.toLowerCase() || emailString.toLowerCase()
  };
}

/**
 * Get all emails in a thread for a specific account
 */
export async function getThreadEmails(email, threadId) {
  const client = getGmailClient(email);

  try {
    const thread = await client.users.threads.get({
      userId: 'me',
      id: threadId,
      format: 'full'
    });

    const emails = [];
    for (const message of thread.data.messages || []) {
      const parsed = parseEmail(message, email);
      if (parsed) {
        emails.push(parsed);
      }
    }

    return emails;
  } catch (error) {
    console.error(`[Gmail] Error fetching thread ${threadId}:`, error.message);
    return [];
  }
}

/**
 * Group emails by unique external contacts
 * Returns map of email address -> array of emails
 */
export function groupEmailsByContact(emails, monitoredEmails) {
  const monitoredSet = new Set(monitoredEmails.map(e => e.toLowerCase()));
  const byContact = new Map();

  for (const email of emails) {
    // Determine the external contact (not one of our monitored accounts)
    let contactEmail;

    if (monitoredSet.has(email.from)) {
      // We sent this - the contact is the recipient
      const toMatch = email.to?.match(/<?([^>,\s]+@[^>,\s]+)>?/);
      contactEmail = toMatch?.[1]?.toLowerCase();
    } else {
      // They sent this - the contact is the sender
      contactEmail = email.from;
    }

    // Skip if contact is one of our monitored emails
    if (!contactEmail || monitoredSet.has(contactEmail)) {
      continue;
    }

    if (!byContact.has(contactEmail)) {
      byContact.set(contactEmail, []);
    }
    byContact.get(contactEmail).push(email);
  }

  return byContact;
}

/**
 * Get list of monitored emails
 */
export function getMonitoredEmails() {
  return [...gmailClients.keys()];
}
