/**
 * Rule: agent.untrusted-install-source
 *
 * Flags provenance / install metadata that makes an agent surface hard to
 * audit: URL shorteners on install URLs, ad/marketing/referral query
 * parameters, missing publisher or version fields, and source/API host
 * mismatches between declared origin URLs.
 *
 * Scope: provenance, mcp-config, and tool-manifest artifacts. JSON content
 * is parsed when possible; non-JSON or malformed content falls back to a
 * line-level URL scan (for shorteners and ad/marketing indicators only —
 * publisher/version/host-mismatch checks need parsed structure).
 *
 * Score:
 *   - URL shortener on install/MCP URL → `url-shortener` (+20)
 *   - Ad/marketing/referral indicator → `ad-marketing` (+10)
 *   - Missing publisher / missing version / source-API host mismatch
 *     emit findings without a scoring signal (info severity); they remain
 *     valuable as audit signal even when the numeric score is zero.
 */

import type { Artifact, Finding, Rule, RuleContext } from './types.ts';

import { computeScore, computeSeverity, Signal } from './scoring.ts';

type IssueKind =
	| 'ad-marketing'
	| 'missing-publisher'
	| 'missing-version'
	| 'source-api-host-mismatch'
	| 'url-shortener';

const RECOMMENDATION =
	'Verify the install source and pin a specific version. Resolve URL ' +
	'shorteners to their final host before approving; require a named ' +
	'publisher and a checked-in version. Ad/marketing/referral parameters ' +
	'on install URLs suggest the source is being routed through a tracker, ' +
	'not the canonical project — fetch from the project’s own domain ' +
	'instead.';

const IN_SCOPE: ReadonlySet<Artifact['type']> = new Set([
	'provenance',
	'mcp-config',
	'tool-manifest',
]);

/**
 * Known URL-shortener hosts. Conservative list — false positives here
 * downgrade trust on real install URLs, so we only include services that
 * are unambiguously redirectors.
 */
const SHORTENER_HOSTS: ReadonlySet<string> = new Set([
	'bit.ly',
	'tinyurl.com',
	't.co',
	'goo.gl',
	'ow.ly',
	'is.gd',
	'buff.ly',
	't.ly',
	'rb.gy',
	'cutt.ly',
	'short.io',
	'shorturl.at',
	'rebrand.ly',
	'tiny.cc',
	'lnkd.in',
	'fb.me',
	'youtu.be',
	'amzn.to',
]);

/** Query parameter names that indicate ad / marketing / referral routing. */
const AD_PARAMS: ReadonlySet<string> = new Set([
	'utm_source',
	'utm_medium',
	'utm_campaign',
	'utm_term',
	'utm_content',
	'utm_id',
	'ref',
	'referrer',
	'referral',
	'aff',
	'affiliate',
	'aff_id',
	'fbclid',
	'gclid',
	'mc_cid',
	'mc_eid',
	'igshid',
	'yclid',
	'dclid',
]);

/** Field names that hold an install / source / API URL. */
const URL_FIELDS: ReadonlySet<string> = new Set([
	'url',
	'sourceurl',
	'source_url',
	'installurl',
	'install_url',
	'downloadurl',
	'download_url',
	'homepage',
	'repository',
	'manifest',
	'manifesturl',
	'manifest_url',
	'updateurl',
	'update_url',
	'apiurl',
	'api_url',
	'endpoint',
]);

const SOURCE_FIELDS: ReadonlySet<string> = new Set([
	'sourceurl',
	'source_url',
	'homepage',
	'repository',
	'installurl',
	'install_url',
	'downloadurl',
	'download_url',
]);

const API_FIELDS: ReadonlySet<string> = new Set([
	'apiurl',
	'api_url',
	'endpoint',
	'updateurl',
	'update_url',
]);

const PUBLISHER_FIELDS: ReadonlySet<string> = new Set(['publisher', 'author', 'maintainer']);
const VERSION_FIELDS: ReadonlySet<string> = new Set(['version']);

interface Match {
	readonly evidence: string;
	readonly kind: IssueKind;
	readonly line: number;
	readonly title: string;
	readonly url?: string;
}

function lineOf(content: string, needle: string): number {
	if (needle.length === 0) return 1;
	const idx = content.indexOf(needle);
	if (idx === -1) return 1;
	let line = 1;
	for (let i = 0; i < idx; i++) {
		if (content.charCodeAt(i) === 0x0a) line++;
	}
	return line;
}

