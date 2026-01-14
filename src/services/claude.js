import Anthropic from '@anthropic-ai/sdk';
import { error } from '../utils/logger.js';

let client = null;

// Model can be switched via CLAUDE_MODEL env var
// Options: 'sonnet' (default), 'opus'
function getModel() {
  const modelEnv = process.env.CLAUDE_MODEL?.toLowerCase();
  if (modelEnv === 'opus') {
    return 'claude-opus-4-5-20251101';
  }
  return 'claude-sonnet-4-5-20250929'; // default
}

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
- 4-5 SHORT factual points max
- Include CURRENT STATUS (where we are with them)
- Be concise - each point should be <10 words
- Example format:
  - Intro call completed 15 Jan
  - Interested in Series A
  - Wants Q4 metrics before next step
  - Following up next week
  - Status: Warm lead, awaiting data

Set isVCInvestor=false and isRelevant=false if:
- Person is from Zealot Labs
- Person is not a VC/investor
- Email is automated/DocuSign/newsletter

JSON only, no other text.`;

  const response = await client.messages.create({
    model: getModel(),
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
    model: getModel(),
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

  // Build example output dynamically based on actual fields
  const exampleFields = emptyFields.slice(0, 6).map(f => {
    const fl = f.toLowerCase();
    if (fl === 'company' || fl === 'firm' || fl === 'fund') return `"${f}": "Their VC firm name"`;
    if (fl === 'location' || fl === 'city' || fl === 'hq') return `"${f}": "City, State"`;
    if (fl === 'about' || fl === 'bio') return `"${f}": "Brief 1-2 sentence bio"`;
    if (fl === 'notes') return `"${f}": "- Point 1\\n- Point 2\\n- Point 3"`;
    if (fl.includes('partner')) return `"${f}": "Partner names at the firm"`;
    return `"${f}": "relevant value for ${f}"`;
  }).join(',\n  ');

  const prompt = `Research this investor to fill in missing CRM data.

INVESTOR:
- Name: ${investor.name}
- Email: ${investor.email}
- Company: ${investor.company || 'Unknown'}
- Current Notes: ${investor.notes || 'None'}

FIELDS TO FILL: ${emptyFields.join(', ')}

Use web search to find accurate, factual information about this person and their VC firm.

IMPORTANT RULES:
- "about" or "bio": Keep SHORT (1-2 sentences, ~20 words max)
- "notes": 4-5 bullet points with "-", include current deal status
- "location": Just "City, State" format
- "partner" fields: Names of partners at the firm
- ANY other field: Research and fill with relevant info
- Only include fields you can VERIFY

Return JSON with the fields you found:
{
  ${exampleFields}
}

JSON only, no other text.`;

  const response = await client.messages.create({
    model: getModel(),
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
    model: getModel(),
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
    model: getModel(),
    max_tokens: 2048,
    tools: [{ type: 'web_search_20250305' }],
    messages: [{ role: 'user', content: prompt }]
  });

  // Collect all text blocks from the response
  const textBlocks = response.content.filter(b => b.type === 'text');
  return textBlocks.map(b => b.text).join('\n\n');
}
