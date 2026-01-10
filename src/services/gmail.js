import { google } from 'googleapis';

let gmail = null;
let lastHistoryId = null;

/**
 * Initialize Gmail API client with OAuth2 credentials
 */
export function initGmail(credentials, tokens) {
  const oauth2Client = new google.auth.OAuth2(
    credentials.client_id,
    credentials.client_secret,
    credentials.redirect_uri
  );

  oauth2Client.setCredentials(tokens);

  // Auto-refresh tokens
  oauth2Client.on('tokens', (newTokens) => {
    console.log('[Gmail] Tokens refreshed');
    if (newTokens.refresh_token) {
      tokens.refresh_token = newTokens.refresh_token;
    }
    tokens.access_token = newTokens.access_token;
  });

  gmail = google.gmail({ version: 'v1', auth: oauth2Client });
  return gmail;
}

/**
 * Get the Gmail client instance
 */
export function getGmailClient() {
  if (!gmail) {
    throw new Error('Gmail client not initialized. Call initGmail first.');
  }
  return gmail;
}

/**
 * Fetch new emails since last check
 * Returns array of parsed email objects
 */
export async function fetchNewEmails() {
  const client = getGmailClient();

  // Get profile to check history ID
  const profile = await client.users.getProfile({ userId: 'me' });
  const currentHistoryId = profile.data.historyId;

  if (!lastHistoryId) {
    // First run - get recent emails from last 24 hours
    console.log('[Gmail] First run - fetching recent emails');
    const oneDayAgo = Math.floor((Date.now() - 24 * 60 * 60 * 1000) / 1000);
    const response = await client.users.messages.list({
      userId: 'me',
      q: `after:${oneDayAgo}`,
      maxResults: 50
    });

    lastHistoryId = currentHistoryId;

    if (!response.data.messages) {
      return [];
    }

    return await getEmailDetails(response.data.messages.map(m => m.id));
  }

  // Use history API for incremental updates
  try {
    const historyResponse = await client.users.history.list({
      userId: 'me',
      startHistoryId: lastHistoryId,
      historyTypes: ['messageAdded']
    });

    lastHistoryId = currentHistoryId;

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

    return await getEmailDetails([...messageIds]);
  } catch (error) {
    if (error.code === 404) {
      // History ID expired, reset and fetch recent
      console.log('[Gmail] History expired, fetching recent emails');
      lastHistoryId = null;
      return await fetchNewEmails();
    }
    throw error;
  }
}

/**
 * Get full email details for a list of message IDs
 */
async function getEmailDetails(messageIds) {
  const client = getGmailClient();
  const emails = [];

  for (const messageId of messageIds) {
    try {
      const message = await client.users.messages.get({
        userId: 'me',
        id: messageId,
        format: 'full'
      });

      const parsed = parseEmail(message.data);
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
function parseEmail(message) {
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
  const senderEmail = fromMatch?.[2]?.trim() || from;

  // Determine if this is incoming or outgoing
  const isIncoming = !from?.includes(process.env.MY_EMAIL);

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
    email: match?.[2]?.trim() || emailString
  };
}

/**
 * Fetch all emails from the past N days for backfill
 * @param {number} days - Number of days to look back
 */
export async function fetchEmailsFromPastDays(days = 7) {
  const client = getGmailClient();

  const daysAgo = Math.floor((Date.now() - days * 24 * 60 * 60 * 1000) / 1000);

  console.log(`[Gmail] Fetching emails from past ${days} days...`);

  let allMessageIds = [];
  let pageToken = null;

  // Paginate through all results
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

  console.log(`[Gmail] Found ${allMessageIds.length} emails`);

  return await getEmailDetails(allMessageIds);
}

/**
 * Get all emails in a thread
 * @param {string} threadId - Gmail thread ID
 */
export async function getThreadEmails(threadId) {
  const client = getGmailClient();

  try {
    const thread = await client.users.threads.get({
      userId: 'me',
      id: threadId,
      format: 'full'
    });

    const emails = [];
    for (const message of thread.data.messages || []) {
      const parsed = parseEmail(message);
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
export function groupEmailsByContact(emails, myEmail) {
  const byContact = new Map();

  for (const email of emails) {
    // Determine the external contact (not me)
    let contactEmail;
    if (email.from.toLowerCase() === myEmail.toLowerCase()) {
      // I sent this - the contact is the recipient
      const toMatch = email.to?.match(/<?([^>,\s]+@[^>,\s]+)>?/);
      contactEmail = toMatch?.[1]?.toLowerCase();
    } else {
      // They sent this - the contact is the sender
      contactEmail = email.from.toLowerCase();
    }

    if (!contactEmail || contactEmail === myEmail.toLowerCase()) {
      continue;
    }

    if (!byContact.has(contactEmail)) {
      byContact.set(contactEmail, []);
    }
    byContact.get(contactEmail).push(email);
  }

  return byContact;
}
