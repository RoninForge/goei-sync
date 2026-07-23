# goei-sync

See your Claude Code spend broken down by git branch, on your machine, with no account. Then optionally sync it to [Goei](https://roninforge.org/goei), the hosted dashboard that rolls spend up across your whole team. Zero API keys, nothing in your request path.

```bash
npx goei-sync
```

That reads the session logs Claude Code already writes under `~/.claude/projects`, prices the tokens at published list rates, and prints your spend by git branch and by model. No account, no API key, nothing leaves your machine.

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

These are local usage values at published list prices, not a provider bill: a real invoice reflects negotiated rates, plan inclusions, and credits this cannot see. Add `--json` for machine-readable output.

## Roll it up across your team

One machine is one machine. To combine every developer and every machine into one rollup, and to re-price 12 months of history at the rates that were live then, sync to Goei:

```bash
npx goei-sync --token goei_dt_your_device_token
```

Sign in at [goei.roninforge.org](https://goei.roninforge.org) with a magic link, create a device token under Settings then Device Tokens, and pass it with `--token` (or set `GOEI_DEVICE_TOKEN` and run `npx goei-sync sync`). Goei prices the tokens on its side and dedupes across your machines. It is free for a single developer.

## What each command reads

- `npx goei-sync` (report) reads the raw `~/.claude/projects/*.jsonl` logs directly, so it can attribute every message to its git branch and price the exact 5-minute vs 1-hour cache split. It prices locally with the open [ai-price-index](https://www.npmjs.com/package/ai-price-index) dataset.
- `npx goei-sync --token ...` (sync) reads your usage through [ccusage](https://github.com/ryoppippi/ccusage) and sends daily, per-model token counts to Goei, which prices them. ccusage reports a single combined cache-creation figure, so synced dollars value cache writes at the 5-minute rate; the local report above is exact.

Either way, goei-sync reads only what Claude Code already wrote to disk. It never sees prompts, responses, or API keys.

## Options

```
--token <t>       Goei device token; routes to sync (env: GOEI_DEVICE_TOKEN)
--days <n>        limit to the last n days
--since <date>    limit to YYYY-MM-DD forward (overrides --days)
--json            print the report as JSON instead of a table (report only)
--machine <id>    machine label for dedupe on sync (default: this host's name)
--endpoint <url>  ingest endpoint (default: https://goei.roninforge.org/api/ingest)
--show-payload    print the exact JSON that sync would send, then exit
--dry-run         run the sync summary but send nothing
-h, --help        show this help
```

Run `npx goei-sync sync --show-payload` to read the exact request body before you ever send a token. Every field it contains is a token count, a date, or a model name. There are no prompts and no keys in it.

## goei-sync vs budgetclaw

Both feed the same Goei dashboard from the same local logs, with no API key. On a machine that syncs, run one of the two, not both: a day synced by both would be counted twice. [budgetclaw](https://github.com/RoninForge/budgetclaw) adds always-on background sync with per-project and per-git-branch attribution to Goei, plus hard spend caps that can stop a runaway agent. Use goei-sync for a quick local look and a dependency-free push; use budgetclaw when you want continuous tracking and enforcement.

## Not a proxy

goei-sync is a reporter, not a proxy. It does not sit between your editor and any AI provider, and it touches no API traffic, prompts, responses, or keys. It reads the usage Claude Code already wrote to disk.

## Requirements

Node 18 or newer.

## License

MIT. Part of [RoninForge](https://roninforge.org).
