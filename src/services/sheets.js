import { google } from 'googleapis';
import fs from 'fs';
import { log, warn, error } from '../utils/logger.js';

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
  location: ['location', 'city', 'hq', 'headquarters', 'based in'],
  about: ['about', 'bio', 'description', 'background'],
  meetingStatus: ['meeting status', 'status', 'stage', 'meeting stage'],
  meetingDate: ['meeting date', 'date', 'next meeting', 'scheduled date', 'meeting'],
  meetingTime: ['meeting time', 'time', 'start time', 'meeting start'],
  lastContact: ['last contact', 'last contacted', 'last email', 'last touch'],
  notes: ['notes', 'note', 'comments', 'summary', 'context'],
  with: ['with', 'meeting with', 'attendee', 'attendees'],
  calendarLink: ['calendar link', 'calendar', 'cal link', 'event link', 'gcal', 'google calendar'],
  meetLink: ['meet link', 'meeting link', 'video link', 'zoom', 'google meet', 'meet'],
  needsResponse: ['needs response', 'awaiting response', 'pending response', 'response needed']
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

  log(`[Sheets] Initialized client for sheet ${sheetId}`);
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

    log(`[Sheets] Found ${headers.length} columns:`, headers.join(', '));

    // Map each header to our field names
    columnMap = {};

    headers.forEach((header, index) => {
      const headerLower = header.toLowerCase().trim();

      for (const [fieldName, aliases] of Object.entries(COLUMN_ALIASES)) {
        if (aliases.some(alias => headerLower.includes(alias) || alias.includes(headerLower))) {
          columnMap[fieldName] = index;
          log(`[Sheets] Mapped "${header}" (col ${index}) → ${fieldName}`);
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
  } catch (err) {
    error('[Sheets] Error discovering columns:', err.message);
    throw err;
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
 * Format time as "2:30 PM"
 */
export function formatMeetingTime(dateTimeStr) {
  if (!dateTimeStr) return '';

  try {
    const date = new Date(dateTimeStr);
    let hours = date.getHours();
    const minutes = date.getMinutes();
    const ampm = hours >= 12 ? 'PM' : 'AM';
    hours = hours % 12 || 12;
    const minutesStr = minutes < 10 ? `0${minutes}` : minutes;
    return `${hours}:${minutesStr} ${ampm}`;
  } catch {
    return '';
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
 * Find an investor by email address or name (to prevent duplicates)
 */
export async function findInvestorByEmail(email) {
  const investors = await getInvestors();
  const emailLower = email.toLowerCase();

  // First try to find by email
  const emailCol = getColumnIndex('email');
  if (emailCol >= 0) {
    const byEmail = investors.find(inv => inv.email === emailLower);
    if (byEmail) return byEmail;
  }

  // Also check if name matches (extract name from email if needed)
  const nameCol = getColumnIndex('name');
  if (nameCol >= 0) {
    // Try to match by name as fallback
    const byName = investors.find(inv => {
      if (!inv.name) return false;
      const invNameLower = inv.name.toLowerCase().trim();
      // Check if investor's email contains this name or vice versa
      const emailPrefix = emailLower.split('@')[0].replace(/[._-]/g, ' ');
      return invNameLower.includes(emailPrefix) || emailPrefix.includes(invNameLower.split(' ')[0]);
    });
    if (byName) return byName;
  }

  return null;
}

/**
 * Find an investor by name (exact or partial match)
 */
export async function findInvestorByName(name) {
  if (!name) return null;

  const investors = await getInvestors();
  const nameLower = name.toLowerCase().trim();

  // Exact match first
  let match = investors.find(inv =>
    inv.name && inv.name.toLowerCase().trim() === nameLower
  );
  if (match) return match;

  // Partial match (first name + last name)
  const nameParts = nameLower.split(/\s+/);
  if (nameParts.length >= 2) {
    match = investors.find(inv => {
      if (!inv.name) return false;
      const invNameLower = inv.name.toLowerCase();
      return nameParts.every(part => invNameLower.includes(part));
    });
  }

  return match || null;
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

  log(`[Sheets] Added new investor: ${investor.name || investor.email}`);
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

    log(`[Sheets] Updated row ${rowIndex}:`, Object.keys(updates).join(', '));
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
        log(`[Sheets] Using existing sheet: "${sheetName}"`);
      } else {
        throw new Error('No sheets found in spreadsheet');
      }
    }

    // Discover columns from existing headers
    await discoverColumns();

    return true;
  } catch (err) {
    error('[Sheets] Error:', err.message);
    throw err;
  }
}

/**
 * Sort the sheet by meeting date, time, then company (to group same-firm investors)
 */
export async function sortByMeetingDate() {
  const meetingDateCol = getColumnIndex('meetingDate');
  if (meetingDateCol < 0) {
    log('[Sheets] No meeting date column found, skipping sort');
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
      log('[Sheets] Sheet not found, skipping sort');
      return;
    }

    const sheetId = targetSheet.properties.sheetId;

    // Build sort specs: date, then time (if exists), then company (to group same-firm)
    const sortSpecs = [
      {
        dimensionIndex: meetingDateCol,
        sortOrder: 'ASCENDING'
      }
    ];

    // Add time sorting if column exists
    const meetingTimeCol = getColumnIndex('meetingTime');
    if (meetingTimeCol >= 0) {
      sortSpecs.push({
        dimensionIndex: meetingTimeCol,
        sortOrder: 'ASCENDING'
      });
    }

    // Add company sorting to group same-firm investors together
    const companyCol = getColumnIndex('company');
    if (companyCol >= 0) {
      sortSpecs.push({
        dimensionIndex: companyCol,
        sortOrder: 'ASCENDING'
      });
    }

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
            sortSpecs
          }
        }]
      }
    });

    log('[Sheets] Sorted by date, time, and company');
  } catch (err) {
    error('[Sheets] Error sorting:', err.message);
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
      log('[Sheets] Sheet already empty');
      return;
    }

    await sheets.spreadsheets.values.clear({
      spreadsheetId,
      range: `${sheetName}!A2:${lastCol}${rows.length}`
    });

    log(`[Sheets] Cleared ${rows.length - 1} rows`);
  } catch (err) {
    error('[Sheets] Error clearing:', err.message);
    throw err;
  }
}

