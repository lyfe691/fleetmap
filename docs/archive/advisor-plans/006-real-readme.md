# Plan 006: Replace the boilerplate README with a real project README

> **Executor instructions**: Follow step by step. This plan writes docs only —
> the "verification" is accuracy against the repo, so check each claim against
> the named source file. Update the 006 row in `plans/README.md` when done.
>
> **Drift check (run first)**: `git diff --stat 7d9801a..HEAD -- README.md CLAUDE.md package.json .env.example docker-compose.yml`
> If `CLAUDE.md`/`package.json` changed, prefer their current content as the
> source of truth over the excerpts here.

## Status

- **Priority**: P3
- **Effort**: S
- **Risk**: LOW
- **Depends on**: none
- **Category**: docs
- **Planned at**: commit `7d9801a`, 2026-06-17

## Why this matters

`README.md` is still the default Next.js + shadcn template ("This is a Next.js
template with shadcn/ui"). It says nothing about fleetmap. The real brief lives in
`CLAUDE.md` and `docs/specs/live-tracking-spec.md`, so anyone landing on the repo
(GitHub, a new contributor) gets a misleading first impression and no setup path.
A short, accurate README that points at the deeper docs is standard hygiene and
costs little. Keep it concise — it summarizes and links, it does not duplicate
the full spec.

## Current state

- `README.md` (entire file) is template boilerplate — replace it wholesale.
- Authoritative sources to summarize **from** (do not invent; copy facts from
  these):
  - `CLAUDE.md` — product one-liner, Stack, Architecture, Setup, Commands, Env,
    Milestones. This is the primary source.
  - `package.json` `scripts` — the real command names (`dev`, `fake-gps`,
    `provision-dashboard`, `provision-dispatcher`, `seed-stops`, `typecheck`,
    `lint`, `build`).
  - `.env.example` — the env var names (do NOT copy any values; names only).
  - `docker-compose.yml` — the OSRM container (mention `docker compose up -d osrm`).
  - `docs/specs/live-tracking-spec.md` — link as the full design doc.

Verify the command list against `package.json` at write time — the milestone
state is "through M8" per `CLAUDE.md`.

## Commands you will need

| Purpose | Command | Expected |
|---|---|---|
| Read sources | open `CLAUDE.md`, `package.json`, `.env.example` | facts to summarize |
| Markdown sanity | `pnpm lint` (if it covers md) or visual check | no broken structure |

(There is no docs linter configured; correctness is by inspection.)

## Scope

**In scope**: `README.md` only (full replacement).
**Out of scope**: `CLAUDE.md`, the spec docs, and any code. Do not move content
out of `CLAUDE.md` — the README *summarizes and links*, it does not replace it.
Never paste secret values from `.env` (names only).

## Git workflow

- Branch: `advisor/006-real-readme`.
- One commit: `docs: replace template README with a real project README`.
- End the commit body with:
  `Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>`

## Steps

### Step 1: Write the new README

Replace the whole file with a README that has these sections, each filled from
the sources above (keep it tight — roughly one screen):

1. **Title + one-liner** — "fleetmap — real-time map of a delivery fleet" plus
   the one-sentence description from `CLAUDE.md`.
2. **Stack** — Next.js (App Router, TS), Supabase (Postgres/Realtime/Auth+RLS),
   MapLibre GL, OSRM (self-hosted), driver PWA. (Summarize the `CLAUDE.md` Stack
   list.)
3. **Architecture** — the phone→`/api/location`→Realtime→dashboard flow and the
   `/api/route`→OSRM proxy, in 2–3 sentences (from `CLAUDE.md` Architecture).
4. **Setup** — pnpm; copy `.env.example` → `.env` and fill the Supabase keys;
   apply migrations (`supabase db push` or the project's migration note); list
   the **env var names** from `.env.example` (names only, no values).
5. **Commands** — a table of the `package.json` scripts with one-line purposes
   (`pnpm dev`, `pnpm fake-gps`, `pnpm seed-stops`, `pnpm provision-dashboard`,
   `pnpm provision-dispatcher`, `pnpm exec tsc --noEmit`, `docker compose up -d osrm`).
6. **Docs** — link `CLAUDE.md` (working brief) and
   `docs/specs/live-tracking-spec.md` (full design doc) as the sources of truth.
7. **Status** — "Through M8" with a one-line list or link to the Milestones in
   `CLAUDE.md`.

Cross-check every command and env name against `package.json` / `.env.example`
before saving — an inaccurate README is worse than the boilerplate.

**Verify**: the README's command names all exist in `package.json` `scripts`
(or are the documented `docker compose` / `supabase` commands); no secret values
appear; the spec link path resolves (`docs/specs/live-tracking-spec.md` exists).

## Test plan

Docs-only. Verification is inspection: every command in the README maps to a real
`package.json` script or a documented external command; every env var name
matches `.env.example`; the deep-doc links resolve to existing files.

## Done criteria

ALL must hold:

- [ ] `README.md` no longer contains "This is a Next.js template".
- [ ] It describes fleetmap, its stack, setup, and commands accurately.
- [ ] Every command listed exists in `package.json` or is a documented compose/supabase command.
- [ ] No secret values appear (env var **names** only).
- [ ] Links to `CLAUDE.md` and `docs/specs/live-tracking-spec.md` resolve.
- [ ] `plans/README.md` 006 row updated.

## STOP conditions

- `package.json` scripts differ substantially from the list above (the project
  moved on) — write from the *current* `package.json`, not these excerpts.
- A claim can't be verified against any source file — omit it rather than guess.

## Maintenance notes

- Keep the README a summary; when milestones advance, update the one-line Status
  and let `CLAUDE.md` hold the detail. Avoid duplicating the full spec here or it
  will drift.
