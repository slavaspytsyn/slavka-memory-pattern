# SMP — System Architecture

> Persistent two-layer memory with dependency awareness for AI agents.
> Version: 2.1

---

## The Problem

AI agents (Claude Code, Cursor, Copilot) have no memory between sessions and no understanding of project relationships. Every session starts from zero. The agent sees files but not dependencies — it changes an API endpoint without knowing that 3 other services depend on it.

Result: broken dependencies, lost decisions, repeated mistakes, massive token waste re-explaining context.

## The Solution

A two-layer pointer-based system where the AI agent:
1. **Remembers** facts, decisions, and lessons across sessions (MCP Memory)
2. **Sees dependencies** between projects (SMP Cards) and within a project (CLAUDE.md)
3. **Automatically** receives context at startup and logs actions during work

---

## Architecture

### Overview

```
┌─────────────────────────────────────────────────────────┐
│                    LEVEL 1: GLOBAL                       │
│                                                          │
│  ┌──────────────┐  ┌──────────────┐  ┌───────────────┐  │
│  │ Global       │  │ MCP Memory   │  │ goals.md      │  │
│  │ CLAUDE.md    │  │ (PostgreSQL) │  │               │  │
│  │              │  │              │  │ Priorities    │  │
│  │ Rules for    │  │ SMP cards    │  │ and focus     │  │
│  │ all sessions │  │ Facts        │  │ (month/year)  │  │
│  │ (constitution│  │ Decisions    │  │               │  │
│  │              │  │ Tasks        │  │               │  │
│  └──────────────┘  └──────────────┘  └───────────────┘  │
└─────────────────────────┬───────────────────────────────┘
                          │
          ┌───────────────┼───────────────┐
          ▼               ▼               ▼
┌─────────────────┐ ┌─────────────┐ ┌─────────────────┐
│   Project A     │ │  Project B  │ │   Project C     │
│                 │ │             │ │                 │
│ CLAUDE.md:      │ │ CLAUDE.md:  │ │ CLAUDE.md:      │
│ - Architecture  │ │ - ...       │ │ - ...           │
│ - Dependencies  │ │             │ │                 │
│ - Commands      │ │             │ │                 │
│ - Tech debt     │ │             │ │                 │
│ - Time bombs    │ │             │ │                 │
└─────────────────┘ └─────────────┘ └─────────────────┘

                    LEVEL 2: PER-PROJECT
```

### Pointer-Based Principle

The AI agent does NOT read all project code. Instead it reads **pointers** — compact files that describe what lives where and what depends on what.

```
Without pointers:                  With pointers:
┌──────────────────┐               ┌──────────────────┐
│ AI reads         │               │ AI reads         │
│ everything       │               │ CLAUDE.md (2KB)  │
│                  │               │                  │
│ src/ (500 files) │               │ Knows:           │
│ = 150K+ tokens   │               │ - where things   │
│ = no dependency  │               │   live           │
│   awareness      │               │ - what depends   │
│                  │               │   on what        │
│                  │               │ - what not to    │
│                  │               │   touch          │
│                  │               │ = 7K tokens      │
└──────────────────┘               └──────────────────┘
```

### Two Levels of Dependencies

**Level 1: Between Projects (SMP Cards)**

SMP cards are stored in MCP Memory with `[SMP]` prefix. Each card is a node in the dependency graph between projects.

```
[SMP] MyApp — production
myapp.com | server1
core: ~/Projects/MyApp → CLAUDE.md
bots: ~/Projects/MyApp-Bots → CLAUDE.md

dependencies:
  bots → GET /api/estimate (⚠️ changing format breaks bots)
  core + bots → server1 (shared PostgreSQL, Redis, Docker)
```

When the AI sees this card, it knows: changing the MyApp API will break the bots. It asks "update bots too?" instead of silently breaking them.

**Level 2: Within a Project (CLAUDE.md)**

