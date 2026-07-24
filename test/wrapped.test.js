'use strict';

const test = require('node:test');
const assert = require('node:assert');
const { buildWrapped, renderCard } = require('../lib/wrapped');

// Deterministic list rates ($/Mtok): input 3, output 15, cache_read 0.30,
// cache_write_5m 3.75, cache_write_1h 6. Lets the aggregation be checked by hand.
function pricer(known = true) {
	return (t) => ({
		usd: (t.input * 3 + t.output * 15 + t.cache_read * 0.3 + t.cache_write_5m * 3.75 + t.cache_write_1h * 6) / 1e6,
		modelKnown: known
	});
}

function rec(o) {
	return {
		date: o.date,
		model: o.model || 'claude-opus-4-8',
		project: o.project,
		branch: o.branch,
		tokens: Object.assign({ input: 0, output: 0, cache_read: 0, cache_write_5m: 0, cache_write_1h: 0 }, o.tokens)
	};
}

const RECORDS = [
	rec({ date: '2026-07-01', project: 'projA', branch: 'main', tokens: { input: 1_000_000 } }),
	rec({ date: '2026-07-01', project: 'projA', branch: 'main', tokens: { cache_read: 1_000_000 } }),
	rec({ date: '2026-07-02', project: 'projB', branch: 'dev', model: 'claude-sonnet-5', tokens: { input: 1_000_000 } })
];

test('totals value, active days, and project/branch counts', async () => {
	const { data } = await buildWrapped(RECORDS, { priceFn: pricer() });
	assert.equal(data.total.usd, 6.3);
	assert.equal(data.activeDays, 2);
	assert.equal(data.projectCount, 2);
	assert.equal(data.branchCount, 2);
	assert.equal(data.range.from, '2026-07-01');
	assert.equal(data.range.to, '2026-07-02');
});

test('caching saved is the net counterfactual of the same tokens billed as plain input', async () => {
	const { data } = await buildWrapped(RECORDS, { priceFn: pricer() });
	// 1M cache reads cost $0.30 but would cost $3.00 as input: $2.70 saved.
	assert.equal(data.cacheSavedUsd, 2.7);
});

test('picks the biggest project, branch, and day by value', async () => {
	const { data } = await buildWrapped(RECORDS, { priceFn: pricer() });
	assert.equal(data.topProject.project, 'projA');
	assert.equal(data.topProject.usd, 3.3);
	assert.equal(Math.round(data.topProject.share * 100), 52);
	assert.equal(data.topBranch.project, 'projA');
	assert.equal(data.topBranch.branch, 'main');
	assert.equal(data.topBranch.usd, 3.3);
	assert.equal(data.busiestDay.date, '2026-07-01');
	assert.equal(data.busiestDay.usd, 3.3);
});

test('orders the model mix by value, highest first', async () => {
	const { data } = await buildWrapped(RECORDS, { priceFn: pricer() });
	assert.equal(data.models[0].model, 'claude-opus-4-8');
	assert.equal(data.models[1].model, 'claude-sonnet-5');
});

test('never claims negative caching savings', async () => {
	// Cache writes cost more than input; a write-only record must not push savings below zero.
	const writeOnly = [rec({ date: '2026-07-01', project: 'p', branch: 'b', tokens: { cache_write_1h: 1_000_000 } })];
	const { data } = await buildWrapped(writeOnly, { priceFn: pricer() });
	assert.equal(data.cacheSavedUsd, 0);
});

test('surfaces unpriced models rather than silently zeroing them', async () => {
	const recs = [rec({ date: '2026-07-01', project: 'p', branch: 'b', model: 'claude-future-9', tokens: { input: 1000 } })];
	const { data } = await buildWrapped(recs, { priceFn: pricer(false) });
	assert.deepEqual(data.unpricedModels, ['claude-future-9']);
});

test('empty logs render a friendly prompt, not a broken card', async () => {
	const { data, text } = await buildWrapped([]);
	assert.equal(data.activeDays, 0);
	assert.match(text, /No Claude Code usage found/);
});

test('color off emits no ANSI; color on wraps the card in escape codes', async () => {
	const { data } = await buildWrapped(RECORDS, { priceFn: pricer() });
	const plain = renderCard(data, { color: false });
	const colored = renderCard(data, { color: true });
	assert.ok(!plain.includes('\x1b['));
	assert.ok(colored.includes('\x1b['));
});

test('caching savings stays a finite number when a record omits the cache-write fields', async () => {
	const safe = (t) => ({ usd: ((t.input || 0) * 3 + (t.output || 0) * 15 + (t.cache_read || 0) * 0.3) / 1e6, modelKnown: true });
	const partial = [{ date: '2026-07-01', model: 'claude-opus-4-8', project: 'p', branch: 'b', tokens: { input: 1_000_000, output: 0, cache_read: 1_000_000 } }];
	const { data } = await buildWrapped(partial, { priceFn: safe });
	assert.ok(Number.isFinite(data.cacheSavedUsd));
	assert.equal(data.cacheSavedUsd, 2.7);
});

// Independent display-width measure (numeric ranges, decoupled from the module) used to
// prove the box borders stay aligned for wide CJK and astral emoji names.
function displayWidth(s) {
	let w = 0;
	for (const ch of s) {
		const cp = ch.codePointAt(0);
		const wide =
			cp >= 0x1f000 ||
			(cp >= 0x1100 && cp <= 0x115f) ||
			(cp >= 0x2e80 && cp <= 0x303e) ||
			(cp >= 0x3041 && cp <= 0x33ff) ||
			(cp >= 0x3400 && cp <= 0x4dbf) ||
			(cp >= 0x4e00 && cp <= 0x9fff) ||
			(cp >= 0xac00 && cp <= 0xd7a3) ||
			(cp >= 0xff00 && cp <= 0xff60) ||
			(cp >= 0xffe0 && cp <= 0xffe6);
		w += wide ? 2 : 1;
	}
	return w;
}

test('renders a fixed-width card for CJK and emoji names, no border drift, no mojibake', async () => {
	const recs = [
		rec({ date: '2026-07-01', project: '中文项目', branch: '功能', tokens: { input: 5_000_000, cache_read: 2_000_000 } }),
		rec({ date: '2026-07-02', project: 'rockets', branch: '\u{1F680}'.repeat(40), tokens: { input: 1_000_000 } })
	];
	const { text } = await buildWrapped(recs, { priceFn: pricer() });
	const framed = text.split('\n').filter((l) => /^[┌│├└]/.test(l));
	assert.ok(framed.length > 0);
	assert.equal(new Set(framed.map(displayWidth)).size, 1);
	assert.ok(!/[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/.test(text));
});
