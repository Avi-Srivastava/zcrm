/**
 * OAuth Helper Script
 * Run this to get Google OAuth tokens for Gmail and Sheets access
 */

import { google } from 'googleapis';
import http from 'http';
import { URL } from 'url';
import open from 'open';

// Configuration - update these with your credentials
const CLIENT_ID = process.env.GOOGLE_CLIENT_ID || 'YOUR_CLIENT_ID';
const CLIENT_SECRET = process.env.GOOGLE_CLIENT_SECRET || 'YOUR_CLIENT_SECRET';
const REDIRECT_URI = 'http://localhost:3000/oauth/callback';

const SCOPES = [
  'https://www.googleapis.com/auth/gmail.readonly',
  'https://www.googleapis.com/auth/spreadsheets'
];

async function main() {
  if (CLIENT_ID === 'YOUR_CLIENT_ID' || CLIENT_SECRET === 'YOUR_CLIENT_SECRET') {
    console.log('Please set GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET environment variables');
    console.log('Or update the values in this script');
    process.exit(1);
  }

  const oauth2Client = new google.auth.OAuth2(CLIENT_ID, CLIENT_SECRET, REDIRECT_URI);

  const authUrl = oauth2Client.generateAuthUrl({
    access_type: 'offline',
    scope: SCOPES,
    prompt: 'consent'
  });

  console.log('Opening browser for Google authentication...');
  console.log('If it doesn\'t open automatically, visit:', authUrl);

  // Start local server to receive callback
  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url, 'http://localhost:3000');

    if (url.pathname === '/oauth/callback') {
      const code = url.searchParams.get('code');

      if (code) {
        try {
          const { tokens } = await oauth2Client.getToken(code);

          res.writeHead(200, { 'Content-Type': 'text/html' });
          res.end('<h1>Success!</h1><p>You can close this window.</p>');

          console.log('\n========================================');
          console.log('SUCCESS! Add these to your .env file:');
          console.log('========================================\n');
          console.log(`GOOGLE_ACCESS_TOKEN=${tokens.access_token}`);
          console.log(`GOOGLE_REFRESH_TOKEN=${tokens.refresh_token}`);
          console.log('');

          server.close();
          process.exit(0);
        } catch (error) {
          res.writeHead(500, { 'Content-Type': 'text/html' });
          res.end('<h1>Error</h1><p>Failed to get tokens</p>');
          console.error('Error getting tokens:', error);
          server.close();
          process.exit(1);
        }
      }
    }
  });

  server.listen(3000, () => {
    console.log('Waiting for OAuth callback on http://localhost:3000...');
    // Try to open browser (may not work in all environments)
    open(authUrl).catch(() => {});
  });
}

main().catch(console.error);
