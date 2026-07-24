'use strict';

// Builds "Claude Code Wrapped": a single, screenshot-ready card summarising the
// list-price value of the Claude Code usage already on this machine. It is the
// shareable sibling of the by-branch report and reuses the same scanned records
// and the same injectable pricer.
//
// Every figure here is LOCAL usage value at published list prices. It is NOT a
// provider bill and must never be presented as one: a real invoice reflects a
// subscription, negotiated rates, and credits this cannot see. The one number
// that is a comparison, "caching saved", is the honest net counterfactual: what
// the same tokens would have cost billed as plain input with no cache at all,
// minus what they actually cost with caching. Reads dominate and price at a
// fraction of input, so this stays positive and is not an overclaim.

const PROVIDER = 'anthropic';
const DISCLAIMER = 'Local usage value at list prices. Not your provider bill.';
const WIDTH = 60;

async function defaultPricer() {
	const pi = await import('ai-price-index');
	return (tokens, model, date) => pi.usdForRollupRaw(tokens, PROVIDER, model, date);
}

function round2(n) {
	return Math.round(n * 100) / 100;
}

// The card deliberately uses thousands separators ($12,244.23) for readability on a figure
// meant to be screenshotted; the report table (report.js) uses plain toFixed for column
// alignment. Both read from the same round2'd value, so no figure ever disagrees.
function fmtUsd(usd) {
	return '$' + usd.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function shortModel(m) {
	if (!m) return '(unknown)';
	return m.startsWith('claude-') ? m.slice('claude-'.length) : m;
}

// The card is a fixed-width box, so widths must be counted in terminal columns, not UTF-16
// code units: East Asian wide / full-width characters and most emoji occupy two columns, and
// slicing on code units can split a surrogate pair into a lone half that renders as a mojibake
// glyph. charWidth iterates by code point and treats the standard wide ranges (UAX #11, given
// here as numeric pairs so they stay reviewable) plus astral pictographs as two columns. It is
// a good approximation, not perfect (zero-width-joiner emoji can still drift), but it keeps a
// CJK or emoji project name from knocking the box border out of line in a screenshot.
const WIDE_RANGES = [
	[0x1100, 0x115f], [0x2329, 0x232a], [0x2e80, 0x303e], [0x3041, 0x33ff],
	[0x3400, 0x4dbf], [0x4e00, 0x9fff], [0xa000, 0xa4cf], [0xac00, 0xd7a3],
	[0xf900, 0xfaff], [0xfe10, 0xfe19], [0xfe30, 0xfe6f], [0xff00, 0xff60], [0xffe0, 0xffe6]
];

function charWidth(ch) {
	const cp = ch.codePointAt(0);
	if (cp >= 0x1f000) return 2;
	for (const [lo, hi] of WIDE_RANGES) if (cp >= lo && cp <= hi) return 2;
	return 1;
}

function displayWidth(s) {
	let w = 0;
	for (const ch of String(s == null ? '' : s)) w += charWidth(ch);
	return w;
}

function clip(s, cols) {
	s = String(s == null ? '' : s);
	if (displayWidth(s) <= cols) return s;
	let out = '';
	let w = 0;
	for (const ch of s) {
		const cw = charWidth(ch);
		if (w + cw > cols - 1) break;
		out += ch;
		w += cw;
	}
	return out + '…';
}

function padEnd(s, cols) {
	s = String(s);
	const w = displayWidth(s);
	return w >= cols ? s : s + ' '.repeat(cols - w);
}

function padStart(s, cols) {
	s = String(s);
	const w = displayWidth(s);
	return w >= cols ? s : ' '.repeat(cols - w) + s;
}

function num(v) {
	return typeof v === 'number' && Number.isFinite(v) ? v : 0;
}

// A record's tokens rebilled as if there were no prompt cache at all: every cached read and
// every cache write becomes a plain input token. Fields are coerced to finite numbers so a
// record missing a token field can never turn the headline "caching saved" figure into a
// silent NaN, which would drop the row from the card without any error.
function withoutCache(t) {
	return {
		input: num(t.input) + num(t.cache_read) + num(t.cache_write_5m) + num(t.cache_write_1h),
		output: num(t.output),
		cache_read: 0,
		cache_write_5m: 0,
		cache_write_1h: 0
	};
}

function emptyData() {
	return {
		range: { from: null, to: null },
		total: { usd: 0 },
		activeDays: 0,
		projectCount: 0,
		branchCount: 0,
		cacheSavedUsd: 0,
		topProject: null,
		topBranch: null,
		busiestDay: null,
		models: [],
		unpricedModels: [],
		disclaimer: DISCLAIMER
	};
}

// Aggregate scanned records into the Wrapped summary. USD is summed as float and
// rounded once, here, so the card and the --json output can never disagree.
async function buildWrapped(records, opts = {}) {
	if (!records || records.length === 0) {
		const data = emptyData();
		return { data, text: renderCard(data, { color: false }) };
	}
	const priceFn = opts.priceFn || (await defaultPricer());

	const projectMap = new Map();
	const branchMap = new Map();
	const modelMap = new Map();
	const dayMap = new Map();
	const projects = new Set();
	const branches = new Set();
	const days = new Set();
	const unpriced = new Set();
	let total = 0;
	let saved = 0;
	let minDate = '';
	let maxDate = '';

	for (const r of records) {
		const { usd, modelKnown } = priceFn(r.tokens, r.model, r.date);
		if (!modelKnown && r.model) unpriced.add(r.model);
		const noCache = priceFn(withoutCache(r.tokens), r.model, r.date).usd;

		total += usd;
		saved += noCache - usd;

		projectMap.set(r.project, (projectMap.get(r.project) || 0) + usd);
		const bKey = JSON.stringify([r.project, r.branch]);
		branchMap.set(bKey, (branchMap.get(bKey) || 0) + usd);
		const mKey = r.model || '';
		modelMap.set(mKey, (modelMap.get(mKey) || 0) + usd);
		dayMap.set(r.date, (dayMap.get(r.date) || 0) + usd);

		projects.add(r.project);
		branches.add(bKey);
		days.add(r.date);
		if (!minDate || r.date < minDate) minDate = r.date;
		if (!maxDate || r.date > maxDate) maxDate = r.date;
	}

	const topProjectEntry = [...projectMap.entries()].sort((a, b) => b[1] - a[1])[0];
	const topBranchKey = [...branchMap.entries()].sort((a, b) => b[1] - a[1])[0];
	const busiest = [...dayMap.entries()].sort((a, b) => b[1] - a[1])[0];
	const models = [...modelMap.entries()]
		.map(([model, usd]) => ({ model, usd: round2(usd), share: total > 0 ? usd / total : 0 }))
		.sort((a, b) => b.usd - a.usd);

	const topBranchParsed = topBranchKey ? JSON.parse(topBranchKey[0]) : null;

	const data = {
		range: { from: minDate, to: maxDate },
		total: { usd: round2(total) },
		activeDays: days.size,
		projectCount: projects.size,
		branchCount: branches.size,
		cacheSavedUsd: round2(Math.max(0, saved)),
		topProject: topProjectEntry
			? { project: topProjectEntry[0], usd: round2(topProjectEntry[1]), share: total > 0 ? topProjectEntry[1] / total : 0 }
			: null,
		topBranch: topBranchParsed
			? { project: topBranchParsed[0], branch: topBranchParsed[1], usd: round2(topBranchKey[1]) }
			: null,
		busiestDay: busiest ? { date: busiest[0], usd: round2(busiest[1]) } : null,
		models,
		unpricedModels: [...unpriced],
		disclaimer: DISCLAIMER
	};

	return { data, text: renderCard(data, { color: false }) };
}

const ANSI = { reset: '\x1b[0m', bold: '\x1b[1m', dim: '\x1b[2m', cyan: '\x1b[36m' };

function renderCard(data, opts = {}) {
	const color = !!opts.color;
	const c = (s, code) => (color ? code + s + ANSI.reset : s);

	if (!data || data.activeDays === 0) {
		return 'No Claude Code usage found in ~/.claude/projects. Use Claude Code, then run this again.\n';
	}

	// One content line, framed. `content` is laid out on display width so the borders always
	// align; colour is applied to the whole finished line as zero-width escape codes.
	const line = (content, code) => {
		const framed = '│ ' + padEnd(clip(content, WIDTH), WIDTH) + ' │';
		return code ? c(framed, code) : framed;
	};
	const lr = (left, right) => {
		const l = String(left);
		const r = String(right);
		const gap = Math.max(1, WIDTH - displayWidth(l) - displayWidth(r));
		return l + ' '.repeat(gap) + r;
	};

	const top = c('┌' + '─'.repeat(WIDTH + 2) + '┐', ANSI.cyan);
	const mid = c('├' + '─'.repeat(WIDTH + 2) + '┤', ANSI.cyan);
	const bot = c('└' + '─'.repeat(WIDTH + 2) + '┘', ANSI.cyan);

	const range = data.range.from === data.range.to ? data.range.from : `${data.range.from} to ${data.range.to}`;
	const out = [];
	out.push('');
	out.push(top);
	out.push(line(lr('CLAUDE CODE WRAPPED', range)));
	out.push(line(data.disclaimer, ANSI.dim));
	out.push(mid);
	out.push(line(''));
	out.push(line('  ' + fmtUsd(data.total.usd) + '  of Claude Code, at list prices', ANSI.bold + ANSI.cyan));
	out.push(line('  across ' + data.activeDays + ' active day' + (data.activeDays === 1 ? '' : 's') + ', ' + data.projectCount + ' project' + (data.projectCount === 1 ? '' : 's') + ', ' + data.branchCount + ' branch' + (data.branchCount === 1 ? '' : 'es')));
	out.push(line(''));

	const rows = [];
	if (data.cacheSavedUsd > 0) rows.push(['Caching saved (vs no cache)', fmtUsd(data.cacheSavedUsd)]);
	if (data.topProject) {
		const pct = Math.round(data.topProject.share * 100);
		rows.push(['Biggest project  ' + clip(data.topProject.project, 20), fmtUsd(data.topProject.usd) + '  ' + pct + '%']);
	}
	if (data.topBranch) {
		rows.push(['Biggest branch  ' + clip(data.topBranch.project + '/' + data.topBranch.branch, 24), fmtUsd(data.topBranch.usd)]);
	}
	if (data.busiestDay) rows.push(['Priciest day  ' + data.busiestDay.date, fmtUsd(data.busiestDay.usd)]);
	for (const [label, value] of rows) {
		out.push(line('  ' + padEnd(label, WIDTH - 4 - value.length) + value));
	}

	const mixModels = data.models.filter((m) => Math.round(m.share * 100) >= 1).slice(0, 4);
	if (mixModels.length > 0) {
		out.push(line(''));
		const mix = mixModels.map((m) => shortModel(m.model) + ' ' + Math.round(m.share * 100) + '%').join('   ');
		out.push(line('  Model mix   ' + mix));
	}

	if (data.unpricedModels.length > 0) {
		out.push(line('  No list price for ' + clip(data.unpricedModels.join(', '), 34) + '; valued at $0', ANSI.dim));
	}

	out.push(line(''));
	out.push(mid);
	out.push(line(lr('See your own:  npx goei-sync wrapped', 'goei.roninforge.org'), ANSI.cyan));
	out.push(bot);
	out.push('');
	return out.join('\n') + '\n';
}

module.exports = { buildWrapped, renderCard, DISCLAIMER };