/**
 * Color a row: 'green' (upcoming confirmed), 'yellow' (needs response), or 'white' (default)
 */
export async function setRowColor(rowIndex, color = 'white') {
  try {
    const spreadsheet = await sheets.spreadsheets.get({
      spreadsheetId
    });

    const targetSheet = spreadsheet.data.sheets.find(
      s => s.properties.title === sheetName
    );

    if (!targetSheet) return;

    const sheetId = targetSheet.properties.sheetId;

    // Define colors: green (confirmed upcoming), yellow (needs response), white (default)
    const colors = {
      green: { red: 0.85, green: 0.95, blue: 0.85 },   // Light green
      yellow: { red: 1, green: 0.95, blue: 0.8 },      // Light yellow
      white: { red: 1, green: 1, blue: 1 }             // White
    };

    const backgroundColor = colors[color] || colors.white;

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

    log(`[Sheets] Row ${rowIndex} colored ${color}`);
  } catch (err) {
    error('[Sheets] Error coloring row:', err.message);
  }
}

/**
 * Update row colors based on meeting status:
 * - Green: upcoming meeting (confirmed)
 * - Yellow: meeting needs response
 * - White: no upcoming meeting or completed
 */
export async function updateRowColors() {
  const investors = await getInvestors();
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  for (const inv of investors) {
    try {
      // Check if needs response (yellow takes priority)
      const needsResponse = inv.needsResponse === 'Yes' || inv.needsResponse === 'TRUE' || inv.needsResponse === true;

      if (needsResponse && inv.meetingStatus === 'Scheduled') {
        await setRowColor(inv.rowIndex, 'yellow');
        continue;
      }

      // Check for upcoming meeting (green)
      if (inv.meetingDate) {
        let meetingDate;
        if (inv.meetingDate.match(/^\d{4}-\d{2}-\d{2}$/)) {
          meetingDate = new Date(inv.meetingDate);
        } else {
          meetingDate = new Date(inv.meetingDate);
        }

        meetingDate.setHours(0, 0, 0, 0);
        const isUpcoming = meetingDate >= today;

        if (isUpcoming && inv.meetingStatus === 'Scheduled') {
          await setRowColor(inv.rowIndex, 'green');
          continue;
        }
      }

      // Default to white
      await setRowColor(inv.rowIndex, 'white');
    } catch (e) {
      log(`[Sheets] Could not process color for row ${inv.rowIndex}`);
    }
  }
}

export { columnMap };
