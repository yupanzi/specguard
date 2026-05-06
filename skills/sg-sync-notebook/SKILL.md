---
name: sg-sync-notebook
description: Manually triggered; distill K/S/C assets from approved changes/<dateId>/v* into .specguard/notebook/{knowledge,skill,check}/, then model self-confirms before rm-ing the source directory
disable-model-invocation: true
---

# /sg-sync-notebook

**Distillation phase** of the four-phase loop (closes the loop by writing K/S/C lessons back into the notebook; not bound to a single library). Manually-triggered project memory distillation. **Never invoked automatically on approve.**

## Preconditions

- User passes a `<dateId>` argument (e.g. `20260504-add-auth`)
- That dateId's active version `check.yaml` contains `approved: true`

## Flow

### 1. Verify approved

Read `<dateId>/v<active>/check.yaml`. The last attempt must have `approved: true`. Otherwise error out.

### 2. Walk all versions

Use the CLI helper `listVersions(dateId)` to get the full sorted version array:
- Last version (v<active>) = **positive material** (the successful path that got approved)
- All earlier versions = **negative material** (KSC / approve rejected; "don't do it this way" reference points)

### 3. LLM distills candidate assets

**Two firewalls before extracting any candidate** (rules + rationale: CLAUDE.md Operating axioms § Notebook scope / Information-source boundary):

1. **Scope test** — would this distilled fact survive `rm -rf changes/<dateId>` and help the *next* task? Sync-specific watch-out: distill the *project-level lesson*, not the event. ❌ "v1 attempt 2 failed because endpoint X returned 502" → ✅ "endpoint X is rate-limited on the free tier — back off or switch plan". The event is task scope; the lesson is project scope.
2. **Source test** — for K candidates, anything inferred from logs / plan content that looks domain-specific (business rule, internal convention) MUST be surfaced in step 4 as an AskUserQuestion ("I observed X — is this a project-level rule?"), never silently admitted.

Read every version's plan/pipeline/check.yaml + logs/. The LLM extracts three categories:

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
source_change_id: <plan.id>
source_date: <YYYYMMDD>
supersedes: []                      # if merging existing assets, list the old source_change_id
---

# Body (markdown, technology-stack-agnostic)
```

Body examples must list **multiple stacks side-by-side** (don't lock in to a single ecosystem):
- Check examples: `npx vitest` / `pytest` / `cargo test` / `go test`
- Metadata file examples: `package.json` / `pyproject.toml` / `Cargo.toml` / `go.mod` / `pom.xml`

**Cross-domain invariants and decision triggers belong in the library INDEX**, not in topic bodies. If a distilled fact is "this rule applies project-wide regardless of domain" (e.g. "any NOT NULL migration must backfill"), it goes into `<library>/INDEX.md`'s `## Invariants` / `## Decision Triggers` section — that's where future ask-plan calls will see it without fetching any topic.

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

Source directory gone = change cycle closed.

## Firewall

- The three libraries' markdown body must be **technology-stack-agnostic** — examples must not lock to one ecosystem
- Any step failure → don't delete the source directory (preserve distillation material)
- User rejects a candidate → don't write that one to notebook, but continue distilling the others
- Must be invoked manually; never auto-triggered on `/sg-sign-check` approve (human in the loop)
