# Plan 025: Correct the production compose file's stale and dangerous header

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report — do not improvise. When done, update the status row for this plan
> in `plans/README.md` — unless a reviewer dispatched you and told you they
> maintain the index.
>
> **Drift check (run first)**:
> `git diff --stat a0e0283..HEAD -- docker-compose.prod.yml`
> If the file changed since this plan was written, compare the "Current state"
> excerpt against the live code before proceeding; on a mismatch, treat it as a
> STOP condition.

## Status

- **Priority**: P2
- **Effort**: S
- **Risk**: LOW
- **Depends on**: none, but see "Git workflow" if plan 024 has already landed
- **Category**: docs
- **Planned at**: commit `a0e0283`, 2026-07-28

## Why this matters

`docker-compose.prod.yml` is the file anyone touching production opens first,
and its header comment block describes a system that no longer exists. It says
Supabase is managed cloud (it has been self-hosted on the same box for months),
it describes a three-service stack (there are five), and — the part that
matters — it instructs the reader to bring the stack up with `--build`.

Building on that box is the one thing the deployment documentation exists to
prevent. From `docs/deployment.md:52-57`:

> ## The one rule that matters: never build on the box
>
> The VPS has 4GB of RAM. Building the Next image while both stacks are
> running has already taken prod down once (load average 91 during a `docker
> build`, the app stack starved of memory and stopped answering). **Never run
> `docker compose ... up -d --build` on the VPS.**

The header tells you to run almost exactly that command. It has already
happened once, and the file that would have warned you instead recommends it.

This is a comment-only change. No service definition, image, port, volume,
network or environment value is touched.

## Current state

`docker-compose.prod.yml:1-7`, verbatim — the block to replace:

```yaml
# Production stack for the VPS: Caddy (TLS) -> Next app -> OSRM (internal).
# Supabase stays managed/cloud — not in this stack.
#
#   docker compose -f docker-compose.prod.yml up -d --build
#
# Reads .env in this directory for both build args (NEXT_PUBLIC_*) and runtime
# env. Build the OSRM dataset once before first `up` (see docs/deployment.md).
```

Four things are wrong with it:

1. **Line 2 is false.** Supabase is self-hosted on the same box, in its own
   compose project, fronted by the same Caddy. `docs/deployment.md:7-9` is the
   accurate description; `caddy/Caddyfile:17-19` proxies `sb.fleet.ysz.life` to
   `kong:8000`, which only exists because the Supabase stack is local.
2. **Line 4 is dangerous** — see "Why this matters". The real procedure is
   `./redeploy.sh`, which runs `up -d --no-build` (`redeploy.sh:23`) after
   loading images built on a developer machine.
3. **Line 1 is incomplete.** It names Caddy, the app and OSRM. The file also
   defines `sync` (`:44`) and `driver-session` (`:55`), and `driver-session` is
   the service with the unusual, security-relevant env arrangement someone
   reading this header most needs to know about.
4. **A related inline comment is misleading.** Line 36 lists `OSRM_URL` among
   the runtime values read from `.env`, but line 38 immediately overrides it,
   and `docs/deployment.md:252` records it as "ignored here — compose overrides
   it to `http://osrm:5000`".

For reference, the accurate architecture summary lives at
`docs/deployment.md:5-48`, and the service inventory at `:17-36`. That document
is correct and current — this plan makes the compose header agree with it
rather than restating it at length.

## Commands you will need

| Purpose         | Command                                                | Expected on success       |
|-----------------|--------------------------------------------------------|---------------------------|
| Validate compose| `docker compose -f docker-compose.prod.yml config --quiet` | exit 0                |
| Diff check      | `git diff docker-compose.prod.yml`                      | comment lines only        |

`docker compose config` needs a local `.env` providing the `NEXT_PUBLIC_*`
variables it interpolates. If you do not have one, that check is optional — the
git-diff check below is the binding one, since a comment-only diff cannot
change compose semantics.

## Scope

**In scope**:

- `docker-compose.prod.yml` — **comment lines only**

**Out of scope** (do NOT touch):

- Every non-comment line in the file. No service, image, tag, digest, port,
  volume, network, `env_file`, `build`, `depends_on` or environment value
  changes. If your diff contains a line that is not a comment, you have gone
  out of scope.
- The `build:` stanzas (`:29-34`, `:45-47`, `:57-58`). They are correct and
  load-bearing — images *are* built from this file, just on a developer machine
  rather than the VPS. Do not remove them to "enforce" the no-build rule.
- `docs/deployment.md`, `README.md`, `CLAUDE.md`, `redeploy.sh`,
  `caddy/Caddyfile` — all already accurate. This plan makes one file agree with
  them; it does not edit them.
- `docker-compose.yml` (the dev OSRM file) — different file, different purpose.

## Git workflow

