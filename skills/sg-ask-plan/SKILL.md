---
name: sg-ask-plan
description: Open the AI autonomous window with dialogue-driven kickoff + AskUserQuestion to disambiguate + EnterPlanMode to lock requirements; produces plan.yaml v1 with version/checks (how is one-of: {cmd:[...]} / {llm:''} / {manual:''})
disable-model-invocation: true
---

# /sg-ask-plan

**Alignment phase** of the four-phase loop (KSC role: **K — Knowledge**). Requirement alignment + plan.yaml drafting. The entry point of the AI autonomous window.

## Kickoff — read priors (progressive disclosure)

Establish context by reading, in order:

- `README.md`
- The project's metadata file at root (e.g. `package.json` / `pyproject.toml` / `Cargo.toml` / `go.mod` / `pom.xml`)
- **Notebook INDEX files first**, dense topics on demand:
  - `.specguard/notebook/INDEX.md` (top-level entry — orients you to the three libraries)
  - `.specguard/notebook/knowledge/INDEX.md` (project map: invariants + abstractions + topic refs)
  - `.specguard/notebook/skill/INDEX.md` (decision triggers + topic refs)
  - `.specguard/notebook/check/INDEX.md` (cmd matrix + llm checks + manual checklists + topic refs)

Notebook may be empty (cold start — common for first-time specguard projects); INDEX files exist as scaffolds with `references: []`. **Do NOT read every `<library>/<topic>.md` upfront** — that's the anti-pattern this design exists to prevent.

**Match-then-fetch protocol** — after reading the three library INDEXes, decide which topic files to `Read` only when one of these triggers fires:

- a Decision Trigger keyword (S library) matches this plan's intent, OR
- an Invariant or Abstraction (K library) is structurally relevant to this change's surface, OR
- a Cmd Matrix / Llm Check entry (C library) maps to a check we're drafting.

For each trigger that fires, fetch the linked `<library>/<topic>.md` for its dense content. No trigger → the topic stays out of context by design.

The library INDEXes' `## Invariants` / `## Decision Triggers` / cross-domain entries (the parts that live in the INDEX itself, not in topic files) are **eagerly applied** to every plan regardless of trigger — they're the cheapest, highest-leverage prior knowledge.

## Flow

### 1. One-sentence goal

Have the user state the goal in one sentence. If their description is long, condense it to ≤ 20 words.

### 2. Disambiguation (one Q per turn)

For each ambiguous point in the user's statement, ask in plain text. **First, let the project answer itself** — anything inferable from code / README / notebook should not require asking the user.

### 3. Decide dateId and version

- Today's date → `YYYYMMDD`
- kebab-case id (short, intent-descriptive)
- dateId = `{YYYYMMDD}-{id}`, e.g. `20260504-add-auth`
- Create `.specguard/changes/{dateId}/v1/`
- Version: v1 (first iteration is always 1); if the user invokes this skill while v1 already exists (i.e. the previous round was ksc-rejected / approval-rejected), open v2 / v3 ...

### 4. Draft plan.yaml

Write to `.specguard/changes/{dateId}/v<n>/plan.yaml`:

```yaml
version: 1
id: <kebab-case-id>
goal: <one sentence>
asks:
  - q: <question>
    a: <answer>
    level: blocker | defer  # optional
checks:
  - id: <kebab-id>
    what: <what to verify>
    how: { cmd: [<program>, <arg>, ...] }   # or { llm: "<prompt>" } / { manual: "<note>" }
tasks:
  - id: <kebab-id>
    do: <what to do>
    verify: <corresponding check id>
```

`check.how` is a one-of object — `cmd` (program array) / `llm` (reasoning prompt) / `manual` (human note), exactly one property. **Priority**: `cmd` > `llm` > `manual`. If `cmd` works, don't reach for `llm`.

#### `cmd` is a YAML array (no shell)

`how.cmd` is a string array: first element is the program, the rest are args. specguard spawns it directly — **no shell**. The array form IS the spawn argv: no split, no quote-hell, no platform difference. The schema enforces a non-empty string array.

