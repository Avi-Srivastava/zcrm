import { google } from 'googleapis';

let sheets = null;
let spreadsheetId = null;

// Expected CRM columns
const CRM_COLUMNS = {
  NAME: 0,           // A - Investor name
  EMAIL: 1,          // B - Email address
  COMPANY: 2,        // C - Company/Fund name
  MEETING_STATUS: 3, // D - Meeting status (e.g., "Scheduled", "Completed", "Pending")
  MEETING_DATE: 4,   // E - Meeting date
  LAST_CONTACT: 5,   // F - Last contact date
  NOTES: 6           // G - Notes (auto-updated from emails)
};

/**
 * Initialize Google Sheets API client
 */
export function initSheets(credentials, tokens, sheetId) {
  const oauth2Client = new google.auth.OAuth2(
    credentials.client_id,
    credentials.client_secret,
    credentials.redirect_uri
  );

  oauth2Client.setCredentials(tokens);

  oauth2Client.on('tokens', (newTokens) => {
    console.log('[Sheets] Tokens refreshed');
    if (newTokens.refresh_token) {
      tokens.refresh_token = newTokens.refresh_token;
    }
    tokens.access_token = newTokens.access_token;
  });

  sheets = google.sheets({ version: 'v4', auth: oauth2Client });
  spreadsheetId = sheetId;

  return sheets;
}

/**
 * Get all investors from the CRM sheet
 */
export async function getInvestors() {
  const response = await sheets.spreadsheets.values.get({
    spreadsheetId,
    range: 'CRM!A:G'
  });

  const rows = response.data.values || [];

  // Skip header row
  if (rows.length <= 1) {
    return [];
  }

  return rows.slice(1).map((row, index) => ({
    rowIndex: index + 2, // +2 because 1-indexed and skip header
    name: row[CRM_COLUMNS.NAME] || '',
    email: (row[CRM_COLUMNS.EMAIL] || '').toLowerCase(),
    company: row[CRM_COLUMNS.COMPANY] || '',
    meetingStatus: row[CRM_COLUMNS.MEETING_STATUS] || '',
    meetingDate: row[CRM_COLUMNS.MEETING_DATE] || '',
    lastContact: row[CRM_COLUMNS.LAST_CONTACT] || '',
    notes: row[CRM_COLUMNS.NOTES] || ''
  }));
}

/**
 * Find an investor by email address
 */
export async function findInvestorByEmail(email) {
  const investors = await getInvestors();
  return investors.find(inv => inv.email === email.toLowerCase());
}

/**
 * Add a new investor to the CRM
 */
export async function addInvestor(investor) {
  const { name, email, company, meetingStatus, meetingDate, lastContact, notes } = investor;

  await sheets.spreadsheets.values.append({
    spreadsheetId,
    range: 'CRM!A:G',
    valueInputOption: 'USER_ENTERED',
    requestBody: {
      values: [[
        name || '',
        email || '',
        company || '',
        meetingStatus || 'New Contact',
        meetingDate || '',
        lastContact || new Date().toISOString().split('T')[0],
        notes || ''
      ]]
    }
  });

  console.log(`[Sheets] Added new investor: ${name} (${email})`);
}

/**
 * Update specific fields for an investor
 */
export async function updateInvestor(rowIndex, updates) {
  const requests = [];

  for (const [field, value] of Object.entries(updates)) {
    let columnIndex;

    switch (field) {
      case 'name': columnIndex = CRM_COLUMNS.NAME; break;
      case 'email': columnIndex = CRM_COLUMNS.EMAIL; break;
      case 'company': columnIndex = CRM_COLUMNS.COMPANY; break;
      case 'meetingStatus': columnIndex = CRM_COLUMNS.MEETING_STATUS; break;
      case 'meetingDate': columnIndex = CRM_COLUMNS.MEETING_DATE; break;
      case 'lastContact': columnIndex = CRM_COLUMNS.LAST_CONTACT; break;
      case 'notes': columnIndex = CRM_COLUMNS.NOTES; break;
      default: continue;
    }

    const columnLetter = String.fromCharCode(65 + columnIndex);
    requests.push({
      range: `CRM!${columnLetter}${rowIndex}`,
      values: [[value]]
    });
  }

  if (requests.length > 0) {
    await sheets.spreadsheets.values.batchUpdate({
      spreadsheetId,
      requestBody: {
        valueInputOption: 'USER_ENTERED',
        data: requests
      }
    });

    console.log(`[Sheets] Updated row ${rowIndex}:`, Object.keys(updates).join(', '));
  }
}

/**
 * Append notes to an investor's existing notes
 */
export async function appendNotes(rowIndex, newNote, existingNotes = '') {
  const timestamp = new Date().toISOString().split('T')[0];
  const formattedNote = `[${timestamp}] ${newNote}`;

  const updatedNotes = existingNotes
    ? `${existingNotes}\n\n${formattedNote}`
    : formattedNote;

  await updateInvestor(rowIndex, { notes: updatedNotes });
}

/**
 * Ensure the CRM sheet exists with proper headers
 */
export async function ensureCRMSheet() {
  try {
    // Check if sheet exists
    const spreadsheet = await sheets.spreadsheets.get({
      spreadsheetId
    });

    const crmSheet = spreadsheet.data.sheets.find(
      s => s.properties.title === 'CRM'
    );

    if (!crmSheet) {
      // Create CRM sheet
      await sheets.spreadsheets.batchUpdate({
        spreadsheetId,
        requestBody: {
          requests: [{
            addSheet: {
              properties: { title: 'CRM' }
            }
          }]
        }
      });

      // Add headers
      await sheets.spreadsheets.values.update({
        spreadsheetId,
        range: 'CRM!A1:G1',
        valueInputOption: 'RAW',
        requestBody: {
          values: [['Name', 'Email', 'Company', 'Meeting Status', 'Meeting Date', 'Last Contact', 'Notes']]
        }
      });

      console.log('[Sheets] Created CRM sheet with headers');
    }

    return true;
  } catch (error) {
    console.error('[Sheets] Error ensuring CRM sheet:', error.message);
    throw error;
  }
}

export { CRM_COLUMNS };
