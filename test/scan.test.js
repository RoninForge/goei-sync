'use strict';

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { scan } = require('../lib/scan');

function tmpRoot() {
	const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'goei-scan-'));
	const root = path.join(dir, 'projects');
	fs.mkdirSync(root, { recursive: true });
	return root;
}

function writeLog(root, name, lines) {
	const sub = path.join(root, name);
	fs.mkdirSync(sub, { recursive: true });
	fs.writeFileSync(path.join(sub, 'session.jsonl'), lines.map((l) => JSON.stringify(l)).join('\n') + '\n');
}

const USAGE = {
	input_tokens: 100,
	output_tokens: 50,
	cache_read_input_tokens: 200,
	cache_creation_input_tokens: 40,
	cache_creation: { ephemeral_5m_input_tokens: 10, ephemeral_1h_input_tokens: 30 }
};

function assistant(o = {}) {
	return {
		type: 'assistant',
		requestId: o.requestId || 'r1',
		cwd: o.cwd || '/home/u/dev/acme',
		gitBranch: 'branch' in o ? o.branch : 'main',
		timestamp: `${o.date || '2026-07-20'}T10:00:00.000Z`,
		message: { model: o.model || 'claude-opus-4-8', id: o.id || 'm1', usage: o.usage || USAGE }
	};
}

test('attributes usage to project name and git branch, with the exact cache split', async () => {
	const root = tmpRoot();
	writeLog(root, 'p', [assistant()]);
	const recs = await scan({ root });
	assert.equal(recs.length, 1);
	assert.equal(recs[0].project, 'acme');
	assert.equal(recs[0].branch, 'main');
	assert.deepEqual(recs[0].tokens, {
		input: 100,
		output: 50,
		cache_read: 200,
		cache_write_5m: 10,
		cache_write_1h: 30
	});
});

test('dedupes a line re-written with the same message id and requestId', async () => {
	const root = tmpRoot();
	writeLog(root, 'p', [assistant(), assistant()]);
	const recs = await scan({ root });
	assert.equal(recs.length, 1);
});

test('keeps distinct messages that share a requestId but differ by message id', async () => {
	const root = tmpRoot();
	writeLog(root, 'p', [assistant({ id: 'a' }), assistant({ id: 'b' })]);
	const recs = await scan({ root });
	assert.equal(recs.length, 2);
});

test('since filter drops days before the cutoff', async () => {
	const root = tmpRoot();
	writeLog(root, 'p', [assistant({ id: 'old', date: '2026-07-01' }), assistant({ id: 'new', date: '2026-07-20' })]);
	const recs = await scan({ root, since: '2026-07-10' });
	assert.equal(recs.length, 1);
	assert.equal(recs[0].date, '2026-07-20');
});

test('falls back to combined cache-creation when the TTL split is absent', async () => {
	const root = tmpRoot();
	writeLog(root, 'p', [assistant({ usage: { input_tokens: 1, output_tokens: 1, cache_creation_input_tokens: 77 } })]);
	const recs = await scan({ root });
	assert.equal(recs[0].tokens.cache_write_5m, 77);
	assert.equal(recs[0].tokens.cache_write_1h, 0);
});

test('ignores non-assistant lines, lines without usage, and unparseable lines', async () => {
	const root = tmpRoot();
	const sub = path.join(root, 'p');
	fs.mkdirSync(sub, { recursive: true });
	fs.writeFileSync(
		path.join(sub, 'session.jsonl'),
		[
			JSON.stringify({ type: 'user', message: { content: 'hi' } }),
			JSON.stringify({ type: 'assistant', message: { model: 'x' } }),
			'{ not json',
			JSON.stringify(assistant())
		].join('\n') + '\n'
	);
	const recs = await scan({ root });
	assert.equal(recs.length, 1);
});

test('missing gitBranch is reported as (no branch)', async () => {
	const root = tmpRoot();
	writeLog(root, 'p', [assistant({ branch: '' })]);
	const recs = await scan({ root });
	assert.equal(recs[0].branch, '(no branch)');
});