Every project has a `CLAUDE.md` in its root with required sections:
- Description, status, file map
- Architecture and data flow
- External dependencies (table: Service | Purpose | Paid | What breaks)
- Time bombs (tokens with expiry dates, certificates)
- Tech debt and TODOs

---

## Components

### 1. MCP Memory Server

Persistent storage with hybrid search (Full-Text Search + Semantic/Vector).

**Server requirements:**

| Requirement | Description |
|-------------|------------|
| Protocol | MCP (Model Context Protocol) — HTTP transport |
| Database | PostgreSQL (or any DB with FTS + vector support) |
| Search | Hybrid: keyword (FTS) + semantic (embeddings) |
| Security | Must not be accessible from the internet (VPN or localhost) |

**Required MCP tools:**

| Tool | Purpose |
|------|---------|
| `memory_store` | Save a record (content, type, importance, project, expiresIn) |
| `memory_recall` | Search by query (hybrid/fts/vector), filters by project, type, importance |
| `memory_forget` | Delete a record by ID |
| `memory_status` | System stats (record count, DB status) |

You can use any MCP memory server that provides these tools. The SMP server is included in `core/server/` — see [Quick Start in README](README.md).

**Connecting to Claude Code:**
```bash
claude mcp add --transport http --scope user memory http://{YOUR_SERVER_URL}/mcp
```

**Record types:**
| Type | Purpose | Example |
|------|---------|---------|
| `context` | Facts, SMP cards | "API returns usernames in quotes, NOT with @" |
| `decision` | Decisions made | "Problem → Options → Choice → Why" |
| `task` | TODOs with deadlines | "TODO [~May]: rotate API keys" |
| `error` | Bugs and lessons | "db push on shared DB drops other tables" |
| `code` | Reusable patterns | Snippets, configurations |
| `context` [REF] | Reflections and insights | "[REF] Growth is slow because content is expert-only" |

### 2. Global CLAUDE.md (Constitution)

File `~/.claude/CLAUDE.md` — rules that apply to EVERY Claude Code session.

Contains:
- Communication and code language
- Session start/end procedures
- Memory routing (what goes where)
- Security rules
- Project and server list
- Links to guides

Size: ~130–200 lines. Rule: keep under 250 lines, move details to separate guides.

### 3. Project CLAUDE.md (Pointers)

File `CLAUDE.md` in the root of each project. Read when the AI starts working with a project.

Required sections:
1. Description (1-2 sentences)
2. Status
3. File map (tree with explanations)
4. Architecture / data flow
5. Commands (run, test, build, deploy)
6. Key decisions
7. Secrets (where they live, NOT values)
8. External dependencies (table)
9. Tech debt / TODOs
10. Time bombs

### 4. Automatic Hooks

Four hooks configured in `~/.claude/settings.json`:

**SessionStart → `pre-session.sh`**
When Claude Code launches, automatically:
- Detects project from working directory (CWD)
- Initializes MCP session
- Loads last session summary
- Loads project SMP card (if detected)
- Reads git status and recent commits
- Injects everything into conversation context

**PostToolUse → `log.sh`**
After each AI action, automatically:
- Logs Edit, Write, Bash, memory_store to a daily raw file
- Skips Read, Glob, Grep (noise)
- Format: `- HH:MM:SS [session_id] **Tool** | details`
- File: `~/.claude-memory/raw/YYYY-MM-DD.md`

**SessionEnd → `post-session.sh`**
When session ends, automatically:
- Checks if raw log is large enough (20+ lines)
- Builds auto-summary from recent actions
- Saves to MCP Memory
- Debounce: no more than once per 30 minutes

**PreToolUse → security hook**
Before Bash commands:
- Blocks commands with hardcoded secrets
- Allows legitimate gcloud secrets/iam commands

### 5. goals.md

File `~/.claude-memory/goals.md` — priority filter. Read at every startup.

Format:
```
## 2026 (year) — yearly goals
## March 2026 (month) — monthly focus
## Current focus — what's happening right now
```

