# JobRadar

> **An Autonomous, Privacy-First Job Search Cockpit & AI Career Suite**  
> Continuous discovery, personalized preference scoring, grounded resume tailoring, and 1-click ATS application autofill — 100% self-hosted, private, and zero-cost.

---

```
                       ┌───────────────────────────────────────────────┐
                       │          DISCOVERY & INTELLIGENCE             │
                       │  98+ Sources · Direct ATS · HN · YC · Funding │
                       └───────────────────────┬───────────────────────┘
                                               │
                                               ▼
                       ┌───────────────────────────────────────────────┐
                       │          DYNAMIC EVALUATION ENGINE            │
                       │  Personal Tiers · Pay Floors · Remote Filters │
                       └───────────────────────┬───────────────────────┘
                                               │
                                               ▼
       ┌───────────────────────────────────────┴───────────────────────────────────────┐
       │                                                                               │
       ▼                                                                               ▼
┌───────────────────────────────┐                               ┌───────────────────────────────┐
│     GROUNDED RESUME SUITE     │                               │      APPLY KIT & EXTENSION    │
│  ATS Scorer · Visual Editor   │                               │  Auto-Draft Answers · Cover   │
│  Grounded AI Rewrite (No Hallucinations)                      │  1-Click ATS Autofill (Chrome)│
│  PDF & DOCX Generator         │                               │  Kanban Pipeline & Reminders  │
└───────────────────────────────┘                               └───────────────────────────────┘
                                               │
                                               ▼
                       ┌───────────────────────────────────────────────┐
                       │            ZERO-COST AI RUNTIME               │
                       │  Cerebras · Gemini · Groq · Local Ollama (Qwen)│
                       └───────────────────────────────────────────────┘
```

---

## 🌟 What is JobRadar?

Most job platforms treat candidates as eyeballs to sell ads to, drowning you in irrelevant sponsored listings. Crawlers and alert bots stop at sending raw links.

**JobRadar is an autonomous personal career operations system.** It runs locally or on your own server, constantly indexing job postings across hundreds of companies and boards. It filters and scores opportunities against **your strict career preferences**, crafts **fact-grounded tailored resumes**, prepares complete **application kits**, and **autofills employer application forms** via a browser extension.

Nothing is changed or submitted without your explicit review and consent.

---

## 🚀 Key Capabilities

### 1. 🔍 Autonomous Discovery & Polling Engine
* **Direct Company ATS Connectors:** Built-in adapters for Greenhouse, Lever, Ashby, Workable, SmartRecruiters, Recruitee, Teamtailor, Personio, BambooHR, Rippling, Workday, RSS feeds, and raw HTML boards.
* **Continuous Discovery:** Scours Hacker News (*Who is Hiring*), Y-Combinator company directories, GitHub repositories, and tech funding rounds to discover new company career boards before aggregators index them.
* **Respectful & Resilient:** Per-host rate limiting, exponential backoffs, circuit breakers, and payload hashing to detect real changes without overwhelming target servers.

### 2. 🎯 Dynamic Preference Engine (Your Personal Filter)
* **Tailored Career Rules:** Define custom evaluation rules with your pay floors, preferred locations (Global Remote, India Remote, Hybrid metros), tech stacks, and seniority levels.
* **Personalized Tiers:** Organizes postings into custom priority buckets (e.g. *Tier 1: Global Remote high-growth*, *Tier 2: Funded scaleups*, *Tier 3: Local anchors*).
* **Transparent Scoring:** Every job receives an explainable fit score showing exact matching criteria, missing requirements, and compensation analysis.

### 3. ✍️ Grounded Resume Tailoring & Visual Editor
* **Hallucination-Free Rewrites:** The tailoring engine validates every proposed bullet point against your verified master profile facts. It will **never invent companies, dates, metrics, or technologies** you didn't actually work with.
* **Real-Time ATS Scoring:** Analyzes job descriptions for required vs. preferred qualifications and scores your resume's keyword and semantic alignment in real-time.
* **Visual 3-Pane Editor:** Interactive editor combining structured form inputs, live layout rendering, and an ATS score rail.
* **Dual-Engine Export:** Generates pixel-perfect PDFs (via headless Chromium) and clean, editable `.docx` files formatted to pass applicant tracking systems.

### 4. 🧩 Browser Extension & 1-Click Application Kit
* **Chromium Manifest v3 Extension:** Securely pairs with your self-hosted JobRadar instance via an encrypted token.
* **Smart ATS Autofill:** Detects job application forms across major ATS platforms (Greenhouse, Lever, Ashby, Workable, etc.) and autofills personal details, tailored answers to custom employer questions, and attaches your tailored resume.
* **One-Click Tracking:** Submitting an application syncs immediately back to JobRadar, updating your pipeline status and scheduling follow-up reminders.

### 5. 📊 Application Pipeline & Lifecycle Kanban
* **Visual Kanban Board:** Track active applications across stages: *Applied → Interviewing → Offer → Rejected → Withdrawn*.
* **Automated Follow-ups:** Never let an application go cold with automated reminders and historical contact tracking.
* **Job Liveness Detection:** Detects when an employer takes down a posting or closes a role, marking jobs closed automatically.

