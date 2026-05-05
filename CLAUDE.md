# CLAUDE.md — specguard collaboration constitution

> This is not a manual. The manual is [README.md](./README.md).
> This is the **map + protocol + pitfalls** for the AI. Read it and you should know which lines never to cross, where to look for authoritative answers when uncertain, and the *why* behind this project.

---

## Core philosophy (one-liner)

**The spec is a state machine in YAML; the AI autonomous window is bounded by slash commands; the CLI never touches the LLM; the plugin welds the state machine into Claude Code's runtime.**

The four-phase loop `/specguard:sg-ask-plan → /specguard:sg-run-pipeline → /specguard:sg-sign-check → /specguard:sg-sync-notebook` is a non-skippable state transition.
Every step produces verifiable YAML artifacts (`plan.yaml` / `pipeline.yaml` / `check.yaml`) plus distillable notebook assets (the K/S/C three libraries).
**Files are the state machine**: no database, no in-memory state, restart and you recover.

specguard is distributed as a **Claude Code Plugin**: the repo root is the plugin root; `.claude-plugin/plugin.json` + `skills/` + `hooks/` are the plugin trinity; packages/cli is the plugin's execution backend (hook scripts only exec the specguard CLI).

---

## Inviolable hard rules

### 1. The CLI and hook scripts never call the LLM

