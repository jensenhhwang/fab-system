# Project Rules Simplification Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Keep one project-rule source in `RULES.md`, expose it to Codex and Claude Code through their supported discovery paths, and prevent automatic subagent invocation.

**Architecture:** `RULES.md` owns the complete project policy. Root `AGENTS.md` becomes a minimal Codex loader, while `.claude/rules/project.md` is a relative symbolic link to the same source so the two tools cannot drift.

**Tech Stack:** Markdown project instructions, Codex `AGENTS.md` discovery, Claude Code `.claude/rules/` discovery, POSIX symbolic link

## Global Constraints

- Read the relevant guide in `node_modules/next/dist/docs/` before writing Next.js code.
- Operating and simulation time uses the shared Twin operating clock at a default `24×` multiplier.
- Wall-clock facts such as creation, approval, user action, and audit timestamps are not accelerated.
- Subagents run only when the user explicitly names them or asks for multi-agent review.
- Preserve `.claude/agents/cree.md`, `.claude/agents/fab.md`, and `.claude/agents/x.md` unchanged.

---

### Task 1: Install the shared project-rule structure

**Files:**
- Create: `RULES.md`
- Modify: `AGENTS.md`
- Create: `.claude/rules/project.md` as a symbolic link to `../../RULES.md`
- Verify unchanged: `.claude/agents/cree.md`, `.claude/agents/fab.md`, `.claude/agents/x.md`

**Interfaces:**
- Consumes: Codex root `AGENTS.md` discovery and Claude Code recursive `.claude/rules/*.md` discovery.
- Produces: one shared rules document with minimal tool-specific entry points.

- [ ] **Step 1: Run the structural check before implementation**

```bash
test -f RULES.md \
  && test "$(cat AGENTS.md)" = $'Before working in this repository, read and follow `RULES.md`.\nDo not invoke subagents unless the user explicitly requests them.' \
  && test -L .claude/rules/project.md \
  && test "$(readlink .claude/rules/project.md)" = "../../RULES.md"
```

Expected: non-zero exit because `RULES.md` and `.claude/rules/project.md` do not exist and `AGENTS.md` still contains automatic three-agent dispatch rules.

- [ ] **Step 2: Create the canonical `RULES.md`**

```md
# Project Rules

## Next.js

This is not the Next.js version assumed by model training data. Before writing Next.js code, read the relevant guide in `node_modules/next/dist/docs/` and follow its deprecation notices.

## Twin operating time

- All production and simulation features must use the shared Twin operating clock.
- The default and mandatory operating-time multiplier is `24×`: one real hour advances one operating day.
- Apply `real elapsed time × 24` only to modeled operations such as WIP progression, material consumption, replenishment and purchase-order ETA, final test, automatic shipment, and contract-period aggregation.
- Never accelerate wall-clock facts such as `createdAt`, approval time, user actions, audit logs, authentication/session expiry, or external-system receipt time. Record those as real `recordedAt`-class timestamps.
- Do not introduce feature-local clocks, product-specific multipliers, or tick-count-based time progression. New time-dependent behavior must consume the shared Twin operating clock.
- Keep wall-clock time and operating time explicitly separated in field names, APIs, and UI labels.

## Subagents

- Do not invoke Cree, Fab, X, or any other subagent automatically for feature requests.
- Invoke subagents only when the user explicitly names an agent or asks for multi-agent or three-person planning-team review.
- Keep the existing definitions in `.claude/agents/` available for those explicit requests.
```

- [ ] **Step 3: Replace `AGENTS.md` with the minimal Codex loader**

```md
Before working in this repository, read and follow `RULES.md`.
Do not invoke subagents unless the user explicitly requests them.
```

- [ ] **Step 4: Add the Claude Code rule link**

```bash
mkdir -p .claude/rules
ln -s ../../RULES.md .claude/rules/project.md
```

- [ ] **Step 5: Run the complete rule verification**

```bash
test -f RULES.md \
  && test "$(cat AGENTS.md)" = $'Before working in this repository, read and follow `RULES.md`.\nDo not invoke subagents unless the user explicitly requests them.' \
  && test -L .claude/rules/project.md \
  && test "$(readlink .claude/rules/project.md)" = "../../RULES.md" \
  && rg -q '24×' RULES.md \
  && rg -q 'real elapsed time × 24' RULES.md \
  && rg -q 'only when the user explicitly' RULES.md \
  && test -f .claude/agents/cree.md \
  && test -f .claude/agents/fab.md \
  && test -f .claude/agents/x.md \
  && ! rg -q '발동 조건|크리 호출|패브 호출|엑스 호출' AGENTS.md
```

Expected: exit code 0 with no output.

- [ ] **Step 6: Check formatting and the exact diff**

```bash
git diff --check -- AGENTS.md RULES.md .claude/rules/project.md
git diff -- AGENTS.md RULES.md .claude/rules/project.md
```

Expected: no whitespace errors; the diff contains only the approved rule restructuring.

- [ ] **Step 7: Commit the rule structure**

```bash
git add AGENTS.md RULES.md .claude/rules/project.md
git commit -m "chore: centralize project agent rules"
```
