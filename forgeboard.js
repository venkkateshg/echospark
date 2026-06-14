/**
 * forgeboard.js — ForgeBoard Core Reasoning Engine for EchoSpark
 *
 * Orchestrates a 6-step chain to transform a creator's raw idea into a
 * script in their voice:
 *   1. Intent Parsing
 *   2. Voice Fingerprint Retrieval
 *   3. Format Resonance Scoring
 *   4. Creative Risk Assessment
 *   5. Script Generation (3 hook variants)
 *   6. Peak Window Scheduling
 */

require('dotenv').config();
const Anthropic = require('@anthropic-ai/sdk');

const clientOptions = process.env.AZURE_INFERENCE_ENDPOINT
  ? {
      apiKey: process.env.AZURE_INFERENCE_KEY,
      baseURL: process.env.AZURE_INFERENCE_ENDPOINT,
      defaultHeaders: { 'api-key': process.env.AZURE_INFERENCE_KEY },
    }
  : { apiKey: process.env.ANTHROPIC_API_KEY };
const client = new Anthropic(clientOptions);

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Safe JSON parse with a fallback value.
 * Strips markdown code fences (```json ... ```) that Claude sometimes emits.
 */
function safeJsonParse(text, fallback) {
  try {
    // Strip optional markdown fences
    const stripped = text.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '').trim();
    return JSON.parse(stripped);
  } catch (_) {
    try {
      // Last resort: extract first {...} or [...] substring
      const match = text.match(/(\{[\s\S]*\}|\[[\s\S]*\])/);
      if (match) return JSON.parse(match[1]);
    } catch (_2) {
      // ignore
    }
    return fallback;
  }
}

/**
 * Call Claude and return the first text block.
 * Uses claude-opus-4-8 with adaptive thinking for best reasoning quality.
 */
async function callClaude(systemPrompt, userPrompt, maxTokens = 2048) {
  const response = await client.messages.create({
    model: 'claude-haiku-4-5',
    max_tokens: maxTokens,
    system: systemPrompt,
    messages: [{ role: 'user', content: userPrompt }],
  });

  const textBlock = response.content.find((b) => b.type === 'text');
  return textBlock ? textBlock.text : '';
}

// ---------------------------------------------------------------------------
// Step 1 — Intent Parsing
// ---------------------------------------------------------------------------

/**
 * Parse a raw creator idea into structured intent.
 *
 * @param {string} rawIdea
 * @returns {Promise<{topic: string, format: string, platform: string, emotionalRegister: string, urgency: string}>}
 */
async function parseIntent(rawIdea) {
  const systemPrompt = `You are an expert content strategist. Your job is to parse a creator's raw idea into structured intent.

Extract the following fields and return ONLY valid JSON (no markdown fences, no extra text):
{
  "topic": "The core subject or theme of the content",
  "format": "One of: video | article | thread | podcast",
  "platform": "The target platform (e.g. YouTube, Twitter/X, LinkedIn, Instagram, TikTok, Substack, Spotify)",
  "emotionalRegister": "The emotional tone or register (e.g. inspiring, educational, controversial, vulnerable, funny, analytical)",
  "urgency": "One of: low | medium | high"
}

Rules:
- If format cannot be clearly inferred, default to "video"
- If platform cannot be clearly inferred, default to "YouTube"
- If urgency cannot be clearly inferred, default to "medium"
- Keep topic concise (max 15 words)
- Return ONLY the JSON object`;

  const userPrompt = `Parse this raw creator idea into structured intent:\n\n"${rawIdea}"`;

  const text = await callClaude(systemPrompt, userPrompt, 1024);

  const defaults = {
    topic: rawIdea.slice(0, 80),
    format: 'video',
    platform: 'YouTube',
    emotionalRegister: 'educational',
    urgency: 'medium',
  };

  const parsed = safeJsonParse(text, defaults);

  // Validate / coerce required fields
  const validFormats = ['video', 'article', 'thread', 'podcast'];
  const validUrgencies = ['low', 'medium', 'high'];

  return {
    topic: String(parsed.topic || defaults.topic),
    format: validFormats.includes(parsed.format) ? parsed.format : defaults.format,
    platform: String(parsed.platform || defaults.platform),
    emotionalRegister: String(parsed.emotionalRegister || defaults.emotionalRegister),
    urgency: validUrgencies.includes(parsed.urgency) ? parsed.urgency : defaults.urgency,
  };
}

