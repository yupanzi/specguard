# specguard

Spec-guarded AI workflow, distributed as a **Claude Code Plugin**. Four-phase loop: **ask-plan → run-pipeline → sign-check → sync-notebook**. The plugin welds the state machine into Claude Code's runtime via hooks.

> Collaboration philosophy, hard rules, pitfalls, and scope boundaries live in [CLAUDE.md](./CLAUDE.md). This file only covers usage.

## Status

`v0.1.0` — pluginized + configurable hook enforcement levels. Underlying four-phase loop + failure-version evolution + KSC project memory (notebook) + full YAML validation.

## Prerequisites

- Node.js ≥ 22

## Install

```bash
# 1. Install the plugin in Claude Code
/plugin marketplace add yupanzi/specguard
/plugin install specguard

# 2. Initialize in your project
#    sg-init-project detects the specguard CLI on PATH; if missing, it
#    asks once and runs the global install for you (npm / pnpm / yarn / bun).
/specguard:sg-init-project
```

`/specguard:sg-init-project` first ensures `specguard` is on PATH (auto-installing `@yupanzi/specguard` via the package manager you pick), then invokes `specguard init` (creates the `.specguard/{changes,notebook}/` skeleton with INDEX.md scaffolding for the K/S/C three libraries + writes `config.yaml` + maintains `.gitignore`), and finally scans the project (`README.md` / `CLAUDE.md` / metadata / `skills/` / `src/` layout) to extract project-specific K/S/C candidates and registers them under each library's INDEX (index-first protocol).

Want to install the CLI yourself first? Pick whichever package manager you use — the skill detects the existing binary and skips the install prompt:

```bash
npm install -g @yupanzi/specguard
# pnpm add -g @yupanzi/specguard
# yarn global add @yupanzi/specguard   # yarn classic (1.x); berry has no global
# bun add -g @yupanzi/specguard
```

Non-interactive skeleton mode (assumes the CLI is already on PATH; no notebook seed): `specguard init --enforcement warn`.

## Usage

In Claude Code, invoke the plugin's slash commands in order. One bootstrap entry sits outside the state machine; each in-loop skill writes one core YAML:

```
/specguard:sg-init-project                  # First-time onboarding (outside the loop); calls specguard init + scans the project to seed KSC notebook
/specguard:sg-ask-plan       <one-line need>  # Writes plan.yaml; AskUserQuestion to disambiguate + EnterPlanMode to lock requirements
/specguard:sg-run-pipeline                  # Writes pipeline.yaml; runs plan.tasks sequentially (subagent isolation) + embedded checks + self-heal loop until pass (max 3) + /simplify entropy reduction
/specguard:sg-sign-check                    # Writes check.yaml; KSC review + AskUserQuestion explicit [y/N] approve
/specguard:sg-sync-notebook  <dateId>       # Manually triggered; distills K/S/C assets from changes/<dateId>/v* into notebook/
```

Human-in-the-loop windows:

1. One-sentence need + AskUserQuestion to disambiguate (/specguard:sg-ask-plan)
2. EnterPlanMode terminal confirmation (/specguard:sg-ask-plan)
3. AskUserQuestion explicit [y/N] approve (/specguard:sg-sign-check)
4. Manually invoke /specguard:sg-sync-notebook + AskUserQuestion review of distillations

Everything else runs autonomously.

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
  changes/{YYYYMMDD}-<id>/     # in-progress (id is kebab-case; dateId carries the date prefix)
    v1/                        # frozen on KSC / approve reject (plan/pipeline/check + logs untouched)
      plan.yaml                # /specguard:sg-ask-plan output
      pipeline.yaml            # /specguard:sg-run-pipeline output (incremental flush of task execution)
      check.yaml               # specguard verify writes machine-layer; /specguard:sg-sign-check adds ksc_check + approved
      logs/r<n>/               # one directory per loop attempt (max r3)
    v2/                        # opens a new version on rejection (v1 preserved)
      ...

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

