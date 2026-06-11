#!/usr/bin/env node

/**
 * Daily DevRev -> Slack reminder.
 *
 * Pulls your DevRev issues and posts them to a Slack channel via an
 * incoming webhook (the webhook is locked to one channel, so there's
 * no channel ID or bot token to manage).
 *
 * Needs two secrets (set as env vars / GitHub secrets):
 *   - DEVREV_TOKEN        (DevRev personal access token)
 *   - SLACK_WEBHOOK_URL   (the my-reminder incoming webhook URL)
 *
 * See README.md for how to get each one.
 */

const DEVREV_TOKEN      = process.env.DEVREV_TOKEN;
const SLACK_WEBHOOK_URL = process.env.SLACK_WEBHOOK_URL;

// Which ticket stages to include. These must match the Stage names shown
// in your DevRev board (matched case-insensitively). Edit to taste --
// e.g. drop 'triage' if you don't want triage items, add 'completed' if
// you ever want those too.
const INCLUDE_STAGES = ['in progress', 'review', 'to do', 'triage'];

function requireEnv() {
  const missing = ['DEVREV_TOKEN', 'SLACK_WEBHOOK_URL']
    .filter((k) => !process.env[k]);
  if (missing.length) {
    console.error('Missing env vars: ' + missing.join(', '));
    process.exit(1);
  }
}

// Fetch issues assigned to the current user from DevRev.
async function getMyTickets() {
  // First, find out who "me" is.
  const meRes = await fetch('https://api.devrev.ai/dev-users.self', {
    headers: { Authorization: DEVREV_TOKEN },
  });
  if (!meRes.ok) {
    throw new Error('DevRev auth failed: ' + meRes.status + ' ' + (await meRes.text()));
  }
  const me = await meRes.json();
  const myId = me.dev_user && me.dev_user.id;

  // List works (issues) assigned to me.
  const listRes = await fetch('https://api.devrev.ai/works.list', {
    method: 'POST',
    headers: {
      Authorization: DEVREV_TOKEN,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      type: ['issue'],
      'owned_by': [myId],
      limit: 50,
    }),
  });
  if (!listRes.ok) {
    throw new Error('DevRev works.list failed: ' + listRes.status + ' ' + (await listRes.text()));
  }
  const data = await listRes.json();
  const works = data.works || [];

  // Filter by stage name if the work exposes one.
  return works.filter((w) => {
    const stage = (w.stage && w.stage.name ? w.stage.name : '').toLowerCase();
    if (!stage) return true; // keep if we can't tell
    return INCLUDE_STAGES.some((s) => stage.includes(s));
  });
}

function buildMessage(tickets) {
  if (!tickets.length) {
    return '🎉 No open tickets assigned to you today. Enjoy!';
  }
  const lines = tickets.map((t) => {
    const title = t.title || '(untitled)';
    const stage = t.stage && t.stage.name ? t.stage.name : 'unknown';
    const ref   = t.display_id ? `[${t.display_id}] ` : '';
    return `• ${ref}${title} — _${stage}_`;
  });
  return [
    '📋 *Your tickets for today*',
    '',
    ...lines,
  ].join('\n');
}

async function postToSlack(text) {
  const res = await fetch(SLACK_WEBHOOK_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ text }),
  });
  // Incoming webhooks return the literal string "ok" on success.
  const body = await res.text();
  if (!res.ok || body !== 'ok') {
    throw new Error('Slack webhook failed: ' + res.status + ' ' + body);
  }
}

async function main() {
  requireEnv();

  // Skip weekends.
  const day = new Date().getDay();
  if (day === 0 || day === 6) {
    console.log('Weekend — skipping.');
    return;
  }

  const tickets = await getMyTickets();
  console.log('Found ' + tickets.length + ' tickets.');
  await postToSlack(buildMessage(tickets));
  console.log('Posted to Slack.');
}

main().catch((err) => {
  console.error(err.message || err);
  process.exit(1);
});