// ---------------------------------------------------------------------------
// Step 2 — Voice Fingerprint Retrieval (loaded from argument or mock)
// ---------------------------------------------------------------------------
// The fingerprint is passed in by the caller (e.g. from a database or user
// profile). The retrieval step simply ensures it is present in the pipeline
// and records it as a completed step.

// ---------------------------------------------------------------------------
// Step 3 — Format Resonance Scoring
// ---------------------------------------------------------------------------

/**
 * Score content formats based on fingerprint performance data.
 *
 * @param {{topic: string, format: string, platform: string, emotionalRegister: string}} intent
 * @param {object} fingerprint  Creator voice fingerprint object
 * @returns {{rankedFormats: Array<{format: string, score: number, reason: string}>, topFormat: string, confidence: number}}
 */
function scoreFormatResonance(intent, fingerprint) {
  const patterns = fingerprint.patterns || {};
  const topicObsessions = patterns.topicObsessions || [];
  const hookStructures = patterns.hookStructures || [];
  const performanceData = fingerprint.performanceData || {};

  // Base scores derived from fingerprint engagement metrics
  const baseScores = {
    video: performanceData.videoEngagement || 0.7,
    article: performanceData.articleEngagement || 0.6,
    thread: performanceData.threadEngagement || 0.65,
    podcast: performanceData.podcastEngagement || 0.55,
  };

  // Bonus for topic alignment with creator's obsessions
  const topicLower = (intent.topic || '').toLowerCase();
  const obsessionMatch = topicObsessions.some((obs) =>
    topicLower.includes(obs.toLowerCase()) || obs.toLowerCase().includes(topicLower)
  );
  const obsessionBonus = obsessionMatch ? 0.12 : 0;

  // Bonus for hook structure availability per format
  const hookFormats = hookStructures.map((h) => (h.preferredFormat || '').toLowerCase());
  const videoHookBonus = hookFormats.includes('video') ? 0.08 : 0;
  const articleHookBonus = hookFormats.includes('article') ? 0.07 : 0;
  const threadHookBonus = hookFormats.includes('thread') ? 0.07 : 0;
  const podcastHookBonus = hookFormats.includes('podcast') ? 0.06 : 0;

  // Platform affinity bonuses
  const platformLower = (intent.platform || '').toLowerCase();
  const platformBonus = {
    video:
      platformLower.includes('youtube') ||
      platformLower.includes('tiktok') ||
      platformLower.includes('instagram')
        ? 0.1
        : 0,
    article:
      platformLower.includes('substack') ||
      platformLower.includes('medium') ||
      platformLower.includes('linkedin')
        ? 0.1
        : 0,
    thread:
      platformLower.includes('twitter') ||
      platformLower.includes('x.com') ||
      platformLower.includes('linkedin')
        ? 0.1
        : 0,
    podcast:
      platformLower.includes('spotify') ||
      platformLower.includes('podcast') ||
      platformLower.includes('apple')
        ? 0.1
        : 0,
  };

  // Urgency modifier — high urgency favors short-form
  const urgencyModifier = {
    video: intent.urgency === 'high' ? -0.05 : 0,
    article: intent.urgency === 'high' ? -0.08 : 0,
    thread: intent.urgency === 'high' ? 0.08 : 0,
    podcast: intent.urgency === 'high' ? -0.1 : 0,
  };

  const scores = {};
  for (const fmt of ['video', 'article', 'thread', 'podcast']) {
    const raw =
      baseScores[fmt] +
      obsessionBonus +
      (fmt === 'video' ? videoHookBonus : 0) +
      (fmt === 'article' ? articleHookBonus : 0) +
      (fmt === 'thread' ? threadHookBonus : 0) +
      (fmt === 'podcast' ? podcastHookBonus : 0) +
      platformBonus[fmt] +
      urgencyModifier[fmt];

    scores[fmt] = Math.min(1, Math.max(0, raw));
  }

  const reasons = {
    video: `Matches ${obsessionMatch ? 'topic obsession and ' : ''}visual storytelling strength${platformBonus.video > 0 ? ` on ${intent.platform}` : ''}`,
    article: `Suits deep-dive format${obsessionMatch ? ' for obsessive topic' : ''}${articleHookBonus > 0 ? ' with proven article hooks' : ''}`,
    thread: `Optimised for virality${threadHookBonus > 0 ? ' using thread hook patterns' : ''}${urgencyModifier.thread > 0 ? '; high-urgency fit' : ''}`,
    podcast: `Conversational depth${podcastHookBonus > 0 ? ' with audio hook structures' : ''}${platformBonus.podcast > 0 ? ` on ${intent.platform}` : ''}`,
  };

  const rankedFormats = ['video', 'article', 'thread', 'podcast']
    .map((fmt) => ({ format: fmt, score: parseFloat(scores[fmt].toFixed(3)), reason: reasons[fmt] }))
    .sort((a, b) => b.score - a.score);

  const topFormat = rankedFormats[0].format;
  const confidence = parseFloat(
    (rankedFormats[0].score - (rankedFormats[1] ? rankedFormats[1].score : 0)).toFixed(3)
  );

  return { rankedFormats, topFormat, confidence };
}