The notebook is intentionally split into **sparse INDEX files** (always read by `/specguard:sg-ask-plan`) plus **dense topic files** (fetched only when an INDEX entry matches the current change's surface). Cross-domain invariants and decision triggers live in the library INDEX directly — they apply project-wide and shouldn't sit behind a topic gate. Topic-shaped distillations sit in `<library>/<topic>.md` and are linked from the INDEX's `## Topics` + `references` array.

`specguard validate --notebook-only` checks notebook integrity independently — surfaces orphan topics, dead references, ref_id axis mismatches, and duplicates. `validate <dateId>` deliberately does NOT run notebook checks (kept off the yaml-write hook hot path); notebook integrity is exercised by sg-sync-notebook / sg-init-project on demand.

## CLI

```
specguard init [--enforcement <level>] [--force]   # Underlying skeleton command (preferred entry: /specguard:sg-init-project)
specguard config get [query]                       # Read config
specguard config set <query> <value>               # Write config (auto ajv-validated)
specguard validate <dateId>                        # Validate plan + pipeline + check schema + reference integrity + n monotonicity + freeze integrity + attempts.length ≤ 3
specguard verify <dateId>                          # Run program-form checks (how.cmd), write check.yaml + verdict
specguard verify <dateId> --verdict-only           # Don't re-run checks; only recompute the latest attempt's verdict
specguard hook on-yaml-write                       # PostToolUse handler (called by the plugin)
specguard hook on-session-start                    # SessionStart handler (called by the plugin)
specguard hook on-prompt-submit                    # UserPromptSubmit handler (called by the plugin)
```

dateId format: `{YYYYMMDD}-<kebab-id>`, e.g. `20260504-add-auth`.

The `hook` subcommand is the entry point for the plugin's hook scripts; **users normally don't invoke it directly**.

## The 3 forms of check.how

`how` is a one-of YAML object (exactly 1 property):

| Form                                | Type        | Note                                                                                                                                                                                                  |
| ----------------------------------- | ----------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `{ cmd: [<program>, <arg>, ...] }`  | program     | YAML array spawned directly (no shell); e.g. `{ cmd: [npx, vitest, run, tests/x.test.ts] }` / `{ cmd: [pytest, -q, tests/test_x.py] }` / `{ cmd: [cargo, test, --test, foo] }` / `{ cmd: [go, test, ./pkg] }` |
| `{ llm: <prompt> }`                 | reasoning   | A `/specguard:sg-run-pipeline` subagent strictly answers yes/no                                                                                                                                       |
| `{ manual: <note> }`                | fallback    | Only when neither of the above applies                                                                                                                                                                |

**Priority**: `cmd` > `llm` > `manual`.

`cmd` is a YAML array spawned directly — no shell interpretation, no string split, no quote-hell, no platform difference. For complex shell expressions (pipe / chain / awk / jq), write a script file inside the project and invoke it via `{ cmd: [bash, scripts/check-foo.sh] }`. See the `/specguard:sg-ask-plan` skill for details.

## The 6 verdict values

- `done` — every check passed, can be approved
- `awaiting-llm` — program-form passed, but `llm` / `manual` still pending
- `re-run` — some failed, but cumulative task failures < 2; auto-retry (same attempt)
- `re-plan` — cumulative task failures ≥ 2 or loop n=3 still failing; opens v<n+1>
- `ksc-rejected` — machine layer passed but KSC review failed (violates knowledge / skill / check baseline); opens v<n+1>
- `approval-rejected` — machine layer + KSC both passed but the user rejected approve; opens v<n+1>

## Build and verify

```
npm install
npm run build                # tsc -b packages/cli
npm run lint:no-ai-sdk       # enforce that packages/cli has no AI SDK dependency
npm test                     # unit tests (node:test, zero-dependency; covers parseHow / validate / verify)
```

## Plugin self-hosting

The specguard repo's root is the plugin root (`.claude-plugin/plugin.json` lives there). For dev, let the hook reach the local build:

```bash
npm install
npm run build
(cd packages/cli && npm link)   # link the local specguard onto PATH
specguard init                  # initialize a skeleton in this repo too (or run /specguard:sg-init-project inside Claude Code for the version with notebook seeds)
```

Open Claude Code inside this repo afterward; the plugin auto-loads and you can test it on itself with `/specguard:sg-*`. Hook calls go through the local build; rerun `npm run build` after edits to take effect immediately.

## License

[MIT](./LICENSE)
