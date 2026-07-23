'use strict';

const test = require('node:test');
const assert = require('node:assert');
const { buildReport } = require('../lib/report');

// Deterministic pricer mirroring the real engine's contract: $1 per 1,000,000
// tokens for known models, and { usd: 0, modelKnown: false } for the unknown one,
// so aggregation is tested without depending on live list prices.
function tokenTotal(t) {
	return t.input + t.output + t.cache_read + t.cache_write_5m + t.cache_write_1h;
}
const priceFn = (tokens, model) => {
	const known = model !== 'mystery';
	return { usd: known ? tokenTotal(tokens) / 1e6 : 0, modelKnown: known };
};

function rec(project, branch, model, n, date = '2026-07-20') {
	return { date, model, project, branch, tokens: { input: n, output: 0, cache_read: 0, cache_write_5m: 0, cache_write_1h: 0 } };
}

test('groups by project and branch and sorts by usd descending', async () => {
	const { data } = await buildReport(
		[
			rec('a', 'main', 'claude-opus-4-8', 3_000_000),
			rec('a', 'feature', 'claude-opus-4-8', 1_000_000),
			rec('a', 'main', 'claude-sonnet-5', 2_000_000)
		],
		{ priceFn }
	);
	assert.equal(data.branches.length, 2);
	assert.deepEqual(data.branches[0], { project: 'a', branch: 'main', usd: 5, tokens: 5_000_000 });
	assert.deepEqual(data.branches[1], { project: 'a', branch: 'feature', usd: 1, tokens: 1_000_000 });
	assert.deepEqual(data.total, { usd: 6, tokens: 6_000_000 });
	assert.deepEqual(data.topBranch, { project: 'a', branch: 'main', usd: 5, tokens: 5_000_000 });
});

test('breaks down by model sorted by usd descending', async () => {
	const { data } = await buildReport(
		[rec('a', 'main', 'claude-opus-4-8', 1_000_000), rec('a', 'main', 'claude-sonnet-5', 4_000_000)],
		{ priceFn }
	);
	assert.equal(data.models[0].model, 'claude-sonnet-5');
	assert.equal(data.models[0].usd, 4);
	assert.equal(data.models[1].model, 'claude-opus-4-8');
	assert.equal(data.models[1].usd, 1);
});

test('flags unpriced models but still counts their tokens at $0', async () => {
	const { data } = await buildReport([rec('a', 'main', 'mystery', 2_000_000)], { priceFn });
	assert.deepEqual(data.unpricedModels, ['mystery']);
	assert.equal(data.total.tokens, 2_000_000);
	assert.equal(data.total.usd, 0);
});

test('carries the not-a-bill disclaimer in both data and text', async () => {
	const { data, text } = await buildReport([rec('a', 'main', 'claude-opus-4-8', 1_000_000)], { priceFn });
	assert.match(data.disclaimer, /Not your provider bill/);
	assert.match(text, /Not your provider bill/);
	assert.match(text, /Top branch: a\/main/);
	assert.match(text, /By model:/);
});

test('rounds reported usd to cents', async () => {
	const { data } = await buildReport([rec('a', 'main', 'claude-opus-4-8', 1_234_567)], { priceFn });
	assert.equal(data.total.usd, 1.23);
});

test('the printed TOTAL matches data.total.usd for fractional-cent inputs', async () => {
	// Three half-cent records across three branches: the classic round-then-sum trap where
	// the text table and the JSON total used to diverge.
	const halfCent = () => ({ usd: 0.005, modelKnown: true });
	const { data, text } = await buildReport(
		[rec('a', 'b1', 'claude-x', 1), rec('a', 'b2', 'claude-x', 1), rec('a', 'b3', 'claude-x', 1)],
		{ priceFn: halfCent }
	);
	const totalLine = text.split('\n').find((l) => l.startsWith('TOTAL'));
	assert.ok(totalLine.includes('$' + data.total.usd.toFixed(2)), `TOTAL line "${totalLine}" must show $${data.total.usd.toFixed(2)}`);
});

test('empty input yields empty data and a friendly, non-crashing message', async () => {
	const { data, text } = await buildReport([]);
	assert.deepEqual(data.branches, []);
	assert.deepEqual(data.models, []);
	assert.equal(data.total.usd, 0);
	assert.equal(data.topBranch, null);
	assert.match(data.disclaimer, /Not your provider bill/);
	assert.match(text, /No Claude Code usage found/);
});