// ---------------------------------------------------------------------------
// Step 4 — Creative Risk Assessment
// ---------------------------------------------------------------------------

/**
 * Evaluate creative drift risk and identify a unique angle.
 *
 * @param {object} fingerprint
 * @param {object} intent
 * @param {string} rawIdea
 * @returns {Promise<{uniqueAngle: string, voiceDriftRisk: string, driftPercentage: number, recommendedLead: string, safeZone: boolean}>}
 */
async function assessCreativeRisk(fingerprint, intent, rawIdea) {
  const patterns = fingerprint.patterns || {};

  const systemPrompt = `You are a creative voice analyst for content creators. Your job is to assess how closely a new content idea aligns with a creator's established voice and identify any creative drift.

You will receive:
1. The creator's voice fingerprint patterns
2. The parsed intent for the new idea
3. The raw idea text

Evaluate and return ONLY valid JSON (no markdown fences):
{
  "uniqueAngle": "A distinctive, voice-aligned angle that makes this content memorable (1-2 sentences)",
  "voiceDriftRisk": "One of: low | medium | high",
  "driftPercentage": <integer 0-100, where 0 = perfectly on-brand, 100 = completely off-brand>,
  "recommendedLead": "The recommended opening hook or framing for this content (1-2 sentences)",
  "safeZone": <true if driftPercentage <= 30, false otherwise>
}`;

  const userPrompt = `Creator Voice Fingerprint:
${JSON.stringify({ patterns, writingStyle: fingerprint.writingStyle, coreThemes: fingerprint.coreThemes }, null, 2)}

Parsed Intent:
${JSON.stringify(intent, null, 2)}

Raw Idea:
"${rawIdea}"

Assess creative risk and return JSON.`;

  const text = await callClaude(systemPrompt, userPrompt, 1536);

  const defaults = {
    uniqueAngle: `A ${intent.emotionalRegister} take on ${intent.topic} that leverages the creator's authentic voice`,
    voiceDriftRisk: 'medium',
    driftPercentage: 25,
    recommendedLead: `Start with a personal story or unexpected observation about ${intent.topic}`,
    safeZone: true,
  };

  const parsed = safeJsonParse(text, defaults);

  const validRisks = ['low', 'medium', 'high'];
  const drift = Math.min(100, Math.max(0, parseInt(parsed.driftPercentage, 10) || defaults.driftPercentage));

  return {
    uniqueAngle: String(parsed.uniqueAngle || defaults.uniqueAngle),
    voiceDriftRisk: validRisks.includes(parsed.voiceDriftRisk) ? parsed.voiceDriftRisk : defaults.voiceDriftRisk,
    driftPercentage: drift,
    recommendedLead: String(parsed.recommendedLead || defaults.recommendedLead),
    safeZone: Boolean(typeof parsed.safeZone === 'boolean' ? parsed.safeZone : drift <= 30),
  };
}

