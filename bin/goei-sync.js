#!/usr/bin/env node
'use strict';

const os = require('node:os');
const { runCcusage } = require('../lib/ccusage');
const { toSpendRecords, buildPayloads, totalTokens } = require('../lib/payload');
const { DEFAULT_ENDPOINT, validToken, push } = require('../lib/ingest');

const HELP = `goei-sync - push local Claude Code usage to Goei

Usage:
  npx goei-sync --token goei_dt_xxxxxxxx [--days 30]

Reads your local Claude Code usage through ccusage and sends daily token
rollups to Goei, which prices them. Zero API keys, no prompt content,
nothing in your request path.

Options:
  --token <t>       Goei device token (or set GOEI_DEVICE_TOKEN)
  --days <n>        sync the last n days (default: all history ccusage has)
  --since <date>    sync from YYYY-MM-DD forward (overrides --days)
  --machine <id>    machine label for dedupe (default: this host's name)
  --endpoint <url>  ingest endpoint (default: ${DEFAULT_ENDPOINT})
  --show-payload    print the exact JSON that would be sent, then exit (no token needed)
  --dry-run         run ccusage and summarize, but send nothing (no token needed)
  -h, --help        show this help

Get a device token at https://goei.roninforge.org (Settings -> Device Tokens).
For always-on sync plus per-project and per-git-branch attribution and hard
spend caps, install budgetclaw: https://github.com/RoninForge/budgetclaw
`;

function parseArgs(argv) {
	const opts = {
		days: null,
		since: null,
		machine: os.hostname(),
		endpoint: DEFAULT_ENDPOINT,
		token: process.env.GOEI_DEVICE_TOKEN || '',
		showPayload: false,
		dryRun: false,
		help: false
	};
	for (let i = 0; i < argv.length; i++) {
		const a = argv[i];
		const next = () => argv[++i];
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
			case '--token':
				opts.token = next() || '';
				break;
			case '--machine':
				opts.machine = next() || opts.machine;
				break;
			case '--endpoint':
				opts.endpoint = next() || opts.endpoint;
				break;
			case '--days': {
				const v = Number(next());
				if (!Number.isInteger(v) || v <= 0) throw new Error('--days must be a positive integer.');
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

function resolveSince(opts) {
	if (opts.since) return opts.since;
	if (opts.days) {
		const t = Date.now() - (opts.days - 1) * 86_400_000;
		return new Date(t).toISOString().slice(0, 10);
	}
	return '';
}

async function main() {
	const opts = parseArgs(process.argv.slice(2));
	if (opts.help) {
		process.stdout.write(HELP);
		return;
	}

	if (typeof fetch !== 'function') {
		throw new Error('goei-sync needs Node 18 or newer (global fetch). Upgrade Node and retry.');
	}

	const willSend = !opts.showPayload && !opts.dryRun;
	if (willSend) {
		if (!validToken(opts.token)) {
			throw new Error(
				'A Goei device token is required. Pass --token goei_dt_... or set GOEI_DEVICE_TOKEN. Get one at https://goei.roninforge.org (Settings -> Device Tokens).'
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
		process.stdout.write(
			JSON.stringify(payloads.length === 1 ? payloads[0] : payloads, null, 2) + '\n'
		);
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
			n = await push(opts.endpoint, opts.token, payloads[i]);
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

main().catch((err) => {
	process.stderr.write(`goei-sync: ${err && err.message ? err.message : err}\n`);
	process.exit(1);
});
