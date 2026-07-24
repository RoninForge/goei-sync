# goei-sync

**Track your Claude Code spend, broken down by git branch, in one command. No account, no API key, nothing in your request path.**

`npx goei-sync` reads the session logs Claude Code already writes under `~/.claude/projects`, prices every response at published list rates, and prints how much each project and git branch has cost you. It is the per-branch view `ccusage` and the native `/cost` command do not give you, and it runs entirely on your machine.

```bash
npx goei-sync
```

```
Claude Code local usage by git branch  (2026-07-10 to 2026-07-23)
Local usage value at list prices. Not your provider bill.

Top branch: web/main  $347.70 (27% of $1265.77 across 54 branches)

PROJECT   BRANCH              TOKENS       USD
web       main           458,244,888   $347.70
web       fix/login       45,402,797    $26.52
api       main            33,271,226    $23.78
TOTAL                    536,918,911   $398.00

By model:
  opus-4-8   500,000,000   $360.00
  sonnet-5    36,918,911    $38.00
```

These are local usage values at published list prices, not a provider bill: a real invoice reflects your subscription, negotiated rates, and credits this cannot see. Add `--json` for machine-readable output, or `--days 7` / `--since 2026-07-01` to scope the window.

For the full walkthrough, see the tutorial [How to track your Claude Code spend over time, per project and branch](https://roninforge.org/tutorials/how-to-track-claude-code-spend-over-time/).

## Claude Code Wrapped: one shareable card

```bash
npx goei-sync wrapped
```

`wrapped` turns the same local logs into a single card you can screenshot. The headline is the number only local re-pricing can compute: the list-price value of the Claude Code usage that ran through your machine, plus what prompt caching saved you against paying for those same tokens as fresh input.

```
┌──────────────────────────────────────────────────────────────┐
│ CLAUDE CODE WRAPPED                 2026-06-28 to 2026-07-19 │
│ Local usage value at list prices. Not your provider bill.    │
├──────────────────────────────────────────────────────────────┤
│                                                              │
│   $190.45  of Claude Code, at list prices                    │
│   across 4 active days, 3 projects, 5 branches               │
│                                                              │
│   Prompt caching saved                             $682.05   │
│   Biggest project  web-app                    $155.00  81%   │
│   Biggest branch  web-app/main                     $110.00   │
│   Priciest day  2026-06-28                         $110.00   │
│                                                              │
│   Model mix   opus-4-8 89%   sonnet-5 10%   haiku-4-5 1%     │
│                                                              │
├──────────────────────────────────────────────────────────────┤
│ See your own:  npx goei-sync wrapped     goei.roninforge.org │
└──────────────────────────────────────────────────────────────┘
```

The "prompt caching saved" line is the honest net figure: what those cached tokens would have cost billed as plain input with no cache, minus what they actually cost. It is a value comparison at list prices, not money credited to a bill.

## Roll it up across your team

One machine is one machine. To combine every developer and every machine into one deduplicated rollup, and to re-price 12 months of history at the rates that were live in each past month, sync to [Goei](https://roninforge.org/goei):

```bash
npx goei-sync --token goei_dt_your_device_token
```

Sign in at [goei.roninforge.org](https://goei.roninforge.org) with a magic link, create a device token under Settings then Device Tokens, and pass it with `--token` (or set `GOEI_DEVICE_TOKEN` and run `npx goei-sync sync`). Goei prices the tokens on its side and dedupes across your machines. It is free for a single developer. See a live dashboard with no signup at [goei.roninforge.org/demo](https://goei.roninforge.org/demo).

## What each command reads

- `npx goei-sync` and `npx goei-sync wrapped` read the raw `~/.claude/projects/*.jsonl` logs directly, so they attribute every message to its git branch and price the exact 5-minute vs 1-hour cache split. They price locally with the open [ai-price-index](https://www.npmjs.com/package/ai-price-index) dataset, dated so each response is valued at the rate that was live the day it ran.
- `npx goei-sync --token ...` (sync) reads your usage through [ccusage](https://github.com/ryoppippi/ccusage) and sends daily, per-model token counts to Goei, which prices them. ccusage reports a single combined cache-creation figure, so synced dollars value cache writes at the 5-minute rate; the local report and card above are exact.

Either way, goei-sync reads only what Claude Code already wrote to disk. It never sees prompts, responses, or API keys.

## Options

```
report            (default) local spend by git branch; no token needed
wrapped           one shareable card summarising your usage; no token
sync              push daily rollups to Goei; uses --token or GOEI_DEVICE_TOKEN

--token <t>       Goei device token; routes to sync (env: GOEI_DEVICE_TOKEN)
--days <n>        limit to the last n days
--since <date>    limit to YYYY-MM-DD forward (overrides --days)
--json            print report or wrapped as JSON instead of a table (local only)
--machine <id>    machine label for dedupe on sync (default: this host's name)
--endpoint <url>  ingest endpoint (default: https://goei.roninforge.org/api/ingest)
--show-payload    print the exact JSON that sync would send, then exit
--dry-run         run the sync summary but send nothing
-h, --help        show this help
```

`report` and `wrapped` are local-only and refuse any sync flag, so they can never send anything. Run `npx goei-sync sync --show-payload` to read the exact request body before you ever send a token. Every field it contains is a token count, a date, or a model name. There are no prompts and no keys in it.

## goei-sync vs ccusage

Both read the same local Claude Code logs with no API key. `ccusage` gives you daily, monthly, and per-session totals. goei-sync adds the two things it does not: a per-git-branch breakdown of where your spend actually went, and a one-command push to a shared team dashboard. Use goei-sync when you want to know which branch or project burned the budget, or when more than one developer needs to see the total. A side-by-side breakdown lives at [Goei vs ccusage](https://roninforge.org/goei/vs-ccusage/).

## goei-sync vs budgetclaw

Both feed the same Goei dashboard from the same local logs, with no API key. On a machine that syncs, run one of the two, not both: a day synced by both would be counted twice. [budgetclaw](https://github.com/RoninForge/budgetclaw) adds always-on background tracking with per-project and per-git-branch attribution, plus hard spend caps that can stop a runaway agent before the bill lands. Use goei-sync for a quick local look, a shareable card, and a dependency-free push; use budgetclaw when you want continuous tracking and enforcement. If you want to stop a runaway agent, not just measure it, start with the tutorial [How to set a hard spend cap on Claude Code](https://roninforge.org/tutorials/how-to-set-a-hard-spend-cap-on-claude-code/).

## Not a proxy

goei-sync is a reporter, not a proxy. It does not sit between your editor and any AI provider, and it touches no API traffic, prompts, responses, or keys. It reads the usage Claude Code already wrote to disk.

## Requirements

Node 18 or newer.

## License

MIT. Part of [RoninForge](https://roninforge.org), which builds honest, local-first cost tools for developers working with AI coding assistants. More on tracking and capping Claude Code spend: [Goei](https://roninforge.org/goei), [budgetclaw](https://roninforge.org/budgetclaw), and the [Claude Code cost tutorials](https://roninforge.org/tutorials/how-to-track-claude-code-spend-over-time/).