### 6. Raw Logs

Automatic log of all AI actions. Lifecycle: 90 days, then auto-deleted.

Used for:
- Restoring context after restart
- Auto-summary in post-session hook
- Diagnostics (what did the AI do last session)

### 7. Session Anchors

During long sessions, the agent automatically writes key moments (config edits, git commits, important decisions) to `session.md`. This file survives context compression and can be re-read to restore working memory.

---

## Session Lifecycle

```
                    ┌──────────────────────┐
                    │    Claude Code        │
                    │    starts             │
                    └──────────┬───────────┘
                               │
                    ┌──────────▼───────────┐
                    │  SessionStart Hook    │
                    │  (pre-session.sh)     │
                    │                       │
                    │  1. Detect project    │
                    │  2. Init MCP session  │
                    │  3. Recall summary    │
                    │  4. Recall SMP card   │
                    │  5. Git context       │
                    │  6. Inject to chat    │
                    └──────────┬───────────┘
                               │
                    ┌──────────▼───────────┐
                    │  Claude Code reads    │
                    │                       │
                    │  1. goals.md          │
                    │  2. memory_recall()   │
                    │  3. Project CLAUDE.md │
                    │  4. Raw logs (tail)   │
                    └──────────┬───────────┘
                               │
                    ┌──────────▼───────────┐
                    │       WORK            │
                    │                       │
                    │  PostToolUse hook     │◄── raw log entry
                    │  (every action)       │    after each
                    │                       │    Edit/Write/Bash
                    │  memory_store()       │◄── decisions, facts
                    │  (as needed)          │    saved immediately
                    └──────────┬───────────┘
                               │
                    ┌──────────▼───────────┐
                    │  SessionEnd Hook      │
                    │  (post-session.sh)    │
                    │                       │
                    │  1. Read raw log      │
                    │  2. Build summary     │
                    │  3. Store to memory   │
                    └──────────┬───────────┘
                               │
                    ┌──────────▼───────────┐
                    │  Pattern Detection    │
                    │  (AI, not a hook)     │
                    │                       │
                    │  1. Extract changed   │
                    │     files from log    │
                    │  2. Cross-reference   │
                    │     with SMP +        │
                    │     CLAUDE.md         │
                    │  3. Propose updates   │
                    └──────────────────────┘
```

---

## Pattern Detection

Key question: **how does the system know what to capture?**

Hooks handle logistics (loading, logging, saving). But recognizing new dependencies and patterns is the AI agent's job, not the script's.

### The Problem

"Save important stuff" is too vague. The AI doesn't know what counts as important without clear criteria. After context compression, dependencies get lost.

### Solution: Triggers + End-of-Session Analysis

Two mechanisms work together:

**1. Real-Time Triggers (during work)**

Clear rules — "if X happens, then write Y":

| If... | Then record | Where | Type |
|-------|------------|-------|------|
| Decision made between 2+ options | Problem → Options → Choice → Why | MCP Memory | decision |
| New external service connected | Service + purpose + what breaks | Project CLAUDE.md (dependencies) | — |
| Cross-project link created | Project → Project (what depends) | MCP Memory (SMP) | context |
| Bug found and fixed | What broke + cause + fix | MCP Memory | error |
| Same error occurs repeatedly | Pattern + how to avoid | MCP Memory | error |
| API endpoint / DB schema changed | Check SMP: who consumes this? | Update SMP if needed | context |
| Cron / scheduled task added | What + when + expiry if any | CLAUDE.md (time bombs) | — |
| Architecture / stack changed | Update file map and architecture | Project CLAUDE.md | — |
| Strategic discussion / reflection | Insight + context + impact | MCP Memory [REF] | context |

The AI agent checks these triggers during work. Each trigger is concrete, not subjective.

**2. End-of-Session Analysis**

Before finishing, the AI agent runs analysis:

