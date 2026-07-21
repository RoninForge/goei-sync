'use strict';

const { execFileSync } = require('node:child_process');

// Runs ccusage and returns its parsed daily JSON. Prefers a ccusage already on PATH; if none is
// installed, pulls ccusage's v20 line with npx on demand. ccusage reads the session logs Claude
// Code already writes to local disk; goei-sync never touches API traffic, prompts, responses, or
// keys. --timezone UTC keeps day boundaries stable across machines. dayOf() in payload.js tolerates
// both the v17 `date` and v20 `period` bucket shapes, so any v20.x release works.
const MAX_BUFFER = 64 * 1024 * 1024;
const CCUSAGE_PIN = 'ccusage@20';

function runCcusage() {
	const args = ['--json', '--timezone', 'UTC'];
	let out;
	try {
		out = execFileSync('ccusage', args, { maxBuffer: MAX_BUFFER, encoding: 'utf8' });
	} catch (err) {
		if (err && err.code === 'ENOENT') {
			out = execFileSync('npx', ['-y', CCUSAGE_PIN, ...args], {
				maxBuffer: MAX_BUFFER,
				encoding: 'utf8'
			});
		} else {
			throw err;
		}
	}

	let data;
	try {
		data = JSON.parse(out);
	} catch {
		throw new Error(
			'ccusage did not return valid JSON. Run `ccusage --json` yourself to check it works.'
		);
	}
	if (!data || !Array.isArray(data.daily)) {
		throw new Error(
			'ccusage JSON had no `daily` array. goei-sync expects the default `ccusage --json` daily report.'
		);
	}
	return data;
}

module.exports = { runCcusage };
