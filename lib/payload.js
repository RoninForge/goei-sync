'use strict';

// Turns ccusage daily rows into Goei spend records at (day, model) grain. The records carry
// token counts only; Goei prices them point-in-time server-side, so goei-sync never ships a
// pricing table. Records are grouped into request-sized payloads, each stamped with a stable
// machine identity so Goei can dedupe across a person's machines.

const PROVIDER = 'anthropic';
// Hard record ceiling per request (the server rejects > 5000). The byte budget below is the real
// limiter for long histories: adapter-node's default BODY_SIZE_LIMIT is 512 KB, so we pack each
// request well under that (a 4000-record chunk can serialize to ~900 KB and would 413).
const MAX_SPEND_PER_REQUEST = 4000;
const MAX_BYTES_PER_REQUEST = 450 * 1024;

const DAY_RE = /^\d{4}-\d{2}-\d{2}$/;

// [start, end) UTC bounds for a YYYY-MM-DD day: `${day}T00:00:00Z` to the next day at 00:00:00Z.
function dayBounds(day) {
	const start = `${day}T00:00:00Z`;
	const next = new Date(
		Date.UTC(Number(day.slice(0, 4)), Number(day.slice(5, 7)) - 1, Number(day.slice(8, 10)) + 1)
	);
	const end = next.toISOString().replace(/\.\d{3}Z$/, 'Z');
	return { start, end };
}

function tokenInt(v) {
	const n = typeof v === 'number' ? v : Number(v);
	return Number.isFinite(n) && n > 0 ? Math.floor(n) : 0;
}

function rollup(o) {
	return {
		input: tokenInt(o.inputTokens),
		output: tokenInt(o.outputTokens),
		cache_read: tokenInt(o.cacheReadTokens),
		// ccusage reports a single combined `cacheCreationTokens` with no 5-minute vs 1-hour TTL
		// split, so all cache-creation tokens are sent as 5-minute writes (priced 1.25x input).
		// Usage that actually used 1-hour cache (priced 2x) is therefore valued slightly low by
		// Goei. budgetclaw reads the raw session logs and reports the exact split; see the README.
		cache_write_5m: tokenInt(o.cacheCreationTokens),
		cache_write_1h: 0
	};
}

function isZero(t) {
	return !(t.input || t.output || t.cache_read || t.cache_write_5m || t.cache_write_1h);
}

// ccusage <= v17 puts the day in `date`; v20+ renamed it to a unified `period` (the legacy key is
// now null). Daily rows are "YYYY-MM-DD" either way, so accept whichever is present.
function dayOf(row) {
	const d =
		typeof row.date === 'string' && row.date
			? row.date
			: typeof row.period === 'string'
				? row.period
				: '';
	return DAY_RE.test(d) ? d : '';
}

// Map ccusage daily rows to spend records, keeping only days on/after sinceDate (if given).
// Prefers per-model `modelBreakdowns`; falls back to the day aggregate under its single model
// (or unattributed). Skips all-zero rows.
function toSpendRecords(dailyRows, sinceDate) {
	const records = [];
	for (const row of dailyRows) {
		const day = dayOf(row);
		if (!day) continue;
		if (sinceDate && day < sinceDate) continue;
		const { start, end } = dayBounds(day);

		const breakdowns = Array.isArray(row.modelBreakdowns) ? row.modelBreakdowns : [];
		if (breakdowns.length > 0) {
			for (const mb of breakdowns) {
				const tokens = rollup(mb);
				if (isZero(tokens)) continue;
				records.push({
					periodStart: start,
					periodEnd: end,
					currency: 'USD',
					model: String(mb.modelName || mb.model || ''),
					project: '',
					branch: '',
					tokens
				});
			}
			continue;
		}

		const tokens = rollup(row);
		if (isZero(tokens)) continue;
		const models = Array.isArray(row.modelsUsed)
			? row.modelsUsed.filter((m) => typeof m === 'string' && m)
			: [];
		records.push({
			periodStart: start,
			periodEnd: end,
			currency: 'USD',
			model: models.length === 1 ? String(models[0]) : '',
			project: '',
			branch: '',
			tokens
		});
	}
	return records;
}

function totalTokens(records) {
	let n = 0;
	for (const r of records) {
		const t = r.tokens;
		n += t.input + t.output + t.cache_read + t.cache_write_5m + t.cache_write_1h;
	}
	return n;
}

// Split records into request-sized payloads, each stamped with the machine identity. Bounds each
// payload by serialized byte size (primary) and record count (secondary) so a long history never
// trips the server's body-size limit.
function buildPayloads(records, machine) {
	const payloads = [];
	let chunk = [];
	let bytes = 0;
	const flush = () => {
		if (chunk.length > 0) {
			payloads.push({ provider: PROVIDER, machine, spend: chunk });
			chunk = [];
			bytes = 0;
		}
	};
	for (const r of records) {
		const size = Buffer.byteLength(JSON.stringify(r)) + 1; // +1 for the array separator
		if (chunk.length > 0 && (bytes + size > MAX_BYTES_PER_REQUEST || chunk.length >= MAX_SPEND_PER_REQUEST)) {
			flush();
		}
		chunk.push(r);
		bytes += size;
	}
	flush();
	return payloads;
}

module.exports = {
	PROVIDER,
	MAX_SPEND_PER_REQUEST,
	dayBounds,
	dayOf,
	toSpendRecords,
	buildPayloads,
	totalTokens
};
