'use strict';

// ─── State ────────────────────────────────────────────────────────────────────

const state = {
  fingerprint: null,
  momentum: null,
  isAuthenticated: false,
  isDemo: true,
  workIQStatus: 'inactive',
  workIQInsight: null,
};

// ─── DOM helpers ──────────────────────────────────────────────────────────────

function $(id) { return document.getElementById(id); }
function setText(id, text) { const el = $(id); if (el) el.textContent = text ?? '—'; }
function show(id) { const el = $(id); if (el) el.style.display = ''; }
function hide(id) { const el = $(id); if (el) el.style.display = 'none'; }
function showEl(el) { if (el) el.style.display = ''; }
function hideEl(el) { if (el) el.style.display = 'none'; }
function delay(ms) { return new Promise(r => setTimeout(r, ms)); }

function renderTags(containerId, items, className = 'tag') {
  const el = $(containerId);
  if (!el) return;
  el.innerHTML = '';
  (items || []).slice(0, 6).forEach(item => {
    const span = document.createElement('span');
    span.className = className;
    span.textContent = typeof item === 'string' ? item : (item.type || item.name || String(item));
    el.appendChild(span);
  });
}

function escapeHtml(text) {
  return String(text)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#039;');
}

function riskBadgeClass(risk) {
  switch ((risk || '').toLowerCase()) {
    case 'low':    return 'badge-green';
    case 'medium': return 'badge-yellow';
    case 'high':   return 'badge-red';
    default:       return 'badge-purple';
  }
}

// ─── Toast notifications ──────────────────────────────────────────────────────

function toast(msg, type = 'info', duration = 3000) {
  const container = $('toast-container');
  if (!container) return;

  const t = document.createElement('div');
  t.className = `toast toast-${type}`;
  t.textContent = msg;
  container.appendChild(t);

  requestAnimationFrame(() => t.classList.add('toast-visible'));
  setTimeout(() => {
    t.classList.remove('toast-visible');
    setTimeout(() => t.remove(), 300);
  }, duration);
}

// ─── Auth / Status ────────────────────────────────────────────────────────────

async function checkAuthStatus() {
  try {
    const res  = await fetch('/api/status');
    const data = await res.json();
    state.isAuthenticated = !!data.authenticated;

    if (state.isAuthenticated) {
      hideEl($('login-btn'));
      showEl($('logout-btn'));
      if (data.username) {
        const badge = $('username-display');
        badge.textContent = data.username;
        showEl(badge);
      }
    } else {
      showEl($('login-btn'));
      hideEl($('logout-btn'));
      hideEl($('username-display'));
    }
  } catch (_) {}
}

// ─── Forge button state ───────────────────────────────────────────────────────

function updateForgeState() {
  const btn  = $('forge-btn');
  const note = $('forge-state-note');
  const hasFingerprint = !!state.fingerprint;

  if (btn) btn.disabled = !hasFingerprint;
  if (note) note.style.display = hasFingerprint ? 'none' : '';
}

// ─── Analyze Archive ──────────────────────────────────────────────────────────

