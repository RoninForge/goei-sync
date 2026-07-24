'use strict';

// Local read path for the no-account report. Reads the JSONL session logs Claude
// Code already writes under ~/.claude/projects, attributes each assistant message
// to {project, git branch} from the line's own `cwd` and `gitBranch` fields, and
// returns token rollups at (date, project, branch, model) grain. Nothing leaves
// the machine; this never touches an API key. The sync path uses ccusage instead
// (see lib/ccusage.js); this exists because ccusage cannot attribute by git branch.

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const readline = require('node:readline');

const DAY_RE = /^\d{4}-\d{2}-\d{2}$/;

// The project comes from a filesystem path and the branch from a git ref, both outside our
// control. Drop C0 control bytes (including ESC) plus the Unicode BiDi and zero-width format
// characters (right-to-left override and friends, the "Trojan Source" class) so a directory
// or branch named with an embedded ANSI sequence or a reversing control cannot break a
// rendered column width, bleed colour, or visually reorder text on a shareable card. Ranges
// are numeric so they stay reviewable; real paths and refs never contain these, so cleanName
// is a no-op for every genuine input.
function isFormatOrControl(cp) {
	return (
		cp <= 0x1f || // C0 control bytes
		cp === 0x7f || // DEL
		cp === 0x061c || // Arabic letter mark
		(cp >= 0x200b && cp <= 0x200f) || // zero-width space/joiners, LRM, RLM
		(cp >= 0x202a && cp <= 0x202e) || // BiDi embeddings, overrides, pop
		(cp >= 0x2060 && cp <= 0x2064) || // word joiner, invisible operators
		(cp >= 0x2066 && cp <= 0x2069) || // BiDi isolates
		cp === 0xfeff // BOM / zero-width no-break space
	);
}

function cleanName(s) {
	let out = '';
	for (const ch of String(s == null ? '' : s)) {
		if (!isFormatOrControl(ch.codePointAt(0))) out += ch;
	}
	return out;
}

function projectsRoot() {
	const base = process.env.CLAUDE_CONFIG_DIR
		? process.env.CLAUDE_CONFIG_DIR
		: path.join(os.homedir(), '.claude');
	return path.join(base, 'projects');
}

function listLogFiles(root) {
	let dirs;
	try {
		dirs = fs.readdirSync(root, { withFileTypes: true });
	} catch {
		return [];
	}
	const files = [];
	for (const d of dirs) {
		if (!d.isDirectory()) continue;
		const sub = path.join(root, d.name);
		let entries;
		try {
			entries = fs.readdirSync(sub);
		} catch {
			continue;
		}
		for (const e of entries) if (e.endsWith('.jsonl')) files.push(path.join(sub, e));
	}
	return files;
}

function tokInt(v) {
	const n = typeof v === 'number' ? v : Number(v);
	return Number.isFinite(n) && n > 0 ? Math.floor(n) : 0;
}

function projectName(cwd) {
	if (typeof cwd !== 'string' || !cwd) return '(unknown)';
	const base = path.basename(cwd);
	return base || '(unknown)';
}

// Read every session log and return usage records, deduped by the Anthropic
// message id + requestId so a line re-written on session resume is not counted
// twice. A single unreadable, truncated, or mid-scan-deleted file is skipped, the
// same way a malformed JSON line is, so one bad file never sinks the whole report.
async function scan(opts = {}) {
	const since = opts.since || '';
	const root = opts.root || projectsRoot();
	const files = listLogFiles(root);
	const seen = new Set();
	const records = [];

	for (const file of files) {
		let stream;
		try {
			stream = fs.createReadStream(file, { encoding: 'utf8' });
		} catch {
			continue;
		}
		const rl = readline.createInterface({ input: stream, crlfDelay: Infinity });
		try {
			for await (const line of rl) {
				if (!line) continue;
				let d;
				try {
					d = JSON.parse(line);
				} catch {
					continue;
				}
				// A line can parse as valid JSON yet be null or a non-object (e.g. a bare `null`);
				// guard before any property access so one such line skips itself, not the whole file.
				if (!d || typeof d !== 'object') continue;
				if (d.type !== 'assistant') continue;
				const msg = d.message;
				if (!msg || typeof msg !== 'object') continue;
				const usage = msg.usage;
				if (!usage || typeof usage !== 'object') continue;

				const date = typeof d.timestamp === 'string' ? d.timestamp.slice(0, 10) : '';
				if (!DAY_RE.test(date)) continue;
				if (since && date < since) continue;

				// Dedupe on (message id, requestId) via a JSON tuple so no separator character can
				// let two distinct events collide onto one key. Only dedupe when at least one id is
				// present; an event carrying neither is never treated as a duplicate of another.
				if (msg.id || d.requestId) {
					const key = JSON.stringify([msg.id || '', d.requestId || '']);
					if (seen.has(key)) continue;
					seen.add(key);
				}

				const cc = usage.cache_creation && typeof usage.cache_creation === 'object' ? usage.cache_creation : {};
				const tokens = {
					input: tokInt(usage.input_tokens),
					output: tokInt(usage.output_tokens),
					cache_read: tokInt(usage.cache_read_input_tokens),
					cache_write_5m: tokInt(cc.ephemeral_5m_input_tokens),
					cache_write_1h: tokInt(cc.ephemeral_1h_input_tokens)
				};
				// Older logs report a single combined cache-creation with no TTL split; treat it as
				// 5-minute (priced 1.25x input, the lower cache-write rate) rather than drop it.
				if (!tokens.cache_write_5m && !tokens.cache_write_1h) {
					tokens.cache_write_5m = tokInt(usage.cache_creation_input_tokens);
				}
				if (!(tokens.input || tokens.output || tokens.cache_read || tokens.cache_write_5m || tokens.cache_write_1h)) {
					continue;
				}

				const branch = cleanName(typeof d.gitBranch === 'string' ? d.gitBranch : '');
				const model = cleanName(typeof msg.model === 'string' ? msg.model : '');
				records.push({
					date,
					model,
					project: cleanName(projectName(d.cwd)) || '(unknown)',
					branch: branch || '(no branch)',
					tokens
				});
			}
		} catch {
			// An unreadable or truncated file surfaces as an async stream error here; skip it and
			// keep the spend from every other log rather than failing the whole command.
		} finally {
			rl.close();
		}
	}
	return records;
}

module.exports = { scan, projectsRoot, listLogFiles };
