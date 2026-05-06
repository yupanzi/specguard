---
name: sg-sign-check
description: KSC review (notebook three-library baseline, LLM strict yes/no) + AskUserQuestion explicit [y/N] approve; failure opens v2 plan (v1 freezes)
disable-model-invocation: true
---

# /sg-sign-check

**Evaluation phase** of the four-phase loop (KSC role: **C — Check**, applying correctness criteria). Value-layer gate: on top of the machine-layer checks already passed in run-pipeline, perform KSC review + approve decision.

## Preconditions

- The current active version's `check.yaml` exists and the last attempt's verdict = `done` (from run-pipeline's self-healing pass)
- **This skill does not re-run verify** — check execution only happens inside run-pipeline; `specguard verify` writes check.yaml

## Flow

### 1. Read check.yaml v<active>

Confirm the machine layer is fully green (last attempt verdict=done). Otherwise raise an error and direct the user back to `/sg-run-pipeline`.

### 2. KSC review (INDEX-first, fetch on demand)

Scan the three library `INDEX.md` files first — NOT every topic:

- `.specguard/notebook/knowledge/INDEX.md` — `## Invariants` + `## Abstractions` + topic references
- `.specguard/notebook/skill/INDEX.md` — `## Decision Triggers` + topic references
- `.specguard/notebook/check/INDEX.md` — `## Cmd Matrix` + `## Llm Checks` + `## Manual Checklists` + topic references

**All three INDEXes empty** (`references: []` and the `##` body sections devoid of entries) → write `attempts[last].ksc_check = { status: skipped, evidence: "notebook empty, no baseline" }`, jump to step 3.

**Otherwise** → strict yes/no across three axes (each library covers its own segment, no overlap):

- **K (Knowledge / Map)**: does this change violate any `## Invariants` listed in `knowledge/INDEX.md`? Does it interfere with any `## Abstractions`? Fetch a linked `knowledge/<topic>.md` only when the change's surface intersects that topic.
- **S (Skill / Way of working)**: does this change conflict with any `## Decision Triggers` in `skill/INDEX.md`? Fetch the linked `skill/<topic>.md` when its trigger keywords match the change's domain.
- **C (Check / Correctness criteria)**: do `plan.checks` cover all entries in `check/INDEX.md`'s `## Cmd Matrix` / `## Llm Checks` / `## Manual Checklists` that apply to this change? Fetch linked `check/<topic>.md` only when its applicability matches.

INDEX-resident invariants / triggers / matrix entries are evaluated even without fetching any topic — they're the eagerly-loaded baseline. Topics are pulled in only when their refs match the change's surface.

Evidence is segmented per library (each segment ≤ 3 sentences):

```
ksc_check:
  status: pass | fail
  evidence: |
    Knowledge: pass — does not violate K library map (abstraction X / invariant Y)
    Skill: pass — solution method aligns with S library decision template Z
    Check: fail — missed C library's "visual-regression" criterion
```

Any library = fail → overall status = fail, write verdict=`ksc-rejected` to check.yaml, jump to step 4.

### 3. Approve

verdict=`done` + ksc_check pass → AskUserQuestion explicit [y/N]:

> Machine layer + KSC review both pass. Approve?
>
> - Yes (approve)
> - No (reject, opens v2 plan)

- Yes → write `attempts[last].approved = true` to check.yaml, verdict stays `done`
- No → write verdict=`approval-rejected` to check.yaml, jump to step 4

### 4. v2 decision (ksc-rejected / approval-rejected)

Freeze the current v — touch neither plan / pipeline / check.yaml nor logs/. Tell the user:

> v<n> failed the value-layer review (verdict=<ksc-rejected | approval-rejected>).
> Suggest invoking `/sg-ask-plan` to open v<n+1>. v<n> is preserved as counter-example material.

## State machine exits

- approved=true → the changes directory awaits `/sg-sync-notebook` distillation
- ksc-rejected / approval-rejected → v<n> frozen, awaiting user `/sg-ask-plan` to open v<n+1>

## Firewall

- KSC judgment follows the conservative principle: fuzzy cases lean toward strict (prefer over-failing)
- This skill doesn't run cmd (machine execution only happens in run-pipeline); doesn't show cmd examples
- Multi-stack examples (e.g. when displaying plan check.how) must list side-by-side: npx / pytest / cargo / go
- Approve must be explicit AskUserQuestion; never infer "ok / agreed" from conversation as approval
