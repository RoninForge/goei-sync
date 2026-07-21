'use strict';

// Posts one payload to the Goei ingest endpoint with a device token. Uses global fetch (Node 18+)
// with a hard 30s timeout so a hung network never wedges the CLI. Returns the count of records
// Goei confirms it stored (or null if the server did not report one).

const DEFAULT_ENDPOINT = 'https://goei.roninforge.org/api/ingest';

// Device tokens are `goei_dt_` + 32 chars = 40 total.
function validToken(t) {
	return typeof t === 'string' && t.length === 40 && t.startsWith('goei_dt_');
}

async function push(endpoint, token, payload) {
	let res;
	try {
		res = await fetch(endpoint, {
			method: 'POST',
			headers: {
				'content-type': 'application/json',
				authorization: `Bearer ${token}`
			},
			body: JSON.stringify(payload),
			signal: AbortSignal.timeout(30_000)
		});
	} catch (err) {
		if (err && (err.name === 'TimeoutError' || err.name === 'AbortError')) {
			throw new Error(`Goei did not respond within 30s (${endpoint}). Check your connection and retry.`);
		}
		throw new Error(`Could not reach Goei at ${endpoint}: ${err && err.message ? err.message : err}`);
	}

	const text = await res.text();
	if (!res.ok) {
		throw new Error(`Goei rejected the sync (HTTP ${res.status}): ${text.slice(0, 300)}`);
	}
	let body = {};
	try {
		body = JSON.parse(text);
	} catch {
		// Tolerate an empty/non-JSON success body.
	}
	return typeof body.records === 'number' ? body.records : null;
}

module.exports = { DEFAULT_ENDPOINT, validToken, push };