async function analyzeArchive(demo = false) {
  state.isDemo = demo;

  hide('fingerprint-card');
  show('analyze-loading');
  setText('analyze-loading-text',
    demo ? 'Loading demo voice fingerprint...' : 'Analyzing your M365 archive...'
  );

  const btns = ['analyze-btn', 'demo-btn', 'hero-analyze-btn', 'hero-demo-btn'];
  btns.forEach(id => { const el = $(id); if (el) el.disabled = true; });

  try {
    const res  = await fetch('/api/analyze', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ useDemo: demo }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Analyze failed');

    state.fingerprint   = data.fingerprint;
    state.momentum      = data.momentum;
    state.workIQStatus  = data.workIQStatus  || 'inactive';
    state.workIQInsight = data.workIQInsight || null;

    hide('analyze-loading');
    renderFingerprintCard(data.fingerprint, data.contentCount, data.isMock);
    show('fingerprint-card');
    updateForgeState();

    if (data.momentum) renderVelocityChart(data.momentum);

    if (demo) {
      toast('Demo fingerprint loaded — try ForgeBoard below!', 'success');
    } else {
      const wiqMessages = {
        active:     'Archive analyzed — Work IQ connected ✓',
        timeout:    'Archive analyzed. Work IQ timed out — M365 Copilot was slow. OneDrive/OneNote data used.',
        error:      'Archive analyzed. Work IQ unavailable — check M365 Copilot license.',
        no_content: 'Archive analyzed. Work IQ found no content — add .docx files to OneDrive for a real fingerprint.',
        inactive:   'Archive analyzed.',
      };
      const msg  = wiqMessages[state.workIQStatus] || 'Archive analyzed.';
      const type = state.workIQStatus === 'active' ? 'success' : state.workIQStatus === 'inactive' ? 'success' : 'warning';
      toast(msg, type, 6000);
    }

    // Smooth scroll to ForgeBoard after brief pause
    await delay(600);
    $('forgeboard-section').scrollIntoView({ behavior: 'smooth', block: 'start' });

  } catch (err) {
    hide('analyze-loading');
    toast(`Analysis failed: ${err.message}`, 'error');
    console.error('[EchoSpark] analyzeArchive error:', err.message);
  } finally {
    btns.forEach(id => { const el = $(id); if (el) el.disabled = false; });
  }
}

// ─── Fingerprint Card ─────────────────────────────────────────────────────────

function renderFingerprintCard(fingerprint, contentCount, isMock) {
  if (!fingerprint) return;
  const patterns = fingerprint.patterns || {};

  const analyzed = fingerprint.analyzedAt
    ? new Date(fingerprint.analyzedAt).toLocaleString()
    : 'just now';
  const sources = (fingerprint.sources || []).join(', ') || 'M365';
  $('fingerprint-meta').textContent = `Analyzed ${analyzed} · Sources: ${sources}`;

  isMock || fingerprint.isMock ? show('fingerprint-demo-badge') : hide('fingerprint-demo-badge');

  setText('fp-personality', patterns.writingPersonality || '—');
  setText('fp-rhythm',      patterns.sentenceRhythm     || '—');

  renderTags('fp-obsessions', patterns.topicObsessions,  'tag');
  renderTags('fp-registers',  patterns.emotionalRegisters,'tag tag-cyan');
  renderTags('fp-hooks',      patterns.hookStructures,    'tag');

  const docs = typeof contentCount === 'number' ? contentCount : (fingerprint.contentCount || 0);
  const patCount = Object.keys(patterns).filter(k => {
    const v = patterns[k];
    return Array.isArray(v) ? v.length > 0 : Boolean(v);
  }).length;

  setText('fp-count',    docs > 0 ? docs : 'Demo');
  setText('fp-patterns', patCount || '—');
  setText('fp-sources',  (fingerprint.sources || []).length || 1);

  // Work IQ panel — only show in real mode
  const panel = $('workiq-panel');
  if (!panel || isMock || fingerprint.isMock) return;

  const statusLabelEl = $('workiq-status-label');
  const insightEl     = $('workiq-insight-text');
  const wiqStatus     = state.workIQStatus;
  const wiqInsight    = state.workIQInsight || fingerprint.workIQContext || null;

  const labelMap = {
    active:     '✓ Connected',
    timeout:    '⚠ Timed out',
    error:      '⚠ Unavailable',
    no_content: '— No content found',
  };
  if (statusLabelEl) statusLabelEl.textContent = labelMap[wiqStatus] || '';

  if (wiqInsight && insightEl) {
    insightEl.textContent = wiqInsight.slice(0, 400);
  } else if (insightEl) {
    const hints = {
      timeout:    'Work IQ timed out. M365 Copilot is available but slow — re-analyze to retry.',
      error:      'Work IQ could not connect. Verify your M365 Copilot license is active.',
      no_content: 'Work IQ found no content. Add .docx or .txt files to OneDrive and re-analyze.',
      active:     '',
    };
    insightEl.textContent = hints[wiqStatus] || '';
  }

  show('workiq-panel');
}

