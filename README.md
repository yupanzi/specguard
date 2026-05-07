# specguard

Spec-guarded AI workflow, distributed as a **Claude Code Plugin**. Four-phase loop: **spec-ask → plan-tasks → check-guard → sync-notebook**. The plugin welds the state machine into Claude Code's runtime via hooks.

> Collaboration philosophy, hard rules, pitfalls, and scope boundaries live in [CLAUDE.md](./CLAUDE.md). This file only covers usage.

## Status

`v0.2.0` — wipe-and-rebuild release. Four phases collapse to four skills (no separate bootstrap); `plan.yaml` v0.1.0 is split into `spec.yaml + plan.yaml + tasks.yaml`; `pipeline.yaml` is gone (no retry mechanism); directory is flat (no `v1/v2/`, no `logs/r<n>/`). Per-task prompts now persist at `tasks/<id>/prompt.md`. See [CHANGELOG.md](./CHANGELOG.md) for the full BREAKING list.

## Prerequisites

- Node.js ≥ 22

## Install

```bash
# 1. Install the plugin in Claude Code
/plugin marketplace add yupanzi/specguard
/plugin install specguard

# 2. Install the specguard CLI globally (one of:)
npm install -g @yupanzi/specguard
# pnpm add -g @yupanzi/specguard
# yarn global add @yupanzi/specguard   # yarn classic (1.x); berry has no global
# bun add -g @yupanzi/specguard

# 3. Initialize in your project (creates the .specguard/ skeleton)
specguard init
# or non-interactively: specguard init --enforcement warn

# 4. Seed the project's K/S/C notebook (run inside Claude Code)
/specguard:sg-sync-notebook
# notebook empty → init path: scans the project to seed first-batch K/S/C topics
```

