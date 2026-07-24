'use strict';

const test = require('node:test');
const assert = require('node:assert');
const { parseArgs, resolveSince, routesToSync, assertFlagCompat } = require('../bin/goei-sync');

test('a bare invocation stays local even when GOEI_DEVICE_TOKEN is set in the environment', () => {
	const prev = process.env.GOEI_DEVICE_TOKEN;
	process.env.GOEI_DEVICE_TOKEN = 'goei_dt_' + 'a'.repeat(32);
	try {
		const opts = parseArgs([]);
		assert.equal(opts.tokenFlag, false);
		assert.equal(opts.token, '');
		assert.equal(routesToSync(opts), false);
	} finally {
		if (prev === undefined) delete process.env.GOEI_DEVICE_TOKEN;
		else process.env.GOEI_DEVICE_TOKEN = prev;
	}
});

test('an explicit --token flag routes to sync', () => {
	const opts = parseArgs(['--token', 'goei_dt_x']);
	assert.equal(opts.tokenFlag, true);
	assert.equal(routesToSync(opts), true);
});

test('the sync command routes to sync', () => {
	assert.equal(routesToSync(parseArgs(['sync'])), true);
});

test('the report command with a window stays local', () => {
	const opts = parseArgs(['report', '--days', '7']);
	assert.equal(opts.days, 7);
	assert.equal(routesToSync(opts), false);
});

test('the wrapped command with a window stays local', () => {
	const opts = parseArgs(['wrapped', '--days', '7']);
	assert.equal(opts.command, 'wrapped');
	assert.equal(opts.days, 7);
	assert.equal(routesToSync(opts), false);
});

test('a bare wrapped invocation stays local even when GOEI_DEVICE_TOKEN is set', () => {
	const prev = process.env.GOEI_DEVICE_TOKEN;
	process.env.GOEI_DEVICE_TOKEN = 'goei_dt_' + 'a'.repeat(32);
	try {
		assert.equal(routesToSync(parseArgs(['wrapped'])), false);
	} finally {
		if (prev === undefined) delete process.env.GOEI_DEVICE_TOKEN;
		else process.env.GOEI_DEVICE_TOKEN = prev;
	}
});

test('wrapped refuses every sync-only flag and never routes to the network', () => {
	for (const flag of [['--token', 'goei_dt_x'], ['--dry-run'], ['--show-payload']]) {
		const opts = parseArgs(['wrapped', ...flag]);
		assert.equal(routesToSync(opts), false);
		assert.throws(() => assertFlagCompat(opts, routesToSync(opts)), /wrapped is local-only/);
	}
});

test('--dry-run and --show-payload route to sync', () => {
	assert.equal(routesToSync(parseArgs(['--dry-run'])), true);
	assert.equal(routesToSync(parseArgs(['--show-payload'])), true);
});

test('rejects --json combined with sync', () => {
	const opts = parseArgs(['sync', '--json']);
	assert.throws(() => assertFlagCompat(opts, routesToSync(opts)), /--json applies to the local report/);
});

test('rejects sync-only flags under the report command', () => {
	const opts = parseArgs(['report', '--show-payload']);
	assert.throws(() => assertFlagCompat(opts, routesToSync(opts)), /report is local-only/);
});

test('rejects unknown flags', () => {
	assert.throws(() => parseArgs(['--nope']), /Unknown option/);
});

test('rejects a non-integer --days and a malformed --since', () => {
	assert.throws(() => parseArgs(['--days', 'x']), /--days must be a positive integer/);
	assert.throws(() => parseArgs(['--since', '2026-1-1']), /--since must be a YYYY-MM-DD date/);
});

test('resolveSince prefers --since over --days', () => {
	assert.equal(resolveSince(parseArgs(['--since', '2026-01-01'])), '2026-01-01');
	assert.equal(resolveSince(parseArgs([])), '');
});
