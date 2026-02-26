# Global Claude Instructions

## Language

Communication in {your language}. Code and commits in English.

## Memory System

> Full guide: `~/Projects/_guides/MEMORY_GUIDE.md`

### Session Start

1. Read `~/.claude-memory/goals.md` — priority filter
2. `memory_recall("user profile goals principles")` — context
3. `memory_recall("[SMP]")` — project & infrastructure map
4. Check `~/.claude-memory/raw/` — last 50 lines from yesterday
5. Health: raw log >2 days → warn. goals.md >30 days → remind. SMP >60 days → ask
6. If project has `CLAUDE.md` → read it

### Routing: what goes where

| Information | Where | How |
|-------------|-------|-----|
| Rule for ALL sessions | Global CLAUDE.md | Propose edit, wait for OK |
| Rule for ONE project | Project CLAUDE.md | Propose edit, wait for OK |
| Fact, decision, event | `memory_store` | Automatically |
| Project/infra card | `memory_store` (SMP) | Automatically |
| Task with deadline | `memory_store` (type=task) | Automatically |
| Insight, reflection | `memory_store` [REF] | Proposed by Claude or on request |
| Routine, small actions | Nothing | Raw log writes via hook |

### memory_store rules (brief)

- **100-400 chars**, max 500. One thought = one entry
- **First line** — the essence (summary truncates at ~200 chars)
- **project** — always specify
- **importance**: 10=goals/SMP, 9=architecture, 8=facts, 7=context, 5-6=minor
- **expiresIn**: never=rules/SMP, 90d=tasks, 30d=temporary
- **decision**: `Problem → Options → Choice → Why`
- **[REF]**: insight/reflection. type=context, importance=8, expiresIn=90d. Trigger: strategic discussion, reflection, shift in understanding
- **task**: What + deadline + project. One task = one entry

### SMP Entries

Cross-project dependency cards in MCP Memory with `[SMP]` prefix.
Main value: **what breaks when something changes**.

Format:
```
[SMP] {Name} — {status}
{url/server} | {path} → CLAUDE.md
dependencies: {project} → {project} (⚠️ what breaks)
TODO: {open strategic questions}
```

### During / End of Session

- Important decisions → `memory_store` immediately
- **After compact** → re-read project CLAUDE.md (risk of hallucinating files, architecture)
- End: check if anything important was missed, propose CLAUDE.md update

## Projects ~/Projects/

- `{project-1}` — description
- `{project-2}` — description

## Security

- **Before every commit** check `git diff --staged` for tokens, passwords, API keys
- **Never commit:** `.env`, files with real secrets, private keys
- Never hardcode secrets "temporarily" or "for simplicity"

## Code Principles

1. **Tests** — don't refactor without tests
2. **Boy Scout Rule** — leave code cleaner than you found it
3. **Rule of Three** — don't abstract prematurely. Duplication OK up to 2 times
4. **Spec from code, not from head** — read existing code before writing specs

## Commits

Always add Co-Authored-By:
```
Co-Authored-By: Claude {model} <noreply@anthropic.com>
```