- Branch: `advisor/025-prod-compose-header-truth`
- Conventional Commits, lowercase subject, no trailing period. Real example
  from `git log`: `fix(deploy): mount the caddy config directory, not the file`.
  Suggested: `docs(deploy): the prod compose header described a stack that no
  longer exists`.
- **Do not add a `Co-Authored-By` trailer or any AI-authorship trailer.**
- **If plan 024 has already landed**, the `app` service's `environment:` block
  contains a second entry (`DRIVER_SESSION_URL`). That is expected; it does not
  conflict with this plan, which only edits comments. Rebase rather than
  reverting anything.
- Do NOT push or open a PR unless the operator instructed it.

## Steps

### Step 1: Replace the header block

Rewrite `docker-compose.prod.yml:1-7` so it states, accurately and briefly:

- what the stack contains: Caddy (TLS) in front of the Next app, with OSRM and
  the `sync` and `driver-session` workers internal-only;
- that the self-hosted Supabase stack runs beside it in `supabase-docker/`,
  joined through the external `fleetmap-edge` network;
- that deploys run `./redeploy.sh`, which loads images built elsewhere and
  brings the stack up **without building** — and that building on the box has
  taken production down before;
- that `.env` supplies the `NEXT_PUBLIC_*` build args and the runtime
  environment, while `driver-session` deliberately reads its own
  `.env.driver-session`;
- that the OSRM dataset must be built once before the first `up`;
- a pointer to `docs/deployment.md` as the full guide.

Keep it to roughly the length of the block it replaces — this is a signpost,
not a second copy of the deployment guide. Match the file's existing comment
style (`#` at column 0, sentence case, no ASCII art).

**Verify**:
- `git diff docker-compose.prod.yml` → every changed line begins with `#`
  (after leading whitespace)
- `grep -n "up -d --build" docker-compose.prod.yml` → no matches
- `grep -n "managed/cloud" docker-compose.prod.yml` → no matches
- `grep -n "redeploy.sh" docker-compose.prod.yml` → at least one match

### Step 2: Fix the `OSRM_URL` inline comment

At `docker-compose.prod.yml:36`, the `app` service's `env_file: .env` comment
lists `OSRM_URL` among the values read from `.env`. Remove `OSRM_URL` from that
list — line 38 overrides it for this stack, and `docs/deployment.md:252` says
the `.env` value is ignored here. Leave the rest of the comment intact.

**Verify**: `git diff docker-compose.prod.yml` → still comment-only.

### Step 3: Confirm nothing semantic moved

**Verify**, both:
- `git diff -U0 docker-compose.prod.yml | grep '^[+-]' | grep -v '^[+-][+-]' | grep -v '^[+-][[:space:]]*#'`
  → **no output**. Any line here is a non-comment change and means you have
  left scope.
- `docker compose -f docker-compose.prod.yml config --quiet` → exit 0
  (skip if you have no local `.env`; the check above is the binding one)

## Test plan

There is nothing to unit-test — this plan changes only comments, and the
verification is the diff itself. Do not add tests.

## Done criteria

Machine-checkable. ALL must hold:

- [ ] `git diff -U0 docker-compose.prod.yml | grep '^[+-]' | grep -v '^[+-][+-]' | grep -v '^[+-][[:space:]]*#'`
      produces no output
- [ ] `grep -n "up -d --build" docker-compose.prod.yml` → no matches
- [ ] `grep -n "managed/cloud" docker-compose.prod.yml` → no matches
- [ ] `grep -n "redeploy.sh" docker-compose.prod.yml` → at least one match
- [ ] `grep -n "driver-session" docker-compose.prod.yml` → matches in both the
      header and the service definition
- [ ] `git status --short` shows only `docker-compose.prod.yml`
      (and `plans/README.md`)
- [ ] `plans/README.md` status row updated

## STOP conditions

Stop and report back (do not improvise) if:

- The header block does not match the excerpt in "Current state" — it may have
  been corrected already.
- Your diff contains any non-comment line.
- You conclude a service definition is *actually* wrong (not just described
  wrongly). That is a real defect and needs a decision, not a comment edit —
  report it instead of fixing it here.

## Maintenance notes

- **Why comment-only matters here**: this file is applied to production by
  `./redeploy.sh` immediately after a `git pull`. A comment-only diff is
  reviewable at a glance and cannot change what runs. Keep any future
  correction of this file to the same discipline unless a service genuinely
  needs to change.
- **What a reviewer should scrutinise**: only that the diff is comments, and
  that the new text does not contradict `docs/deployment.md:5-48`.
- **Root cause worth noticing**: this header drifted because it duplicates
  information that lives in `docs/deployment.md`. The correction deliberately
  shrinks the duplication to a signpost plus a pointer, so the next
  architecture change has one place to update rather than two.
