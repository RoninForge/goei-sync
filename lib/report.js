'use strict';

// Prices scanned usage records and formats the no-account local report: Claude
// Code spend broken down by git branch, the view ccusage cannot produce, plus a
// top-branch headline and a by-model breakdown.
//
// This is LOCAL usage value at published list prices. It is NOT a provider bill
// and must never be presented as one or added to one: a real invoice reflects
// negotiated rates, plan inclusions, and credits this cannot see. ai-price-index
// (ESM) is imported lazily here so the sync path keeps its zero-startup cost; the
// pricer is injectable so the aggregation can be tested without live prices.

const PROVIDER = 'anthropic';
const MAX_ROWS = 30;
const NAME_MAX = 32;
const DISCLAIMER = 'Local usage value at list prices. Not your provider bill.';

async function defaultPricer() {
	const pi = await import('ai-price-index');
	return (tokens, model, date) => pi.usdForRollupRaw(tokens, PROVIDER, model, date);
}

function fmtUsd(usd) {
	return '$' + usd.toFixed(2);
}

function shortModel(m) {
	if (!m) return '(unknown model)';
	return m.startsWith('claude-') ? m.slice('claude-'.length) : m;
}

function clip(s, n) {
	s = String(s == null ? '' : s);
	// Slice on code-point boundaries (Array.from), not UTF-16 units, so truncating a name that
	// ends mid-surrogate-pair cannot leave a lone half that renders as a mojibake glyph.
	const cp = Array.from(s);
	return cp.length > n ? cp.slice(0, n - 1).join('') + '…' : s;
}

function pad(s, n) {
	s = String(s);
	return s.length >= n ? s : s + ' '.repeat(n - s.length);
}

function padLeft(s, n) {
	s = String(s);
	return s.length >= n ? s : ' '.repeat(n - s.length) + s;
}

function tokenTotal(t) {
	return t.input + t.output + t.cache_read + t.cache_write_5m + t.cache_write_1h;
}

function round2(n) {
	return Math.round(n * 100) / 100;
}

function emptyData() {
	return {
		range: { from: null, to: null },
		total: { usd: 0, tokens: 0 },
		topBranch: null,
		branches: [],
		models: [],
		unpricedModels: [],
		disclaimer: DISCLAIMER
	};
}

// Aggregate records into a structured summary, pricing each via `priceFn` and
// summing float USD (never per-record cents) so many small events do not each
// round to zero. Every dollar figure is rounded once, here, so the text table,
// the by-model block, and the JSON output can never disagree. Returns
// { data, text } so the caller can print either.
async function buildReport(records, opts = {}) {
	if (!records || records.length === 0) {
		const data = emptyData();
		return { data, text: renderText(data) };
	}
	const priceFn = opts.priceFn || (await defaultPricer());

	const branchMap = new Map();
	const modelMap = new Map();
	let grandUsd = 0;
	let grandTokens = 0;
	let minDate = '';
	let maxDate = '';
	const unpriced = new Set();

	for (const r of records) {
		const { usd, modelKnown } = priceFn(r.tokens, r.model, r.date);
		if (!modelKnown && r.model) unpriced.add(r.model);
		const tt = tokenTotal(r.tokens);

		const bKey = JSON.stringify([r.project, r.branch]);
		let b = branchMap.get(bKey);
		if (!b) {
			b = { project: r.project, branch: r.branch, usd: 0, tokens: 0 };
			branchMap.set(bKey, b);
		}
		b.usd += usd;
		b.tokens += tt;

		const mKey = r.model || '';
		let m = modelMap.get(mKey);
		if (!m) {
			m = { model: r.model || '', usd: 0, tokens: 0 };
			modelMap.set(mKey, m);
		}
		m.usd += usd;
		m.tokens += tt;

		grandUsd += usd;
		grandTokens += tt;
		if (!minDate || r.date < minDate) minDate = r.date;
		if (!maxDate || r.date > maxDate) maxDate = r.date;
	}

	const branches = [...branchMap.values()].sort((a, b) => b.usd - a.usd);
	const models = [...modelMap.values()].sort((a, b) => b.usd - a.usd);
	const top = branches[0] || null;

	const data = {
		range: { from: minDate, to: maxDate },
		total: { usd: round2(grandUsd), tokens: grandTokens },
		topBranch: top ? { project: top.project, branch: top.branch, usd: round2(top.usd), tokens: top.tokens } : null,
		branches: branches.map((b) => ({ project: b.project, branch: b.branch, usd: round2(b.usd), tokens: b.tokens })),
		models: models.map((m) => ({ model: m.model, usd: round2(m.usd), tokens: m.tokens })),
		unpricedModels: [...unpriced],
		disclaimer: DISCLAIMER
	};

	return { data, text: renderText(data) };
}

