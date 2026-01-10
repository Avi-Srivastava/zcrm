# Email-CRM Sync Agent

Autonomous agent that monitors your Gmail inbox and keeps your investor CRM (Google Sheet) up-to-date.

## Features

- **Email Monitoring**: Checks for new emails every 5 minutes (configurable)
- **Smart Parsing**: Uses Claude AI to extract investor information from emails
- **Auto-Add Investors**: Creates new CRM entries for first-time contacts
- **Meeting Tracking**: Updates meeting status and dates from email context
- **Notes Generation**: Maintains up-to-date notes based on email content

## CRM Structure

The agent manages a Google Sheet with these columns:

| Column | Description |
|--------|-------------|
| Name | Investor's full name |
| Email | Email address |
| Company | Company/fund name |
| Meeting Status | Scheduled, Completed, Pending Response, etc. |
| Meeting Date | Date of scheduled/completed meeting |
| Last Contact | Date of most recent email |
| Notes | Auto-generated notes from email content |

## Setup

### 1. Google Cloud Setup

1. Go to [Google Cloud Console](https://console.cloud.google.com/)
2. Create a new project or select existing
3. Enable **Gmail API** and **Google Sheets API**
4. Create OAuth 2.0 credentials:
   - Go to APIs & Services > Credentials
   - Create OAuth client ID (Web application)
   - Add `http://localhost:3000/oauth/callback` as redirect URI
   - Download credentials

### 2. Get OAuth Tokens

Run the auth helper to get your tokens:

```bash
node scripts/auth.js
```

This will:
1. Open a browser for Google sign-in
2. Request Gmail and Sheets permissions
3. Output your access and refresh tokens

### 3. Create Google Sheet

1. Create a new Google Sheet
2. Copy the Sheet ID from the URL: `docs.google.com/spreadsheets/d/[SHEET-ID]/edit`
3. The agent will auto-create a "CRM" sheet with headers on first run

### 4. Get Claude API Key

1. Go to [Anthropic Console](https://console.anthropic.com/)
2. Create an API key

### 5. Configure Environment

Copy `.env.example` to `.env` and fill in your values:

```bash
cp .env.example .env
```

### 6. Install & Run

```bash
npm install
npm start
```

## Usage

### Continuous Mode (default)
```bash
npm start
```
Runs continuously, checking for new emails every 5 minutes.

### Single Sync
```bash
npm start -- --once
```
Runs one sync cycle and exits.

### Development Mode
```bash
npm run dev
```
Runs with auto-restart on file changes.

## Configuration

| Environment Variable | Description | Default |
|---------------------|-------------|---------|
| `SYNC_INTERVAL_MINUTES` | Minutes between sync cycles | 5 |
| `MY_EMAIL` | Your email (to identify outgoing emails) | Required |

## How It Works

1. **Email Detection**: Uses Gmail History API for efficient incremental fetches
2. **AI Analysis**: Claude extracts investor name, company, meeting details, and generates notes
3. **CRM Update**:
   - New contacts → Added as new row
   - Existing contacts → Updates meeting status, date, last contact, appends notes
4. **Filtering**: Ignores newsletters, automated emails, and irrelevant messages

## Example Output

```
========================================
[Sync] Starting sync cycle at 2024-01-15T10:30:00.000Z
========================================
[Sync] Found 3 new email(s)

[Sync] Processing email: "Re: Meeting next week" from john@vc.com
[Sheets] Updated row 5: meetingStatus, meetingDate, lastContact
[Sheets] Appended notes to row 5
[Sync] Updated investor: John Smith

[Sync] Processing email: "Introduction" from new@investor.com
[Sheets] Added new investor: Jane Doe (new@investor.com)
[Sync] Added new investor: Jane Doe

[Sync] Cycle complete: { processed: 3, added: 1, updated: 1, skipped: 1 }
```
