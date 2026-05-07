# CLAUDE.md — specguard collaboration constitution

> This is not a manual. The manual is [README.md](./README.md).
> This is the **map + protocol + pitfalls** for the AI. Read it and you should know which lines never to cross, where to look for authoritative answers when uncertain, and the *why* behind this project.

---

## Core philosophy (one-liner)

**The spec is a state machine in YAML; the AI autonomous window is bounded by slash commands; the CLI never touches the LLM; the plugin welds the state machine into Claude Code's runtime.**

The four-phase loop `/specguard:sg-spec-ask → /specguard:sg-plan-tasks → /specguard:sg-check-guard → /specguard:sg-sync-notebook` is a non-skippable state transition.
Every step produces verifiable YAML artifacts (`spec.yaml` / `plan.yaml` / `tasks.yaml` / `check.yaml`) plus distillable notebook assets (the K/S/C three libraries).
**Files are the state machine**: no database, no in-memory state, restart and you recover.

specguard is distributed as a **Claude Code Plugin**: the repo root is the plugin root; `.claude-plugin/plugin.json` + `skills/` + `hooks/` are the plugin trinity; packages/cli is the plugin's execution backend (hook scripts only exec the specguard CLI).

---

## Operating axioms

All specguard mechanisms exist to serve these 6 axioms; the KSC three libraries are merely the landing layer:

1. **Knowledge must be understood** — K library carries `## Abstractions` + Why footnotes, not a fact list
2. **Requirements must be aligned** — sg-spec-ask AskUserQuestion ≤ 4/batch; flush each answer to spec.yaml immediately
3. **Decisions must be explainable** — S library decision templates carry Why; ksc_check evidence ≤ 3 sentences/library
4. **Experience must be reused** — notebook persists across tasks; survives `rm -rf changes/<dateId>`
5. **Constraints must be tractable** — check.how priority cmd > llm > manual; one-shot execution (no retry); failure → new dateId
6. **Evaluation must be verifiable** — C library cmd/llm/manual triad; non-verifiable "constraints" don't enter the library

| K/S/C (schema) | Phase (SKILL.md)                | YAML artifact | Semantics (design) |
|----------------|---------------------------------|---------------|--------------------|
| **K** Knowledge | Alignment (`sg-spec-ask`)       | spec.yaml     | Facts              |
| **S** Skill     | Reasoning (`sg-plan-tasks`)     | plan.yaml + tasks.yaml | Decisions  |
| **C** Check     | Evaluation (`sg-check-guard`)   | check.yaml    | Constraints        |

The fourth phase **Distillation** (`/specguard:sg-sync-notebook`) closes the loop — it writes the run's lessons back into K/S/C; it doesn't bind to a single library, so it lives outside the table. This skill ALSO handles the bootstrap path (when notebook is empty, scan project to seed first-batch K/S/C topics) — there's no separate `sg-init-project` skill.

**Notebook scope is project, not task.** A line earns a K/S/C entry only if it survives task deletion: ask "would this still be useful after `rm -rf changes/<dateId>`?" — yes → notebook (K/S/C); no → spec/plan/tasks.yaml. Task-specific spec details (e.g. "this dateId implements OAuth with Google as the provider") belong to spec.yaml; project-level invariants (e.g. "the four-phase loop is non-skippable", "CLI never calls LLM") belong to K.

**Information-source boundary for K.** Domain-specific facts (business rules, internal terminology, project-specific conventions) MUST be user-provided. AI-inferred domain knowledge is rejected. Generic knowledge (language/framework facts queryable in public docs) may be AI-suggested but still requires user confirmation via AskUserQuestion before admission. The danger: LLMs hallucinate domain rules fluently and convincingly — once they pollute K, every downstream sg-check-guard uses a corrupted baseline.

Letters K/S/C are locked by schema; the three semantic layers coexist — pick by audience: schema / ref_id / file paths use K/S/C; each loop SKILL.md flags its phase up front (Alignment / Reasoning / Evaluation / Distillation), so phase names are the right shorthand for design discussion of the loop; internal trade-off discussions use Facts/Decisions/Constraints.

---

## Inviolable hard rules

### 1. The CLI and hook scripts never call the LLM