// ─── ForgeBoard ───────────────────────────────────────────────────────────────

async function runForgeBoard(rawIdea) {
  if (!rawIdea || !rawIdea.trim()) {
    toast('Enter your raw idea first.', 'error');
    return;
  }
  if (!state.fingerprint) {
    toast('Run archive analysis first (or Demo Mode).', 'error');
    return;
  }

  const forgeBtn   = $('forge-btn');
  const btnText    = forgeBtn.querySelector('.forge-btn-text');
  const btnLoading = forgeBtn.querySelector('.forge-btn-loading');
  const forgeError = $('forge-error');

  hideEl(forgeError);
  hideEl(btnText);
  showEl(btnLoading);
  forgeBtn.disabled = true;

  // Hide previous output, show steps
  hide('output-section');
  show('steps-section');
  resetStepCards();
  $('steps-section').scrollIntoView({ behavior: 'smooth', block: 'start' });

  try {
    const res  = await fetch('/api/forgeboard', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ rawIdea: rawIdea.trim(), useDemo: state.isDemo }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'ForgeBoard failed');

    await renderStepCards(data.steps);

    if (data.finalOutput) renderFinalOutput(data.finalOutput);

    toast('Script forged!', 'success');
  } catch (err) {
    console.error('[EchoSpark] runForgeBoard error:', err.message);
    const el = $('forge-error');
    if (el) { el.textContent = `ForgeBoard error: ${err.message}`; el.style.display = 'block'; }
    toast(`ForgeBoard error: ${err.message}`, 'error');
  } finally {
    showEl(btnText);
    hideEl(btnLoading);
    forgeBtn.disabled = false;
    updateForgeState();
  }
}

// ─── Step Cards ───────────────────────────────────────────────────────────────

function resetStepCards() {
  for (let i = 1; i <= 6; i++) {
    const card = $(`step-${i}`);
    if (!card) continue;
    card.classList.remove('revealed');

    // Restore spinner, remove injected check icon
    const spinner = card.querySelector('.spinner');
    if (spinner) spinner.style.display = '';
    const check = card.querySelector('.step-check-icon');
    if (check) check.remove();
  }
}

function revealStepCard(stepNum) {
  const card = $(`step-${stepNum}`);
  if (!card) return;
  card.classList.add('revealed');

  const statusIcon = card.querySelector('.step-status-icon');
  const spinner    = card.querySelector('.spinner');
  if (spinner) spinner.style.display = 'none';

  if (statusIcon && !statusIcon.querySelector('.step-check-icon')) {
    const svg = document.createElement('div');
    svg.className = 'step-check-icon';
    svg.innerHTML = `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#10b981" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 16 4 11"/></svg>`;
    statusIcon.appendChild(svg);
  }
}

async function renderStepCards(steps) {
  if (!Array.isArray(steps)) return;
  for (const stepData of steps) {
    populateStepContent(stepData.step, stepData.result);
    await delay(280);
    revealStepCard(stepData.step);
    await delay(220);
  }
}

function populateStepContent(step, result) {
  if (!result) return;
  switch (step) {
    case 1: populateStep1(result); break;
    case 2: populateStep2(result); break;
    case 3: populateStep3(result); break;
    case 4: populateStep4(result); break;
    case 5: populateStep5(result); break;
    case 6: populateStep6(result); break;
  }
}

function populateStep1(intent) {
  setText('intent-topic',    intent.topic);
  setText('intent-platform', intent.platform);
  setText('intent-register', intent.emotionalRegister);
  const fmtEl = $('intent-format');
  if (fmtEl) { fmtEl.textContent = intent.format || '—'; fmtEl.className = 'intent-value intent-badge'; }
}