`specguard init` creates the `.specguard/{changes,notebook}/` skeleton with INDEX.md scaffolding for the K/S/C three libraries + writes `config.yaml` + maintains `.gitignore` (idempotent; doesn't create `.gitignore` when the project lacks one).

`/specguard:sg-sync-notebook` (in init mode, when notebook is empty) scans the project (`README.md` / `CLAUDE.md` / metadata file / source layout) to extract project-specific K/S/C candidates and registers them under each library's INDEX (index-first protocol). The same skill, in sync mode (when notebook is non-empty), distills lessons from approved dateIds into KSC.

## Usage

In Claude Code, invoke the plugin's slash commands in order. Each phase writes one or two YAML artifacts:

```
/specguard:sg-spec-ask       <one-line need>  # Writes spec.yaml; AskUserQuestion to disambiguate + EnterPlanMode to lock requirements
/specguard:sg-plan-tasks                      # Writes plan.yaml + tasks.yaml; subagent isolation runs each task once + writes tasks/<id>/{prompt.md, debug.log} + invokes specguard verify at the end
/specguard:sg-check-guard                     # Writes check.yaml; KSC three-library review + AskUserQuestion explicit [y/N] approve
/specguard:sg-sync-notebook  [<dateId>]       # Manually triggered; init path (notebook empty) seeds K/S/C from project, sync path (with dateId) distills approved changes
```

Human-in-the-loop windows:

1. One-sentence need + AskUserQuestion to disambiguate (/specguard:sg-spec-ask)
2. EnterPlanMode terminal confirmation (/specguard:sg-spec-ask)
3. AskUserQuestion to confirm files + approach (/specguard:sg-plan-tasks design sub-phase)
4. AskUserQuestion explicit [y/N] approve (/specguard:sg-check-guard)
5. Manually invoke /specguard:sg-sync-notebook + AskUserQuestion review of distillations

Everything else runs autonomously.

**Failure handling**: if `/sg-check-guard` returns verdict=`re-plan` or `ksc-reject`, the current dateId is sealed (no retry within it). Open a NEW dateId via `/sg-spec-ask` for the redesign — the old dateId stays as a counter-example archive that `/sg-sync-notebook` can later cite.

## Hook enforcement levels

The plugin ships 3 hooks: `yaml-write` (PostToolUse auto-validate), `session-start` (SessionStart injects state-machine position), `prompt-submit` (UserPromptSubmit detects intent). Each hook's enforcement level is independently configurable.

| Level    | Exit code on failure | stderr output | Effect                                |
| -------- | -------------------- | ------------- | ------------------------------------- |
| `strict` | 2                    | detailed error | LLM blocked, must fix                 |
| `warn`   | 0                    | warning       | LLM sees warning, can continue (default) |
| `off`    | 0                    | silent        | fully bypassed                        |

**Granularity**: global default + per-hook override.

```bash
specguard config get                              # full config
specguard config get enforcement                  # global default
specguard config get hooks.yaml-write             # per hook (incl. effective)
specguard config set enforcement strict           # change global default
specguard config set hooks.yaml-write strict      # per-hook override
specguard config set hooks.prompt-submit off      # disable a hook
specguard config set hooks.yaml-write null        # clear override (back to global)
```

When `init` defaults to enforcement=warn, every hook follows. When enforcement=strict, `prompt-submit` auto-downgrades to `warn` (keyword matching is prone to false positives — safe default).

## Directory layout

```
.specguard/
  config.yaml                  # created by init; enforcement + hooks overrides
  changes/{YYYYMMDD}-<id>/     # in-progress (id is kebab-case; dateId carries the date prefix) — flat, no version subdirs
    spec.yaml                  # /specguard:sg-spec-ask output (goal + asks + checks with how)
    plan.yaml                  # /specguard:sg-plan-tasks design output (files + approach + tradeoffs)
    tasks.yaml                 # /specguard:sg-plan-tasks execution output (tasks[].{do, verify, status})
    check.yaml                 # specguard verify writes machine layer; /specguard:sg-check-guard adds ksc_check + signed_off
    tasks/<task_id>/           # per-task subagent products
      prompt.md                # original prompt sent to the subagent
      debug.log                # subagent execution output

  notebook/                    # KSC project memory (MUST be committed); INDEX-first three-tier (progressive disclosure)
    INDEX.md                   # Top-level entry; @ links to library INDEXes
    knowledge/
      INDEX.md                 # K library: ## Invariants + ## Abstractions + ## Topics + frontmatter references[]
      <topic>.md               # Dense topic, fetched on demand (ref_id K-NN; pulled when an Invariant / Abstraction matches)
    skill/
      INDEX.md                 # S library: ## Decision Triggers + ## Topics + references[]
      <topic>.md               # Decision templates / reasoning frameworks (ref_id S-NN)
    check/
      INDEX.md                 # C library: ## Cmd Matrix + ## Llm Checks + ## Manual Checklists + ## Topics + references[]
      <topic>.md               # Correctness criteria (ref_id C-NN)
```

### Progressive disclosure

The notebook is intentionally split into **sparse INDEX files** (always read by `/specguard:sg-spec-ask`) plus **dense topic files** (fetched only when an INDEX entry matches the current change's surface). Cross-domain invariants and decision triggers live in the library INDEX directly — they apply project-wide and shouldn't sit behind a topic gate. Topic-shaped distillations sit in `<library>/<topic>.md` and are linked from the INDEX's `## Topics` + `references` array.

`specguard validate --notebook-only` checks notebook integrity independently — surfaces orphan topics, dead references, ref_id axis mismatches, and duplicates. `validate <dateId>` deliberately does NOT run notebook checks (kept off the yaml-write hook hot path); notebook integrity is exercised by `/sg-sync-notebook` on demand.

## CLI

```
specguard init [--enforcement <level>] [--force]   # Skeleton + config.yaml + .gitignore maintenance
specguard config get [query]                       # Read config
specguard config set <query> <value>               # Write config (auto ajv-validated)
specguard validate <dateId>                        # Validate spec + plan + tasks + check schema + cross-file id integrity + ref integrity + orphan task dirs
specguard verify <dateId>                          # Run program-form checks (spec.checks[].how.cmd), write check.yaml + verdict
specguard verify <dateId> --verdict-only           # Don't re-run checks; only recompute verdict from existing check_results
specguard hook on-yaml-write                       # PostToolUse handler (called by the plugin)
specguard hook on-session-start                    # SessionStart handler (called by the plugin)
specguard hook on-prompt-submit                    # UserPromptSubmit handler (called by the plugin)
```

dateId format: `{YYYYMMDD}-<kebab-id>`, e.g. `20260504-add-auth`.

The `hook` subcommand is the entry point for the plugin's hook scripts; **users normally don't invoke it directly**.

## The 3 forms of check.how

`how` is a one-of YAML object (exactly 1 property), declared in `spec.yaml.checks[].how`:

| Form                                | Type        | Note                                                                                                                                                                                                  |
| ----------------------------------- | ----------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `{ cmd: [<program>, <arg>, ...] }`  | program     | YAML array spawned directly (no shell); e.g. `{ cmd: [npx, vitest, run, tests/x.test.ts] }` / `{ cmd: [pytest, -q, tests/test_x.py] }` / `{ cmd: [cargo, test, --test, foo] }` / `{ cmd: [go, test, ./pkg] }` |
| `{ llm: <prompt> }`                 | reasoning   | A `/specguard:sg-check-guard` LLM strictly answers yes/no                                                                                                                                             |
| `{ manual: <note> }`                | fallback    | Only when neither of the above applies                                                                                                                                                                |

**Priority**: `cmd` > `llm` > `manual`.

`cmd` is a YAML array spawned directly — no shell interpretation, no string split, no quote-hell, no platform difference. For complex shell expressions (pipe / chain / awk / jq), write a script file inside the project and invoke it via `{ cmd: [bash, scripts/check-foo.sh] }`. See the `/specguard:sg-spec-ask` skill for details.

## The 4 verdict values

- `done` — every check passed, can be approved
- `awaiting-llm` — cmd checks passed but `llm` / `manual` still pending; resolve them in `/sg-check-guard`, then `specguard verify <dateId> --verdict-only` recomputes verdict
- `re-plan` — at least one check failed; user opens a NEW dateId (no retry within current dateId)
- `ksc-reject` — machine layer passed but KSC review failed (violates K/S/C baseline); user opens a NEW dateId

## Build and verify

```
npm install
npm run build                # tsc -b packages/cli
npm run lint:no-ai-sdk       # enforce that packages/cli has no AI SDK dependency
npm test                     # unit tests (node:test, zero-dependency; covers parseHow / validate / verify / cross-file integrity / orphan task dirs)
```

## Plugin self-hosting

The specguard repo's root is the plugin root (`.claude-plugin/plugin.json` lives there). For dev, let the hook reach the local build:

```bash
npm install
npm run build
(cd packages/cli && npm link)   # link the local specguard onto PATH
specguard init                  # initialize a skeleton in this repo too
```

Open Claude Code inside this repo afterward; the plugin auto-loads and you can test it on itself with `/specguard:sg-*`. Hook calls go through the local build; rerun `npm run build` after edits to take effect immediately.

## License

[MIT](./LICENSE)