// ---------------------------------------------------------------------------
// Step 5 — Script Generation (3 hook variants)
// ---------------------------------------------------------------------------

/**
 * Generate 3 hook variants in the creator's voice.
 *
 * @param {object} fingerprint
 * @param {object} intent
 * @param {object} riskAssessment
 * @returns {Promise<{hooks: Array<{text: string, voiceMatchScore: number, style: string}>, topHook: object}>}
 */
async function generateScriptHooks(fingerprint, intent, riskAssessment) {
  const patterns = fingerprint.patterns || {};
  const hookStructures = patterns.hookStructures || [];
  const topicObsessions = patterns.topicObsessions || [];
  const signaturePhrases = fingerprint.signaturePhrases || [];
  const writingStyle = fingerprint.writingStyle || {};

  const systemPrompt = `Generate 3 hook variants for a ${intent.format} in this creator's exact voice.

The hooks must:
- Sound authentically like this creator, not generic AI content
- Match the emotional register: ${intent.emotionalRegister}
- Incorporate the recommended lead angle where natural
- Be platform-appropriate for ${intent.platform}
- Each hook should use a distinct structural approach

Return ONLY valid JSON (no markdown fences):
{
  "hooks": [
    {
      "text": "The complete hook text (2-4 sentences max)",
      "voiceMatchScore": <float 0.0-1.0>,
      "style": "Brief label describing the hook style (e.g. 'Personal Story', 'Contrarian Take', 'Data-Led', 'Question Opener')"
    },
    { ... },
    { ... }
  ]
}`;

  const userPrompt = `CREATOR VOICE FINGERPRINT:
Topic Obsessions: ${JSON.stringify(topicObsessions)}
Hook Structures: ${JSON.stringify(hookStructures)}
Signature Phrases: ${JSON.stringify(signaturePhrases)}
Writing Style: ${JSON.stringify(writingStyle)}

CONTENT BRIEF:
Topic: ${intent.topic}
Format: ${intent.format}
Platform: ${intent.platform}
Emotional Register: ${intent.emotionalRegister}
Unique Angle: ${riskAssessment.uniqueAngle}
Recommended Lead: ${riskAssessment.recommendedLead}

Generate 3 distinct hook variants.`;

  const text = await callClaude(systemPrompt, userPrompt, 2048);

  const fallbackHooks = [
    {
      text: `${riskAssessment.recommendedLead} Here's what I've discovered about ${intent.topic} that changed everything.`,
      voiceMatchScore: 0.72,
      style: 'Personal Story',
    },
    {
      text: `Everyone is talking about ${intent.topic}, but they're missing the most important part. Let me show you what really matters.`,
      voiceMatchScore: 0.68,
      style: 'Contrarian Take',
    },
    {
      text: `What if everything you knew about ${intent.topic} was wrong? In this ${intent.format}, I'm breaking down the truth.`,
      voiceMatchScore: 0.65,
      style: 'Question Opener',
    },
  ];

  const parsed = safeJsonParse(text, { hooks: fallbackHooks });
  const rawHooks = Array.isArray(parsed.hooks) ? parsed.hooks : fallbackHooks;

  // Normalise and validate each hook
  const hooks = rawHooks.slice(0, 3).map((h, i) => ({
    text: String(h.text || fallbackHooks[i].text),
    voiceMatchScore: Math.min(1, Math.max(0, parseFloat(h.voiceMatchScore) || fallbackHooks[i].voiceMatchScore)),
    style: String(h.style || fallbackHooks[i].style),
  }));

  // Pad to exactly 3 if fewer were returned
  while (hooks.length < 3) {
    hooks.push(fallbackHooks[hooks.length]);
  }

  const topHook = hooks.reduce((best, h) => (h.voiceMatchScore > best.voiceMatchScore ? h : best), hooks[0]);

  return { hooks, topHook };
}