function populateStep2(fp) {
  setText('step2-patterns', fp.patternCount ?? '—');
  setText('step2-sources',  fp.fingerprintVersion ? `v${fp.fingerprintVersion}` : '—');
  if (fp.loadedAt) {
    const t = new Date(fp.loadedAt);
    setText('step2-loaded', `${t.getHours()}:${String(t.getMinutes()).padStart(2,'0')}`);
  }
}

function populateStep3(resonance) {
  const container = $('format-bars');
  if (!container) return;
  container.innerHTML = '';
  (resonance.rankedFormats || []).forEach((fmt, idx) => {
    const pct = Math.round(fmt.score * 100);
    const row = document.createElement('div');
    row.className = 'format-bar-row';
    row.innerHTML = `
      <div class="format-bar-label">${fmt.format}</div>
      <div class="format-bar-track">
        <div class="format-bar-fill${idx === 0 ? ' top' : ''}" data-pct="${pct}" style="width:0%"></div>
      </div>
      <div class="format-bar-score">${pct}%</div>`;
    container.appendChild(row);
  });
  requestAnimationFrame(() => {
    container.querySelectorAll('.format-bar-fill').forEach(f => { f.style.width = f.dataset.pct + '%'; });
  });
}

function populateStep4(risk) {
  const pct = risk.driftPercentage ?? 0;
  animateDriftGauge(pct);
  setText('drift-pct', `${pct}%`);
  const levelEl = $('risk-level');
  if (levelEl) { levelEl.textContent = risk.voiceDriftRisk || '—'; levelEl.className = 'badge ' + riskBadgeClass(risk.voiceDriftRisk); }
  setText('unique-angle', risk.uniqueAngle || '—');
}

function populateStep5(script) {
  const container = $('hooks-list');
  if (!container) return;
  container.innerHTML = '';
  const hooks   = script.hooks   || [];
  const topHook = script.topHook || {};
  hooks.forEach(hook => {
    const isTop    = hook.text === topHook.text;
    const matchPct = Math.round((hook.voiceMatchScore || 0) * 100);
    const card = document.createElement('div');
    card.className = 'hook-card' + (isTop ? ' top-hook' : '');
    card.innerHTML = `
      <div class="hook-card-header">
        <span class="hook-style">${hook.style || 'Hook'}</span>
        <span class="top-hook-label">Top Pick</span>
        <div class="hook-match-bar">
          <div class="hook-match-track">
            <div class="hook-match-fill" data-pct="${matchPct}" style="width:0%"></div>
          </div>
          <span class="hook-match-score">${matchPct}%</span>
        </div>
      </div>
      <div class="hook-text">${escapeHtml(hook.text)}</div>`;
    container.appendChild(card);
  });
  requestAnimationFrame(() => {
    container.querySelectorAll('.hook-match-fill').forEach(f => { f.style.width = f.dataset.pct + '%'; });
  });
}

function populateStep6(peak) {
  setText('peak-window-text', peak.nextPeakWindow || '—');
}

// ─── Final Output ─────────────────────────────────────────────────────────────

function renderFinalOutput(output) {
  show('output-section');
  $('output-section').scrollIntoView({ behavior: 'smooth', block: 'start' });

  const hookEl = $('output-hook-text');
  if (hookEl) hookEl.textContent = output.topHook || '—';

  const scorePct = Math.round((output.voiceMatchScore ?? 0) * 100);
  renderVoiceMatchRing(scorePct);
  setText('ring-score', scorePct + '%');

  const fmtEl = $('output-format');
  if (fmtEl) { fmtEl.textContent = output.recommendedFormat || '—'; fmtEl.className = 'badge badge-purple'; }

  const driftEl = $('output-drift');
  if (driftEl) { driftEl.textContent = output.driftRisk || '—'; driftEl.className = 'badge ' + riskBadgeClass(output.driftRisk); }

  setText('output-angle', output.uniqueAngle    || '—');
  setText('output-peak',  output.nextPeakWindow || '—');

  if (state.momentum) {
    show('momentum-section');
    show('peak-window-inline');
    setText('peak-window-inline-text', output.nextPeakWindow || '—');
  }
}

