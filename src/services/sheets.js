import { google } from 'googleapis';
import fs from 'fs';

let sheets = null;
let spreadsheetId = null;
let sheetName = null;
let columnMap = {}; // Maps field names to column indices
let totalColumns = 0;

// Common column name variations we'll look for
const COLUMN_ALIASES = {
  name: ['name', 'investor name', 'investor', 'contact name', 'contact'],
  email: ['email', 'email address', 'e-mail'],
  company: ['company', 'fund', 'firm', 'organization', 'org'],
  meetingStatus: ['meeting status', 'status', 'stage', 'meeting stage'],
  meetingDate: ['meeting date', 'date', 'next meeting', 'scheduled date', 'meeting'],
  lastContact: ['last contact', 'last contacted', 'last email', 'last touch'],
  notes: ['notes', 'note', 'comments', 'summary', 'context'],
  with: ['with', 'meeting with', 'attendee', 'attendees'],
  calendarLink: ['calendar link', 'calendar', 'cal link', 'event link', 'gcal', 'google calendar'],
  meetLink: ['meet link', 'meeting link', 'video link', 'zoom', 'google meet', 'meet']
};

/**
 * Initialize Google Sheets API client using Service Account
 */
export function initSheets(serviceAccountPath, sheetId, targetSheetName = 'CRM') {
  const serviceAccount = JSON.parse(fs.readFileSync(serviceAccountPath, 'utf8'));

  const auth = new google.auth.JWT({
    email: serviceAccount.client_email,
    key: serviceAccount.private_key,
    scopes: ['https://www.googleapis.com/auth/spreadsheets']
  });

  sheets = google.sheets({ version: 'v4', auth });
  spreadsheetId = sheetId;
  sheetName = targetSheetName;

  console.log(`[Sheets] Initialized client for sheet ${sheetId}`);
  return sheets;
}

/**
 * Read column headers and build column map
 */
export async function discoverColumns() {
  try {
    // Get the first row (headers)
    const response = await sheets.spreadsheets.values.get({
      spreadsheetId,
      range: `${sheetName}!1:1`
    });

    const headers = response.data.values?.[0] || [];
    totalColumns = headers.length;

    console.log(`[Sheets] Found ${headers.length} columns:`, headers.join(', '));

    // Map each header to our field names
    columnMap = {};

    headers.forEach((header, index) => {
      const headerLower = header.toLowerCase().trim();

      for (const [fieldName, aliases] of Object.entries(COLUMN_ALIASES)) {
        if (aliases.some(alias => headerLower.includes(alias) || alias.includes(headerLower))) {
          columnMap[fieldName] = index;
          console.log(`[Sheets] Mapped "${header}" (col ${index}) → ${fieldName}`);
          break;
        }
      }
    });

    // Store raw headers for reference
    columnMap._headers = headers;
    columnMap._headerIndices = {};
    headers.forEach((h, i) => {
      columnMap._headerIndices[h.toLowerCase().trim()] = i;
    });

    return columnMap;
  } catch (error) {
    console.error('[Sheets] Error discovering columns:', error.message);
    throw error;
  }
}

/**
 * Get column index for a field
 */
function getColumnIndex(field) {
  return columnMap[field] ?? -1;
}

/**
 * Get column letter from index
 */
function getColumnLetter(index) {
  return String.fromCharCode(65 + index);
}

/**
 * Format date as "11 Jan 2025"
 */
export function formatMeetingDate(dateStr) {
  if (!dateStr) return '';

  try {
    const date = new Date(dateStr);
    const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
    const day = date.getDate();
    const month = months[date.getMonth()];
    const year = date.getFullYear();
    return `${day} ${month} ${year}`;
  } catch {
    return dateStr;
  }
}

/**
 * Get all investors from the sheet
 */
export async function getInvestors() {
  const lastCol = getColumnLetter(totalColumns - 1);
  const response = await sheets.spreadsheets.values.get({
    spreadsheetId,
    range: `${sheetName}!A:${lastCol}`
  });

  const rows = response.data.values || [];

  // Skip header row
  if (rows.length <= 1) {
    return [];
  }

  return rows.slice(1).map((row, index) => {
    const investor = {
      rowIndex: index + 2, // +2 because 1-indexed and skip header
      _raw: row // Keep raw row for any unmapped columns
    };

    // Map known fields
    for (const field of Object.keys(COLUMN_ALIASES)) {
      const colIndex = getColumnIndex(field);
      if (colIndex >= 0) {
        let value = row[colIndex] || '';
        if (field === 'email') value = value.toLowerCase();
        investor[field] = value;
      }
    }

    return investor;
  });
}

/**
 * Find an investor by email address
 */
export async function findInvestorByEmail(email) {
  const emailCol = getColumnIndex('email');
  if (emailCol < 0) {
    console.warn('[Sheets] No email column found');
    return null;
  }

  const investors = await getInvestors();
  return investors.find(inv => inv.email === email.toLowerCase());
}

/**
 * Add a new investor to the sheet
 */
export async function addInvestor(investor) {
  // Build row based on discovered columns
  const row = new Array(totalColumns).fill('');

  for (const [field, value] of Object.entries(investor)) {
    const colIndex = getColumnIndex(field);
    if (colIndex >= 0 && value) {
      row[colIndex] = value;
    }
  }

  const lastCol = getColumnLetter(totalColumns - 1);

  await sheets.spreadsheets.values.append({
    spreadsheetId,
    range: `${sheetName}!A:${lastCol}`,
    valueInputOption: 'USER_ENTERED',
    requestBody: {
      values: [row]
    }
  });

  console.log(`[Sheets] Added new investor: ${investor.name || investor.email}`);
}