function tryParseUrl(value: string): null | URL {
	try {
		return new URL(value);
	} catch {
		return null;
	}
}

function isShortenerHost(host: string): boolean {
	const lc = host.toLowerCase();
	if (SHORTENER_HOSTS.has(lc)) return true;
	const parts = lc.split('.');
	if (parts.length >= 2) {
		const tail = parts.slice(-2).join('.');
		if (SHORTENER_HOSTS.has(tail)) return true;
	}
	return false;
}

function detectAdParams(url: URL): string[] {
	const hits: string[] = [];
	for (const key of url.searchParams.keys()) {
		if (AD_PARAMS.has(key.toLowerCase())) hits.push(key);
	}
	return hits;
}

interface UrlEntry {
	readonly field: string;
	readonly parsed: URL;
	readonly url: string;
}

function collectUrls(value: unknown, urls: UrlEntry[], pathField: null | string): void {
	if (Array.isArray(value)) {
		for (const item of value) collectUrls(item, urls, pathField);
		return;
	}
	if (value === null || typeof value !== 'object') {
		if (typeof value === 'string' && pathField !== null && URL_FIELDS.has(pathField)) {
			const parsed = tryParseUrl(value);
			if (parsed !== null && (parsed.protocol === 'http:' || parsed.protocol === 'https:')) {
				urls.push({ field: pathField, parsed, url: value });
			}
		}
		return;
	}
	const obj = value as Record<string, unknown>;
	for (const [key, child] of Object.entries(obj)) {
		const lower = key.toLowerCase();
		collectUrls(child, urls, lower);
	}
}

function hasField(value: unknown, fields: ReadonlySet<string>): boolean {
	if (Array.isArray(value)) {
		return value.some((item) => hasField(item, fields));
	}
	if (value === null || typeof value !== 'object') return false;
	const obj = value as Record<string, unknown>;
	for (const [key, child] of Object.entries(obj)) {
		const lower = key.toLowerCase();
		if (fields.has(lower)) {
			if (typeof child === 'string' && child.trim().length === 0) continue;
			if (child === null) continue;
			return true;
		}
		if (hasField(child, fields)) return true;
	}
	return false;
}

function findJsonMatches(content: string, type: Artifact['type']): Match[] {
	let parsed: unknown;
	try {
		parsed = JSON.parse(content);
	} catch {
		return [];
	}

	const urls: UrlEntry[] = [];
	collectUrls(parsed, urls, null);

	const matches: Match[] = [];
	const seen = new Set<string>();

	for (const entry of urls) {
		const evidenceLine = lineOf(content, JSON.stringify(entry.url));
		if (isShortenerHost(entry.parsed.host)) {
			const key = `url-shortener::${entry.url}`;
			if (!seen.has(key)) {
				seen.add(key);
				matches.push({
					evidence: `${entry.field}=${entry.url}`,
					kind: 'url-shortener',
					line: evidenceLine,
					title: `URL shortener in install/source URL (${entry.parsed.host})`,
					url: entry.url,
				});
			}
		}
		const adHits = detectAdParams(entry.parsed);
		if (adHits.length > 0) {
			const key = `ad-marketing::${entry.url}`;
			if (!seen.has(key)) {
				seen.add(key);
				matches.push({
					evidence: `${entry.field}=${entry.url}`,
					kind: 'ad-marketing',
					line: evidenceLine,
					title: `Ad/marketing/referral parameter in install URL (${adHits.join(', ')})`,
					url: entry.url,
				});
			}
		}
	}

	if (type === 'provenance') {
		if (!hasField(parsed, PUBLISHER_FIELDS)) {
			matches.push({
				evidence: 'no publisher/author/maintainer field present',
				kind: 'missing-publisher',
				line: 1,
				title: 'Provenance metadata is missing publisher/author',
			});
		}
		if (!hasField(parsed, VERSION_FIELDS)) {
			matches.push({
				evidence: 'no version field present',
				kind: 'missing-version',
				line: 1,
				title: 'Provenance metadata is missing version',
			});
		}
	}

	const sourceHosts = new Set<string>();
	const apiHosts = new Set<string>();
	for (const entry of urls) {
		if (SOURCE_FIELDS.has(entry.field)) sourceHosts.add(entry.parsed.host.toLowerCase());
		if (API_FIELDS.has(entry.field)) apiHosts.add(entry.parsed.host.toLowerCase());
	}
	if (sourceHosts.size > 0 && apiHosts.size > 0) {
		const overlap = [...sourceHosts].some((h) => apiHosts.has(h));
		if (!overlap) {
			const sources = [...sourceHosts].join(', ');
			const apis = [...apiHosts].join(', ');
			matches.push({
				evidence: `source=[${sources}] api=[${apis}]`,
				kind: 'source-api-host-mismatch',
				line: 1,
				title: 'Source and API hosts disagree',
			});
		}
	}

	return matches;
}

