---
name: sg-init-project
description: Project bootstrap entry; invokes specguard init for the deterministic skeleton (incl. .gitignore maintenance), scans the project (README / CLAUDE / metadata / skills / src layout) to extract project-specific K/S/C candidates, batches AskUserQuestion to admit them into .specguard/notebook/{knowledge,skill,check}/
disable-model-invocation: true
---

# /sg-init-project

Project bootstrap entry. **Outside the state machine** — orthogonal to the four-phase loop (ask-plan / run-pipeline / sign-check / sync-notebook), invoked only on first onboarding or to seed an additional notebook draft.

The CLI's `specguard init` only does the deterministic skeleton (create dirs / write config / maintain .gitignore). This skill layers an **LLM-reasoning increment** on top: scan the project → distill project-specific K/S/C candidates → user reviews → admit them.

## Flow

### 1. Ensure CLI is on PATH

Run `command -v specguard` via Bash before anything else.

- **Found** → record `specguard --version` and proceed to step 2.
- **Missing** → AskUserQuestion to pick an installer (single batch, default npm + abort option):

  | Option | Command |
  | ------ | ------- |
  | npm (default) | `npm install -g @yupanzi/specguard` |
  | pnpm | `pnpm add -g @yupanzi/specguard` |
  | yarn (classic) | `yarn global add @yupanzi/specguard` |
  | bun | `bun add -g @yupanzi/specguard` |
  | I'll install it myself | abort the skill, surface the suggested command for the user to run manually |

  Run the chosen command via Bash, then assert `specguard --version` succeeds before continuing. If verification fails (PATH cache, permission, registry error, ...), surface the install command's stderr to the user and abort — do **NOT** silently fall back to a different installer.

