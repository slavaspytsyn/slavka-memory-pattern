# Slavka Memory Pattern (SMP)

> Give your AI coding agent unlimited memory with a fixed context window.

Claude Code, Cursor, Copilot — they all forget everything between sessions. Your agent doesn't know what it did yesterday, doesn't see dependencies between projects, and wastes tokens re-learning your codebase every time.

**SMP fixes this.** A pointer-based memory system that gives AI agents persistent memory, cross-project dependency awareness, and automatic context loading — without expanding the context window.

## The Problem

```
Session 1: "Don't use .env files, use GCP Secret Manager"
Session 2: *creates .env file*

Session 1: "The /api/estimate endpoint is used by 3 bots"
Session 2: *changes the endpoint format, breaks all bots*
```

AI agents have no memory. Every session starts from zero. They see files but not dependencies — they'll change an API endpoint without knowing 3 bots depend on it.

## The Solution

Instead of stuffing everything into the context window, use **short pointers** that reference detailed knowledge on disk and in external memory. The agent reads details only when relevant.

```
Traditional:    Memory = Context window (fixed, ~200K tokens)
SMP:            Memory = Unlimited files + external DB, Context = pointers only (~7K tokens)
```

Think of it like human memory: you don't memorize every book, but you remember where to find information. A library, not a backpack.

## Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                    LEVEL 1: GLOBAL                          │
│                                                             │
│  Global CLAUDE.md    MCP Memory Server      goals.md        │
│  (rules, pointers)   (facts, decisions,     (priorities)    │
│  ~130 lines           SMP cards, tasks)                     │
│  Always in context    Searched on demand     Read at start   │
└─────────────────────────────┬───────────────────────────────┘
                              │
              ┌───────────────┼───────────────┐
              ▼               ▼               ▼
     ┌──────────────┐ ┌──────────────┐ ┌──────────────┐
     │  Project A   │ │  Project B   │ │  Project C   │
     │  CLAUDE.md   │ │  CLAUDE.md   │ │  CLAUDE.md   │
     │              │ │              │ │              │
     │  Structure   │ │  Structure   │ │  Structure   │
     │  Commands    │ │  Commands    │ │  Commands    │
     │  Dependencies│ │  Dependencies│ │  Dependencies│
     │  Tech debt   │ │  Tech debt   │ │  Tech debt   │
     └──────────────┘ └──────────────┘ └──────────────┘

                    LEVEL 2: PER-PROJECT
```

## Key Concepts

### 1. Pointer-Based Architecture

Your `~/.claude/CLAUDE.md` is always loaded (~3K tokens). It contains **rules + pointers**, not detailed knowledge:

```markdown
## Guides (read on demand)
- **Git, branches, deploy** → ~/guides/IT_WORKFLOW.md
- **Docker** → ~/guides/DOCKER_GUIDE.md
- **Database** → ~/guides/DATABASE_GUIDE.md

Read only when the conversation touches these topics.
```

Each pointer costs ~10 tokens. The full guide is 200+ lines but costs **0 tokens until needed**.

### 2. SMP Cards (Cross-Project Dependencies)

SMP cards live in MCP Memory with `[SMP]` prefix. They map what depends on what — and what breaks if you change something:

```
[SMP] Fragstat — production
fragstat.org | server1
core: ~/Projects/Fragstat → CLAUDE.md
bots: ~/Projects/Bots → CLAUDE.md

dependencies:
  bots → GET /api/estimate (⚠️ changing format breaks all bots)
  core + bots → shared PostgreSQL, Redis, Docker
```

When the AI sees this card, it knows: changing the Fragstat API will break the bots. It asks "update bots too?" instead of silently breaking them.

### 3. Project CLAUDE.md

Every project has a `CLAUDE.md` in its root — a 2KB file that replaces expensive codebase exploration:

```markdown
# My Project
## Status: Production
## File map
src/
├── api/routes.ts     ← REST endpoints
├── db/schema.ts      ← Prisma schema
└── services/
    ├── auth.ts       ← JWT + refresh tokens
    └── payments.ts   ← Stripe integration

