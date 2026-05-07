---
name: sg-sync-notebook
description: Two-mode skill — (init mode) when notebook is empty, scan project to seed K/S/C topics; (sync mode) when notebook has content, distill lessons from approved changes/<dateId>/ into K/S/C, then model self-confirms before rm-ing the source directory
disable-model-invocation: true
---

# /sg-sync-notebook

**Distillation phase** of the four-phase loop (closes the loop by writing K/S/C lessons back into the notebook; not bound to a single library). Manually-triggered project memory write. **Never invoked automatically on approve.**

## Two paths — one skill

This skill **detects** which path to walk based on notebook state:

- **Init path** (notebook is empty): seed the three libraries with first-batch topics by scanning the project itself. Triggered when `.specguard/notebook/INDEX.md` doesn't exist OR all three library INDEXes have `references: []` and empty `##` body sections.
- **Sync path** (notebook is non-empty): distill lessons from a specific approved dateId into the existing libraries. Triggered when at least one INDEX has any references OR body entries.

`source_change_id` distinguishes:
- Init-path topics: `source_change_id: project-init`
- Sync-path topics: `source_change_id: <plan.id>` (the dateId's id portion)

---

## Init path (notebook bootstrap)

Use this path when first dropping specguard into an existing project.

### 1. Verify notebook is empty (or absent)

If `.specguard/notebook/INDEX.md` exists AND any library INDEX has non-empty `references[]` or non-empty `##` body sections → STOP, the user meant the sync path; ask for a `<dateId>` argument.

### 2. Scan project priors

Read in order:
- `README.md` (project intent / domain language)
- The project's metadata file at root (e.g. `package.json` / `pyproject.toml` / `Cargo.toml` / `go.mod` / `pom.xml`) — extract dependencies, scripts, build invariants
- `CLAUDE.md` (if present) — project-specific collaboration rules
- Top-level source layout (single `ls` of `src/` or equivalent) — major modules

### 3. Draft first-batch K/S/C topic candidates

Each candidate falls into one library:

- **K (Knowledge)**: project-level abstractions, invariants, concept relations exposed by the codebase (e.g. "the CLI never imports any AI SDK", "schema is frozen `additionalProperties: false`")
- **S (Skill)**: how to think when working on this project — decision templates, workflows (e.g. "to add a new yaml field, change schema → types.ts → SKILL.md in three places consistently")
- **C (Check)**: what's right and how to tell — cmd / llm yes-no / manual checklists (e.g. "the project's lint guard must pass before merge"; the actual cmd is whatever the project's standard lint script is)

### 4. AskUserQuestion review (≤ 4 per batch)

For each candidate:
- "Admit K candidate `cli-no-ai-sdk-rule` to notebook?"
- Domain-specific facts MUST be user-confirmed (LLMs hallucinate domain rules fluently — once they pollute K, every downstream sg-check-guard uses a corrupted baseline)
- Generic-knowledge candidates (language/framework facts queryable in public docs) may be AI-suggested but still need user confirm

### 5. Write to notebook (index-first, two-step)

Write `.specguard/notebook/INDEX.md` (root entry, with @-links to three library INDEXes) using `source_change_id: notebook-index`.

For each admitted candidate: see Sync path step 5 below for the index-first protocol — same procedure, but `source_change_id: project-init`.

### 6. Self-confirm + done

`specguard validate --notebook-only` must surface zero notebook errors. **Do NOT delete any source** — init path doesn't touch `changes/`.

Init complete. Future `/sg-sync-notebook <dateId>` invocations will go down the sync path.

---

## Sync path (per-dateId distillation)

Use this path when a dateId has been approved (`check.yaml.signed_off = true`) and you want to extract its lessons.

### 1. Verify approved

User passes `<dateId>` argument (e.g. `20260504-add-auth`). Read `.specguard/changes/{dateId}/check.yaml`. **`signed_off` MUST be `true`.** Otherwise error out.

### 2. Read the dateId's full record

No version subdirectories anymore. Read directly:

- `.specguard/changes/{dateId}/spec.yaml` — what was the goal + acceptance criteria
- `.specguard/changes/{dateId}/plan.yaml` — what was the design intent (files + approach + tradeoffs)
- `.specguard/changes/{dateId}/tasks.yaml` — what tasks ran, and their final status
- `.specguard/changes/{dateId}/check.yaml` — final verdict + ksc_check evidence
- `.specguard/changes/{dateId}/tasks/<taskId>/{prompt.md, debug.log}` — per-task subagent prompts and execution traces (rich source for distilling failure-mode patterns when a task initially struggled)

### 3. LLM distills candidate assets

**Two firewalls before extracting any candidate** (rules + rationale: CLAUDE.md Operating axioms § Notebook scope / Information-source boundary):

1. **Scope test** — would this distilled fact survive `rm -rf changes/<dateId>` and help the *next* task? Sync-specific watch-out: distill the *project-level lesson*, not the event. ❌ "this dateId's task t2 failed because endpoint X returned 502" → ✅ "endpoint X is rate-limited on the free tier — back off or switch plan". The event is task scope; the lesson is project scope.
2. **Source test** — for K candidates, anything inferred from logs / plan content that looks domain-specific (business rule, internal convention) MUST be surfaced in step 4 as an AskUserQuestion ("I observed X — is this a project-level rule?"), never silently admitted.

The LLM extracts three categories:

- **Knowledge / Map** — project core abstractions, invariants, concept relations exposed by this change (macro, "what the project looks like"; not an event-by-event diary)
- **Skill / Way of working** — teach the AI to think like a person solving the problem: decision templates, reasoning frameworks, workflows ("how to think when running into a class-Y problem")
- **Check / Correctness criteria** — what's right and how to tell: cmd / llm yes-no / manual checklist / self-test framework ("how to know we got it right")

Each candidate is a **topic** (kind: topic) carrying frontmatter per `notebook-asset.schema.json`:

```yaml
---
topic: <kebab-case-topic>
kind: topic
scope: notebook.<library>          # notebook.knowledge | notebook.skill | notebook.check
library: knowledge | skill | check  # must match scope suffix
ref_id: <K-NN | S-NN | C-NN>        # axis matches library; next available NN per library
version: 1
source_change_id: <plan.id>          # init path uses "project-init" instead
source_date: <YYYYMMDD>
supersedes: []                       # if merging existing assets, list the old source_change_id
---

# Body (markdown, technology-stack-agnostic)
```

Body examples must list **multiple stacks side-by-side** (don't lock in to a single ecosystem):
- Check examples: `npx vitest` / `pytest` / `cargo test` / `go test`
- Metadata file examples: `package.json` / `pyproject.toml` / `Cargo.toml` / `go.mod` / `pom.xml`

**Cross-domain invariants and decision triggers belong in the library INDEX**, not in topic bodies. If a distilled fact is "this rule applies project-wide regardless of domain" (e.g. "any NOT NULL migration must backfill"), it goes into `<library>/INDEX.md`'s `## Invariants` / `## Decision Triggers` section — that's where future `/sg-spec-ask` calls will see it without fetching any topic.

### 4. AskUserQuestion review

Batched, ≤ 4 per batch. Sample questions:

- "Admit K candidate 'cli-no-ai-sdk-rule' to notebook?"
- "S candidate 'subagent-isolation-pattern' — topic name suggestion?"
- "Merge C candidate 'lint-no-ai-sdk-cmd' into existing 'lint-checks.md'?"

### 5. Write to notebook (index-first, two-step)

For each admitted candidate, write in this order:

1. **Library INDEX update first** — read `.specguard/notebook/<library>/INDEX.md`:
   - If the candidate is **cross-domain invariant / decision trigger / cmd matrix entry**: append directly to the relevant `##` section in the body (no topic file produced for this kind of distillation; INDEX is the home).
   - If the candidate is a **topic-shaped distillation**: append a `{ ref_id, file, when }` entry to frontmatter `references` array, AND a `- [<ref_id>](<topic>.md) — when: ...` line under `## Topics`. ref_id assignment: re-read the array and pick the next axis-conforming integer (K-NN / S-NN / C-NN), zero-padded.
2. **Topic file write** at `.specguard/notebook/<library>/<topic>.md`:
   - Path doesn't exist → new (version=1)
   - Path exists → version+1, frontmatter adds `supersedes: [<old source_change_id>]`; the INDEX reference's `file` field stays the same (still points at the same path), but its `when` may be refreshed.

**The two writes happen in this exact order** — INDEX first, topic second. If the topic write fails, validate's orphan check still surfaces it on the next `specguard validate` call. If the INDEX write fails, no topic gets created (atomicity at the candidate level).

### 6. Model self-confirmation

Re-read every newly-written notebook file AND every touched library `INDEX.md`, verifying:
- topic frontmatter matches `notebook-asset.schema.json` (kind: topic, scope: notebook.<library>, library matches scope, ref_id pattern, axis matches library)
- the topic's `ref_id` appears in `<library>/INDEX.md.references` (no orphan)
- the `## Topics` markdown line for the topic exists in the INDEX
- INDEX `references` is duplicate-free; INDEX-only invariant / trigger entries are non-duplicate too
- content matches the user's reviewed intent
- body lists multiple stacks side-by-side (no single-stack lock-in)
- run `specguard validate --notebook-only` — must surface zero notebook errors (orphans / dead links / axis mismatches / duplicates)

Any inconsistency → halt with an error (**do not delete the source directory**); the user steps in to correct.

### 7. Clean up the source directory

Once verified:

```bash
rm -rf .specguard/changes/<dateId>/
```

Source directory gone = change cycle closed. The lessons live on in K/S/C; the per-task trace lives on in `git history`.

## Firewall

- The three libraries' markdown body must be **technology-stack-agnostic** — examples must not lock to one ecosystem
- Any step failure → don't delete the source directory (preserve distillation material)
- User rejects a candidate → don't write that one to notebook, but continue distilling the others
- Must be invoked manually; never auto-triggered on `/sg-check-guard` signed_off (human in the loop)
- Init path NEVER deletes anything from `changes/` (init path only writes to `notebook/`)
- Sync path NEVER touches another dateId's source files; it only reads the supplied `<dateId>` and only deletes that one