```
Step 1: Extract changed files from raw log (cheap, ~10 lines)
        grep "Edit\|Write" raw.log → list of paths

Step 2: Cross-reference with pointers (~1K tokens)
        For each file:
        → Mentioned in SMP cards? Is the card up to date?
        → Mentioned in project CLAUDE.md? Is the section current?
        → Is it an API / DB schema / config? Any consumers?

Step 3: Propose updates
        → "api/estimate.ts changed — SMP says 3 bots depend on it. Update SMP?"
        → "Added Redis — add to external dependencies section?"
        → "Decided to use esbuild — record as decision?"
```

**Cost:** ~1-4K tokens (file extraction is free, cross-reference = 1 memory_recall + reading CLAUDE.md).

### What This Does NOT Do

- Does not analyze code content (too expensive in tokens)
- Does not detect implicit dependencies (import chains, runtime calls)
- Does not replace humans — only **proposes**, the user decides

### Example

```
Session: developer asked to change /api/products response format

During work:
  AI sees trigger "API endpoint changed"
  → memory_recall("[SMP]") → finds: "bots → GET /api/products (⚠️ breaks bots)"
  → AI asks: "This endpoint is consumed by bots. Update them too?"

End of session:
  Raw log: Edit api/products.ts, Edit bots/price-bot.ts, Edit bots/alert-bot.ts
  Cross-reference: api/products.ts is in SMP → everything updated? Yes
  → Proposal: "SMP is up to date, no updates needed"
```

---

## Memory Routing

| Information | Where | Why |
|-------------|-------|-----|
| Rule for EVERY session | Global CLAUDE.md | Always read at startup |
| Rule for ONE project | Project CLAUDE.md | Read when working on that project |
| Fact / decision / event | MCP Memory | Searched on demand, doesn't load context |
| Cross-project link | MCP Memory (SMP) | Instant overview at startup |
| Task with deadline | MCP Memory (task) | Surfaces on recall, expires |
| Insight / reflection | MCP Memory ([REF]) | Strategic conclusions from discussions |
| Goals and focus | goals.md | Priority filter |
| Action log | Raw logs | Written by hooks automatically |

**Routing principle: "Who will read this, and when?"**

---

## Memory Hygiene

The memory system degrades without maintenance: records become outdated, duplicate files, lose relevance. Hygiene is a required part of the lifecycle.

### When to Clean

- At the end of long sessions (20+ actions)
- During memory audits (on user request)
- When working on a project — if stale data is noticed

### What to Look For

| Problem | How to find | What to do |
|---------|------------|------------|
| **Duplicate with file** | Decision/fact already in CLAUDE.md or spec → why is it in memory? | `memory_forget`. Keep only a reference if needed |
| **Outdated** | Fact has changed since recording | `memory_forget` + `memory_store` new one, or just delete |
| **Inflated importance** | Minor item with importance=9 (9-10 only for architecture/SMP/goals) | Recreate with correct importance |
| **Session noise** | Operational details ("replied X, discussed Y") | `memory_forget`. Valuable decision → separate record |
| **Duplicate records** | Two memories about the same thing | Keep the more complete one, delete the other |

### Principle

**Files = source of truth. Memory = index + facts without a permanent file.**

If information exists in a project file (CLAUDE.md, specs, logs) — store only a reference in memory, don't duplicate the content.

### Procedure

1. `memory_recall` by project (limit=20)
2. For each record: "Is this still current? Does it duplicate a file?"
3. Propose deletion list to user (table: ID, content, reason)
4. Delete after confirmation

---

## Deployment Options

**Option 1: Remote Server (recommended for multiple devices)**
```
Device 1 (Claude Code) ──┐
Device 2 (Gemini CLI)  ──┼── VPN ──→ Server (MCP Server + PostgreSQL)
Device 3 (Cursor)      ──┘
```
- One database accessible from all devices
- VPN (Tailscale/WireGuard) for security — port NOT open to the internet
- Minimum requirements: 1 vCPU, 1GB RAM ($5-7/month)

