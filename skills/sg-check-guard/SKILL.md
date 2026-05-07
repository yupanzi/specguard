---
name: sg-check-guard
description: KSC review (notebook three-library baseline, LLM strict yes/no) + AskUserQuestion explicit [y/N] approve; failure prompts user to open a NEW dateId for re-spec/re-plan
disable-model-invocation: true
---

# /sg-check-guard

**Evaluation phase** of the four-phase loop (KSC role: **C — Check**, applying correctness criteria). Value-layer gate: on top of the machine-layer checks already produced by `specguard verify` (called from sg-plan-tasks), perform KSC review + approve decision.

## Preconditions

- `.specguard/changes/{dateId}/check.yaml` exists with initial `check_results[]` + `verdict` (written by `specguard verify` at the end of `/sg-plan-tasks`)
- spec.yaml + plan.yaml + tasks.yaml all present and validate clean

## Flow

### 1. Read check.yaml + tasks.yaml

Confirm what state we're in:

- `check.yaml.verdict = done` AND every `tasks.tasks[].status = passed` → proceed to KSC review (step 2)
- `check.yaml.verdict = re-plan` (some cmd failed) OR any `tasks.tasks[].status = failed` → skip KSC, jump to step 4 (failure routing)
- `check.yaml.verdict = awaiting-llm` → some llm/manual checks are pending; resolve them first (have the LLM judge each pending check_result, set status=pass/fail, then recompute verdict via `specguard verify <dateId> --verdict-only`), then loop back to step 1

### 2. KSC review (INDEX-first, fetch on demand)

Scan the three library `INDEX.md` files first — NOT every topic:

- `.specguard/notebook/knowledge/INDEX.md` — `## Invariants` + `## Abstractions` + topic references
- `.specguard/notebook/skill/INDEX.md` — `## Decision Triggers` + topic references
- `.specguard/notebook/check/INDEX.md` — `## Cmd Matrix` + `## Llm Checks` + `## Manual Checklists` + topic references

**All three INDEXes empty** (`references: []` and the `##` body sections devoid of entries) → write `check.yaml.ksc_check = { status: skipped, evidence: "notebook empty, no baseline" }`, jump to step 3.

**Otherwise** → strict yes/no across three axes (each library covers its own segment, no overlap):

- **K (Knowledge / Map)**: does this change violate any `## Invariants` listed in `knowledge/INDEX.md`? Does it interfere with any `## Abstractions`? Fetch a linked `knowledge/<topic>.md` only when the change's surface intersects that topic.
- **S (Skill / Way of working)**: does this change conflict with any `## Decision Triggers` in `skill/INDEX.md`? Fetch the linked `skill/<topic>.md` when its trigger keywords match the change's domain.
- **C (Check / Correctness criteria)**: do `spec.checks` cover all entries in `check/INDEX.md`'s `## Cmd Matrix` / `## Llm Checks` / `## Manual Checklists` that apply to this change? Fetch linked `check/<topic>.md` only when its applicability matches.

INDEX-resident invariants / triggers / matrix entries are evaluated even without fetching any topic — they're the eagerly-loaded baseline. Topics are pulled in only when their refs match the change's surface.

Evidence is segmented per library (each segment ≤ 3 sentences):

```yaml
ksc_check:
  status: pass | fail
  k: "pass — does not violate K library map (abstraction X / invariant Y)"
  s: "pass — solution method aligns with S library decision template Z"
  c: "fail — missed C library's 'visual-regression' criterion"
  evidence: |
    K: pass — does not violate K library map (abstraction X / invariant Y)
    S: pass — solution method aligns with S library decision template Z
    C: fail — missed C library's "visual-regression" criterion
```

Any library = fail → overall ksc_check.status = fail, write `check.yaml.verdict = ksc-reject`, jump to step 4.

### 3. Approve

verdict=`done` + ksc_check pass → AskUserQuestion explicit [y/N]:

> Machine layer + KSC review both pass. Approve?
>
> - Yes (approve)
> - No (reject — open a new dateId for re-spec/re-plan)

- Yes → write `check.yaml.signed_off = true`, verdict stays `done`
- No → write `check.yaml.verdict = ksc-reject` (reuse the same verdict for "user-rejected at approve gate"; signed_off stays false), jump to step 4

### 4. Failure routing (verdict=re-plan / ksc-reject)

The current dateId is **not modified further** — leave spec/plan/tasks/check.yaml as the failure record. Tell the user:

> dateId `<dateId>` failed at the value-layer gate (verdict=<re-plan | ksc-reject>).
>
> **No retry within this dateId.** To proceed:
> - Invoke `/sg-spec-ask` to open a NEW dateId (e.g. `<today>-<id>-v2`) for the redesign.
> - The current dateId stays as a counter-example — `git history` is the failure archive.
> - When distilling lessons later via `/sg-sync-notebook`, this dateId can be cited as negative material.

## State machine exits

- `signed_off=true` → the changes directory awaits `/sg-sync-notebook` distillation
- `verdict=re-plan / ksc-reject` → no further action on this dateId; user starts a fresh dateId via `/sg-spec-ask`

## Firewall

- KSC judgment follows the conservative principle: fuzzy cases lean toward strict (prefer over-failing)
- This skill doesn't run `cmd` (machine execution happens during `/sg-plan-tasks` via `specguard verify`); doesn't show `cmd` examples
- Multi-stack examples (when displaying spec.checks.how) must list side-by-side: `npx` / `pytest` / `cargo` / `go`
- Approve must be explicit AskUserQuestion; never infer "ok / agreed" from conversation as approval
- **No version fork.** Failure → new dateId, never retry within current dateId.
