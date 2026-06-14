# How EchoSpark Works — Real-Life Scenario

## The Problem It Solves

You're a YouTuber, blogger, or podcaster. You've been creating content for 2+ years. You have a style — people recognize your voice. But when you sit down to write a new script, you stare at a blank page.

EchoSpark reads your past content, extracts your writing DNA, then takes any raw idea and generates hooks that sound like *you* — not generic AI.

---

## What It Reads from OneDrive

The app connects to your Microsoft 365 account via the Microsoft Graph API and pulls:

| Source | What It Looks For |
|---|---|
| OneDrive files | `.docx`, `.txt`, `.md` files — blog drafts, scripts, notes |
| OneNote notebooks | Any notebooks in your M365 account |
| OneDrive root + subfolders | First 200 items, prioritised by most recent |

### Best content to have in OneDrive:
- Past video scripts (Word docs)
- Blog post drafts
- Newsletter drafts
- Podcast episode notes/outlines
- Threads/tweet drafts saved as text files
- Any writing where YOU chose the words

> The more authentic your writing in OneDrive, the more accurate your voice fingerprint.

---

## What It Extracts — Voice Fingerprint

Claude reads up to 15 of your documents and identifies:

| Pattern | Example |
|---|---|
| **Writing Personality** | "Pragmatic storyteller who leads with personal failure" |
| **Sentence Rhythm** | "Short punchy opener, long exploratory middle, one-line kicker" |
| **Topic Obsessions** | Themes you return to repeatedly (burnout, AI, creativity...) |
| **Emotional Registers** | Your tones — sarcastic, earnest, analytical, vulnerable |
| **Hook Structures** | How you typically open content |
| **Preferred Openings** | Literal phrases you start with ("I used to think...", "Here's the thing...") |

---

## Then ForgeBoard — The 6-Step Reasoning Chain

You type a raw idea: *"video about why most productivity advice is wrong"*

ForgeBoard runs 6 steps:

1. **Intent Parsing** — Extracts topic, format, platform, emotional register, urgency
2. **Voice Fingerprint** — Loads your extracted creative signature
3. **Format Resonance** — Scores video / article / thread / podcast against your proven strengths
4. **Creative Risk** — Checks how far this idea drifts from your established voice
5. **Script Generation** — Generates 3 hook variants in your exact voice
6. **Peak Window** — Recommends your next optimal creation window based on momentum patterns

### Output
- **Top Hook** — the best opening line for your content, unmistakably in your voice
- **Voice Match Score** — how closely the hook matches your fingerprint (0–100%)
- **Recommended Format** — video, article, thread, or podcast
- **Drift Risk** — low / medium / high — how far this idea pushes outside your comfort zone
- **Unique Angle** — a distinctive framing that makes this content memorable

---

## Demo Mode vs. Real Mode

| | Demo Mode | Real Mode |
|---|---|---|
| Fingerprint source | Mock creator "Maya" (wellness/productivity) | Your actual OneDrive/OneNote writing |
| Login required | No | Yes — Microsoft 365 login |
| OneDrive access | No | Yes — reads your files via Graph API |
| Hook quality | Generic demo persona | Calibrated to your exact voice |

---

## Prerequisites for Real Mode

1. **Microsoft 365 account** with content in OneDrive or OneNote
2. **Azure App Registration** (CLIENT_ID, TENANT_ID, CLIENT_SECRET in `.env`)
3. **At least 5–10 documents** of your authentic writing in OneDrive
4. **Login with M365** via the button in the app header

---

## The More You Write, The Better It Gets

EchoSpark improves with more source material. Ideal content archive:

- 10+ blog posts or video scripts
- Mix of formats (short and long)
- Spanning multiple topics (so it can identify your *recurring* obsessions)
- Written in your natural voice — not edited-for-SEO or ghostwritten

The fingerprint is regenerated each session, so as you add more content to OneDrive, the analysis automatically improves next time you log in.
