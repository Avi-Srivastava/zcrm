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

  const prompt = `You are helping manage an investor CRM for Zealot Labs (a startup). Analyze this email.

EMAIL:
- From: ${email.fromName} <${email.from}>
- To: ${email.to}
- Subject: ${email.subject}
- Date: ${email.date}

BODY:
${email.body}

${existingContext}

CRITICAL RULES:
1. ONLY track EXTERNAL investors from VC firms, funds, or angel investors
2. NEVER track anyone from Zealot Labs or @zealotlabs.com (these are internal)
3. NEVER track service providers, lawyers, contractors, employees, friends

Return JSON:
{
  "investorName": "Name of the EXTERNAL investor (not Zealot employee)",
  "company": "Their VC firm or fund",
  "meetingStatus": "Scheduled | Completed | Follow-up",
  "meetingDate": "YYYY-MM-DD or null",
  "noteSummary": "- point 1\n- point 2\n- point 3",
  "isVCInvestor": true/false,
  "isRelevant": true/false
}

FOR noteSummary:
- Just plain bullet points starting with "-"
- NO headers, NO "CRM Summary", NO markdown formatting
- 2-4 short factual points about what happened
- Example format:
  - Intro call scheduled for 15 Jan
  - Discussed Series A interest
  - They want to see Q4 metrics

Set isVCInvestor=false and isRelevant=false if:
- Person is from Zealot Labs
- Person is not a VC/investor
- Email is automated/DocuSign/newsletter

JSON only, no other text.`;

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

  const prompt = `Summarize this email thread as plain bullet points for a CRM.

EMAILS:
${emailSummaries}

Return ONLY 2-4 bullet points starting with "-". No headers, no markdown.
Example:
- Intro call on 10 Jan went well
- They're interested in Series A
- Follow-up scheduled for next week`;

  const response = await client.messages.create({
    model: 'claude-sonnet-4-5-20250929',
    max_tokens: 256,
    messages: [{ role: 'user', content: prompt }]
  });

  return response.content[0].text;
}