// ─── Velocity Chart ───────────────────────────────────────────────────────────

function renderVelocityChart(momentum) {
  show('momentum-section');
  const velocityHistory = momentum.velocityHistory || [];
  if (velocityHistory.length === 0) return;

  const chart  = $('velocity-chart');
  const labels = $('velocity-x-labels');
  if (!chart || !labels) return;

  chart.innerHTML  = '';
  labels.innerHTML = '';

  const maxCount = Math.max(...velocityHistory.map(w => w.count), 1);

  velocityHistory.forEach((week, idx) => {
    const heightPct = maxCount > 0 ? (week.count / maxCount) * 100 : 0;
    const isPeak    = week.count === maxCount && week.count > 0;

    const wrap = document.createElement('div');
    wrap.className = 'velocity-bar-wrap';
    wrap.title = `${week.week}: ${week.count} items`;

    const dot = document.createElement('div');
    dot.className = 'velocity-avg-dot';

    const bar = document.createElement('div');
    bar.className = 'velocity-bar' + (isPeak ? ' peak-week' : '');
    bar.style.height = '0%';

    wrap.appendChild(dot);
    wrap.appendChild(bar);
    chart.appendChild(wrap);

    const labelEl = document.createElement('div');
    labelEl.className = 'velocity-x-label';
    labelEl.textContent = (idx % 4 === 0) ? week.week.replace(/^\d{4}-/, 'W') : '';
    labels.appendChild(labelEl);

    requestAnimationFrame(() => {
      setTimeout(() => {
        bar.style.transition = `height 0.5s cubic-bezier(0.4,0,0.2,1) ${idx * 15}ms`;
        bar.style.height = heightPct + '%';
      }, 50);
    });
  });
}

// ─── SVG Gauges ───────────────────────────────────────────────────────────────

function renderVoiceMatchRing(scorePct) {
  const ring = $('voice-ring');
  if (!ring) return;
  const circumference = 351.9;
  ring.style.transition = 'stroke-dashoffset 1s cubic-bezier(0.4,0,0.2,1)';
  ring.style.strokeDashoffset = circumference - (scorePct / 100) * circumference;
  ring.style.stroke = scorePct >= 80 ? 'url(#ringGrad)' : scorePct >= 60 ? '#f59e0b' : '#ef4444';
}

function animateDriftGauge(pct) {
  const arc = $('drift-arc');
  if (!arc) return;
  const circumference = 301.6;
  arc.style.transition = 'stroke-dashoffset 0.8s cubic-bezier(0.4,0,0.2,1), stroke 0.3s ease';
  arc.style.strokeDashoffset = circumference - (pct / 100) * circumference;
  arc.style.stroke = pct <= 30 ? '#10b981' : pct <= 60 ? '#f59e0b' : '#ef4444';
}

// ─── Copy hook ────────────────────────────────────────────────────────────────

