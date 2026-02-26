# {Project Name} — Project Memory

> Updated: YYYY-MM-DD

## What is this

{1-2 sentences: what the project does, who it's for}

## Status: {Active / Development / Paused}

{Current state — what works, what doesn't}

## File Map

```
project-root/
├── CLAUDE.md              ← YOU ARE HERE
├── src/
│   ├── {module-1}/        ← {what it does}
│   ├── {module-2}/        ← {what it does}
│   └── index.ts           ← {entry point}
├── {config files}
└── README.md
```

## Architecture / Data Flow

```
{ASCII diagram of how data flows through the system}

Example:
User → Frontend → API → Database
                    ↓
              External Service
```

## Key Commands

```bash
# Run
{command to start the project}

# Test
{command to run tests}

# Build
{command to build}

# Deploy
{command to deploy}
```

## Decisions

| Decision | Why | Date |
|----------|-----|------|
| {e.g., Chose PostgreSQL over MongoDB} | {reasoning} | {when} |

## Secrets

| Secret | Where | What for |
|--------|-------|----------|
| {name} | {GCP SM / env var / config} | {purpose} |

**Never store secret values in this file.**

## External Dependencies

| Service | Why | Paid | ⚠️ If it goes down |
|---------|-----|------|-------------------|
| {e.g., Stripe API} | {payments} | {yes/no} | {what breaks} |

## Tech Debt / TODO

- [ ] {thing that needs fixing}
- [ ] {thing that needs improvement}

## Ticking Bombs

| What | Deadline | Impact |
|------|----------|--------|
| {e.g., API token expires} | {date} | {what breaks} |