**Option 2: Localhost (single device)**
```
Your machine ──→ localhost:3100 (MCP Server + PostgreSQL)
```
- Simplest setup — everything on one machine
- Downside: memory not accessible from other devices

**Option 3: Docker (recommended for quick start)**
```bash
cd core/server && docker compose up -d
```
- PostgreSQL + MCP Server in containers
- Works out of the box with FTS-only mode
- Add `OPENAI_API_KEY` or Vertex AI credentials for semantic search

### Recommendations

- **Backups** — daily pg_dump, store in at least 2 locations
- **Health check** — cron every 5 min, alert on failure
- **Auto-restart** — systemd (Linux) or launchd (macOS)

### Dependencies

- **MCP Server** — any server supporting memory_store/recall/forget/status
- **PostgreSQL** — record storage (or any DB with FTS + vector)
- **Embeddings API** — for semantic search (Vertex AI, OpenAI, or local model). Optional — FTS-only mode works without it
- **Agent hooks** — SessionStart, SessionEnd, PostToolUse, PreToolUse

---

## Key Concepts

### SMP (Structured Memory Pattern)
Dependency cards between projects in MCP Memory. Prefix `[SMP]`. ~300-400 characters. Core value — **what breaks** when things change. Few cards (5-10), but high impact.

### Pointer-Based Approach
The AI reads compact pointers (CLAUDE.md, SMP cards) instead of scanning all code. A 2KB file describes a 500-file project. The agent knows where to look instead of trying to understand everything.

### Dependency Graph
Two-level dependency graph:
- **Global** (SMP): project → project, project → service
- **Local** (CLAUDE.md): module → module, API → consumers

The AI sees connections BEFORE it starts changing code.

---

## Evolution

### v0: No Memory
Every Claude Code session starts from scratch. Re-explaining context every time. ~150K tokens per session.

### v1: Token Optimization
Added CLAUDE.md to projects as pointer files. AI reads pointers instead of all code. Usage: 150K → ~7K tokens.

### v1.5: Persistent Memory
Added MCP Memory Server. AI remembers facts, decisions, and errors across sessions. SSH/stdio transport (up to 2 concurrent sessions).

### v1.6: HTTP Transport
Migrated from SSH/stdio to HTTP over VPN. Solved deadlock issues with 3+ concurrent sessions. Single Node.js process serves all sessions.

### v2.0: Dependency Awareness
Introduced SMP cards — a dependency graph between projects. Two-layer architecture: global dependencies (SMP) + local (CLAUDE.md). Automatic hooks: pre-session, post-session, raw-log, security.

### v2.1: Reflection Capture
Added [REF] format — capturing insights from strategic discussions. System expanded beyond code: captures not just decisions (what was chosen), but the understanding that led to them (why something isn't working, what pattern keeps repeating).

---

## Tech Stack

| Component | Technology | Link |
|-----------|-----------|------|
| MCP Protocol | Model Context Protocol (Anthropic) | https://modelcontextprotocol.io |
| MCP SDK | @modelcontextprotocol/sdk | https://github.com/modelcontextprotocol/typescript-sdk |
| Claude Code | CLI for Claude (Anthropic) | https://docs.anthropic.com/en/docs/claude-code |
| Claude Code Hooks | Event-driven hooks system | https://docs.anthropic.com/en/docs/claude-code/hooks |
| Embeddings | OpenAI / Vertex AI / FTS-only | Configurable via EMBEDDING_PROVIDER |
| VPN | Tailscale / WireGuard | https://tailscale.com |
| PostgreSQL | Database + pgvector | https://www.postgresql.org |

---

## Metrics

| Metric | Before SMP | After SMP |
|--------|-----------|-----------|
| Tokens per session for context | ~150K | ~7K |
| Cross-session memory | None | Full |
| Broken dependencies | Regular | Rare (agent asks first) |
| Session startup time | 5-10 min explaining | Automatic |
