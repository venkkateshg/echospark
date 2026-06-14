const express = require('express');
const router = express.Router();

const { createGraphClient } = require('../graphClient');
const { getContentArchive } = require('../contentArchive');
const { buildVoiceFingerprint, getMockFingerprint } = require('../voiceFingerprint');
const { getMomentumData, getMockMomentumData } = require('../creativeMomentum');
const { runForgeBoard, runDemoForgeBoard } = require('../forgeboard');
const { getWorkIQCombinedContext } = require('../workiqClient');

/**
 * Parses Work IQ's natural language performance response and adjusts engagement
 * scores for ForgeBoard Step 3 (Format Resonance). Boosts formats that Work IQ
 * identifies as high-engagement; conservative delta (max ±0.15) so mock baseline
 * always contributes.
 *
 * @param {object} existing  Current performanceData object
 * @param {string} workIQText  Work IQ natural language response
 * @returns {object} Merged performanceData
 */
function enrichPerformanceData(existing = {}, workIQText = '') {
  const text = workIQText.toLowerCase();
  const delta = 0.12;

  const boosts = {
    videoEngagement:   text.includes('video') && (text.includes('most') || text.includes('highest') || text.includes('popular')) ? delta : 0,
    articleEngagement: text.includes('article') || text.includes('blog') || text.includes('post')
      ? (text.includes('most') || text.includes('highest') ? delta : delta * 0.5)
      : 0,
    threadEngagement:  text.includes('thread') || text.includes('tweet') || text.includes('linkedin')
      ? (text.includes('most') || text.includes('highest') ? delta : delta * 0.5)
      : 0,
    podcastEngagement: text.includes('podcast') || text.includes('audio')
      ? (text.includes('most') || text.includes('highest') ? delta : delta * 0.5)
      : 0,
  };

  return {
    videoEngagement:   Math.min(1, (existing.videoEngagement   || 0.7) + boosts.videoEngagement),
    articleEngagement: Math.min(1, (existing.articleEngagement || 0.6) + boosts.articleEngagement),
    threadEngagement:  Math.min(1, (existing.threadEngagement  || 0.65) + boosts.threadEngagement),
    podcastEngagement: Math.min(1, (existing.podcastEngagement || 0.55) + boosts.podcastEngagement),
  };
}

// POST /api/analyze
router.post('/analyze', async (req, res) => {
  try {
    const useDemo = req.body.useDemo === true || req.body.useDemo === 'true';
    const accessToken = req.session.accessToken;

    let fingerprint;
    let momentumData;
    let contentCount;
    let isMock;
    let workIQStatus = 'inactive';
    let workIQInsight = null;

    if (useDemo || !accessToken) {
      fingerprint = getMockFingerprint();
      momentumData = getMockMomentumData();
      contentCount = 0;
      isMock = true;
    } else {
      const graphClient = createGraphClient(accessToken);

      // Run Work IQ in parallel with Graph API calls
      const [workiqResult, driveItems, momentumResult] = await Promise.allSettled([
        getWorkIQCombinedContext(accessToken),
        getContentArchive(graphClient, null),
        getMomentumData(graphClient, []),
      ]);

      const workiqData = workiqResult.status === 'fulfilled' ? workiqResult.value : null;
      if (workiqResult.status === 'rejected') {
        console.warn('[api] Work IQ combined context failed (non-fatal):', workiqResult.reason?.message);
      }

      // Merge Work IQ content items into archive
      let items = driveItems.status === 'fulfilled' ? driveItems.value : [];
      if (workiqData?.contentText) {
        const { parseWorkIQContentResponse } = require('../contentArchive');
        const workiqItems = parseWorkIQContentResponse(workiqData.contentText);
        console.log(`[api] Work IQ content items merged: ${workiqItems.length}`);
        items = [...items, ...workiqItems];
      }

      fingerprint = await buildVoiceFingerprint(items);
      momentumData = momentumResult.status === 'fulfilled' ? momentumResult.value : getMockMomentumData();
      contentCount = items.length;
      isMock = false;

      // Derive Work IQ status
      if (workiqData?.contentText || workiqData?.performanceText) {
        workIQStatus = 'active';
        workIQInsight = workiqData.performanceText || null;
        fingerprint.workIQContext = workiqData.performanceText || workiqData.contentText;
        fingerprint.performanceData = enrichPerformanceData(
          fingerprint.performanceData,
          workiqData.performanceText || ''
        );
      } else if (workiqResult.status === 'rejected') {
        const msg = workiqResult.reason?.message || '';
        workIQStatus = msg.includes('timeout') ? 'timeout' : 'error';
      } else {
        workIQStatus = 'no_content';
      }

      console.log(`[api] workIQStatus: ${workIQStatus}`);
    }

    req.session.fingerprint = fingerprint;
    req.session.momentumData = momentumData;

    res.json({ fingerprint, momentum: momentumData, contentCount, isMock, workIQStatus, workIQInsight });
  } catch (error) {
    console.error('[api] /analyze error:', error.message || error);
    res.status(500).json({ error: 'Failed to analyze content', details: error.message });
  }
});

// POST /api/forgeboard
router.post('/forgeboard', async (req, res) => {
  try {
    const { rawIdea, useDemo } = req.body;

    // Validate rawIdea
    if (!rawIdea || typeof rawIdea !== 'string' || rawIdea.trim().length === 0) {
      return res.status(400).json({ error: 'rawIdea is required' });
    }
    if (rawIdea.length > 500) {
      return res.status(400).json({ error: 'rawIdea must be 500 characters or fewer' });
    }

    const isDemo = useDemo === true || useDemo === 'true';

    let result;
    if (isDemo) {
      result = await runDemoForgeBoard(rawIdea.trim());
    } else {
      const fingerprint = req.session.fingerprint || getMockFingerprint();
      const momentumData = req.session.momentumData || getMockMomentumData();
      result = await runForgeBoard(rawIdea.trim(), fingerprint, momentumData);
    }

    res.json({ steps: result.steps, finalOutput: result.finalOutput });
  } catch (error) {
    console.error('[api] /forgeboard error:', error.message || error);
    res.status(500).json({ error: 'Failed to run ForgeBoard', details: error.message });
  }
});

// GET /api/status
router.get('/status', (req, res) => {
  res.json({
    authenticated: !!req.session.accessToken,
    hasFingerprintInSession: !!req.session.fingerprint,
    workIQActive: !!(req.session.fingerprint && req.session.fingerprint.workIQContext),
    username: req.session.userDisplayName || null,
  });
});

module.exports = router;