`packages/cli/` may not import any AI SDK (anthropic / openai / google-generative-ai / cohere / ...).
`hooks/scripts/*.sh` likewise must not call any LLM — they are thin shells over the specguard CLI (see hard rule #7).
All LLM inference must happen inside slash commands or subagents.

**Guardrail**: `npm run lint:no-ai-sdk` checks `packages/cli/package.json`. Red CI = refuse to merge.
**Reason**: capability scales by riding Claude Code's own evolution, not by binding to an SDK; the CLI + hook scripts retain the property of being purely deterministic programs.

### 2. The schema is frozen, `additionalProperties: false`

Authoritative files: `packages/cli/src/schemas/{plan,pipeline,check,notebook-asset,config}.schema.json`
Fields not listed there are rejected by AJV. **Want to add a field? Argue with the user first**, then change in three places consistently: schema → `lib/types.ts` types → the relevant slash command / CLI templates.
**Reason**: minimum-fields-only; expansion requires justification. Redundant fields are the start of cognitive rot.

`config.schema.json` is contract-grade too — change an enforcement field name / enum value, tell the user first.

### 3. The state machine is non-skippable

- `/sg-sign-check` MUST explicitly AskUserQuestion `[y/N]` for approve, with verdict ∈ `{done}` (no silent approve)
- The skill frontmatter MUST set `disable-model-invocation: true` to prevent the LLM from "deciding for itself" mid-conversation to skip ask-plan and jump straight to run-pipeline
- `attempt n` is monotonically non-decreasing (`validate.ts:checkMonotonicN`)
- Once v1 is frozen, only append v2/, never touch v1 (`validate.ts:checkFreezeIntegrity`)
- Loop ceiling 3: `pipeline.attempts.length ≤ 3` and `check.attempts.length ≤ 3`; violations error out

### 4. `check.how` is a one-of YAML object (exactly 1 property)

- `{ cmd: [<program>, <arg>, ...] }` program form; the YAML array IS the spawn argv (**no shell**); e.g. `{ cmd: [npx, vitest, run, tests/x.test.ts] }` / `{ cmd: [pytest, -q, tests/test_x.py] }` / `{ cmd: [cargo, test, --test, foo] }` / `{ cmd: [go, test, ./pkg] }`
- `{ llm: <prompt> }` reasoning form
- `{ manual: <note> }` fallback

The schema expresses "exactly one property" via `type:object + minProperties:1 + maxProperties:1 + additionalProperties:false` — cmd must be a non-empty string array; llm / manual must be non-empty strings. **There is no string-prefix form**; the data shape IS the semantics — YAML array ≡ spawn argv, no split, no quote, no platform difference. Note: don't replace this contract with `oneOf [{cmd}, {llm}, {manual}]` — the semantics are equivalent but ajv errors get N× louder (each branch reports separately); known anti-pattern.
The spec model = clean entrypoint + script fallback: for pipe / chain / substitution / multi-step conditions, write a script file and invoke it from cmd (e.g. `{ cmd: [bash, scripts/check-foo.sh] }` / `{ cmd: [python, scripts/check_foo.py] }` / `{ cmd: [./scripts/check_foo] }`).
**Priority**: `cmd` > `llm` > `manual`. If `cmd` works, don't reach for `llm`.

### 5. Status changes flush immediately

Every status change in `pipeline.yaml` / `check.yaml` is written to disk on the spot.
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
├── sg-init-project/SKILL.md          # project bootstrap entry; outside the state machine (orthogonal to the four-phase loop)
├── sg-ask-plan/SKILL.md
├── sg-run-pipeline/SKILL.md
├── sg-sign-check/SKILL.md
└── sg-sync-notebook/SKILL.md

packages/cli/src/
├── index.ts                         # commander entry; subcommands: validate / verify / init / config / hook
├── commands/
│   ├── validate.ts                  # schema + reference integrity + n monotonicity + attempts.length ≤ 3 + freeze integrity
│   ├── verify.ts                    # spawn how.cmd as an array (no shell); llm / manual stay pending; writes check.yaml
│   ├── init.ts                      # project init: readline picks enforcement + builds .specguard/ skeleton + writes config.yaml + maintains .gitignore (idempotent append of .specguard/changes/ exclusion; doesn't create .gitignore if the project lacks one)
│   ├── config.ts                    # config get / set; ajv-validates before write
│   └── hook.ts                      # three hook handlers: read stdin JSON + read config + decide exit code per enforcement
├── lib/
│   ├── yaml-io.ts                   # path helpers (dateId, version, configPath, notebookDir, notebookRootIndexPath, notebookLibraryIndexPath, notebookTopicPath) + parseDateId + activeVersion + listVersions + readNotebookFrontmatter + parseRefId + NOTEBOOK_LIBRARIES + listNotebookTopicFiles
│   ├── config.ts                    # readConfig / writeConfig / effectiveEnforcement / defaultConfig
│   ├── status.ts                    # summarize() walks changes/ to derive plan/pipeline/check status + nextHint
│   ├── how.ts                       # check.how 3-form dispatch (cmd array / llm / manual)
│   ├── types.ts                     # PlanShape / PipelineShape / CheckShape / ConfigShape / EnforcementLevel / HookName / NotebookAssetShape (IndexAssetShape | TopicAssetShape, discriminated by kind) / NotebookLibrary / NotebookScope / IndexReference
│   └── errors.ts                    # AJV-error humanization
└── schemas/                         # ⚠️ change here = change the contract; argue with the user first
    ├── plan.schema.json
    ├── pipeline.schema.json
    ├── check.schema.json
    ├── config.schema.json           # enforcement + per-hook overrides
    └── notebook-asset.schema.json   # markdown frontmatter; kind: index | topic discriminator + conditional required (index → references; topic → ref_id + library); scope enum 4 values

packages/cli/test/                    # node:test unit tests (zero-dep; runs against dist/ as commonjs)
├── _helpers.js                      # enterTmp / leaveTmp / writeYaml / HAPPY_PLAN_TEMPLATE + writeNotebookFile / defaultRootIndexFm / defaultLibraryIndexFm / defaultTopicFm / seedHealthyNotebook
├── lib/how.test.js                  # parseHow dispatch
└── commands/
    ├── validate.test.js             # schema + business rules; includes regression for "empty cmd / both keys / non-object how → exactly one precise error"
    └── verify.test.js               # spawn path + verdict; includes regression for "&& is a literal arg, not interpreted (no shell)"

.specguard/                           # ⚠️ structure under user projects; this repo also self-hosts using it
├── config.yaml                      # created by init; enforcement (strict|warn|off) + per-hook overrides
├── changes/{YYYYMMDD}-<id>/         # in-progress (dateId = directory name)
│   ├── v1/                          # frozen on KSC / approve reject (plan/pipeline/check + logs untouched)
│   │   ├── plan.yaml pipeline.yaml check.yaml
│   │   └── logs/r<n>/<task_id>.log  # one directory per attempt (max r3)
│   └── v2/                          # parallel new version under the same dateId
│       └── ...
└── notebook/                        # KSC project memory (committed to git; not ignored); INDEX-first three-tier (progressive disclosure)
    ├── INDEX.md                     # Top-level entry (fixed template, scope: notebook); @ links to the three library INDEXes
    ├── knowledge/
    │   ├── INDEX.md                 # K library entry: ## Invariants + ## Abstractions + ## Topics + frontmatter references[]
    │   └── <topic>.md               # Dense topic (ref_id K-NN; fetched on demand by ask-plan when an Invariant / Abstraction / trigger matches)
    ├── skill/
    │   ├── INDEX.md                 # S library entry: ## Decision Triggers + ## Topics + references[]
    │   └── <topic>.md               # Decision templates / reasoning frameworks / workflows (ref_id S-NN)
    └── check/
        ├── INDEX.md                 # C library entry: ## Cmd Matrix + ## Llm Checks + ## Manual Checklists + ## Topics + references[]
        └── <topic>.md               # Correctness criteria: cmd / llm yes-no / manual checklist / self-test framework (ref_id C-NN)
```

**Core YAML ↔ skill 1:1 mapping**: plan.yaml ↔ /specguard:sg-ask-plan / pipeline.yaml ↔ /specguard:sg-run-pipeline / check.yaml ↔ /specguard:sg-sign-check (verify CLI writes first, then /specguard:sg-sign-check appends ksc_check + approved).

**`/specguard:sg-init-project` writes no YAML** — a project bootstrap action outside the state machine; output goes to `.specguard/notebook/<library>/<topic>.md` (project-specific KSC seed) AND updates the corresponding `<library>/INDEX.md.references` (index-first protocol; topic files without an INDEX entry are flagged as orphans by `validate.ts:validateNotebook`). The topic frontmatter uses fixed `source_change_id: project-init`. INDEX files are written by `specguard init` with `source_change_id: notebook-index` and never overwritten on re-init (idempotent, even with `--force`; protects user edits).

**Hook ↔ state-machine mapping**: `yaml-write` runs validate after a YAML under .specguard/changes/ is written; `session-start` injects `lib/status.ts:summarize()` output at session start (so the LLM knows where on the grid it stands); `prompt-submit` detects intent keywords and, when no in-progress change exists, nudges the user toward sg-ask-plan.

---

## Collaboration conventions

- **Aggressive rewrite over compatibility patches**: philosophy-level refactors default to wipe-and-rebuild; old code is form-only reference. No `@deprecated`, no `// removed: ...` shadow code.
- **Subagent isolation**: each task in `/sg-run-pipeline` runs in its own subagent to prevent context collapse.
- **Subagent self-check when stuck**: same error ≥ 3 times or thinking in circles → fail proactively, don't push through.
- **AskUserQuestion ≤ 4 per batch**: split when exceeding; each answer flushes back to plan.yaml immediately (so an unexpected exit doesn't lose answers).
- **LLM judge: strict yes/no + ≤ 3 evidence sentences**: fuzzy cases lean strict (conservative — prefer over-failing).
- **KSC three-axis review**: at sg-sign-check time the LLM judges from K (does it violate the project map's abstractions / invariants / concept relations?), S (does it conflict with the project's way of thinking about this class of problem? decision templates), C (which correctness criterion from the C library got missed?). Evidence is segmented per axis. Each library owns its segment: K is "what the project looks like", S is "how to think", C is "how to tell right from wrong".
- **/specguard:sg-sync-notebook MUST be triggered manually**: never auto-invoke at approve.
- **Modifying `hooks/hooks.json` = changing the plugin interface contract**: tell the user first.
- **Modifying `config.schema.json` = changing the enforcement contract**: tell the user first.
- **Don't lightly tune enforcement defaults**: default `warn`, `prompt-submit` auto-downgrades to warn under strict — these are deliberated safe defaults; ask before changing.

---

## Pitfalls list

### 1. `skills/` MUST use the subdirectory layout

- ❌ `skills/sg-ask-plan.md` (loose files are **silently ignored** by Claude Code — the most dangerous failure mode: you think it's loaded, it isn't)
- ✅ `skills/sg-ask-plan/SKILL.md` (directory + fixed uppercase filename)

Note: under the plugin model, the path is `skills/` at the plugin root, not `.claude/skills/`. Once loaded, the namespace becomes `/specguard:sg-ask-plan` etc.

Authority: `https://code.claude.com/docs/en/custom-skills.md`

### 2. Skills MUST set `disable-model-invocation: true`

Otherwise the LLM, seeing context like "ok let's do it", may skip `/specguard:sg-ask-plan` and jump straight into `/specguard:sg-run-pipeline`, breaking the state machine contract. The frontmatter must declare it explicitly.

The `prompt-submit` hook is a **runtime backstop** for this rule — even if the LLM tries to bypass, the hook reminds (or blocks, depending on enforcement) when intent keywords match.

### 3. Schema `additionalProperties: false` is intentional

Newcomers seeing plan.yaml often want to add `metadata` / `tags` / `notes` fields.
**The answer is uniformly NO**: argue first, change the schema first.

### 4. After v1 freezes, only append v2/, never touch v1

When KSC or approve rejects, v1/{plan,pipeline,check}.yaml + logs/ MUST stay byte-identical. The new plan opens `v2/` under the same dateId (**don't create a new top-level dateId directory**). validate enforces this: when v2 exists, v1's three artifacts must all be present; missing one = reject.

### 5. Loop ceiling 3; if attempt 3 still fails, stop

sg-run-pipeline retries at most 3 times internally. If attempt 3 still fails → write verdict=`re-plan` to check.yaml and **do not invoke sg-sign-check** — a machine-layer fail goes straight to v2 decision. validate enforces `attempts.length ≤ 3` to prevent "fake-4th attempts".

### 6. /sg-sync-notebook is human-triggered, never auto on approve

Distilling into the memory library is a "value layer" operation; the human must decide when. Source-directory `rm -rf` only happens after model self-confirmation passes.

### 7. CLI argument is dateId, not id

`specguard validate <dateId>` / `specguard verify <dateId>`. dateId format: `{YYYYMMDD}-<kebab-id>`, e.g. `20260504-add-auth`. `yaml-io.ts:parseDateId` parses it. plan.id MUST equal the parsed id portion.

---

## Current version boundary (v0.1.0)

v0.1.0 = Claude Code Plugin form. The `.claude-plugin/` + `hooks/` + `skills/` trinity is in place; 3 hooks (yaml-write / session-start / prompt-submit) + 3 enforcement levels (strict / warn / off) + 2-tier override (global / per-hook). CLI subcommands: `init` / `config` / `validate` / `verify` / `hook`. `init` auto-maintains `.gitignore` (deterministic; doesn't create `.gitignore` when the project lacks one). `/specguard:sg-init-project` skill scans the project to seed KSC notebook on top of the deterministic skeleton.

The following are **out of scope**; the AI must NOT add them on its own:

- A `plan.failure_class` field (redundant with `ksc_check.evidence`; hard rule #2 minimum-fields)
- Auto-attribution logic for KSC (programmatic failure-mode classification)
- Auto-injecting notebook into the next plan ("crystallize as template" automation)
- Notebook asset staleness detection (auto-flagging K-library references whose source code drifted)
- Cross-language sample projects e2e (verification, not a deliverable)
- A `notebook` CLI subcommand (distillation is owned by `/specguard:sg-sync-notebook`; the CLI reuses validate to check frontmatter)
- Plugin telemetry / hook retry / fallback chain (post v0.1.x territory)
- `specguard config set` dotted paths beyond the `enforcement` and `hooks.<name>` categories (don't widen to arbitrary YAML paths)

**v0.1.1 roadmap**: notebook auto-injection into the next plan + auto-attribution logic for KSC + asset staleness detection.

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
- [ ] Approaching the v0.1.0 boundary (above section)? Stop and confirm whether this should land in v0.1.1.
- [ ] Writing YAML? Cut every field not in the schema.
- [ ] Adding hook handler behavior? Reuse `lib/config.ts:effectiveEnforcement` for enforcement parsing; don't hardcode level checks in hook.ts.
- [ ] Fixing a bug? Read `.specguard/notebook/INDEX.md` first, then drill down per the match-then-fetch protocol described in `/specguard:sg-ask-plan` (don't read every topic upfront).

---

## Notebook (project memory)

@.specguard/notebook/INDEX.md