// ---------------------------------------------------------------------------
// Step 6 — Peak Window Scheduling (derived from momentum data)
// ---------------------------------------------------------------------------

/**
 * Determine the next optimal creation window from momentum data.
 * This is a synchronous calculation based on momentum patterns.
 *
 * @param {object} momentumData  Creator momentum and scheduling data
 * @param {string} urgency  'low' | 'medium' | 'high'
 * @returns {string}  Human-readable description of the next peak window
 */
function schedulePeakWindow(momentumData, urgency) {
  if (!momentumData) {
    return urgency === 'high' ? 'Today — within the next 4 hours' : 'Tomorrow morning (9–11 AM)';
  }

  const peakHours = momentumData.peakCreationHours || [];
  const peakDays = momentumData.peakDays || [];
  const streakActive = momentumData.streakActive || false;
  const lastSessionHoursAgo = momentumData.lastSessionHoursAgo || 24;
  const energyLevel = (momentumData.currentEnergyLevel || 'medium').toLowerCase();

  // If on a streak and energy is high, strike now
  if (streakActive && energyLevel === 'high') {
    return 'Right now — you are in peak momentum. Strike while the iron is hot.';
  }

  // High urgency overrides scheduling
  if (urgency === 'high') {
    if (energyLevel === 'high') {
      return 'Right now — high urgency + high energy = ideal conditions.';
    }
    return 'Within the next 2 hours — content is time-sensitive.';
  }

  // Use peak hours if available
  if (peakHours.length > 0) {
    const peakDayStr = peakDays.length > 0 ? peakDays.slice(0, 2).join(' or ') : 'your next work day';
    const hourStr = peakHours.slice(0, 2).join('–');
    return `${peakDayStr} at ${hourStr} — your historically highest-output window.`;
  }

  // Default scheduling based on last session gap
  if (lastSessionHoursAgo < 6) {
    return 'In 4–6 hours — let your current session energy replenish.';
  }
  if (lastSessionHoursAgo < 24) {
    return 'Tomorrow morning (9–11 AM) — fresh session after overnight rest.';
  }
  return 'Today between 9 AM–12 PM — you are due for a creation session.';
}

// ---------------------------------------------------------------------------
// Main orchestrator — runForgeBoard
// ---------------------------------------------------------------------------

/**
 * Run the full 6-step ForgeBoard pipeline.
 *
 * @param {string} rawIdea  The creator's raw content idea
 * @param {object} fingerprint  Creator voice fingerprint
 * @param {object} [momentumData]  Creator momentum/scheduling data
 * @param {Function} [onProgress]  Optional callback: onProgress(stepNumber, stepName, result)
 * @returns {Promise<{steps: Array, finalOutput: object}>}
 */
async function runForgeBoard(rawIdea, fingerprint, momentumData, onProgress) {
  const steps = [];

  function recordStep(step, name, result) {
    const entry = { step, name, status: 'complete', result };
    steps.push(entry);
    if (typeof onProgress === 'function') {
      onProgress(step, name, result);
    }
    return result;
  }

  // ── Step 1: Intent Parsing ────────────────────────────────────────────────
  const intent = recordStep(
    1,
    'Intent Parsing',
    await parseIntent(rawIdea)
  );

  // ── Step 2: Voice Fingerprint Retrieval ───────────────────────────────────
  const fingerprintResult = recordStep(2, 'Voice Fingerprint', {
    creatorId: fingerprint.creatorId || 'unknown',
    fingerprintVersion: fingerprint.version || '1.0',
    patternCount: Object.keys(fingerprint.patterns || {}).length,
    loadedAt: new Date().toISOString(),
  });

  // ── Step 3: Format Resonance Scoring ─────────────────────────────────────
  const resonanceResult = recordStep(
    3,
    'Format Resonance Scoring',
    scoreFormatResonance(intent, fingerprint)
  );

  // Overlay recommended format from resonance scoring if different from parsed
  const effectiveIntent = {
    ...intent,
    format: resonanceResult.topFormat,
  };

  // ── Step 4: Creative Risk Assessment ─────────────────────────────────────
  const riskAssessment = recordStep(
    4,
    'Creative Risk Assessment',
    await assessCreativeRisk(fingerprint, effectiveIntent, rawIdea)
  );

  // ── Step 5: Script Generation ─────────────────────────────────────────────
  const scriptResult = recordStep(
    5,
    'Script Generation',
    await generateScriptHooks(fingerprint, effectiveIntent, riskAssessment)
  );

  // ── Step 6: Peak Window Scheduling ───────────────────────────────────────
  const peakWindow = schedulePeakWindow(momentumData, intent.urgency);
  recordStep(6, 'Peak Window Scheduling', { nextPeakWindow: peakWindow });

  // ── Final Output ──────────────────────────────────────────────────────────
  const finalOutput = {
    topHook: scriptResult.topHook.text,
    voiceMatchScore: scriptResult.topHook.voiceMatchScore,
    recommendedFormat: resonanceResult.topFormat,
    driftRisk: riskAssessment.voiceDriftRisk,
    uniqueAngle: riskAssessment.uniqueAngle,
    nextPeakWindow: peakWindow,
  };

  return { steps, finalOutput };
}