`packages/cli/` may not import any AI SDK (anthropic / openai / google-generative-ai / cohere / ...).
`hooks/scripts/*.sh` likewise must not call any LLM — they are thin shells over the specguard CLI (see hard rule #7).
All LLM inference must happen inside slash commands or subagents.

**Guardrail**: `npm run lint:no-ai-sdk` checks `packages/cli/package.json`. Red CI = refuse to merge.
**Reason**: capability scales by riding Claude Code's own evolution, not by binding to an SDK; the CLI + hook scripts retain the property of being purely deterministic programs.

### 2. The schema is frozen, `additionalProperties: false`

Authoritative files: `packages/cli/src/schemas/{spec,plan,tasks,check,notebook-asset,config}.schema.json`
Fields not listed there are rejected by AJV. **Want to add a field? Argue with the user first**, then change in three places consistently: schema → `lib/types.ts` types → the relevant slash command / CLI templates.
**Reason**: minimum-fields-only; expansion requires justification. Redundant fields are the start of cognitive rot.

`config.schema.json` is contract-grade too — change an enforcement field name / enum value, tell the user first.

### 3. The state machine is non-skippable

- `/sg-check-guard` MUST explicitly AskUserQuestion `[y/N]` for approve, with `signed_off=true` only set after explicit yes (no silent approve)
- The skill frontmatter MUST set `disable-model-invocation: true` to prevent the LLM from "deciding for itself" mid-conversation to skip spec-ask and jump straight to plan-tasks
- Cross-file id integrity: `spec.id == plan.id == tasks.id == check.id` (validate.ts:validateCrossFiles)
- Cross-file ref integrity: `tasks.tasks[].verify ∈ spec.checks[].id`; `check.check_results[].id ∈ spec.checks[].id`
- No orphan task directories: every `tasks/<id>/` must have a matching `tasks.yaml.tasks[].id` (validate.ts:checkOrphanTaskDirs)

### 4. `check.how` is a one-of YAML object (exactly 1 property)

- `{ cmd: [<program>, <arg>, ...] }` program form; the YAML array IS the spawn argv (**no shell**); e.g. `{ cmd: [npx, vitest, run, tests/x.test.ts] }` / `{ cmd: [pytest, -q, tests/test_x.py] }` / `{ cmd: [cargo, test, --test, foo] }` / `{ cmd: [go, test, ./pkg] }`
- `{ llm: <prompt> }` reasoning form
- `{ manual: <note> }` fallback

The schema expresses "exactly one property" via `type:object + minProperties:1 + maxProperties:1 + additionalProperties:false` — cmd must be a non-empty string array; llm / manual must be non-empty strings. **There is no string-prefix form**; the data shape IS the semantics — YAML array ≡ spawn argv, no split, no quote, no platform difference. Note: don't replace this contract with `oneOf [{cmd}, {llm}, {manual}]` — the semantics are equivalent but ajv errors get N× louder (each branch reports separately); known anti-pattern.
The spec model = clean entrypoint + script fallback: for pipe / chain / substitution / multi-step conditions, write a script file and invoke it from cmd (e.g. `{ cmd: [bash, scripts/check-foo.sh] }` / `{ cmd: [python, scripts/check_foo.py] }` / `{ cmd: [./scripts/check_foo] }`).
**Priority**: `cmd` > `llm` > `manual`. If `cmd` works, don't reach for `llm`.

### 5. Status changes flush immediately

Every status change in `tasks.yaml` / `check.yaml` is written to disk on the spot.
**Reason**: recoverable-on-unexpected-exit is the default behavior, not a nice-to-have.

### 6. Skills and docs stay technology-stack-agnostic

`skills/*/SKILL.md`, `README.md`, `CLAUDE.md`, `.specguard/notebook/*/<topic>.md` default to **any-language / any-build-system** projects.
You may NOT bake in single-stack artifacts:

- ❌ `"scan README.md, package.json"` (Node bias)
- ✅ `"scan README.md, the project root metadata file (e.g. package.json / pyproject.toml / Cargo.toml / go.mod / pom.xml)"`

`check.how.cmd` examples must list multiple ecosystems side-by-side (npx / pytest / cargo / go); never just one.
**Reason**: specguard's reuse value is exactly "drop it into any project and it holds". Bind a skill to a stack and it instantly degrades into a "Node tool".
**Exception**: `packages/cli/`'s own README / build scripts can be Node-specific — that's the implementation layer; skills / spec are the interface layer.

### 7. Hook scripts are CLI thin shells only

`hooks/scripts/*.sh` is allowed exactly ONE business line: `command -v specguard >/dev/null 2>&1 && exec specguard hook on-<name>`.
**Forbidden**: business logic in hook scripts, LLM calls, external tools like jq, conditional dispatch, YAML reads. Every decision lives in `packages/cli/src/commands/hook.ts`.
**Reason**: bash has cross-platform pitfalls and is hard to unit-test; logic in the CLI lets us reuse yaml-io / validate / config helpers and write tests.
**Guardrail**: when reviewing hook scripts, count business lines (excluding shebang); >1 = reject.

---

## File map

```
.claude-plugin/plugin.json            # Plugin manifest (name/description/version/author)
hooks/
├── hooks.json                       # PostToolUse / SessionStart / UserPromptSubmit registration
└── scripts/                         # ⚠️ each script has exactly 1 business line (hard rule #7)
    ├── on-yaml-write.sh
    ├── on-session-start.sh
    └── on-prompt-submit.sh
skills/                               # ⚠️ MUST be the <name>/SKILL.md subdirectory layout; the plugin auto-namespaces them as /specguard:<name>
├── sg-spec-ask/SKILL.md             # K — Alignment phase; produces spec.yaml
├── sg-plan-tasks/SKILL.md           # S — Reasoning phase; produces plan.yaml + tasks.yaml + tasks/<id>/{prompt.md, debug.log}
├── sg-check-guard/SKILL.md          # C — Evaluation phase; produces check.yaml + signed_off
└── sg-sync-notebook/SKILL.md        # Distillation phase; ALSO bootstrap (init mode when notebook empty)

packages/cli/src/
├── index.ts                         # commander entry; subcommands: validate / verify / init / config / hook
├── commands/
│   ├── validate.ts                  # schema + cross-file id/ref integrity + orphan task dir check + notebook integrity
│   ├── verify.ts                    # spawn how.cmd as an array (no shell); llm / manual stay pending; writes check.yaml
│   ├── init.ts                      # project init: readline picks enforcement + builds .specguard/ skeleton + writes config.yaml + maintains .gitignore (idempotent append of .specguard/changes/ exclusion; doesn't create .gitignore if the project lacks one)
│   ├── config.ts                    # config get / set; ajv-validates before write
│   └── hook.ts                      # three hook handlers: read stdin JSON + read config + decide exit code per enforcement
├── lib/
│   ├── yaml-io.ts                   # path helpers (specPath, planPath, tasksPath, checkPath, taskDir, taskPromptPath, taskDebugLogPath, configPath, notebookDir, notebookRootIndexPath, notebookLibraryIndexPath, notebookTopicPath) + parseDateId + listTaskDirs + readNotebookFrontmatter + parseRefId + NOTEBOOK_LIBRARIES + listNotebookTopicFiles
│   ├── config.ts                    # readConfig / writeConfig / effectiveEnforcement / defaultConfig
│   ├── status.ts                    # summarize() walks changes/ to derive spec/plan/tasks/check status + nextHint
│   ├── how.ts                       # check.how 3-form dispatch (cmd array / llm / manual)
│   ├── types.ts                     # SpecShape / PlanShape / TasksShape / CheckShape / ConfigShape / EnforcementLevel / HookName / NotebookAssetShape (IndexAssetShape | TopicAssetShape, discriminated by kind) / NotebookLibrary / NotebookScope / IndexReference
│   └── errors.ts                    # AJV-error humanization
└── schemas/                         # ⚠️ change here = change the contract; argue with the user first
    ├── spec.schema.json
    ├── plan.schema.json
    ├── tasks.schema.json
    ├── check.schema.json
    ├── config.schema.json           # enforcement + per-hook overrides
    └── notebook-asset.schema.json   # markdown frontmatter; kind: index | topic discriminator + conditional required (index → references; topic → ref_id + library); scope enum 4 values

packages/cli/test/                    # node:test unit tests (zero-dep; runs against dist/ as commonjs)
├── _helpers.js                      # enterTmp / leaveTmp / writeYaml / writeTaskDebug / HAPPY_SPEC_TEMPLATE / HAPPY_PLAN_TEMPLATE / HAPPY_TASKS_TEMPLATE / seedHealthyChange + writeNotebookFile / defaultRootIndexFm / defaultLibraryIndexFm / defaultTopicFm / seedHealthyNotebook
├── lib/how.test.js                  # parseHow dispatch
└── commands/
    ├── validate.test.js             # schema + cross-file integrity + orphan task dirs + notebook integrity
    └── verify.test.js               # spawn path + verdict; includes regression for "&& is a literal arg, not interpreted (no shell)"

.specguard/                           # ⚠️ structure under user projects; this repo also self-hosts using it
├── config.yaml                      # created by init; enforcement (strict|warn|off) + per-hook overrides
├── changes/{YYYYMMDD}-<id>/         # in-progress (dateId = directory name) — flat, no version subdirs
│   ├── spec.yaml                    # goal + asks + checks (with how)
│   ├── plan.yaml                    # files + approach + tradeoffs
│   ├── tasks.yaml                   # tasks definition + status (no attempts)
│   ├── check.yaml                   # check_results + verdict + signed_off + ksc_check
│   └── tasks/<task_id>/             # per-task subagent products (no r<n> attempt subdirs)
│       ├── prompt.md                # original prompt sent to the subagent
│       └── debug.log                # subagent execution output
└── notebook/                        # KSC project memory (committed to git; not ignored); INDEX-first three-tier (progressive disclosure)
    ├── INDEX.md                     # Top-level entry (fixed template, scope: notebook); @ links to the three library INDEXes
    ├── knowledge/
    │   ├── INDEX.md                 # K library entry: ## Invariants + ## Abstractions + ## Topics + frontmatter references[]
    │   └── <topic>.md               # Dense topic (ref_id K-NN; fetched on demand by spec-ask when an Invariant / Abstraction / trigger matches)
    ├── skill/
    │   ├── INDEX.md                 # S library entry: ## Decision Triggers + ## Topics + references[]
    │   └── <topic>.md               # Decision templates / reasoning frameworks / workflows (ref_id S-NN)
    └── check/
        ├── INDEX.md                 # C library entry: ## Cmd Matrix + ## Llm Checks + ## Manual Checklists + ## Topics + references[]
        └── <topic>.md               # Correctness criteria: cmd / llm yes-no / manual checklist / self-test framework (ref_id C-NN)
```

**Core YAML ↔ skill mapping**: spec.yaml ↔ /specguard:sg-spec-ask / plan.yaml + tasks.yaml ↔ /specguard:sg-plan-tasks / check.yaml ↔ /specguard:sg-check-guard (the verify CLI is invoked from inside sg-plan-tasks at the end of execution, writing check_results + initial verdict; sg-check-guard then reviews and adds ksc_check + signed_off).

**`/specguard:sg-sync-notebook` writes no per-dateId YAML** — its output goes to `.specguard/notebook/<library>/<topic>.md` (project KSC) AND updates the corresponding `<library>/INDEX.md.references` (index-first protocol; topic files without an INDEX entry are flagged as orphans by `validate.ts:validateNotebook`). Init-path topic frontmatter uses fixed `source_change_id: project-init`; sync-path topic frontmatter uses `source_change_id: <plan.id>` of the dateId being distilled. INDEX files are written by `specguard init` with `source_change_id: notebook-index` and never overwritten on re-init (idempotent, even with `--force`; protects user edits).

**Hook ↔ state-machine mapping**: `yaml-write` runs validate after a YAML under .specguard/changes/ is written; `session-start` injects `lib/status.ts:summarize()` output at session start (so the LLM knows where on the grid it stands); `prompt-submit` detects intent keywords and, when no in-progress change exists, nudges the user toward sg-spec-ask.

---

## Collaboration conventions

- **Aggressive rewrite over compatibility patches**: philosophy-level refactors default to wipe-and-rebuild; old code is form-only reference. No `@deprecated`, no `// removed: ...` shadow code.
- **Subagent isolation**: each task in `/sg-plan-tasks` runs in its own subagent to prevent context collapse.
- **Subagent self-check when stuck**: same error ≥ 3 times or thinking in circles → fail proactively, don't push through. Note: the skill-level retry mechanism is gone; subagent failure goes straight to `tasks.tasks[].status=failed`, then sg-check-guard routes to re-plan.
- **AskUserQuestion ≤ 4 per batch**: split when exceeding; each answer flushes back to the relevant yaml immediately (so an unexpected exit doesn't lose answers).
- **LLM judge: strict yes/no + ≤ 3 evidence sentences**: fuzzy cases lean strict (conservative — prefer over-failing).
- **KSC three-axis review**: at sg-check-guard time the LLM judges from K (does it violate the project map's abstractions / invariants / concept relations?), S (does it conflict with the project's way of thinking about this class of problem? decision templates), C (which correctness criterion from the C library got missed?). Evidence is segmented per axis. Each library owns its segment: K is "what the project looks like", S is "how to think", C is "how to tell right from wrong".
- **/specguard:sg-sync-notebook MUST be triggered manually**: never auto-invoke at signed_off.
- **Failure → new dateId, not retry**: when a dateId fails (verdict=re-plan / ksc-reject), do NOT modify its files further. Open a fresh dateId via `/sg-spec-ask` (e.g. `<today>-<id>-v2`). The old dateId stays as a counter-example archive.
- **Modifying `hooks/hooks.json` = changing the plugin interface contract**: tell the user first.
- **Modifying `config.schema.json` = changing the enforcement contract**: tell the user first.
- **Don't lightly tune enforcement defaults**: default `warn`, `prompt-submit` auto-downgrades to warn under strict — these are deliberated safe defaults; ask before changing.

---

## Pitfalls list

### 1. `skills/` MUST use the subdirectory layout

- ❌ `skills/sg-spec-ask.md` (loose files are **silently ignored** by Claude Code — the most dangerous failure mode: you think it's loaded, it isn't)
- ✅ `skills/sg-spec-ask/SKILL.md` (directory + fixed uppercase filename)

Note: under the plugin model, the path is `skills/` at the plugin root, not `.claude/skills/`. Once loaded, the namespace becomes `/specguard:sg-spec-ask` etc.

Authority: `https://code.claude.com/docs/en/custom-skills.md`

### 2. Skills MUST set `disable-model-invocation: true`

Otherwise the LLM, seeing context like "ok let's do it", may skip `/specguard:sg-spec-ask` and jump straight into `/specguard:sg-plan-tasks`, breaking the state machine contract. The frontmatter must declare it explicitly.

The `prompt-submit` hook is a **runtime backstop** for this rule — even if the LLM tries to bypass, the hook reminds (or blocks, depending on enforcement) when intent keywords match.

### 3. Schema `additionalProperties: false` is intentional

Newcomers seeing spec.yaml often want to add `metadata` / `tags` / `notes` fields.
**The answer is uniformly NO**: argue first, change the schema first.

### 4. Failure → new dateId, never retry within current dateId

When sg-check-guard returns verdict=`re-plan` or `ksc-reject`, the current `changes/<dateId>/` is not modified further. Open a NEW dateId via `/sg-spec-ask` for the redesign. Old dateIds stay on disk as counter-examples; they're useful inputs to `/sg-sync-notebook` distillation. Do not edit a sealed dateId in place — it ruins the failure archive.

### 5. /sg-sync-notebook is human-triggered, never auto on signed_off

Distilling into the memory library is a "value layer" operation; the human must decide when. Source-directory `rm -rf` only happens after model self-confirmation passes.

### 6. CLI argument is dateId, not id

`specguard validate <dateId>` / `specguard verify <dateId>`. dateId format: `{YYYYMMDD}-<kebab-id>`, e.g. `20260504-add-auth`. `yaml-io.ts:parseDateId` parses it. spec.id MUST equal the parsed id portion (and plan.id / tasks.id / check.id MUST equal spec.id).

### 7. CLI not on PATH = hooks silently no-op

`hooks/scripts/*.sh` is `command -v specguard ... || true`: if `@yupanzi/specguard` isn't installed globally, every hook **exits 0 with no stderr** — yaml-write / session-start / prompt-submit are nominally registered but enforce nothing. Schema violations slip through; no validation log; the user sees "the plugin is doing nothing".

When a user reports "I edited spec.yaml but nothing validated", the very first probe is `command -v specguard`.

---

## Current version boundary (v0.2.0)

v0.2.0 = the four-phase wipe-and-rebuild release. Key shifts from v0.1.0:

- Slash command renames (sg-ask-plan → sg-spec-ask / sg-run-pipeline → sg-plan-tasks / sg-sign-check → sg-check-guard; sg-sync-notebook unchanged)
- Skill consolidation (sg-init-project merged into sg-sync-notebook as the init-when-empty path)
- YAML reorganization (plan.yaml split into spec/plan/tasks; pipeline.yaml deleted)
- Directory flattening (no v1/v2/ subdirs, no logs/r<n>/ subdirs)
- Retry mechanism removed (no r1/r2/r3; failure → new dateId)
- Schema rules updated (added cross-file integrity + orphan task dir check; removed monotonic n / attempts ceiling / freeze integrity)

The following are **out of scope**; the AI must NOT add them on its own:

- A `spec.failure_class` field (redundant with `ksc_check.evidence`; hard rule #2 minimum-fields)
- Auto-attribution logic for KSC (programmatic failure-mode classification)
- Auto-injecting notebook into the next spec ("crystallize as template" automation)
- Notebook asset staleness detection (auto-flagging K-library references whose source code drifted)
- Cross-language sample projects e2e (verification, not a deliverable)
- A `notebook` CLI subcommand (distillation is owned by `/specguard:sg-sync-notebook`; the CLI reuses validate to check frontmatter)
- Plugin telemetry / hook retry / fallback chain (post v0.2.x territory)
- `specguard config set` dotted paths beyond the `enforcement` and `hooks.<name>` categories (don't widen to arbitrary YAML paths)
- Reintroducing version subdirectories or attempt retry mechanisms (v0.2.0 deliberately removed these)

**v0.2.1 roadmap**: notebook auto-injection into the next spec + auto-attribution logic for KSC + asset staleness detection.

If you find something "obviously needed but not above", ASK before opening the gate.

---

## Pre-collaboration probe

Run through this before touching anything:

- [ ] Modifying `packages/cli/`? Run `npm run lint:no-ai-sdk` + `npm run build` + `npm test`; all three must pass.
- [ ] Modifying lib logic, schema, or commands behavior? Add tests under `packages/cli/test/` (node:test, zero-dep); new branches must have coverage.
- [ ] Modifying the `.gitignore` maintenance logic in `init.ts`? Stay idempotent (line-exact match for `.specguard/changes/`) + don't create `.gitignore` when the project lacks one (don't impose a git workflow).
- [ ] Modifying `schemas/*.json` (incl. `config.schema.json`)? This is a contract-grade change — **tell the user first**, list the impact surface, then move.
- [ ] Modifying `hooks/hooks.json` or `.claude-plugin/plugin.json`? Plugin interface contract; tell the user first.
- [ ] Modifying `hooks/scripts/*.sh`? Stay at 1 business line (hard rule #7); all logic lives in `commands/hook.ts`.
- [ ] Adding a new slash command? Always `skills/<name>/SKILL.md` + `disable-model-invocation: true`; never `.claude/skills/` (deprecated).
- [ ] Modifying skill or README/CLAUDE "examples"? Check whether examples bind to a stack (single mention of `package.json` / `npm` / `Cargo.toml`) — that violates hard rule #6.
- [ ] Approaching the v0.2.0 boundary (above section)? Stop and confirm whether this should land in v0.2.1.
- [ ] Writing YAML? Cut every field not in the schema. Each phase writes its own yaml only (sg-spec-ask → spec.yaml; sg-plan-tasks → plan.yaml + tasks.yaml; sg-check-guard → check.yaml).
- [ ] Adding hook handler behavior? Reuse `lib/config.ts:effectiveEnforcement` for enforcement parsing; don't hardcode level checks in hook.ts.
- [ ] Fixing a bug? Read `.specguard/notebook/INDEX.md` first, then drill down per the match-then-fetch protocol described in `/specguard:sg-spec-ask` (don't read every topic upfront).

---

## Notebook (project memory)

@.specguard/notebook/INDEX.md
