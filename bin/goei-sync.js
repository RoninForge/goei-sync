#!/usr/bin/env node
'use strict';

const os = require('node:os');
const { runCcusage } = require('../lib/ccusage');
const { toSpendRecords, buildPayloads, totalTokens } = require('../lib/payload');
const { DEFAULT_ENDPOINT, validToken, push } = require('../lib/ingest');
const { scan } = require('../lib/scan');
const { buildReport } = require('../lib/report');
const { buildWrapped, renderCard } = require('../lib/wrapped');

const HELP = `goei-sync - see and sync your Claude Code costs

Usage:
  npx goei-sync                       show local spend by git branch (no account)
  npx goei-sync wrapped               one shareable card of your Claude Code usage
  npx goei-sync --token goei_dt_xxx   sync daily rollups to your Goei dashboard

With no arguments, goei-sync prices the session logs Claude Code already writes
and prints your spend broken down by git branch, entirely on your machine: no
account, no API key, nothing in your request path. Add a token to also roll it
up across your machines and teammates in Goei, which keeps 12-month history
re-priced at the rates that were live then.

Commands:
  report            (default) print local spend by git branch; no token needed
  wrapped           print one shareable card summarising your usage; no token
  sync              push daily rollups to Goei; uses --token or GOEI_DEVICE_TOKEN

Options:
  --token <t>       Goei device token; routes to sync (env: GOEI_DEVICE_TOKEN,
                    read by the sync command)
  --days <n>        limit to the last n days
  --since <date>    limit to YYYY-MM-DD forward (overrides --days)
  --json            print report or wrapped as JSON instead of a table (local)
  --machine <id>    machine label for dedupe on sync (default: this host's name)
  --endpoint <url>  ingest endpoint (default: ${DEFAULT_ENDPOINT})
  --show-payload    print the exact JSON that sync would send, then exit
  --dry-run         run the sync summary but send nothing
  -h, --help        show this help

Local numbers are usage value at list prices, not a provider bill. Get a device
token at https://goei.roninforge.org (Settings -> Device Tokens). For always-on
tracking plus hard spend caps, install budgetclaw:
https://github.com/RoninForge/budgetclaw
`;

function parseArgs(argv) {
	let args = argv;
	let command = '';
	if (args[0] === 'report' || args[0] === 'wrapped' || args[0] === 'sync') {
		command = args[0];
		args = args.slice(1);
	}
	const opts = {
		command,
		days: null,
		since: null,
		machine: os.hostname(),
		endpoint: DEFAULT_ENDPOINT,
		// Only an explicit --token flag routes to sync; GOEI_DEVICE_TOKEN is resolved inside
		// runSync so it can never silently turn the bare, advertised-as-local command into a
		// network sync.
		token: '',
		tokenFlag: false,
		showPayload: false,
		dryRun: false,
		json: false,
		help: false
	};
	for (let i = 0; i < args.length; i++) {
		const a = args[i];
		const next = () => args[++i];
		switch (a) {
			case '-h':
			case '--help':
				opts.help = true;
				break;
			case '--show-payload':
				opts.showPayload = true;
				break;
			case '--dry-run':
				opts.dryRun = true;
				break;
			case '--json':
				opts.json = true;
				break;
			case '--token':
				opts.token = next() || '';
				opts.tokenFlag = true;
				break;
			case '--machine':
				opts.machine = next() || opts.machine;
				break;
			case '--endpoint':
				opts.endpoint = next() || opts.endpoint;
				break;
			case '--days': {
				const v = Number(next());
				// Upper bound keeps the since-date arithmetic in resolveSince well inside the valid
				// Date range, so an absurd --days yields the friendly error here, not a raw RangeError.
				if (!Number.isInteger(v) || v <= 0 || v > 36500) throw new Error('--days must be a positive integer (max 36500).');
				opts.days = v;
				break;
			}
			case '--since': {
				const v = next();
				if (!/^\d{4}-\d{2}-\d{2}$/.test(v || '')) throw new Error('--since must be a YYYY-MM-DD date.');
				opts.since = v;
				break;
			}
			default:
				throw new Error(`Unknown option: ${a}. Run goei-sync --help.`);
		}
	}
	return opts;
}

// Sync is chosen only by an explicit --token flag, the `sync` word, or a sync-only
// flag; never by the environment alone, so the bare local report stays local. The
// local-only commands (report, wrapped) never route to sync even with a token flag.
function routesToSync(opts) {
	const localOnly = opts.command === 'report' || opts.command === 'wrapped';
	return opts.command === 'sync' || (!localOnly && (opts.tokenFlag || opts.showPayload || opts.dryRun));
}

function assertFlagCompat(opts, wantsSync) {
	const localOnly = opts.command === 'report' || opts.command === 'wrapped';
	if (localOnly && (opts.tokenFlag || opts.showPayload || opts.dryRun)) {
		throw new Error(`${opts.command} is local-only and takes no sync flags (--token, --show-payload, --dry-run).`);
	}
	if (wantsSync && opts.json) {
		throw new Error('--json applies to the local report only, not sync.');
	}
}