// ---------------------------------------------------------------------------
// Demo runner — runDemoForgeBoard
// ---------------------------------------------------------------------------

/**
 * Mock fingerprint for "Maya" — a wellness/productivity creator persona.
 */
const MOCK_MAYA_FINGERPRINT = {
  creatorId: 'maya-demo',
  version: '1.0',
  coreThemes: ['productivity', 'mental health', 'authentic living', 'creative work', 'burnout recovery'],
  writingStyle: {
    tone: 'warm and direct',
    sentenceLength: 'medium',
    usesPersonalAnecdotes: true,
    usesDataPoints: true,
    avoidsJargon: true,
  },
  signaturePhrases: [
    "Here's the thing nobody tells you...",
    "I used to think...",
    "What changed everything for me was...",
    "Let me be honest with you —",
  ],
  patterns: {
    topicObsessions: [
      'burnout',
      'deep work',
      'creative blocks',
      'morning routines',
      'digital minimalism',
      'authentic productivity',
    ],
    hookStructures: [
      { type: 'personal_failure_pivot', preferredFormat: 'video' },
      { type: 'myth_busting', preferredFormat: 'thread' },
      { type: 'data_surprise', preferredFormat: 'article' },
      { type: 'vulnerable_admission', preferredFormat: 'podcast' },
    ],
    contentRhythm: {
      avgPostsPerWeek: 3,
      bestDaysToPost: ['Tuesday', 'Thursday'],
    },
  },
  performanceData: {
    videoEngagement: 0.82,
    articleEngagement: 0.74,
    threadEngagement: 0.79,
    podcastEngagement: 0.61,
  },
};

/**
 * Mock momentum data for Maya's current creative state.
 */
const MOCK_MAYA_MOMENTUM = {
  streakActive: true,
  currentEnergyLevel: 'high',
  lastSessionHoursAgo: 18,
  peakCreationHours: ['9 AM', '10 AM', '11 AM'],
  peakDays: ['Tuesday', 'Wednesday'],
  ideasQueueLength: 4,
  lastPublishedDaysAgo: 3,
};

/**
 * Run ForgeBoard with mock Maya fingerprint and momentum data for demos.
 *
 * @param {string} rawIdea
 * @param {Function} [onProgress]
 * @returns {Promise<{steps: Array, finalOutput: object}>}
 */
async function runDemoForgeBoard(rawIdea, onProgress) {
  return runForgeBoard(rawIdea, MOCK_MAYA_FINGERPRINT, MOCK_MAYA_MOMENTUM, onProgress);
}

// ---------------------------------------------------------------------------
// Exports
// ---------------------------------------------------------------------------

module.exports = {
  runForgeBoard,
  runDemoForgeBoard,
  parseIntent,
  scoreFormatResonance,
  assessCreativeRisk,
  generateScriptHooks,
};
