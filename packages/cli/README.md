# @yupanzi/specguard

> Spec-guarded AI workflow CLI. Runtime backend for the [specguard Claude Code Plugin](https://github.com/yupanzi/specguard). **Never imports any AI SDK.**

The spec is a state machine in YAML. The four-phase loop — **ask-plan → run-pipeline → sign-check → sync-notebook** — produces verifiable artifacts (`plan.yaml` / `pipeline.yaml` / `check.yaml`) plus distillable notebook assets. Files are the state machine: no database, no in-memory state, restart and you recover.

This package is the **deterministic core**: schema validation, YAML I/O, program-form check execution, hook handlers. All LLM inference happens inside the plugin's [slash commands](https://github.com/yupanzi/specguard/tree/main/skills) — see the [main repo](https://github.com/yupanzi/specguard) for the full workflow.

- 🏠 Repository: <https://github.com/yupanzi/specguard>
- 📖 Full docs: [README](https://github.com/yupanzi/specguard#readme) · [CLAUDE.md](https://github.com/yupanzi/specguard/blob/main/CLAUDE.md)
- 🐛 Issues: <https://github.com/yupanzi/specguard/issues>
- 🚀 Releases: <https://github.com/yupanzi/specguard/releases>

## Install

```bash
npm install -g @yupanzi/specguard
```

Requires Node.js ≥ 22.

For the full Claude Code Plugin experience (slash commands + hooks):

```bash
# After installing the CLI globally, install the plugin in Claude Code
/plugin marketplace add yupanzi/specguard
/plugin install specguard
```

## Quick start

```bash
# Skeleton-only mode (no project-specific notebook seed)
specguard init                              # interactive
specguard init --enforcement warn           # non-interactive

# Inside Claude Code, prefer the slash command (also seeds the KSC notebook)
/specguard:sg-init-project
```

## The four-phase loop

Each in-loop slash command writes exactly one core YAML; one bootstrap entry sits outside the loop:

| Slash command                                                                                                       | YAML written      | Role                                                                                                |
| ------------------------------------------------------------------------------------------------------------------- | ----------------- | --------------------------------------------------------------------------------------------------- |
| [`/specguard:sg-init-project`](https://github.com/yupanzi/specguard/blob/main/skills/sg-init-project/SKILL.md)      | _(none)_          | First-time onboarding (outside the loop); calls `specguard init` + scans the project to seed KSC.  |
| [`/specguard:sg-ask-plan`](https://github.com/yupanzi/specguard/blob/main/skills/sg-ask-plan/SKILL.md)              | `plan.yaml`       | AskUserQuestion to disambiguate + EnterPlanMode to lock requirements.                               |
| [`/specguard:sg-run-pipeline`](https://github.com/yupanzi/specguard/blob/main/skills/sg-run-pipeline/SKILL.md)      | `pipeline.yaml`   | Runs `plan.tasks` sequentially (subagent isolation) + embedded checks + self-heal loop (max 3).     |
| [`/specguard:sg-sign-check`](https://github.com/yupanzi/specguard/blob/main/skills/sg-sign-check/SKILL.md)          | `check.yaml`      | KSC review + AskUserQuestion explicit `[y/N]` approve.                                              |
| [`/specguard:sg-sync-notebook`](https://github.com/yupanzi/specguard/blob/main/skills/sg-sync-notebook/SKILL.md)    | _(updates KSC)_   | Manually triggered; distills K/S/C assets from `changes/<dateId>/v*` into `notebook/`.              |

## Commands

```
specguard init [--enforcement <level>] [--force]
    Create .specguard/{changes,notebook}/ skeleton + config.yaml.
    Maintains .gitignore (idempotent; never creates one if absent).

specguard config get [query]
    Read config. Examples: `config get`, `config get enforcement`,
    `config get hooks.yaml-write`.

specguard config set <query> <value>
    Write config (auto ajv-validated). Examples:
      config set enforcement strict
      config set hooks.yaml-write strict
      config set hooks.prompt-submit off
      config set hooks.yaml-write null    # clear override

specguard validate <dateId>
    Schema + reference integrity + n monotonicity + freeze integrity
    + attempts.length ≤ 3.

specguard validate --notebook-only
    Notebook integrity (orphans, dead refs, ref_id axis mismatches,
    duplicates) — independent of any change.

specguard verify <dateId>
    Run program-form checks (how.cmd as argv array, no shell);
    write check.yaml + verdict.

specguard verify <dateId> --verdict-only
    Recompute the latest attempt's verdict without re-running checks.

specguard hook on-yaml-write
specguard hook on-session-start
specguard hook on-prompt-submit
    Plugin hook entry points. Users normally don't invoke directly.
```

`dateId` format: `{YYYYMMDD}-<kebab-id>`, e.g. `20260504-add-auth`.

Source: [`init.ts`](https://github.com/yupanzi/specguard/blob/main/packages/cli/src/commands/init.ts) · [`config.ts`](https://github.com/yupanzi/specguard/blob/main/packages/cli/src/commands/config.ts) · [`validate.ts`](https://github.com/yupanzi/specguard/blob/main/packages/cli/src/commands/validate.ts) · [`verify.ts`](https://github.com/yupanzi/specguard/blob/main/packages/cli/src/commands/verify.ts) · [`hook.ts`](https://github.com/yupanzi/specguard/blob/main/packages/cli/src/commands/hook.ts)

## Hook enforcement levels

| Level    | Exit on failure | stderr | Effect                                     |
| -------- | --------------- | ------ | ------------------------------------------ |
| `strict` | 2               | error  | LLM blocked, must fix                      |
| `warn`   | 0               | warn   | LLM sees warning, can continue _(default)_ |
| `off`    | 0               | silent | fully bypassed                             |

Each of the 3 hooks ([`yaml-write`](https://github.com/yupanzi/specguard/blob/main/hooks/scripts/on-yaml-write.sh) / [`session-start`](https://github.com/yupanzi/specguard/blob/main/hooks/scripts/on-session-start.sh) / [`prompt-submit`](https://github.com/yupanzi/specguard/blob/main/hooks/scripts/on-prompt-submit.sh)) is independently configurable via [`hooks.json`](https://github.com/yupanzi/specguard/blob/main/hooks/hooks.json). Under `enforcement: strict`, `prompt-submit` auto-downgrades to `warn` (keyword matching is prone to false positives — safe default).

Enforcement parsing: [`lib/config.ts`](https://github.com/yupanzi/specguard/blob/main/packages/cli/src/lib/config.ts) · contract: [`config.schema.json`](https://github.com/yupanzi/specguard/blob/main/packages/cli/src/schemas/config.schema.json).

## The 3 forms of `check.how`

`how` is a one-of YAML object (exactly 1 property):

| Form                                | Type      | Note                                                              |
| ----------------------------------- | --------- | ----------------------------------------------------------------- |
| `{ cmd: [<program>, <arg>, ...] }`  | program   | YAML array spawned directly — no shell, no split, no quote-hell.  |
| `{ llm: <prompt> }`                 | reasoning | A pipeline subagent strictly answers yes/no.                      |
| `{ manual: <note> }`                | fallback  | Only when neither of the above applies.                           |

**Priority**: `cmd` > `llm` > `manual`.

For pipes / chains / multi-step shell logic, write a script file and invoke it: `{ cmd: [bash, scripts/check-foo.sh] }`. The data shape IS the semantics.

Examples across stacks:

```yaml
how: { cmd: [npx, vitest, run, tests/x.test.ts] }
how: { cmd: [pytest, -q, tests/test_x.py] }
how: { cmd: [cargo, test, --test, foo] }
how: { cmd: [go, test, ./pkg] }
```

Dispatch logic: [`lib/how.ts`](https://github.com/yupanzi/specguard/blob/main/packages/cli/src/lib/how.ts) · contract: [`check.schema.json`](https://github.com/yupanzi/specguard/blob/main/packages/cli/src/schemas/check.schema.json).

## Verdict values

- `done` — every check passed; can be approved
- `awaiting-llm` — program-form passed, `llm` / `manual` still pending
- `re-run` — some failed but cumulative task failures < 2; auto-retry (same attempt)
- `re-plan` — cumulative ≥ 2 or n=3 still failing; opens v⟨n+1⟩
- `ksc-rejected` — machine layer passed but KSC review failed; opens v⟨n+1⟩
- `approval-rejected` — both layers passed but user rejected; opens v⟨n+1⟩

Status derivation: [`lib/status.ts`](https://github.com/yupanzi/specguard/blob/main/packages/cli/src/lib/status.ts).

## Hard contracts

1. **The CLI never calls the LLM.** No `anthropic` / `openai` / `@google/generative-ai` / `cohere` in `dependencies` or `devDependencies`. CI enforces this via [`npm run lint:no-ai-sdk`](https://github.com/yupanzi/specguard/blob/main/package.json). Capability scales by riding Claude Code's evolution, not by binding to an SDK.
2. **Schemas are frozen, `additionalProperties: false`.** Fields not listed in [`src/schemas/*.json`](https://github.com/yupanzi/specguard/tree/main/packages/cli/src/schemas) are rejected by AJV. Adding a field is a contract change.
3. **The state machine is non-skippable.** `n` is monotonically non-decreasing; once `v1` freezes, only append `v2/`, never touch `v1`; `attempts.length ≤ 3` per loop. Enforcement: [`commands/validate.ts`](https://github.com/yupanzi/specguard/blob/main/packages/cli/src/commands/validate.ts).
4. **Status changes flush immediately.** Recoverable-on-unexpected-exit is the default behavior, not a nice-to-have.

See [CLAUDE.md](https://github.com/yupanzi/specguard/blob/main/CLAUDE.md) for the full set of inviolable rules and the rationale behind each.

## Source map

[`packages/cli/src/`](https://github.com/yupanzi/specguard/tree/main/packages/cli/src)

```
commands/        # commander subcommand entries
  init.ts        config.ts        validate.ts        verify.ts        hook.ts
lib/             # pure helpers; no I/O at module top level
  yaml-io.ts     config.ts        status.ts          how.ts           types.ts          errors.ts
schemas/         # AJV JSON Schema — the contract
  plan.schema.json     pipeline.schema.json     check.schema.json
  config.schema.json   notebook-asset.schema.json
```

Plugin trinity (lives at the repo root, not in this package):

- [`.claude-plugin/plugin.json`](https://github.com/yupanzi/specguard/blob/main/.claude-plugin/plugin.json) — plugin manifest
- [`hooks/`](https://github.com/yupanzi/specguard/tree/main/hooks) — `hooks.json` + `scripts/` (each script is exactly 1 business line; logic lives in [`commands/hook.ts`](https://github.com/yupanzi/specguard/blob/main/packages/cli/src/commands/hook.ts))
- [`skills/`](https://github.com/yupanzi/specguard/tree/main/skills) — five `SKILL.md` files, namespaced by Claude Code as `/specguard:<name>`

## Build & verify

For contributors working on the CLI itself:

```bash
git clone https://github.com/yupanzi/specguard.git
cd specguard
npm install
npm run build                # tsc -b packages/cli
npm run lint:no-ai-sdk       # enforce that packages/cli has no AI SDK dependency
npm test                     # node:test, zero-dependency; covers parseHow / validate / verify
```

Local plugin self-hosting (test the plugin against itself):

```bash
(cd packages/cli && npm link)   # link the local specguard onto PATH
specguard init                  # initialize a skeleton in this repo too
```

Open Claude Code inside this repo afterward; the plugin auto-loads. Hook calls go through the local build; rerun `npm run build` after edits to take effect.

## Documentation

**For users**

- [Main README](https://github.com/yupanzi/specguard#readme) — full plugin install, hook details, KSC project memory, directory layout
- [Slash command skills](https://github.com/yupanzi/specguard/tree/main/skills) — read each `SKILL.md` to see exactly what each phase does

**For contributors**

- [CLAUDE.md](https://github.com/yupanzi/specguard/blob/main/CLAUDE.md) — hard rules, pitfalls, collaboration philosophy, scope boundaries
- [CHANGELOG.md](https://github.com/yupanzi/specguard/blob/main/CHANGELOG.md) — release history (auto-generated by `semantic-release`; populated after the first release)
- [Releases](https://github.com/yupanzi/specguard/releases) — published versions
- [Issues](https://github.com/yupanzi/specguard/issues) — bug reports and feature requests

## License

[MIT](https://github.com/yupanzi/specguard/blob/main/LICENSE) © specguard contributors
