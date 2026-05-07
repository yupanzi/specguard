---
name: sg-plan-tasks
description: Two sub-phases — design plan.yaml (files + approach + tradeoffs via AskUserQuestion) then execute tasks.yaml in subagent isolation (one-shot, no retries; failure routes to sg-check-guard for re-plan/ksc-reject decision)
disable-model-invocation: true
---

# /sg-plan-tasks

**Reasoning phase** of the four-phase loop (KSC role: **S — Skill**, applying decision templates). Two sub-phases compressed into one skill: **design** (write plan.yaml + tasks.yaml) → **execute** (run tasks via subagent, write tasks/{taskId}/{prompt.md, debug.log}).

**One-shot execution.** No r1/r2/r3 retry mechanism. If any task fails, the user proceeds to `/sg-check-guard`, which routes to `re-plan` or `ksc-reject` and prompts the user to open a NEW dateId.

## Preconditions

- `.specguard/changes/{dateId}/spec.yaml` exists and passes `specguard validate`
- `plan.yaml` and `tasks.yaml` may not yet exist (this skill creates them)
- `tasks/` directory may not yet exist (this skill creates per-task subdirectories during execution)

## Sub-phase 2a — Design (write plan.yaml + tasks.yaml)

### 1. Read spec.yaml + AskUserQuestion to lock design

Read `.specguard/changes/{dateId}/spec.yaml`. The `checks[]` define what must pass; design must enable those checks.

Batched AskUserQuestion, ≤ 4 per batch:

- Which files will this change touch? (relative paths from repo root)
- What's the implementation path? (e.g. "OAuth via Google provider, token refresh in middleware")
- Any tradeoffs / alternatives rejected? (optional, helps future re-plan)

### 2. Write plan.yaml

`.specguard/changes/{dateId}/plan.yaml`:

```yaml
version: 1
id: <kebab-case-id>          # MUST equal spec.id
files:
  - src/auth.ts
  - tests/auth.test.ts
approach: |
  OAuth via Google provider; token refresh in middleware;
  schema migration handled by existing migrate runner.
tradeoffs: |
  Considered passport.js but rejected — adds session state we don't need.
```

`plan.yaml` is the **design intent layer** — it captures the why and how before any code is written. Future re-plan iterations can `git diff` plan.yaml to see what changed in the design (not just the tasks).

### 3. Write tasks.yaml

Derive atomic tasks from plan.approach. Each task's `verify` field MUST reference a `spec.checks[].id` (cross-file integrity enforced by `specguard validate`).

`.specguard/changes/{dateId}/tasks.yaml`:

```yaml
version: 1
id: <kebab-case-id>          # MUST equal spec.id
tasks:
  - id: t1
    do: |
      Add Google OAuth provider in src/auth.ts
    verify: c1                # references spec.checks[id=c1]
    status: pending
  - id: t2
    do: |
      Add token-refresh middleware in src/middleware/refresh.ts
    verify: c2
    status: pending
```

**No `attempts[]`**. `tasks[].status` is the single execution state: `pending → running → passed | failed`.

### 4. Validate

```bash
specguard validate <dateId>
```

Catches: id mismatch (spec/plan/tasks must share same id) / orphan task verify (unknown spec.checks.id) / schema violations.

## Sub-phase 2b — Execute (run tasks via subagent isolation)

### 5. Iterate tasks.tasks[] in order

For each task:

1. Update `tasks.yaml.tasks[id].status = running`, set `started_at`, **flush immediately**.
2. Compose the subagent prompt:
   - context: spec.goal + plan.approach (so subagent knows the destination)
   - task description: task.do
   - verification target: the spec.checks[].how that task.verify references
3. **Write the prompt to disk before launching**: `.specguard/changes/{dateId}/tasks/{taskId}/prompt.md` (so failures are diagnosable later).
4. Launch isolated subagent (subagent_type: general-purpose) with that prompt.
5. Subagent appends every step's output to `.specguard/changes/{dateId}/tasks/{taskId}/debug.log`.
6. On completion:
   - subagent reports success → `tasks[id].status = passed`, set `finished_at`, optionally fill `result` with brief summary
   - subagent reports failure (or self-checks: same error ≥ 3 times → fail proactively) → `tasks[id].status = failed`, set `finished_at`, fill `result` with failure summary
7. **Flush tasks.yaml after each status change** (status changes flush immediately — CLAUDE.md hard rule).

### 6. After all tasks complete

```bash
specguard verify <dateId>
```

This reads `spec.yaml.checks[]` and runs every `cmd` how, writing `check.yaml.check_results[]` + initial verdict. `llm` / `manual` checks remain `pending` (resolved during `/sg-check-guard`).

### 7. Report

Summarize for the user:

- All tasks passed + verify produced verdict=`done` → "Tasks complete + machine checks green. Invoke `/sg-check-guard` for value-layer KSC review."
- Some tasks failed OR verdict=`re-plan` → "Tasks failed: [list]. The check.yaml verdict reflects this. Invoke `/sg-check-guard` to formalize re-plan or ksc-reject."

## cmd examples (multi-stack side-by-side)

`how.cmd` examples in this skill must list 4 ecosystems side-by-side:
- `{ cmd: [npm, test] }`
- `{ cmd: [pytest, -q] }`
- `{ cmd: [cargo, test] }`
- `{ cmd: [go, test, ./...] }`

## Firewall

- **Subagent self-check**: same error ≥ 3 times or thinking in circles → fail proactively, don't push through (CLAUDE.md collaboration convention). Fail-proactive ≠ retry — there is no retry; let the failure go to sg-check-guard.
- Don't invoke any CLI side command other than `validate` and `verify`.
- **No r1/r2/r3 retry**. A subagent retry within itself is OK (let it solve its own problem); but at the skill level, each task runs once. Failure → mark failed → continue to next task → final verdict comes from check.yaml.
- AskUserQuestion ≤ 4 per batch; split when exceeding.
- `tasks/{taskId}/prompt.md` MUST be written before launching the subagent — if the subagent crashes, this is the only record of what was asked.
