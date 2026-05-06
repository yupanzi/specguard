---
name: sg-run-pipeline
description: Run plan.tasks sequentially (subagent isolation) + run embedded machine-layer checks + self-heal loop until pass (max 3 attempts) + invoke /simplify for entropy reduction on success
disable-model-invocation: true
---

# /sg-run-pipeline

**Reasoning phase** of the four-phase loop (KSC role: **S — Skill**, applying decision templates). Task execution pipeline: subagent runs task → run check → self-heal until pass (max 3 attempts) → /simplify for entropy reduction.

## Preconditions

- `.specguard/changes/{dateId}/v<n>/plan.yaml` exists and passes validate
- The current active version is determined by the CLI helper `activeVersion(dateId)`

## Kickoff

- Read plan.yaml + pipeline.yaml (resume if it exists)
- Determine attempt n:
  - pipeline.yaml absent → n = 1
  - pipeline.yaml present + last attempt status = fail → n = last attempt.n + 1
  - pipeline.yaml present + last attempt status = pass → already complete; prompt the user to invoke `/sg-sign-check`

## Main loop (max 3 attempts)

```
loop:
  1. flush pipeline.yaml: append a new attempt record, status=in_progress
  2. iterate plan.tasks in order:
     - launch an isolated subagent (subagent_type: general-purpose)
     - input: plan.goal + task.do + all plan.checks (so the subagent knows the destination)
     - require the subagent to append every step's log to logs/r<n>/<task_id>.log
     - on completion, flush pipeline.yaml: status=pass | fail
  3. run the machine-layer checks (writes check.yaml):
       specguard verify <dateId>
  4. read the last attempt's verdict in check.yaml:
     - done → exit loop (machine layer fully green)
     - re-run / re-plan / awaiting-llm → continue
  5. if n == 3 → exit loop (loop ceiling)
  6. n+1 → start a new attempt (subagent in fresh context)
```

`pipeline.yaml.attempts.length` strictly mirrors loop iterations (CLI validate enforces attempts.length ≤ 3).

## After exit

### Pass (verdict=done)

Invoke the `/simplify` skill for entropy reduction — the main agent surveys all task-written code and removes redundancy / temporary implementations. On completion, report to the user:

> Machine checks fully green + simplify done. Invoke `/sg-sign-check` for the value-layer review.

### Fail (n=3 still failing)

Write verdict=`re-plan` to check.yaml. Report:

> Attempt 3 still failing. **Do not invoke /sg-sign-check** — a machine-layer fail goes straight to the v2 decision. Suggested next steps:
> - Invoke `/sg-ask-plan` to open v<n+1> (v<n> is preserved)
> - Or, in conversation, adjust plan.yaml v<n>'s `do` / `check` (only if the issue is local; re-run validate to confirm the schema)

## cmd examples (multi-stack side-by-side)

`how.cmd` examples in this skill must list 4 ecosystems side-by-side:
- `{ cmd: [npm, test] }`
- `{ cmd: [pytest, -q] }`
- `{ cmd: [cargo, test] }`
- `{ cmd: [go, test, ./...] }`

## Firewall

- Subagent self-check: same error ≥ 3 times or thinking in circles → fail proactively (CLAUDE.md collaboration convention)
- Don't invoke `archive` or any CLI side command other than validate
- A subagent restart is NOT a new attempt (attempt n strictly mirrors pipeline.yaml.attempts length)
- /simplify is invoked exactly once after verdict=done exit, never inside the loop