### 6. 🔒 Zero-Cost, Privacy-First AI Runtime
* **Multi-Provider Fallback Chain:** Intelligently routes requests through hosted free tiers (`Cerebras → Gemini → Groq → Mistral → OpenRouter`) and falls back to **100% local Ollama** (`qwen2.5:3b-instruct` + `nomic-embed-text`) or deterministic rule engines.
* **Zero Paid Tokens Required:** Runs perpetually without paid API subscriptions.
* **Local Data & PII Redaction:** Strips sensitive contact details before passing job description analysis to cloud models, or runs completely offline on your own machine.

---

## 🏗️ Architecture

```
JobRadar (Monorepo via Turborepo & pnpm)
├── apps/
│   ├── web/            # Next.js 15 (App Router, Tailwind CSS, Server Actions & Route Handlers)
│   ├── worker/         # BullMQ background worker, supervisor, and scheduled dispatchers
│   └── extension/      # Manifest v3 Chrome/Chromium Browser Extension
├── packages/
│   ├── crawler/        # 98+ source adapters, direct ATS pollers, circuit breakers
│   ├── extractor/      # JD parsing, fact extraction, compensation normalizer
│   ├── watchlist/      # Company discovery, tiering, board health & sighting reconciliation
│   ├── ranking/        # Multi-attribute scoring and candidate-job matching algorithms
│   ├── resume/         # Resume parser, grounded rewrite engine, ATS scorer, PDF/DOCX renderers
│   ├── llm/            # Multi-provider fallback chain, PII redaction, token throttles
│   ├── prefs/          # Dynamic preference schema & evaluation engine
│   ├── notifications/  # Follow-up alerts, Telegram notifications, email digests
│   ├── storage/        # File storage & signed URL handlers for resumes and assets
│   ├── db/             # Prisma schema, PostgreSQL migrations, and database seeders
│   └── log/            # Structured logging and audit subsystem
└── tools/
    ├── launcher/       # Zero-dependency CLI launcher & supervisor (./jobradar)
    ├── sandbox-e2e/    # Offline integration and end-to-end test suites
    └── backup/         # Automated database and storage backup routines
```

---

## ⚡ Quick Start

### Prerequisites
* **Operating System:** Linux, macOS, or Windows (WSL2)
* **Node.js:** `≥ 22.0.0`
* **Package Manager:** `pnpm` (`corepack enable && corepack prepare pnpm@9.14.2 --activate`)
* **Databases:** PostgreSQL 16 & Redis 7 (either installed locally or managed via Docker)

### 1. Launch JobRadar

Run the unified launcher:

```bash
./jobradar up
```

**What `./jobradar up` does automatically:**
1. Validates your environment and verifies Node, pnpm, and database connectivity.
2. Creates `.env` with cryptographically secure generated secrets.
3. Automatically applies database migrations and seeds initial anchor companies, ATS sources, and crawler policies.
4. Starts the Next.js web application (`http://localhost:3000`) and the BullMQ background worker.
5. Prints your one-time administrator login credentials in the terminal.

---

## 🛠️ CLI Management Commands

JobRadar includes a dedicated CLI launcher (`./jobradar`):

| Command | Description |
|---|---|
| `./jobradar up` | Start all services (web app, worker, database checks, supervisor) |
| `./jobradar status` | Check process health, PID status, and port availability |
| `./jobradar doctor` | Diagnose environment, installed tools, and database reachability |
| `./jobradar logs` | Stream consolidated live logs (`./jobradar logs worker` for worker only) |
| `./jobradar down` | Cleanly stop all JobRadar services and child processes |
| `./jobradar ai setup` | Configure AI provider (Ollama local, Gemini, Groq, Cerebras, or hybrid) |
| `./jobradar up --mode docker` | Run entire stack inside Docker Compose |
| `./jobradar up --prod` | Build and run in production mode |

---

## 🔌 Browser Extension Setup

1. Open your Chromium-based browser (Chrome, Brave, Edge).
2. Navigate to `chrome://extensions/` and enable **Developer mode** (top-right toggle).
3. Click **Load unpacked** and select the [`apps/extension`](file:///home/ajay/Desktop/JobRadarFv10/files/app/JobRadar-main/apps/extension) directory.
4. In the JobRadar Web UI, navigate to **Account → Browser Extension**, copy your pairing key, and paste it into the extension popup.
5. When viewing any supported ATS job posting (Greenhouse, Lever, Ashby, etc.), the extension icon activates to autofill your information with a single click.

---

## 🧪 Verification & Testing

JobRadar includes a complete offline-first test suite covering migrations, unit tests, full E2E flows, and headless browser validation:

```bash
# Run full sandbox verification (220+ tests, E2E, UI smoke)
tools/sandbox-e2e/run-all.sh

# Run unit tests only
pnpm test

# Run full-stack live verification
./jobradar up && pnpm verify:local
```

---

## 📜 License

JobRadar is distributed under the MIT License. Designed and built for private, self-hosted career autonomy.
