# goei-sync

Push your local Claude Code usage to [Goei](https://roninforge.org/goei), the hosted team cost dashboard, with one command. Zero API keys, daily rollups only, nothing in your request path.

```bash
npx goei-sync --token goei_dt_your_device_token --days 30
```

> `npx goei-sync` reads your local Claude Code usage through ccusage and pushes daily token rollups to Goei, the hosted dashboard that dedupes across every machine and teammate. Goei prices the tokens and shows cost per developer and per model. For per-project and per-git-branch attribution plus hard spend caps, run the open-source budgetclaw CLI instead. No API keys, no prompts, nothing in the request path.

## What it does

goei-sync runs [ccusage](https://github.com/ryoppippi/ccusage) (Claude Code's local usage reader), takes the per-day, per-model token counts it produces, and sends them to Goei with a device token you can revoke. Goei prices the tokens point-in-time on its side, so goei-sync ships no pricing table and computes no dollars itself. The token counts match ccusage exactly; the dollar figures on your dashboard are Goei's own repricing.

One caveat on the dollars: ccusage reports a single combined cache-creation figure with no 5-minute vs 1-hour TTL split, so Goei values all cache writes at the 5-minute rate. If your sessions used 1-hour caching, that portion is priced slightly low. budgetclaw reads the raw session logs and reports the exact split, so use it when you need cache pricing to be exact.

It reads only what Claude Code already writes to local disk. It never sees prompts, responses, or API keys, and it never sits in your request path.

## Get a token

Sign in at [goei.roninforge.org](https://goei.roninforge.org) with a magic link, then create a device token under Settings then Device Tokens. Pass it with `--token`, or set `GOEI_DEVICE_TOKEN`.

## Options

```
--token <t>       Goei device token (or set GOEI_DEVICE_TOKEN)
--days <n>        sync the last n days (default: all history ccusage has)
--since <date>    sync from YYYY-MM-DD forward (overrides --days)
--machine <id>    machine label for dedupe (default: this host's name)
--endpoint <url>  ingest endpoint (default: https://goei.roninforge.org/api/ingest)
--show-payload    print the exact JSON that would be sent, then exit (no token needed)
--dry-run         run ccusage and summarize, but send nothing (no token needed)
-h, --help        show this help
```

Run `npx goei-sync --show-payload` to read the exact request body before you ever send a token. Every field it contains is a token count, a date, or a model name. There are no prompts and no keys in it.

The `--machine` label defaults to your hostname and is shown to everyone on your team's dashboard (it is how Goei dedupes across your machines). Pass `--machine <id>` if you would rather not share your hostname.

## goei-sync vs budgetclaw

Both feed the same Goei dashboard from the same local logs, with no API key. Run one of the two on a given machine, not both: goei-sync attributes spend by day and model, while [budgetclaw](https://github.com/RoninForge/budgetclaw) also attributes it by project and git branch, so a day synced by both tools would be counted twice on that machine.

Use goei-sync for a quick, dependency-free push. Use budgetclaw when you want always-on background sync, per-project and per-git-branch attribution, and hard spend caps that can stop a runaway agent.

## Not a proxy

goei-sync is a reporter, not a proxy. It does not sit between your editor and any AI provider, and it touches no API traffic, prompts, responses, or keys. It reads the usage rollups Claude Code already wrote to disk and forwards daily token counts to a dashboard you control.

## Requirements

Node 18 or newer. ccusage is used if it is on your PATH; otherwise goei-sync pulls ccusage's v20 line with npx on demand.

## License

MIT. Part of [RoninForge](https://roninforge.org).