async function copyHook() {
  const hookEl  = $('output-hook-text');
  const copyBtn = $('copy-hook-btn');
  if (!hookEl || !copyBtn) return;

  try {
    await navigator.clipboard.writeText(hookEl.textContent);
    copyBtn.textContent = '✓ Copied!';
    toast('Hook copied to clipboard!', 'success', 2000);
    setTimeout(() => {
      copyBtn.innerHTML = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg> Copy`;
    }, 2000);
  } catch (_) {
    toast('Copy failed — select and copy manually.', 'error');
  }
}

// ─── Forge Another ────────────────────────────────────────────────────────────

function forgeAnother() {
  hide('output-section');
  hide('steps-section');
  hide('momentum-section');
  const ideaInput = $('idea-input');
  if (ideaInput) { ideaInput.value = ''; updateCharCount(); ideaInput.focus(); }
  $('forgeboard-section').scrollIntoView({ behavior: 'smooth', block: 'start' });
}

// ─── Char counter ─────────────────────────────────────────────────────────────

function updateCharCount() {
  const textarea = $('idea-input');
  const counter  = $('char-count');
  if (!textarea || !counter) return;
  const len = textarea.value.length;
  counter.textContent = `${len} / 500`;
  counter.style.color = len >= 500 ? '#ef4444' : len > 450 ? '#f59e0b' : '';
}

// ─── Automated Demo ───────────────────────────────────────────────────────────

state.demoRunning = false;
state.demoAborted = false;

async function highlightEl(el, durationMs = 2200) {
  if (!el || state.demoAborted) return;
  el.classList.add('demo-highlight');
  el.scrollIntoView({ behavior: 'smooth', block: 'center' });
  await delay(durationMs);
  el.classList.remove('demo-highlight');
  await delay(150);
}

async function typeText(inputEl, text, msPerChar = 45) {
  inputEl.value = '';
  updateCharCount();
  for (const char of text) {
    if (state.demoAborted) break;
    inputEl.value += char;
    updateCharCount();
    await delay(msPerChar + Math.random() * 18 - 9);
  }
}

async function waitForVisible(id, timeoutMs = 14000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const el = $(id);
    if (el && el.style.display !== 'none') return el;
    await delay(250);
  }
  return null;
}

function showDemoControl() {
  let ctrl = $('demo-control');
  if (!ctrl) {
    ctrl = document.createElement('div');
    ctrl.id = 'demo-control';
    ctrl.className = 'demo-control';
    ctrl.innerHTML = `
      <span class="demo-control-dot"></span>
      <span class="demo-control-label">Auto Demo</span>
      <button class="demo-stop-btn" onclick="stopDemo()">✕ Stop</button>`;
    document.body.appendChild(ctrl);
  }
  ctrl.style.display = 'flex';
}

function hideDemoControl() {
  const ctrl = $('demo-control');
  if (ctrl) ctrl.style.display = 'none';
}

function stopDemo() {
  state.demoAborted = true;
  state.demoRunning = false;
  hideDemoControl();
  // Remove any leftover highlights
  document.querySelectorAll('.demo-highlight').forEach(el => el.classList.remove('demo-highlight'));
  document.querySelectorAll('.demo-highlight-btn').forEach(el => el.classList.remove('demo-highlight-btn'));
}

async function runAutomatedDemo() {
  if (state.demoRunning) return;
  state.demoRunning = true;
  state.demoAborted = false;
  state.isDemo = true;
  showDemoControl();

  try {
    // ── Phase 1: Analyze section ─────────────────────────────────────────
    $('analyze-section').scrollIntoView({ behavior: 'smooth', block: 'start' });
    await delay(1800);
    if (state.demoAborted) return;

    // Pulse the "Run Demo Mode" button
    const demoBtn = $('demo-btn');
    if (demoBtn) {
      demoBtn.classList.add('demo-highlight-btn');
      await delay(2500);
      demoBtn.classList.remove('demo-highlight-btn');
      await delay(400);
    }
    if (state.demoAborted) return;

    // Trigger analysis
    await analyzeArchive(true);
    if (state.demoAborted) return;

    // Wait for fingerprint card to render
    const fpCard = await waitForVisible('fingerprint-card');
    if (!fpCard || state.demoAborted) return;
    await delay(1200);

    // ── Phase 2: Tour fingerprint fields ─────────────────────────────────
    // Writing Personality + Sentence Rhythm (fingerprint-block elements)
    for (const block of document.querySelectorAll('.fingerprint-block')) {
      if (state.demoAborted) return;
      await highlightEl(block, 2200);
    }

    // Topic Obsessions, Emotional Registers, Hook Structures (tag groups)
    for (const group of document.querySelectorAll('.fingerprint-tags-group')) {
      if (state.demoAborted) return;
      await highlightEl(group, 2200);
    }

    // Metrics row
    await highlightEl(document.querySelector('.fingerprint-metrics'), 1800);
    if (state.demoAborted) return;

    // ── Phase 3: ForgeBoard — scroll, type, forge ─────────────────────────
    $('forgeboard-section').scrollIntoView({ behavior: 'smooth', block: 'start' });
    await delay(1400);
    if (state.demoAborted) return;

    const textarea = $('idea-input');
    textarea.scrollIntoView({ behavior: 'smooth', block: 'center' });
    await delay(800);

    // Auto-type the idea
    const idea = 'Why AI coding tools are making developers forget how to think for themselves';
    await typeText(textarea, idea, 45);
    if (state.demoAborted) return;
    await delay(2000);

    // Pulse the Forge It button
    const forgeBtn = $('forge-btn');
    if (forgeBtn) {
      forgeBtn.classList.add('demo-highlight-btn');
      await delay(1500);
      forgeBtn.classList.remove('demo-highlight-btn');
      await delay(300);
    }
    if (state.demoAborted) return;

    // Run ForgeBoard — steps reveal naturally as API responds
    await runForgeBoard(idea);
    if (state.demoAborted) return;

    // ── Phase 4: Tour each step card ─────────────────────────────────────
    $('steps-section').scrollIntoView({ behavior: 'smooth', block: 'start' });
    await delay(1200);

    for (let i = 1; i <= 6; i++) {
      if (state.demoAborted) return;
      await highlightEl($(`step-${i}`), 2500);
    }

    // ── Phase 5: Final output tour ────────────────────────────────────────
    $('output-section').scrollIntoView({ behavior: 'smooth', block: 'start' });
    await delay(1000);
    if (state.demoAborted) return;

    await highlightEl(document.querySelector('.output-hook-card'), 3200);
    if (state.demoAborted) return;
    await highlightEl(document.querySelector('.output-ring-card'), 2200);
    if (state.demoAborted) return;
    await highlightEl(document.querySelector('.output-badges-card'), 2500);

    await delay(600);
    toast('Demo complete! Enter your own idea and forge it.', 'success', 4000);

  } finally {
    state.demoRunning = false;
    hideDemoControl();
  }
}

// ─── Boot ─────────────────────────────────────────────────────────────────────

document.addEventListener('DOMContentLoaded', () => {

  checkAuthStatus().then(() => {
    setTimeout(() => analyzeArchive(!state.isAuthenticated), 600);
  });
  updateForgeState();

  // Hero buttons
  $('hero-analyze-btn')?.addEventListener('click', () => {
    $('analyze-section').scrollIntoView({ behavior: 'smooth' });
    analyzeArchive(false);
  });
  $('hero-demo-btn')?.addEventListener('click', () => runAutomatedDemo());

  // Analyze section buttons
  $('analyze-btn')?.addEventListener('click', () => analyzeArchive(false));
  $('demo-btn')?.addEventListener('click', () => analyzeArchive(true));

  // Nav demo toggle
  $('demo-toggle-btn')?.addEventListener('click', () => {
    state.isDemo = !state.isDemo;
    const btn = $('demo-toggle-btn');
    btn.textContent = state.isDemo ? '✓ Demo' : 'Demo Mode';
    btn.style.color = state.isDemo ? 'var(--cyan-light)' : '';
  });

  // Auth buttons
  $('login-btn')?.addEventListener('click', () => { window.location = '/auth/login'; });
  $('logout-btn')?.addEventListener('click', () => { window.location = '/auth/logout'; });

  // Forge
  $('forge-btn')?.addEventListener('click', () => runForgeBoard($('idea-input')?.value));

  // Keyboard shortcut
  $('idea-input')?.addEventListener('keydown', e => {
    if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
      e.preventDefault();
      runForgeBoard($('idea-input').value);
    }
  });
  $('idea-input')?.addEventListener('input', updateCharCount);

  // Copy + Forge Another
  $('copy-hook-btn')?.addEventListener('click', copyHook);
  $('forge-another-btn')?.addEventListener('click', forgeAnother);



});
