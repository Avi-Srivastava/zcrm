import Anthropic from '@anthropic-ai/sdk';
import { error } from '../utils/logger.js';

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
4. If you cannot identify their VC FIRM NAME, set isVCInvestor=false
5. Internal team communication = isRelevant=false, isVCInvestor=false
6. The person MUST be attachable to a known VC firm or fund

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
      error('[Claude] No JSON found in response:', content);
      return null;
    }

    const parsed = JSON.parse(jsonMatch[0]);
    return parsed;
  } catch (err) {
    error('[Claude] Failed to parse response:', content);
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

/**
 * Research an investor to fill empty columns (with web search)
 */
export async function researchInvestor(investor, emptyFields) {
  if (!client) {
    throw new Error('Claude client not initialized');
  }

  const prompt = `Research this investor to fill in missing CRM data.

INVESTOR:
- Name: ${investor.name}
- Email: ${investor.email}
- Company: ${investor.company || 'Unknown'}
- Current Notes: ${investor.notes || 'None'}

FIELDS TO FILL: ${emptyFields.join(', ')}

Use web search to find accurate information about this person and their VC firm.
Return JSON with only the fields that need filling:
{
  "company": "Their VC firm (if missing)",
  "notes": "- Key facts about them\n- Their investment focus\n- Notable deals"
}

Only return fields you can verify. JSON only.`;

  const response = await client.messages.create({
    model: 'claude-sonnet-4-5-20250929',
    max_tokens: 1024,
    tools: [{ type: 'web_search_20250305' }],
    messages: [{ role: 'user', content: prompt }]
  });

  // Extract text from response (may have tool use blocks)
  const textBlock = response.content.find(b => b.type === 'text');
  if (!textBlock) return null;

  try {
    const jsonMatch = textBlock.text.match(/\{[\s\S]*\}/);
    return jsonMatch ? JSON.parse(jsonMatch[0]) : null;
  } catch {
    return null;
  }
}

/**
 * Redo specific columns for an investor (with web search)
 */
export async function redoColumnForInvestor(investor, fields, userPrompt) {
  if (!client) {
    throw new Error('Claude client not initialized');
  }

  const fieldDescriptions = {
    name: 'Full name of the investor',
    company: 'Their VC firm or fund name',
    meetingStatus: 'Scheduled | Completed | Follow-up',
    meetingDate: 'Date in format "11 Jan 2025"',
    notes: 'Bullet points starting with "-"',
    with: 'Avi | Yuval | Both'
  };

  const fieldsToRedo = fields.map(f => `${f}: ${fieldDescriptions[f] || f}`).join('\n');

  const prompt = `Redo these CRM fields for an investor. Use web search if needed.

CURRENT DATA:
- Name: ${investor.name}
- Email: ${investor.email}
- Company: ${investor.company || 'Unknown'}
- Meeting Status: ${investor.meetingStatus || 'None'}
- Meeting Date: ${investor.meetingDate || 'None'}
- Notes: ${investor.notes || 'None'}

FIELDS TO REDO:
${fieldsToRedo}

${userPrompt ? `USER GUIDANCE: ${userPrompt}` : ''}

Return JSON with the updated fields only. For notes, use plain bullet points with "-".
JSON only, no other text.`;

  const response = await client.messages.create({
    model: 'claude-sonnet-4-5-20250929',
    max_tokens: 1024,
    tools: [{ type: 'web_search_20250305' }],
    messages: [{ role: 'user', content: prompt }]
  });

  const textBlock = response.content.find(b => b.type === 'text');
  if (!textBlock) return null;

  try {
    const jsonMatch = textBlock.text.match(/\{[\s\S]*\}/);
    return jsonMatch ? JSON.parse(jsonMatch[0]) : null;
  } catch {
    return null;
  }
}

/**
 * Ask questions about the CRM sheet (with web search)
 */
export async function askAboutSheet(investors, question) {
  if (!client) {
    throw new Error('Claude client not initialized');
  }

  const crmSummary = investors.map(inv =>
    `- ${inv.name} | ${inv.company || 'Unknown firm'} | ${inv.meetingStatus || 'No status'} | ${inv.meetingDate || 'No date'} | Notes: ${(inv.notes || '').substring(0, 100)}`
  ).join('\n');

  const prompt = `You have access to a startup's investor CRM and web search. Answer this question.

CRM DATA (${investors.length} investors):
${crmSummary}

QUESTION: ${question}

Use web search freely to:
- Look up investors and their firms
- Find their investment history
- Research their portfolio companies
- Get any relevant context

Provide a helpful, detailed answer. Include specific names and facts from the CRM and web.`;

  const response = await client.messages.create({
    model: 'claude-sonnet-4-5-20250929',
    max_tokens: 2048,
    tools: [{ type: 'web_search_20250305' }],
    messages: [{ role: 'user', content: prompt }]
  });

  // Collect all text blocks from the response
  const textBlocks = response.content.filter(b => b.type === 'text');
  return textBlocks.map(b => b.text).join('\n\n');
}