function resolveSince(opts) {
	if (opts.since) return opts.since;
	if (opts.days) {
		const t = Date.now() - (opts.days - 1) * 86_400_000;
		return new Date(t).toISOString().slice(0, 10);
	}
	return '';
}

// The no-account trial: read local logs, price at list rates, print spend by branch.
async function runReport(opts) {
	const records = await scan({ since: resolveSince(opts) });
	const { data, text } = await buildReport(records);
	if (opts.json) process.stdout.write(JSON.stringify(data, null, 2) + '\n');
	else process.stdout.write(text);
}

// The shareable card: same local records, rendered as one screenshot-ready summary.
// Colour only when writing to a terminal and NO_COLOR is unset, so a pipe or a
// redirect captures clean text.
async function runWrapped(opts) {
	const records = await scan({ since: resolveSince(opts) });
	const { data, text } = await buildWrapped(records);
	if (opts.json) {
		process.stdout.write(JSON.stringify(data, null, 2) + '\n');
		return;
	}
	// NO_COLOR disables colour whenever the variable is present, empty or not (no-color.org).
	// The color-off card is already rendered by buildWrapped, so reuse it instead of re-rendering.
	const color = !!process.stdout.isTTY && !('NO_COLOR' in process.env);
	process.stdout.write(color ? renderCard(data, { color: true }) : text);
}

// The existing push path: ccusage -> daily rollups -> Goei ingest.
async function runSync(opts) {
	if (typeof fetch !== 'function') {
		throw new Error('goei-sync sync needs Node 18 or newer (global fetch). Upgrade Node and retry.');
	}
	const token = opts.token || process.env.GOEI_DEVICE_TOKEN || '';

	const willSend = !opts.showPayload && !opts.dryRun;
	if (willSend) {
		if (!validToken(token)) {
			throw new Error(
				'A Goei device token is required to sync. Pass --token goei_dt_... or set GOEI_DEVICE_TOKEN. Get one at https://goei.roninforge.org (Settings -> Device Tokens). Or run `npx goei-sync` with no token to see local spend by branch.'
			);
		}
		let url;
		try {
			url = new URL(opts.endpoint);
		} catch {
			throw new Error(`Invalid --endpoint URL: ${opts.endpoint}`);
		}
		const localhost = url.hostname === 'localhost' || url.hostname === '127.0.0.1';
		if (url.protocol !== 'https:' && !localhost) {
			throw new Error(`Refusing to send your token to a non-HTTPS endpoint (${opts.endpoint}).`);
		}
	}

	const sinceDate = resolveSince(opts);
	const data = runCcusage();
	const records = toSpendRecords(data.daily, sinceDate);
	if (records.length === 0) {
		process.stdout.write(`No usage found to sync${sinceDate ? ` since ${sinceDate}` : ''}.\n`);
		return;
	}
	const payloads = buildPayloads(records, opts.machine);

	if (opts.showPayload) {
		process.stdout.write(JSON.stringify(payloads.length === 1 ? payloads[0] : payloads, null, 2) + '\n');
		return;
	}

	const days = new Set(records.map((r) => r.periodStart.slice(0, 10))).size;
	const toks = totalTokens(records);
	if (opts.dryRun) {
		process.stdout.write(
			`Dry run: ${records.length} records across ${days} days (${toks.toLocaleString()} tokens) in ${payloads.length} request(s). Nothing sent.\n`
		);
		return;
	}

	let stored = 0;
	let counted = true;
	for (let i = 0; i < payloads.length; i++) {
		let n;
		try {
			n = await push(opts.endpoint, token, payloads[i]);
		} catch (err) {
			// Each batch commits independently server-side via an idempotent upsert, so a mid-run
			// failure never corrupts data and re-running is safe (duplicates are ignored).
			const extra =
				i > 0 ? ` (${i} of ${payloads.length} batches were already saved; re-running is safe)` : '';
			throw new Error(`${err && err.message ? err.message : err}${extra}`);
		}
		if (n === null) counted = false;
		else stored += n;
	}
	process.stdout.write(
		`Synced ${records.length} records across ${days} days as "${opts.machine}".` +
			(counted ? ` Goei stored ${stored}.` : '') +
			'\n' +
			'View them at https://goei.roninforge.org. For always-on sync plus per-project and per-branch caps, see https://github.com/RoninForge/budgetclaw\n'
	);
}

async function main() {
	const opts = parseArgs(process.argv.slice(2));
	if (opts.help) {
		process.stdout.write(HELP);
		return;
	}
	const wantsSync = routesToSync(opts);
	assertFlagCompat(opts, wantsSync);
	if (opts.command === 'wrapped') await runWrapped(opts);
	else if (wantsSync) await runSync(opts);
	else await runReport(opts);
}

if (require.main === module) {
	main().catch((err) => {
		process.stderr.write(`goei-sync: ${err && err.message ? err.message : err}\n`);
		process.exit(1);
	});
}

module.exports = { parseArgs, resolveSince, routesToSync, assertFlagCompat };
