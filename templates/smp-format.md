# SMP (Slavka Memory Pattern) — Card Format

## What is SMP

Cross-project dependency cards stored in MCP Memory. Each card is a node in a dependency graph between your projects and infrastructure.

The main value is answering: **"If I change X, what breaks?"**

## Format

```
[SMP] {Name} — {status: production/development/paused/active}
{url/server} | {local path} → CLAUDE.md

dependencies:
  {project/service} → {project/service} (⚠️ what breaks if changed)
  {project/service} → {project/service} (⚠️ what breaks)

TODO: {open strategic questions}
```

## Parameters

| Parameter | Value |
|-----------|-------|
| type | `context` |
| importance | 9-10 |
| expiresIn | `never` |
| project | project name |
| length | ~300-400 characters |

## Examples

### Web App + API Bots
```
[SMP] MyApp — production
myapp.com | server1
core: ~/Projects/MyApp → CLAUDE.md
bots: ~/Projects/MyApp-Bots → CLAUDE.md

dependencies:
  bots → GET /api/data (⚠️ changing response format breaks all bots)
  core + bots → server1 (shared DB, Redis, Docker)
  secrets: GCP SM myapp-*

TODO: add rate limiting, monitoring
```

### Infrastructure Service
```
[SMP] Memory System — active
GCP VM | http://{tailscale-ip}:3100/mcp
docs: ~/Projects/_Servers/MEMORY_SYSTEM.md

dependencies:
  all sessions → Tailscale → :3100 (⚠️ Tailscale down = no memory)
  Vertex AI → embeddings (⚠️ GCP billing)
```

### Standalone Project
```
[SMP] SideProject — development
~/Projects/SideProject (no CLAUDE.md yet)
dependencies: none (standalone)
```

## Lifecycle

| Action | When |
|--------|------|
| Create | First session with new project/infrastructure |
| Update | Architecture, stack, status, or dependencies changed. Method: `memory_forget(old_id)` + `memory_store(new)` |
| Health check | If older than 60 days → ask "is this still relevant?" |
| Delete | Only with user confirmation |

## How Many Cards

Typically 5-15 cards total. Not every project needs one — only those with **cross-project dependencies**. A standalone project with no external connections doesn't need an SMP card.

## Key Principle

SMP cards track **connections between things**, not the things themselves. Project details live in the project's CLAUDE.md. SMP answers: "what depends on what, and what breaks."