const URL_LINE_PATTERN = /(https?:\/\/[^\s"'<>`)\]]+)/g;

function findInlineMatches(content: string): Match[] {
	const matches: Match[] = [];
	const lines = content.split(/\r?\n/);
	const seen = new Set<string>();

	for (let i = 0; i < lines.length; i++) {
		const line = lines[i] ?? '';
		URL_LINE_PATTERN.lastIndex = 0;
		let m: null | RegExpExecArray;
		while ((m = URL_LINE_PATTERN.exec(line)) !== null) {
			const raw = m[1] ?? '';
			if (raw.length === 0) continue;
			const cleaned = raw.replace(/[.,;:!?)\]]+$/, '');
			const parsed = tryParseUrl(cleaned);
			if (parsed === null) continue;

			if (isShortenerHost(parsed.host)) {
				const key = `url-shortener::${cleaned}::${i + 1}`;
				if (!seen.has(key)) {
					seen.add(key);
					matches.push({
						evidence: line.trim().slice(0, 240),
						kind: 'url-shortener',
						line: i + 1,
						title: `URL shortener in install/source URL (${parsed.host})`,
						url: cleaned,
					});
				}
			}
			const adHits = detectAdParams(parsed);
			if (adHits.length > 0) {
				const key = `ad-marketing::${cleaned}::${i + 1}`;
				if (!seen.has(key)) {
					seen.add(key);
					matches.push({
						evidence: line.trim().slice(0, 240),
						kind: 'ad-marketing',
						line: i + 1,
						title: `Ad/marketing/referral parameter in install URL (${adHits.join(', ')})`,
						url: cleaned,
					});
				}
			}
		}
	}

	return matches;
}

function findMatches(artifact: Artifact): Match[] {
	const json = findJsonMatches(artifact.content, artifact.type);
	if (json.length > 0) return json;
	return findInlineMatches(artifact.content);
}

function signalsFor(kind: IssueKind): readonly string[] {
	switch (kind) {
		case 'ad-marketing':
			return [Signal.AdMarketing];
		case 'url-shortener':
			return [Signal.UrlShortener];
		default:
			return [];
	}
}

function buildFinding(artifact: Artifact, match: Match): Finding {
	const signals = signalsFor(match.kind);
	const idTail = match.url ?? match.kind;
	return {
		confidence:
			match.kind === 'source-api-host-mismatch' || match.kind === 'ad-marketing'
				? 'medium'
				: 'high',
		evidence: `[${match.kind}] ${match.evidence}`,
		file: artifact.path,
		group: 'untrusted-provenance',
		id: `agent.untrusted-install-source:${artifact.path}:${match.kind}:${idTail}:${match.line}`,
		line: match.line,
		recommendation: RECOMMENDATION,
		ruleId: 'agent.untrusted-install-source',
		score: computeScore(signals),
		severity: computeSeverity(signals),
		signals,
		source: artifact.source,
		title: match.title,
	};
}

export const untrustedInstallSourceRule: Rule = {
	description:
		'Flags provenance and install metadata that is hard to audit: URL ' +
		'shorteners on install URLs, ad/marketing/referral parameters, missing ' +
		'publisher or version fields, and source/API host mismatches between ' +
		'declared origin URLs.',
	group: 'untrusted-provenance',
	id: 'agent.untrusted-install-source',
	async scan(ctx: RuleContext): Promise<Finding[]> {
		const findings: Finding[] = [];
		for (const artifact of ctx.artifacts) {
			if (!IN_SCOPE.has(artifact.type)) continue;
			for (const match of findMatches(artifact)) {
				findings.push(buildFinding(artifact, match));
			}
		}
		return findings;
	},
	title: 'Untrusted install source',
};