test('returns nothing when the projects root does not exist', async () => {
	const recs = await scan({ root: path.join(os.tmpdir(), 'goei-does-not-exist-xyz', 'projects') });
	assert.deepEqual(recs, []);
});

test('uses the top-level usage totals and never sums the iterations array', async () => {
	const root = tmpRoot();
	const usage = {
		input_tokens: 100,
		output_tokens: 50,
		cache_read_input_tokens: 0,
		iterations: [
			{ input_tokens: 100, output_tokens: 50 },
			{ input_tokens: 100, output_tokens: 50 }
		]
	};
	writeLog(root, 'p', [assistant({ usage })]);
	const recs = await scan({ root });
	assert.equal(recs[0].tokens.input, 100);
	assert.equal(recs[0].tokens.output, 50);
});

test('skips an unreadable entry and still returns spend from the good logs', async () => {
	const root = tmpRoot();
	writeLog(root, 'good', [assistant()]);
	// A directory named like a log file makes createReadStream fail with EISDIR mid-scan.
	fs.mkdirSync(path.join(root, 'bad', 'session.jsonl'), { recursive: true });
	const recs = await scan({ root });
	assert.equal(recs.length, 1);
	assert.equal(recs[0].project, 'acme');
});

test('does not merge distinct events whose ids differ only by separator placement', async () => {
	const root = tmpRoot();
	writeLog(root, 'p', [assistant({ id: 'a|b', requestId: 'c' }), assistant({ id: 'a', requestId: 'b|c' })]);
	const recs = await scan({ root });
	assert.equal(recs.length, 2);
});

test('a JSON null line skips itself without discarding the rest of the file', async () => {
	const root = tmpRoot();
	const sub = path.join(root, 'p');
	fs.mkdirSync(sub, { recursive: true });
	fs.writeFileSync(path.join(sub, 'session.jsonl'), ['null', '42', JSON.stringify(assistant())].join('\n') + '\n');
	const recs = await scan({ root });
	assert.equal(recs.length, 1);
});

test('strips control bytes from project and branch so a rendered card cannot be broken', async () => {
	const root = tmpRoot();
	writeLog(root, 'p', [assistant({ cwd: '/home/u/dev/ac\x1b[31mme', branch: 'ma\x1b[0min' })]);
	const recs = await scan({ root });
	assert.equal(recs[0].project, 'ac[31mme');
	assert.equal(recs[0].branch, 'ma[0min');
	assert.ok(!/[\x00-\x1f\x7f]/.test(recs[0].project + recs[0].branch));
});

test('a project or branch made only of control bytes falls back to a placeholder', async () => {
	const root = tmpRoot();
	writeLog(root, 'p', [assistant({ cwd: '/home/u/dev/\x01\x02', branch: '\x1b' })]);
	const recs = await scan({ root });
	assert.equal(recs[0].project, '(unknown)');
	assert.equal(recs[0].branch, '(no branch)');
});

test('strips BiDi override and zero-width format characters from names', async () => {
	const root = tmpRoot();
	const rlo = String.fromCodePoint(0x202e), zwsp = String.fromCodePoint(0x200b), bom = String.fromCodePoint(0xfeff);
	writeLog(root, 'p', [assistant({ cwd: '/home/u/dev/nor' + rlo + 'mal', branch: 'a' + zwsp + 'b' + bom })]);
	const recs = await scan({ root });
	assert.equal(recs[0].project, 'normal');
	assert.equal(recs[0].branch, 'ab');
});

test('resolves the projects root from CLAUDE_CONFIG_DIR when set', () => {
	const { projectsRoot } = require('../lib/scan');
	const prev = process.env.CLAUDE_CONFIG_DIR;
	process.env.CLAUDE_CONFIG_DIR = path.join(os.tmpdir(), 'goei-cfg-xyz');
	try {
		assert.equal(projectsRoot(), path.join(os.tmpdir(), 'goei-cfg-xyz', 'projects'));
	} finally {
		if (prev === undefined) delete process.env.CLAUDE_CONFIG_DIR;
		else process.env.CLAUDE_CONFIG_DIR = prev;
	}
});
