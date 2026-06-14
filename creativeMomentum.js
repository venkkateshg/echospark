'use strict';

// ---------------------------------------------------------------------------
// creativeMomentum.js — EchoSpark Creative Momentum Tracker
// Analyzes creation timestamps, detects peak creative windows, and builds
// velocity history from contentArchive contentItems.
// ---------------------------------------------------------------------------

const DAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

// ---------------------------------------------------------------------------
// 1. analyzeCreationTimestamps
// ---------------------------------------------------------------------------

/**
 * Extract all timestamps from contentItems and group by dayOfWeek, hour, month.
 *
 * @param {Array<{createdAt: string, modifiedAt: string, title: string, source: string, type: string}>} contentItems
 * @returns {{ byDayOfWeek: number[], byHour: number[], byMonth: Object }}
 */
function analyzeCreationTimestamps(contentItems) {
  const byDayOfWeek = new Array(7).fill(0);   // index 0 = Sunday
  const byHour      = new Array(24).fill(0);  // index 0 = midnight
  const byMonth     = {};                     // key = 'YYYY-MM'

  if (!Array.isArray(contentItems) || contentItems.length === 0) {
    return { byDayOfWeek, byHour, byMonth };
  }

  for (const item of contentItems) {
    // Collect both timestamps; deduplicate exact same value
    const rawTimestamps = [];
    if (item.createdAt)  rawTimestamps.push(item.createdAt);
    if (item.modifiedAt && item.modifiedAt !== item.createdAt) {
      rawTimestamps.push(item.modifiedAt);
    }

    for (const ts of rawTimestamps) {
      const d = new Date(ts);
      if (isNaN(d.getTime())) continue; // skip unparseable timestamps

      byDayOfWeek[d.getDay()]++;
      byHour[d.getHours()]++;

      const monthKey = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
      byMonth[monthKey] = (byMonth[monthKey] || 0) + 1;
    }
  }

  return { byDayOfWeek, byHour, byMonth };
}

// ---------------------------------------------------------------------------
// 2. detectPeakWindows
// ---------------------------------------------------------------------------

/**
 * Find the peak creative window from the analyzed patterns.
 *
 * @param {{ byDayOfWeek: number[], byHour: number[], byMonth: Object }} patterns
 * @returns {{ peakDayOfWeek: number, peakDayName: string, peakHour: number, peakHourRange: string, confidence: number }}
 */
function detectPeakWindows(patterns) {
  const { byDayOfWeek, byHour } = patterns;

  // Peak day of week
  const peakDayOfWeek = byDayOfWeek.indexOf(Math.max(...byDayOfWeek));
  const peakDayName   = DAY_NAMES[peakDayOfWeek];

  // Peak single hour
  const peakHour = byHour.indexOf(Math.max(...byHour));

  // Peak 2-hour window (wrap-around handled)
  let bestWindowStart = 0;
  let bestWindowCount = -1;
  for (let h = 0; h < 24; h++) {
    const count = byHour[h] + byHour[(h + 1) % 24];
    if (count > bestWindowCount) {
      bestWindowCount = count;
      bestWindowStart = h;
    }
  }
  const windowEnd = (bestWindowStart + 2) % 24;
  const peakHourRange = `${_formatHour(bestWindowStart)}-${_formatHour(windowEnd)}`;

  // Confidence: based on total event count vs a "rich" threshold of 100 data points
  const totalEvents = byDayOfWeek.reduce((a, b) => a + b, 0);
  const confidence  = Math.min(totalEvents / 100, 1);

  return { peakDayOfWeek, peakDayName, peakHour, peakHourRange, confidence };
}

function _formatHour(h) {
  const period = h < 12 ? 'am' : 'pm';
  const display = h === 0 ? 12 : h > 12 ? h - 12 : h;
  return `${display}${period}`;
}

// ---------------------------------------------------------------------------
// 3. buildVelocityHistory
// ---------------------------------------------------------------------------

/**
 * Group contentItems by ISO week, count per week for last 26 weeks, add rolling
 * 4-week average.
 *
 * @param {Array<{createdAt: string}>} contentItems
 * @returns {Array<{ week: string, count: number, rollingAvg: number }>}
 */