`cmd` examples must list **multiple stacks side-by-side** (don't bind to a single ecosystem):

```yaml
how: { cmd: [npx, vitest, run, tests/auth.test.ts] }
how: { cmd: [pytest, -q, tests/test_auth.py] }
how: { cmd: [cargo, test, --test, auth] }
how: { cmd: [go, test, ./pkg/auth] }
```

##### Literal `&&` `||` `|` `;` `>` `<` tokens in the array = shell thinking leaked in

If you write a plan with these tokens as array elements, **99.9% it's wrong** — the spec model has no mechanism to interpret them. Two failure modes, **neither of them what you want**:

**Strict programs** (test / npm / grep / cargo / pytest etc.) reject the unknown arg → non-zero exit → spec marks fail, stderr surfaces the cause (e.g. `test: unexpected operator`, `npm: script "&&" not found`). This is "self-detonation", relatively easy to diagnose.

**Lenient programs** (echo / cat / printf etc.) print the unknown arg literally → exit 0 → **spec marks pass, false positive**:

```yaml
# ❌ False positive! Spec machine layer marks done, but echo verifies nothing —
# it just prints the whole line literally.
# how: { cmd: [echo, ok, "&&", echo, also-ok] }
# log: stdout="ok && echo also-ok\n", EXIT 0 → status=pass
```

False positives from lenient programs aren't catchable at the machine layer (verify) — its contract is "exit 0 = pass". Coverage falls back to `/sg-sign-check`'s KSC three-axis review (especially the C library's correctness criteria). But better not to **get there in the first place**: avoid this at plan-drafting time.

For complex logic (pipe / multi-step / conditional / substitution), two ways out:

**1. Split into multiple checks** — each with single-failure semantics, sharper localization:

```yaml
# ❌ `&&` in the array = shell thinking leaked in
# how: { cmd: [test, -x, .husky/pre-commit, "&&", grep, -q, lint-staged, .husky/pre-commit] }

# ✅ Split into two checks
- id: husky-executable
  how: { cmd: [test, -x, .husky/pre-commit] }
- id: husky-uses-lint-staged
  how: { cmd: [grep, -q, lint-staged, .husky/pre-commit] }
```

**2. Script fallback** — write pipe / awk / jq expressions / multi-step shell into a project-internal script, cmd invokes it:

```yaml
# ❌ Compound shell syntax in array — spawn doesn't interpret; first program exits 0 → false positive
# how: { cmd: [pnpm, exec, biome, --version] }   # only checks "can it run", doesn't check version >= 2.3

# ✅ Encode the version constraint in a script (where pipe / awk / set -o pipefail are available)
how: { cmd: [bash, scripts/check-biome-version.sh] }
how: { cmd: [python, scripts/check_lint_staged.py] }
how: { cmd: [node, scripts/check_husky.mjs] }
how: { cmd: [./scripts/check_x] }   # already chmod +x
```

### 5. AskUserQuestion to clear asks in batches

Batched AskUserQuestion, ≤ 4 per batch. After each answer, **immediately** flush back to plan.yaml (so an unexpected exit doesn't lose answers).

### 6. Validate schema

```bash
specguard validate <dateId>
```

On error → fix in place and re-run → pass.

### 7. EnterPlanMode terminal confirmation

Invoke EnterPlanMode for user review. On approval, the next phase is unlocked (the user invokes `/sg-run-pipeline`).

## State machine exits

- User approves → plan.yaml persisted, awaiting `/sg-run-pipeline`
- User rejects → return to flow step 2 to re-align, or terminate

## Firewall

- Don't directly invoke side commands like `verify`
- AskUserQuestion ≤ 4 per batch; split when exceeding
- check.how is a one-of object (`{cmd:[...]}` / `{llm:''}` / `{manual:''}`, exactly 1 property); the schema rejects other shapes
- Stack examples must list 4 ecosystems side-by-side (CLAUDE.md hard rule #6)
