# ⚡ EchoSpark

**AI Creative Momentum Engine for Content Creators**

> *Your voice. Your ideas. Forged by AI.*

EchoSpark reads your past writing from Microsoft OneDrive and OneNote, extracts your **Voice Fingerprint** using Claude AI, then runs a **6-step reasoning chain** (ForgeBoard) to generate new hooks that sound exactly like you — not generic AI output.

Built on **Azure AI Foundry**, **Microsoft Graph API**, **Microsoft 365 Copilot (Work IQ)**, and **Claude AI**.

---

## What It Does

| Step | What Happens |
|------|-------------|
| **1. Read** | Microsoft Graph API pulls your OneDrive `.docx`/`.txt`/`.md` files and OneNote notebooks |
| **2. Extract** | Claude AI builds your Voice Fingerprint: sentence rhythm, topic obsessions, hook structures, emotional registers |
| **3. Enrich** | Work IQ (M365 Copilot) adds real engagement patterns from your Microsoft 365 activity |
| **4. Forge** | You type a raw idea → ForgeBoard runs 6-step AI reasoning → outputs hooks in your exact voice |

**Output:** Top hook, voice match score (0–100%), recommended format, drift risk, unique angle, peak creation window.

---

## ForgeBoard — 6-Step Reasoning Chain

| Step | Name | Engine | Output |
|------|------|--------|--------|
| 1 | Intent Parsing | Claude | topic, format, platform, register |
| 2 | Voice Fingerprint | In-memory | 6 patterns loaded |
| 3 | Format Resonance | Deterministic | video/article/thread/podcast scored |
| 4 | Creative Risk | Claude | drift %, unique angle |
| 5 | Hook Generation | Claude | 3 variants + voice match scores |
| 6 | Peak Window | Deterministic | next optimal creation window |

Steps 1, 4, 5 → Claude AI (creative reasoning)
Steps 2, 3, 6 → deterministic (fast, no API cost)
Total: ~6–12 seconds end-to-end.

---

## Quick Start

### No account needed

```bash
git clone https://github.com/venkkateshg/echospark.git
cd echospark
npm install
cp .env.example .env
# Add ANTHROPIC_API_KEY or AZURE_INFERENCE_ENDPOINT + AZURE_INFERENCE_KEY to .env
npm start
# Open http://localhost:3000 → click "Run Demo Mode"
```

### With Microsoft 365 (full mode)

