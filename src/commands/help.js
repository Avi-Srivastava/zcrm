#!/usr/bin/env node

console.log(`
========================================
EMAIL-CRM SYNC AGENT - COMMANDS
========================================

MAIN COMMANDS
-------------

npm start
  Start the continuous sync agent (checks every 5 minutes)
  Example: npm start

npm run backfill
  Process emails from the past 7 days
  Example: npm run backfill

npm run backfill:clear
  Clear CRM and re-process past 7 days
  Example: npm run backfill:clear


NEW COLUMN COMMANDS
-------------------

npm run fill
  Fill empty columns using web search
  Example: npm run fill

  This will scan all investors and use web search to fill
  any columns that are empty (company, notes, etc.)


npm run redo -- --columns "col1,col2" --prompt "guidance"
  Redo specific columns with custom guidance

  Examples:
    npm run redo -- --columns "notes" --prompt "Focus on investment interest"
    npm run redo -- --columns "company" --prompt "Find their actual VC firm name"
    npm run redo -- --columns "meeting,status" --prompt "Check for scheduled calls"
    npm run redo -- --columns "notes" --prompt "Summarize deal stage and next steps"

  Available columns:
    name, company, email, status, meeting, notes, with


ASK QUESTIONS
-------------

npm run ask -- "your question"
  Ask questions about your CRM with web search

  Examples:
    npm run ask -- "Who are the most engaged investors?"
    npm run ask -- "What does Sequoia typically invest in?"
    npm run ask -- "Tell me about John Smith from a16z"
    npm run ask -- "Which investors have meetings this week?"
    npm run ask -- "What stage does Andreessen focus on?"
    npm run ask -- "Compare our top 3 investors"


SHEET COLUMNS (auto-detected)
-----------------------------

Required:
  - Name / Investor Name
  - Email

Optional (agent fills these):
  - Company / Fund / Firm
  - Status / Meeting Status (Scheduled | Completed | Follow-up)
  - Meeting / Meeting Date (format: 11 Jan 2025)
  - With (Avi | Yuval | Both)
  - Notes
  - Calendar Link / Calendar
  - Meet Link / Meeting Link
  - Last Contact


TIPS
----

1. The agent only tracks EXTERNAL VC investors (not internal Zealot team)
2. Upcoming meetings are highlighted green
3. Rows are auto-sorted by meeting date (soonest first)
4. Calendar and Meet links auto-populate from Google Calendar
5. Web search is enabled for fill, redo, and ask commands

========================================
`);
