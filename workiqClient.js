require('dotenv').config();

const GRAPH_BETA = 'https://graph.microsoft.com/beta';
const WORKIQ_TIMEOUT_MS = 25000;

function withTimeout(promise, ms = WORKIQ_TIMEOUT_MS) {
  const timeout = new Promise((_, reject) =>
    setTimeout(() => reject(new Error(`Work IQ timeout after ${ms}ms`)), ms)
  );
  return Promise.race([promise, timeout]);
}

/**
 * Creates a new Work IQ (M365 Copilot) conversation session.
 * Requires M365 Copilot license on the tenant.
 *
 * @param {string} accessToken
 * @returns {Promise<string>} conversationId
 */
async function createConversation(accessToken) {
  const res = await fetch(`${GRAPH_BETA}/copilot/conversations`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({}),
  });

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Work IQ createConversation ${res.status}: ${body}`);
  }

  const data = await res.json();
  return data.id;
}

/**
 * Sends a message to an existing Work IQ conversation and returns the response text.
 *
 * @param {string} accessToken
 * @param {string} conversationId
 * @param {string} question
 * @returns {Promise<string>} Copilot response text
 */
async function askWorkIQ(accessToken, conversationId, question) {
  const res = await fetch(`${GRAPH_BETA}/copilot/conversations/${conversationId}/chat`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      message: { text: question },
      locationHint: { timeZone: 'UTC' },
    }),
  });

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Work IQ askWorkIQ ${res.status}: ${body}`);
  }

  const data = await res.json();

  // Handle multiple possible beta API response shapes
  return (
    data?.message?.text ||
    data?.message?.content ||
    data?.reply?.content ||
    data?.response?.text ||
    (typeof data === 'string' ? data : JSON.stringify(data))
  );
}

/**
 * One-shot: creates a conversation, asks a question, returns the response text.
 * Use for single independent queries; use createConversation + askWorkIQ for
 * multi-turn sessions.
 *
 * @param {string} accessToken
 * @param {string} question
 * @returns {Promise<string>}
 */
async function queryWorkIQ(accessToken, question) {
  const conversationId = await createConversation(accessToken);
  return askWorkIQ(accessToken, conversationId, question);
}

/**
 * Asks Work IQ to surface the creator's recent writing content across M365
 * (OneDrive, OneNote, Teams, email drafts, SharePoint).
 * Returns raw natural language response for downstream parsing.
 * Enforces a 25-second timeout.
 *
 * @param {string} accessToken
 * @returns {Promise<string>}
 */
async function getWorkIQContentContext(accessToken) {
  return withTimeout(queryWorkIQ(
    accessToken,
    'List my recent writing content from OneDrive, OneNote, Teams messages, and email drafts. ' +
    'Include blog posts, scripts, newsletters, brainstorm notes, and any original writing I authored. ' +
    'For each item provide the title, a 200-word excerpt or summary, the source (onedrive/onenote/teams/email), ' +
    'and approximate date. Format as a numbered list.'
  ));
}

/**
 * Asks Work IQ about the creator's content performance and engagement patterns
 * across M365 — used to enrich ForgeBoard Format Resonance scoring.
 * Enforces a 25-second timeout.
 *
 * @param {string} accessToken
 * @returns {Promise<string>}
 */
async function getWorkIQPerformanceContext(accessToken) {
  return withTimeout(queryWorkIQ(
    accessToken,
    'Based on my Microsoft 365 activity, answer the following: ' +
    '1. Which content formats (video, article, thread, podcast) generate the most responses or engagement in Teams and email? ' +
    '2. What topics do I write about most frequently across my OneDrive documents and OneNote notebooks? ' +
    '3. When during the week do I tend to create the most content based on file activity? ' +
    'Be concise and factual based only on my actual M365 data.'
  ));
}

/**
 * Runs content and performance queries as TWO PARALLEL Work IQ conversations.
 * Each has a 30-second timeout. Total time = max(content, perf) not sum.
 * Returns { contentText, performanceText } — either may be null on timeout/error.
 *
 * @param {string} accessToken
 * @returns {Promise<{ contentText: string|null, performanceText: string|null }>}
 */
async function getWorkIQCombinedContext(accessToken) {
  const [contentResult, perfResult] = await Promise.allSettled([
    withTimeout(
      queryWorkIQ(
        accessToken,
        'List up to 3 of my most recent documents or notes from OneDrive or OneNote. ' +
        'For each give: title, one-sentence summary, source (onedrive/onenote). ' +
        'Format as a numbered list. No extra commentary.'
      ),
      30000
    ),
    withTimeout(
      queryWorkIQ(
        accessToken,
        'Based on my OneDrive and OneNote: what topics do I write about most? ' +
        'Which day of the week am I most active? Answer in 2 sentences maximum.'
      ),
      30000
    ),
  ]);

  const contentText = contentResult.status === 'fulfilled' ? contentResult.value : null;
  const performanceText = perfResult.status === 'fulfilled' ? perfResult.value : null;

  if (contentResult.status === 'rejected')
    console.warn('[workiq] content query failed:', contentResult.reason?.message);
  if (perfResult.status === 'rejected')
    console.warn('[workiq] performance query failed:', perfResult.reason?.message);

  return { contentText, performanceText };
}

module.exports = {
  createConversation,
  askWorkIQ,
  queryWorkIQ,
  getWorkIQContentContext,
  getWorkIQPerformanceContext,
  getWorkIQCombinedContext,
};