## External dependencies
| Service | Purpose | Paid | If it goes down |
|---------|---------|------|-----------------|
| Stripe  | Payments | 2.9% | No new payments |
| Sentry  | Errors   | Free | No error alerts |

## Ticking bombs
- Stripe API key expires ~March 2026
- SSL cert auto-renews but check if DNS changes
```

### 4. Automatic Hooks

Four hooks automate the memory lifecycle:

| Hook | Script | What it does |
|------|--------|-------------|
| **SessionStart** | `pre-session.sh` | Loads last session summary, project SMP card, git status |
| **PostToolUse** | `log.sh` | Logs every Edit/Write/Bash to daily raw file |
| **SessionEnd** | `post-session.sh` | Auto-summarizes session if 20+ actions |
| **PreToolUse** | `security.sh` | Blocks hardcoded secrets in commands |

### 5. Session Anchors

During long sessions, the agent automatically writes key moments (config edits, git commits, important decisions) to `session.md`. This file survives context compression and can be re-read to restore working memory.

### 6. MCP Memory Server

External persistent storage with hybrid search (full-text + semantic/vector). Stores facts, decisions, errors, tasks, and SMP cards.

Any MCP-compatible memory server works. Requirements:
- `memory_store` — save a record
- `memory_recall` — search with filters
- `memory_forget` — delete a record
- `memory_status` — system health

## Results

| Metric | Before | After |
|--------|--------|-------|
| Tokens per session for "memory" | ~150K | ~7K |
| Cross-session context | None | Full |
| Broken dependencies | Regular | Rare (agent asks first) |
| Session startup time | 5-10 min explaining | Automatic |

## Quick Start

### Step 1: Set up Global CLAUDE.md

Copy `templates/global-claude-md.md` to `~/.claude/CLAUDE.md` and customize.

### Step 2: Add Project CLAUDE.md

Copy `templates/project-claude-md.md` to your project root and fill in the sections.

### Step 3: Install Hooks

Copy hook scripts from `templates/hooks/` to `~/.claude-memory/` and configure in `~/.claude/settings.json` (see `templates/settings-example.json`).

### Step 4: (Optional) Set up MCP Memory Server

For cross-session memory, set up any MCP memory server:
```bash
claude mcp add --transport http --scope user memory http://YOUR_SERVER/mcp
```

### Step 5: (Optional) Create goals.md

Copy `templates/goals.md` to `~/.claude-memory/goals.md` and set your priorities.

## Templates

| File | Description |
|------|------------|
| `templates/global-claude-md.md` | Global CLAUDE.md template |
| `templates/project-claude-md.md` | Per-project CLAUDE.md template |
| `templates/goals.md` | Goals/priorities template |
| `templates/smp-format.md` | SMP card format with examples |
| `templates/settings-example.json` | Claude Code settings with hooks |
| `templates/hooks/pre-session.sh` | Auto-load context at session start |
| `templates/hooks/post-session.sh` | Auto-save summary at session end |
| `templates/hooks/log.sh` | Raw action logging |
| `templates/hooks/security.sh` | Block hardcoded secrets |

## Deep Dive

See [SYSTEM.md](SYSTEM.md) for the full methodology: architecture diagrams, pattern detection, memory hygiene, evolution history, and infrastructure recommendations.

## Background

This system was born from a practical need: managing 10+ projects with Claude Code, each with its own dependencies, secrets, and deployment pipelines. After breaking production twice because the AI forgot cross-project dependencies, I built SMP.

It evolved from a simple pointer file (v1, February 2026) into a full memory framework with MCP server, automatic hooks, session anchors, and dependency graph (v2.1).

Originally described in [Claude Code Issue #24718](https://github.com/anthropics/claude-code/issues/24718).

## Acknowledgments

This system was inspired by ideas and discussions from:
- RAG and retrieval-augmented patterns from the AI engineering community
- [ukr-coder](https://github.com/ukr-coder) — Claude Code workflow ideas
- Claude Code community discussions and [Issue #24718](https://github.com/anthropics/claude-code/issues/24718)

## License

MIT