/**
 * Update specific fields for an investor
 */
export async function updateInvestor(rowIndex, updates) {
  const requests = [];

  for (const [field, value] of Object.entries(updates)) {
    const colIndex = getColumnIndex(field);
    if (colIndex < 0) continue;

    const columnLetter = getColumnLetter(colIndex);
    requests.push({
      range: `${sheetName}!${columnLetter}${rowIndex}`,
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
 * Ensure the sheet exists (but don't create headers - use existing)
 */
export async function ensureCRMSheet() {
  try {
    const spreadsheet = await sheets.spreadsheets.get({
      spreadsheetId
    });

    const targetSheet = spreadsheet.data.sheets.find(
      s => s.properties.title === sheetName
    );

    if (!targetSheet) {
      // Try first sheet if CRM doesn't exist
      const firstSheet = spreadsheet.data.sheets[0];
      if (firstSheet) {
        sheetName = firstSheet.properties.title;
        console.log(`[Sheets] Using existing sheet: "${sheetName}"`);
      } else {
        throw new Error('No sheets found in spreadsheet');
      }
    }

    // Discover columns from existing headers
    await discoverColumns();

    return true;
  } catch (error) {
    console.error('[Sheets] Error:', error.message);
    throw error;
  }
}

/**
 * Sort the sheet by meeting date (soonest first)
 */
export async function sortByMeetingDate() {
  const meetingDateCol = getColumnIndex('meetingDate');
  if (meetingDateCol < 0) {
    console.log('[Sheets] No meeting date column found, skipping sort');
    return;
  }

  try {
    const spreadsheet = await sheets.spreadsheets.get({
      spreadsheetId
    });

    const targetSheet = spreadsheet.data.sheets.find(
      s => s.properties.title === sheetName
    );

    if (!targetSheet) {
      console.log('[Sheets] Sheet not found, skipping sort');
      return;
    }

    const sheetId = targetSheet.properties.sheetId;

    await sheets.spreadsheets.batchUpdate({
      spreadsheetId,
      requestBody: {
        requests: [{
          sortRange: {
            range: {
              sheetId,
              startRowIndex: 1,
              startColumnIndex: 0,
              endColumnIndex: totalColumns
            },
            sortSpecs: [{
              dimensionIndex: meetingDateCol,
              sortOrder: 'ASCENDING'
            }]
          }
        }]
      }
    });

    console.log('[Sheets] Sorted by meeting date (soonest first)');
  } catch (error) {
    console.error('[Sheets] Error sorting:', error.message);
  }
}

/**
 * Clear all data except headers
 */
export async function clearCRMData() {
  try {
    const lastCol = getColumnLetter(totalColumns - 1);
    const response = await sheets.spreadsheets.values.get({
      spreadsheetId,
      range: `${sheetName}!A:${lastCol}`
    });

    const rows = response.data.values || [];

    if (rows.length <= 1) {
      console.log('[Sheets] Sheet already empty');
      return;
    }

    await sheets.spreadsheets.values.clear({
      spreadsheetId,
      range: `${sheetName}!A2:${lastCol}${rows.length}`
    });

    console.log(`[Sheets] Cleared ${rows.length - 1} rows`);
  } catch (error) {
    console.error('[Sheets] Error clearing:', error.message);
    throw error;
  }
}

/**
 * Color a row light green (for upcoming meetings)
 */
export async function setRowColor(rowIndex, isGreen) {
  try {
    const spreadsheet = await sheets.spreadsheets.get({
      spreadsheetId
    });

    const targetSheet = spreadsheet.data.sheets.find(
      s => s.properties.title === sheetName
    );

    if (!targetSheet) return;

    const sheetId = targetSheet.properties.sheetId;

    const backgroundColor = isGreen
      ? { red: 0.85, green: 0.95, blue: 0.85 } // Light green
      : { red: 1, green: 1, blue: 1 }; // White

    await sheets.spreadsheets.batchUpdate({
      spreadsheetId,
      requestBody: {
        requests: [{
          repeatCell: {
            range: {
              sheetId,
              startRowIndex: rowIndex - 1,
              endRowIndex: rowIndex,
              startColumnIndex: 0,
              endColumnIndex: totalColumns
            },
            cell: {
              userEnteredFormat: {
                backgroundColor
              }
            },
            fields: 'userEnteredFormat.backgroundColor'
          }
        }]
      }
    });

    console.log(`[Sheets] Row ${rowIndex} colored ${isGreen ? 'green' : 'white'}`);
  } catch (error) {
    console.error('[Sheets] Error coloring row:', error.message);
  }
}

/**
 * Update row colors based on upcoming meetings
 */
export async function updateRowColors() {
  const investors = await getInvestors();
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  for (const inv of investors) {
    if (!inv.meetingDate) continue;

    try {
      // Parse the date - could be "11 Jan 2025" or "2025-01-11"
      let meetingDate;
      if (inv.meetingDate.match(/^\d{4}-\d{2}-\d{2}$/)) {
        meetingDate = new Date(inv.meetingDate);
      } else {
        // Parse "11 Jan 2025" format
        meetingDate = new Date(inv.meetingDate);
      }

      meetingDate.setHours(0, 0, 0, 0);
      const isUpcoming = meetingDate >= today;

      await setRowColor(inv.rowIndex, isUpcoming);
    } catch (e) {
      console.log(`[Sheets] Could not parse date for row ${inv.rowIndex}`);
    }
  }
}

export { columnMap };