function buildVelocityHistory(contentItems) {
  const now = new Date();

  // Generate the 26 most-recent ISO week keys (inclusive of current week)
  const weeks = [];
  for (let i = 25; i >= 0; i--) {
    const d = new Date(now);
    d.setDate(d.getDate() - i * 7);
    weeks.push(_isoWeekKey(d));
  }

  // Count items per ISO week
  const countByWeek = {};
  weeks.forEach(w => { countByWeek[w] = 0; });

  if (Array.isArray(contentItems)) {
    for (const item of contentItems) {
      const ts = item.createdAt || item.modifiedAt;
      if (!ts) continue;
      const d = new Date(ts);
      if (isNaN(d.getTime())) continue;
      const key = _isoWeekKey(d);
      if (Object.prototype.hasOwnProperty.call(countByWeek, key)) {
        countByWeek[key]++;
      }
    }
  }

  // Build result array sorted by week, with rolling 4-week average
  const result = weeks.map(week => ({ week, count: countByWeek[week] }));

  for (let i = 0; i < result.length; i++) {
    const windowSlice = result.slice(Math.max(0, i - 3), i + 1);
    const sum         = windowSlice.reduce((a, r) => a + r.count, 0);
    result[i].rollingAvg = parseFloat((sum / windowSlice.length).toFixed(2));
  }

  return result;
}

/**
 * Returns an ISO 8601 week key in the format YYYY-WW.
 * Week 01 = the week containing the first Thursday of the year (ISO standard).
 */
function _isoWeekKey(date) {
  const d = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
  // Set to nearest Thursday: current date + 4 - current day number (Mon=1)
  const day = d.getUTCDay() || 7; // make Sunday = 7
  d.setUTCDate(d.getUTCDate() + 4 - day);
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
  const weekNum   = Math.ceil(((d - yearStart) / 86400000 + 1) / 7);
  return `${d.getUTCFullYear()}-${String(weekNum).padStart(2, '0')}`;
}

// ---------------------------------------------------------------------------
// 4. getNextPeakWindow
// ---------------------------------------------------------------------------

/**
 * Given the peak window info, compute the next real-world occurrence.
 *
 * @param {{ peakDayOfWeek: number, peakHour: number, peakHourRange: string, peakDayName: string }} peakWindows
 * @returns {{ datetime: string, dayName: string, timeRange: string, daysUntil: number }}
 */
function getNextPeakWindow(peakWindows) {
  const { peakDayOfWeek, peakHour, peakHourRange, peakDayName } = peakWindows;

  const now      = new Date();
  const todayDay = now.getDay();

  // Days until the peak day (0 = today, could still be in the future if hour not yet reached)
  let daysAhead = (peakDayOfWeek - todayDay + 7) % 7;

  // If today is the peak day but the peak hour has already passed, advance by a week
  if (daysAhead === 0 && now.getHours() >= peakHour + 1) {
    daysAhead = 7;
  }

  const next = new Date(
    now.getFullYear(),
    now.getMonth(),
    now.getDate() + daysAhead,
    peakHour,
    0,
    0,
    0
  );

  return {
    datetime  : next.toISOString(),
    dayName   : peakDayName,
    timeRange : peakHourRange,
    daysUntil : daysAhead,
  };
}

// ---------------------------------------------------------------------------
// 5. getMomentumData (async, uses graphClient)
// ---------------------------------------------------------------------------

/**
 * Build full momentum analysis, optionally enriched with OneDrive recent files.
 *
 * @param {import('@microsoft/microsoft-graph-client').Client} graphClient
 * @param {Array} contentItems
 * @returns {Promise<{ patterns, peakWindows, velocityHistory, nextPeakWindow, totalItemsAnalyzed, dataQuality }>}
 */
