import Anthropic from '@anthropic-ai/sdk';

let client = null;

/**
 * Initialize Claude API client
 */
export function initClaude(apiKey) {
  client = new Anthropic({ apiKey });
  return client;
}

/**
 * Analyze an email and extract investor CRM information
 */
export async function analyzeEmail(email, existingInvestor = null) {
  if (!client) {
    throw new Error('Claude client not initialized. Call initClaude first.');
  }

  const existingContext = existingInvestor
    ? `
EXISTING INVESTOR DATA:
- Name: ${existingInvestor.name}
- Company: ${existingInvestor.company}
- Current Meeting Status: ${existingInvestor.meetingStatus}
- Current Meeting Date: ${existingInvestor.meetingDate}
- Existing Notes: ${existingInvestor.notes}
`
    : 'This is a NEW investor not currently in our CRM.';

  const prompt = `You are an AI assistant helping manage an investor CRM for fundraising. Analyze this email and extract relevant information.

EMAIL DETAILS:
- From: ${email.fromName} <${email.from}>
- To: ${email.to}
- Subject: ${email.subject}
- Date: ${email.date}
- Direction: ${email.isIncoming ? 'INCOMING (from investor)' : 'OUTGOING (to investor)'}

EMAIL BODY:
${email.body}

${existingContext}

CRITICAL: Only track investors who work at VENTURE CAPITAL FIRMS, INVESTMENT FUNDS, or ANGEL INVESTORS. Do NOT track:
- Regular business contacts
- Service providers, lawyers, accountants
- Employees, contractors
- Friends, family
- Anyone not explicitly involved in startup investing

Analyze this email and provide a JSON response with the following structure:
{
  "investorName": "Full name of the investor (only if they are a VC/investor)",
  "company": "VC firm or fund name",
  "meetingStatus": "One of: Scheduled, Completed, Follow-up",
  "meetingDate": "YYYY-MM-DD format if a specific meeting date is mentioned, otherwise null",
  "noteSummary": "Factual bullet points of what happened, e.g.:\\n- Sent intro email on 10 Jan\\n- Meeting scheduled for 15 Jan\\n- Discussed Series A terms",
  "isVCInvestor": true/false - whether this person is actually a VC/investor at an investment firm,
  "isRelevant": true/false - whether this email is relevant for investor tracking
}

Important:
- Set isVCInvestor to false if the person is NOT a venture capitalist or investor
- Set isRelevant to false for automated emails, newsletters, DocuSign, marketing, internal emails
- meetingStatus should be: "Scheduled" (meeting coming up), "Completed" (meeting happened), or "Follow-up" (needs action/response)
- noteSummary should be SHORT bullet points of facts only - no headers like "CRM Summary", just the points
- Extract concrete dates in YYYY-MM-DD format when possible

Respond ONLY with valid JSON, no other text.`;

  const response = await client.messages.create({
    model: 'claude-sonnet-4-5-20250929',
    max_tokens: 1024,
    messages: [{ role: 'user', content: prompt }]
  });

  const content = response.content[0].text;

  try {
    // Extract JSON from response (handle potential markdown code blocks)
    const jsonMatch = content.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      console.error('[Claude] No JSON found in response:', content);
      return null;
    }

    const parsed = JSON.parse(jsonMatch[0]);
    return parsed;
  } catch (error) {
    console.error('[Claude] Failed to parse response:', content);
    return null;
  }
}

/**
 * Generate a summary of multiple recent emails for notes
 */
export async function summarizeEmailThread(emails) {
  if (!client || emails.length === 0) {
    return null;
  }

  const emailSummaries = emails.map(e => `
[${e.date}] ${e.isIncoming ? 'FROM' : 'TO'} investor
Subject: ${e.subject}
Content: ${e.body.substring(0, 500)}...
`).join('\n---\n');

  const prompt = `Summarize the following email thread for a CRM note. Focus on:
- Key discussion points
- Any commitments or next steps
- Meeting outcomes or changes
- Investment interest signals

EMAILS:
${emailSummaries}

Provide a concise 2-3 sentence summary suitable for CRM notes.`;

  const response = await client.messages.create({
    model: 'claude-sonnet-4-5-20250929',
    max_tokens: 256,
    messages: [{ role: 'user', content: prompt }]
  });

  return response.content[0].text;
}