Why this is step 1: hook scripts (`hooks/scripts/*.sh`) are 1-line `command -v specguard ... || true` shims (CLAUDE.md hard rule #7). Without the CLI on PATH the yaml-write / session-start / prompt-submit guards **silently exit 0** — the plugin appears installed but enforces nothing. Step 1 is what makes the rest of the plugin live.

### 2. Detect current state

Read:

- whether `.specguard/config.yaml` exists
- read each library's `INDEX.md.references` array length to count registered topics (cold start = 0 across all three libraries; topic .md files outside the INDEX are orphans, surfaced by `specguard validate`)

Two cases:

- **First run** (`config.yaml` absent) → step 3
- **Subsequent run** (`config.yaml` present) → step 4

### 3. First run: bootstrap the skeleton

`AskUserQuestion` for the enforcement level (strict / warn / off, default warn).

Invoke the CLI:

```bash
specguard init --enforcement <level>
```

The CLI prints `gitignore: appended/noop/skipped (no .gitignore)` — verify it matches expectation (existing `.gitignore` already has the specguard line → noop; blank project → appended; no `.gitignore` at all → skipped).

Once the skeleton is in place, proceed to step 5.

### 4. Subsequent run: three-way choice

`AskUserQuestion` with three options:

| Option | Behavior |
| ------ | -------- |
| Skip | Exit immediately, touch nothing |
| Append | Proceed to step 5; in step 8 **skip topics that already exist** (avoid overwriting human edits / sync distillations) |
| Diff report | Proceed to step 5; in step 8 skip writes and **emit a markdown diff report only** (candidates list + comparison vs. existing topics) |

### 5. Scan project "shape" (prior material)

Read the following in order; each piece is K/S/C candidate material:

- `README.md` (if present) → product purpose, key concepts, user perspective
- `CLAUDE.md` (if present) → **highest priority**: hard rules, pitfalls, collaboration tone map directly to S/K
- The project's root metadata file → stack, build commands, dependency graph:
  - Node: `package.json`
  - Python: `pyproject.toml` / `setup.py` / `requirements.txt`
  - Rust: `Cargo.toml`
  - Go: `go.mod`
  - Java: `pom.xml` / `build.gradle`
  - Ruby: `Gemfile`
  - PHP: `composer.json`
  - Add others as you encounter them
- `skills/<name>/SKILL.md` (if present) → slash-command workflow constraints (K + S candidates)
- `src/` (or the equivalent source root inferred from metadata) → directory layout up to 2 levels (K candidate: module map)

**Don't copy README verbatim** — README is the manual; notebook is the "why" for AI. Distill, don't transcribe.

### 6. Generate KSC candidates

**Two firewalls before generating any candidate** (rules + rationale: CLAUDE.md Operating axioms § Notebook scope / Information-source boundary):

1. **Scope test** — would this candidate survive `rm -rf changes/<dateId>` and still help the *next* task? If it only matters for the current init/onboarding context, it's task scope: discard. (init-specific watch-out: don't admit "I just ran specguard init with enforcement=warn" — that's the event, not a project rule.)
2. **Source test** — for any K candidate, classify as public (language/framework/build system, queryable in public docs) vs domain-specific (business terminology, internal convention, project-specific behavior). Domain-specific MUST be user-confirmed via the step 7 AskUserQuestion batch — never inferred silently. Public facts still need step 7 confirmation.

Each candidate is its own asset; the three categories are strictly distinct:

- **K (Knowledge / Map)**: project core abstractions, invariants, concept relations. **Give the AI a panoramic view** — e.g. "the state machine is carried by files; restart-recoverable", "the four-phase loop is non-skippable", "CLI is decoupled from LLM; capability scales by riding Claude Code's own evolution". **Macro-level**, not an exhaustive manual; statements of fact, not a tutorial.
- **S (Skill / Way of working)**: teach the AI to **think like a person solving the problem** — decision templates, reasoning frameworks, workflows. E.g. "for major refactors, default to wipe-and-rebuild using prior code as form-only reference; no @deprecated", "AskUserQuestion ≤ 4 per batch; flush each answer to plan.yaml immediately to survive unexpected exit", "subagent self-check: same error ≥ 3 times or thinking in circles → fail proactively, don't push through". **Methodology**, not a fact list.
- **C (Check / Correctness criteria)**: what's right and how to tell. Forms include cmd, llm yes-no, manual checklist, self-test framework. E.g. "lint:no-ai-sdk guards the invariant that the CLI never calls an LLM", "hook scripts have ≤ 1 business line (after stripping comments + blanks)", "is plan.yaml's field set minimal? (count schema.required + flag any extras for PR-level justification)". **Criteria**, not a map, not a method.

Each candidate is a **topic** (kind: topic) and must carry frontmatter per `notebook-asset.schema.json`:

```yaml
---
topic: <kebab-case-topic>
kind: topic
scope: notebook.<library>          # notebook.knowledge | notebook.skill | notebook.check
library: knowledge | skill | check  # must match the scope suffix
ref_id: <K-NN | S-NN | C-NN>        # axis (K/S/C) must match library; NN = next available 2-digit per library
version: 1
source_change_id: project-init
source_date: <YYYYMMDD>
---
```

**`source_change_id: project-init`** is the fixed value at init stage (self-describing — `/sg-sync-notebook` recognizes it as an init seed, not a change distillation).

**ref_id assignment** — read `<library>/INDEX.md.references` and pick the next unused integer per axis (K-01, K-02, ... in knowledge; S-01, S-02, ... in skill; C-01, C-02, ... in check). Two-digit zero-padded; uniqueness within a library is enforced by `specguard validate`.

The body must list **multiple stacks side-by-side** (CLAUDE.md hard rule #6):

- Check examples: `{ cmd: [npx, vitest, run, ...] }` / `{ cmd: [pytest, -q, ...] }` / `{ cmd: [cargo, test, ...] }` / `{ cmd: [go, test, ./...] }`
- Metadata-file examples: `package.json` / `pyproject.toml` / `Cargo.toml` / `go.mod` / `pom.xml`

### 7. AskUserQuestion batched review

≤ 4 items per batch (CLAUDE.md collaboration convention). Each candidate decided independently:

- Admit (default)
- Skip
- Rename topic (rename, then decide)

Pattern reference: `/sg-sync-notebook` step 4.

### 8. Write to notebook (index-first)

Per the step-4 selection:

- **First run / Append**: for each admitted candidate, do two writes in order:
  1. **Update the library INDEX first** — read `.specguard/notebook/<library>/INDEX.md`, append a new entry to its frontmatter `references` array `{ ref_id, file: <topic>.md, when: <one-line trigger condition> }`, and add a matching `- [<ref_id>](<topic>.md) — when: ...` line under `## Topics`. If the library has invariant-class or abstraction-class material extracted from this candidate, also append to `## Invariants` / `## Abstractions` (knowledge) or `## Decision Triggers` (skill) or `## Cmd Matrix / Llm Checks / Manual Checklists` (check) — those sections live in the INDEX, not the topic.
  2. **Write the topic file** at `.specguard/notebook/<library>/<topic>.md` with the frontmatter shown in step 6 plus the dense body.
  - Topic path exists → skip BOTH writes (append semantics; don't mutate human edits or sync content; ref_id auto-bump if a reference is needed for a different reason)
  - Topic path doesn't exist → create new (version=1)
- **Diff report**: skip writes, emit a markdown report:

  ```markdown
  # /sg-init-project diff report (YYYYMMDD)

  ## Suggested additions
  - K: <topic> — <one-line summary>
  - S: <topic> — <one-line summary>
  - C: <topic> — <one-line summary>

  ## Existing topics (unchanged)
  - K: <existing-topic>
  - ...

  ## Suggested merges (supersedes candidates)
  - Candidate <new-topic> overlaps existing <old-topic>; recommend the next /sg-sync-notebook take the supersedes path
  ```

### 9. Model self-confirmation

After writes complete, re-read every newly-written `.md` file AND the touched library `INDEX.md`:

- topic frontmatter matches `notebook-asset.schema.json` (kind: topic, scope: notebook.<library>, library matches scope, ref_id pattern `^[KSC]-\d{2}$` with axis matching library)
- the topic's `ref_id` appears in the library `INDEX.md.references` array (no orphan)
- the matching `## Topics` markdown line exists in the library INDEX
- topic body lists multiple stacks side-by-side (no single-stack lock-in)
- no verbatim README content
- run `specguard validate --notebook-only` — surfaces orphans / dead links / axis mismatches / duplicates (independent of any dateId)

Any inconsistency → halt with an error, prompt the user to fix. **Do not delete the written files** — let the user decide whether the issue is in frontmatter, INDEX entry, or body.

## Firewall

- Not invoked inside the state machine (project bootstrap only; orthogonal to the four-phase loop ask-plan / run-pipeline / sign-check / sync-notebook)
- Does not delete / overwrite existing notebook files — append semantics; topic changes go through `/sg-sync-notebook`'s supersedes path
- Doesn't copy README verbatim ("not a manual")
- Candidate examples must list multiple stacks side-by-side (CLAUDE.md hard rule #6)
- Doesn't create `.gitignore` (when the project lacks one — don't impose a git workflow; the CLI already has this behavior)
- AskUserQuestion ≤ 4 per batch; split when exceeding