// Renders strictly from the rounded `data` figures so the printed table and the
// JSON output are guaranteed to show identical dollar amounts.
function renderText(data) {
	if (data.branches.length === 0) {
		return 'No Claude Code usage found in ~/.claude/projects. Use Claude Code, then run this again.\n';
	}
	const shown = data.branches.slice(0, MAX_ROWS);
	const totalUsd = data.total.usd;

	const projW = Math.max(7, ...shown.map((r) => clip(r.project, NAME_MAX).length));
	const branchW = Math.max(6, ...shown.map((r) => clip(r.branch, NAME_MAX).length));
	const tokW = Math.max(
		6,
		...shown.map((r) => r.tokens.toLocaleString('en-US').length),
		data.total.tokens.toLocaleString('en-US').length
	);
	const usdW = Math.max(
		4,
		...shown.map((r) => fmtUsd(r.usd).length),
		...data.models.map((m) => fmtUsd(m.usd).length),
		fmtUsd(totalUsd).length
	);

	const out = [];
	const range = data.range.from === data.range.to ? data.range.from : `${data.range.from} to ${data.range.to}`;
	out.push('');
	out.push(`Claude Code local usage by git branch  (${range})`);
	out.push(DISCLAIMER);
	out.push('');
	if (data.topBranch) {
		const pct = totalUsd > 0 ? Math.round((data.topBranch.usd / totalUsd) * 100) : 0;
		out.push(
			`Top branch: ${data.topBranch.project}/${data.topBranch.branch}  ${fmtUsd(data.topBranch.usd)} (${pct}% of ${fmtUsd(totalUsd)} across ${data.branches.length} branch${data.branches.length === 1 ? '' : 'es'})`
		);
		out.push('');
	}
	out.push(`${pad('PROJECT', projW)}  ${pad('BRANCH', branchW)}  ${padLeft('TOKENS', tokW)}  ${padLeft('USD', usdW)}`);
	for (const r of shown) {
		out.push(
			`${pad(clip(r.project, NAME_MAX), projW)}  ${pad(clip(r.branch, NAME_MAX), branchW)}  ${padLeft(r.tokens.toLocaleString('en-US'), tokW)}  ${padLeft(fmtUsd(r.usd), usdW)}`
		);
	}
	if (data.branches.length > shown.length) out.push(`... and ${data.branches.length - shown.length} more branch(es)`);
	out.push(`${pad('TOTAL', projW)}  ${pad('', branchW)}  ${padLeft(data.total.tokens.toLocaleString('en-US'), tokW)}  ${padLeft(fmtUsd(totalUsd), usdW)}`);

	if (data.models.length > 0) {
		const mNameW = Math.max(5, ...data.models.map((m) => shortModel(m.model).length));
		const mTokW = Math.max(6, ...data.models.map((m) => m.tokens.toLocaleString('en-US').length));
		out.push('');
		out.push('By model:');
		for (const m of data.models) {
			out.push(`  ${pad(shortModel(m.model), mNameW)}  ${padLeft(m.tokens.toLocaleString('en-US'), mTokW)}  ${padLeft(fmtUsd(m.usd), usdW)}`);
		}
	}
	if (data.unpricedModels.length > 0) {
		out.push('');
		out.push(`Note: no list price for ${data.unpricedModels.join(', ')}; those tokens are counted but valued at $0.`);
	}

	out.push('');
	out.push('This is one machine. To roll spend up across your whole team and re-price');
	out.push('12 months of history at the rates that were live then, sync to Goei:');
	out.push('  npx goei-sync --token goei_dt_...   (free for one developer)');
	out.push('  Get a token at https://goei.roninforge.org (Settings -> Device Tokens)');
	out.push('For always-on tracking plus hard spend caps, install budgetclaw:');
	out.push('  https://github.com/RoninForge/budgetclaw');
	out.push('');
	return out.join('\n');
}

module.exports = { buildReport, DISCLAIMER };