async function getMomentumData(graphClient, contentItems) {
  let allItems = Array.isArray(contentItems) ? [...contentItems] : [];

  // Try to enrich with OneDrive recent file activity
  try {
    const response = await graphClient
      .api('/me/drive/recent')
      .select('id,name,createdDateTime,lastModifiedDateTime')
      .top(50)
      .get();

    const recentFiles = (response.value || []).map(f => ({
      title     : f.name,
      source    : 'onedrive',
      type      : 'file',
      createdAt : f.createdDateTime,
      modifiedAt: f.lastModifiedDateTime,
    }));

    // Merge: avoid duplicates by title+createdAt
    const existingKeys = new Set(
      allItems.map(i => `${i.title}|${i.createdAt}`)
    );
    for (const rf of recentFiles) {
      const key = `${rf.title}|${rf.createdAt}`;
      if (!existingKeys.has(key)) {
        allItems.push(rf);
        existingKeys.add(key);
      }
    }
  } catch (_err) {
    // OneDrive fetch is best-effort; continue with what we have
  }

  const totalItemsAnalyzed = allItems.length;

  // Determine data quality
  let dataQuality;
  if (totalItemsAnalyzed >= 50) {
    dataQuality = 'rich';
  } else if (totalItemsAnalyzed >= 10) {
    dataQuality = 'sparse';
  } else {
    dataQuality = 'demo';
  }

  const patterns        = analyzeCreationTimestamps(allItems);
  const peakWindows     = detectPeakWindows(patterns);
  const velocityHistory = buildVelocityHistory(allItems);
  const nextPeak        = getNextPeakWindow(peakWindows);

  return {
    patterns,
    peakWindows,
    velocityHistory,
    nextPeakWindow      : nextPeak,
    totalItemsAnalyzed,
    dataQuality,
  };
}

// ---------------------------------------------------------------------------
// 6. getMockMomentumData — Maya creator demo scenario
// ---------------------------------------------------------------------------

/**
 * Realistic demo data for the Maya creator scenario.
 * Peak creative window: Tuesday 9–11am.
 * 26 weeks of velocity history with organic peaks and valleys.
 */
function getMockMomentumData() {
  // --- patterns -------------------------------------------------------
  const byDayOfWeek = [4, 18, 27, 15, 12, 8, 3]; // Tue (index 2) is peak
  const byHour = [
    0, 0, 1, 0, 0, 2, 4, 8, 14, 22, 18, 12,  // 0-11
    9, 7, 10, 8, 6, 5, 7, 4,  3,  2,  1,  0  // 12-23
  ]; // 9am slot is max
  const byMonth = {
    '2025-12': 8,
    '2026-01': 12,
    '2026-02': 15,
    '2026-03': 19,
    '2026-04': 14,
    '2026-05': 22,
    '2026-06': 7,
  };

  const patterns = { byDayOfWeek, byHour, byMonth };

  // --- peakWindows ----------------------------------------------------
  const peakWindows = {
    peakDayOfWeek : 2,
    peakDayName   : 'Tuesday',
    peakHour      : 9,
    peakHourRange : '9am-11am',
    confidence    : 0.87,
  };

  // --- velocityHistory — 26 weeks of organic data ---------------------
  // Build week keys going back 25 weeks from today
  const now = new Date();
  const rawCounts = [
    3, 5, 4, 7, 6, 8, 5, 9, 11, 8,
    6, 12, 10, 7, 14, 13, 9, 11, 8, 15,
    12, 10, 16, 14, 11, 9,
  ];

  const velocityHistory = rawCounts.map((count, i) => {
    const d = new Date(now);
    d.setDate(d.getDate() - (25 - i) * 7);
    const week = _isoWeekKey(d);
    return { week, count };
  });

  // Rolling 4-week average
  for (let i = 0; i < velocityHistory.length; i++) {
    const slice      = velocityHistory.slice(Math.max(0, i - 3), i + 1);
    const sum        = slice.reduce((a, r) => a + r.count, 0);
    velocityHistory[i].rollingAvg = parseFloat((sum / slice.length).toFixed(2));
  }

  // --- nextPeakWindow -------------------------------------------------
  const nextPeak = getNextPeakWindow(peakWindows);

  return {
    patterns,
    peakWindows,
    velocityHistory,
    nextPeakWindow     : nextPeak,
    totalItemsAnalyzed : 97,
    dataQuality        : 'rich',
    // Extra insight for demo UI
    creatorInsight: {
      name          : 'Maya',
      topContentType: 'short-form video',
      peakNote      : 'Maya produces her highest-performing content on Tuesday mornings between 9–11am. Posts created in this window receive 2.3× more engagement on average.',
    },
  };
}

// ---------------------------------------------------------------------------
// Exports
// ---------------------------------------------------------------------------

module.exports = {
  getMomentumData,
  analyzeCreationTimestamps,
  detectPeakWindows,
  buildVelocityHistory,
  getNextPeakWindow,
  getMockMomentumData,
};
