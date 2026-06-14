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

const DEFAULT_ANALYSIS = {
  recurringMetaphors: [],
  sentenceRhythm: 'Unknown',
  hookStructures: [],
  emotionalRegisters: [],
  topicObsessions: [],
  writingPersonality: 'Unknown',
  avgSentenceLength: 'medium',
  preferredOpenings: [],
};

/**
 * Analyzes a creator's content archive and extracts their unique voice patterns.
 * @param {Array<{title: string, content: string, source: string, type: string, createdAt: string}>} contentItems
 * @returns {Promise<Object>} Parsed voice pattern object
 */
async function analyzeVoicePatterns(contentItems) {
  const sample = contentItems.slice(0, 15);

  const sampleText = sample
    .map((item, i) => {
      const snippet = (item.content || '').slice(0, 500);
      return `--- Item ${i + 1}: ${item.title || '(untitled)'} ---\n${snippet}`;
    })
    .join('\n\n');

  const systemPrompt = `You are an expert literary analyst specializing in identifying unique creative voices and writing signatures.
Analyze the provided content samples from a single creator and extract their distinctive voice fingerprint.

Return ONLY a valid JSON object with exactly these keys:
{
  "recurringMetaphors": ["array of recurring metaphors or analogies the creator uses"],
  "sentenceRhythm": "a description of how the creator structures sentence rhythm and pacing",
  "hookStructures": ["array of opening/hook patterns the creator favors"],
  "emotionalRegisters": ["array of emotional tones that recur in the writing"],
  "topicObsessions": ["array of themes or subjects the creator returns to repeatedly"],
  "writingPersonality": "a single descriptive string capturing the creator's overall authorial voice",
  "avgSentenceLength": "short, medium, or long",
  "preferredOpenings": ["array of specific phrases or sentence starters the creator tends to use"]
}

Do not include any explanation, markdown fencing, or extra text — only the raw JSON object.`;

  const userMessage = `Here are content samples from a creator's archive. Analyze them and return the voice fingerprint JSON:\n\n${sampleText}`;

  try {
    const response = await client.messages.create({
      model: 'claude-haiku-4-5',
      max_tokens: 1024,
      messages: [{ role: 'user', content: userMessage }],
      system: systemPrompt,
    });

    const rawText = response.content[0].text.trim();

    // Strip markdown code fences if present
    const jsonText = rawText.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '').trim();

    return JSON.parse(jsonText);
  } catch (error) {
    console.error('analyzeVoicePatterns error:', error.message || error);
    return { ...DEFAULT_ANALYSIS };
  }
}

/**
 * Builds a complete voice fingerprint for the creator based on their content archive.
 * @param {Array<{title: string, content: string, source: string, type: string, createdAt: string}>} contentItems
 * @returns {Promise<Object>} Enriched voice fingerprint
 */
async function buildVoiceFingerprint(contentItems) {
  if (!contentItems || contentItems.length === 0) {
    return getMockFingerprint();
  }

  const analysisResult = await analyzeVoicePatterns(contentItems);

  return {
    patterns: analysisResult,
    contentCount: contentItems.length,
    analyzedAt: new Date().toISOString(),
    sources: [...new Set(contentItems.map(i => i.source).filter(Boolean))],
  };
}

/**
 * Compares a draft text against the creator's voice fingerprint and returns a match score.
 * @param {Object} fingerprint - Voice fingerprint produced by buildVoiceFingerprint
 * @param {string} draftText - The draft content to evaluate
 * @returns {Promise<{score: number, strengths: string[], weaknesses: string[], recommendation: string}>}
 */
async function calculateVoiceMatch(fingerprint, draftText) {
  const patterns = fingerprint.patterns || {};

  const systemPrompt = `You are an expert writing coach who evaluates how well a piece of content matches a creator's established voice fingerprint.

Given a voice fingerprint and a draft text, assess how well the draft reflects the creator's voice.

Return ONLY a valid JSON object with exactly these keys:
{
  "score": 0.0,
  "strengths": ["array of specific ways the draft successfully reflects the creator's voice"],
  "weaknesses": ["array of specific ways the draft diverges from the creator's voice"],
  "recommendation": "a concise, actionable suggestion to better align the draft with the creator's voice"
}

The score must be a float between 0.0 (no match) and 1.0 (perfect match).
Do not include any explanation, markdown fencing, or extra text — only the raw JSON object.`;

  const userMessage = `Voice Fingerprint:
${JSON.stringify(patterns, null, 2)}

Draft Text:
${draftText}

Evaluate how well the draft matches the creator's voice and return the JSON assessment.`;

  try {
    const response = await client.messages.create({
      model: 'claude-haiku-4-5',
      max_tokens: 1024,
      messages: [{ role: 'user', content: userMessage }],
      system: systemPrompt,
    });

    const rawText = response.content[0].text.trim();
    const jsonText = rawText.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '').trim();

    return JSON.parse(jsonText);
  } catch (error) {
    console.error('calculateVoiceMatch error:', error.message || error);
    return {
      score: 0.75,
      strengths: [],
      weaknesses: [],
      recommendation: 'Unable to analyze voice match at this time.',
    };
  }
}

/**
 * Returns a realistic demo fingerprint for when no content archive is available.
 * @returns {Object} Mock voice fingerprint
 */
function getMockFingerprint() {
  return {
    patterns: {
      recurringMetaphors: [
        'technology as a living system',
        'learning as physical movement',
        'problems as landscapes',
      ],
      sentenceRhythm:
        'Varied rhythm: short punchy statements followed by longer exploratory sentences',
      hookStructures: [
        'Personal failure/vulnerability opener',
        'Counterintuitive claim',
        'Specific number + surprising fact',
      ],
      emotionalRegisters: ['curious', 'self-deprecating', 'earnest', 'occasionally frustrated'],
      topicObsessions: [
        'developer experience',
        "AI's effect on craft",
        'authenticity in tech content',
        'fundamentals vs tools',
      ],
      writingPersonality:
        'Thoughtful practitioner who questions received wisdom and leads with personal experience',
      avgSentenceLength: 'medium',
      preferredOpenings: ['I noticed...', 'I wonder if...', 'Last week I...'],
    },
    contentCount: 0,
    analyzedAt: new Date().toISOString(),
    sources: ['demo'],
    isMock: true,
  };
}

module.exports = {
  buildVoiceFingerprint,
  calculateVoiceMatch,
  getMockFingerprint,
  analyzeVoicePatterns,
};