1. [Create an Azure App Registration](https://portal.azure.com) with these delegated permissions:
   - `User.Read`
   - `Files.Read`
   - `Notes.Read`
   - `offline_access`
2. Add a redirect URI: `http://localhost:3000/auth/callback`
3. Fill in `.env` with all values from `.env.example`
4. `npm start` → click **Sign in with Microsoft**

---

## Environment Variables

```bash
# .env — copy from .env.example

# Microsoft Azure App Registration (for M365 real mode)
CLIENT_ID=
TENANT_ID=
CLIENT_SECRET=
CLIENT_SECRET_ID=
REDIRECT_URI=http://localhost:3000/auth/callback

# Session
SESSION_SECRET=change_this_to_a_random_secret

# Claude API — choose ONE:

# Option A: Azure AI Foundry (recommended)
# Deploy Claude from ai.azure.com → Model catalog → Claude → Serverless API
# Remove trailing /v1/messages from the Target URI
AZURE_INFERENCE_ENDPOINT=https://your-resource.services.ai.azure.com/anthropic
AZURE_INFERENCE_KEY=your_key

# Option B: Direct Anthropic API
ANTHROPIC_API_KEY=your_key

# Server
PORT=3000
```

---

## API Reference

### `POST /api/analyze`

Builds the Voice Fingerprint. Reads OneDrive + OneNote via Microsoft Graph, optionally queries Work IQ.

**Body:**
```json
{ "useDemo": false }
```

**Response:**
```json
{
  "fingerprint": { "patterns": {}, "sources": [], ... },
  "momentum": { "velocityHistory": [], ... },
  "contentCount": 12,
  "isMock": false,
  "workIQStatus": "active | timeout | error | no_content | inactive",
  "workIQInsight": "string or null"
}
```

### `POST /api/forgeboard`

Runs the 6-step ForgeBoard chain on a raw idea.

**Body:**
```json
{ "rawIdea": "Why AI tools are making us forget how to think", "useDemo": false }
```

**Response:**
```json
{
  "steps": [
    { "step": 1, "name": "Intent Parsing", "status": "complete", "result": {} },
    ...
  ],
  "finalOutput": {
    "topHook": "string",
    "voiceMatchScore": 0.87,
    "recommendedFormat": "video",
    "driftRisk": "low",
    "uniqueAngle": "string",
    "nextPeakWindow": "string"
  }
}
```

### `GET /api/status`

```json
{
  "authenticated": true,
  "hasFingerprintInSession": true,
  "workIQActive": true,
  "username": "Maya Chen"
}
```

---

## Architecture

```
Browser (Vanilla JS SPA)
    │
    ├── POST /api/analyze
    │       ├── Microsoft Graph API → OneDrive (.docx, .txt, .md)
    │       ├── Microsoft Graph API → OneNote notebooks
    │       ├── Work IQ (/beta/copilot/conversations) [non-blocking]
    │       └── Claude AI (Azure Foundry) → buildVoiceFingerprint()
    │
    └── POST /api/forgeboard
            └── Claude AI (Azure Foundry) → ForgeBoard chain
                    Step 1  parseIntent()           [Claude]
                    Step 2  loadFingerprint()        [in-memory]
                    Step 3  scoreFormatResonance()   [deterministic]
                    Step 4  assessCreativeRisk()     [Claude]
                    Step 5  generateScriptHooks()    [Claude]
                    Step 6  schedulePeakWindow()     [deterministic]

Auth: MSAL (msal-node) → Microsoft Entra ID → Bearer Token → Graph Client
```

---

## Reliability Design

| Failure Mode | Response |
|-------------|----------|
| Work IQ timeout | `Promise.allSettled` → non-fatal · "Timed out" badge shown · fingerprint still built |
| Claude returns bad JSON | `safeJsonParse()` extracts embedded JSON or falls back to safe defaults |
| OneDrive returns 0 files | `getMockFingerprint()` substituted · Demo badge shown |
| M365 login unavailable | Full pipeline runs without auth · no external dependencies |
| Privacy | Access tokens in session only · no database writes · no PII stored |

---

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Reasoning Engine | Claude AI (`claude-haiku-4-5`) on Azure AI Foundry |
| Content Access | Microsoft Graph API (OneDrive + OneNote) |
| Engagement Intel | Microsoft 365 Copilot Work IQ |
| Authentication | MSAL (`msal-node`) · Microsoft Entra ID · OAuth 2.0 |
| Backend | Node.js 18+ · Express v5 · express-session |
| Frontend | Vanilla JS SPA (no framework) |
| Built With | GitHub Copilot |

---

## Project Structure

```
echospark/
├── index.js              # Express server entry
├── forgeboard.js         # 6-step ForgeBoard reasoning engine
├── voiceFingerprint.js   # Claude-powered voice extraction
├── contentArchive.js     # OneDrive + OneNote content reader
├── creativeMomentum.js   # Momentum + velocity tracking
├── graphClient.js        # Microsoft Graph client factory
├── workiqClient.js       # Work IQ (M365 Copilot) integration
├── routes/
│   ├── api.js            # /api/analyze, /api/forgeboard, /api/status
│   └── auth.js           # /auth/login, /auth/callback, /auth/logout
├── public/
│   ├── index.html        # SPA shell
│   ├── app.js            # All frontend logic
│   └── style.css         # Styles + animations
├── .env.example          # Environment variable template
└── HOW_IT_WORKS.md       # Detailed usage guide
```

---

## Demo vs Real Mode

| | No Account | With Microsoft 365 |
|--|-----------|-------------------|
| Fingerprint source | Built-in creator persona | Your actual OneDrive/OneNote writing |
| Login required | No | Yes — Microsoft 365 |
| OneDrive access | No | Yes — reads your files |
| Work IQ | No | Yes — M365 Copilot |
| Hook quality | Demo persona voice | Calibrated to your exact voice |

---

## License

ISC
