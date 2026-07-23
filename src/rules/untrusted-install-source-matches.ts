import type { Artifact } from './types.ts';

import {
	collectUrls,
	detectAdParams,
	isApiField,
	isShortenerHost,
	isSourceField,
	lineOf,
	tryParseUrl,
} from './untrusted-install-source-urls.ts';

export type IssueKind =
	| 'ad-marketing'
	| 'missing-publisher'
	| 'missing-version'
	| 'source-api-host-mismatch'
	| 'url-shortener';

export interface Match {
	readonly evidence: string;
	readonly kind: IssueKind;
	readonly line: number;
	readonly title: string;
	readonly url?: string;
}

const PUBLISHER_FIELDS: ReadonlySet<string> = new Set(['publisher', 'author', 'maintainer']);
const VERSION_FIELDS: ReadonlySet<string> = new Set(['version']);
const URL_LINE_PATTERN = /(https?:\/\/[^\s"'<>`)\]]+)/g;

function hasField(value: unknown, fields: ReadonlySet<string>): boolean {
	if (Array.isArray(value)) return value.some((item) => hasField(item, fields));
	if (value === null || typeof value !== 'object') return false;
	for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
		if (fields.has(key.toLowerCase())) {
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

	const urls = collectUrls(parsed);
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
		if (isSourceField(entry.field)) sourceHosts.add(entry.parsed.host.toLowerCase());
		if (isApiField(entry.field)) apiHosts.add(entry.parsed.host.toLowerCase());
	}
	if (sourceHosts.size > 0 && apiHosts.size > 0) {
		const overlap = [...sourceHosts].some((host) => apiHosts.has(host));
		if (!overlap) {
			matches.push({
				evidence: `source=[${[...sourceHosts].join(', ')}] api=[${[...apiHosts].join(', ')}]`,
				kind: 'source-api-host-mismatch',
				line: 1,
				title: 'Source and API hosts disagree',
			});
		}
	}

	return matches;
}

function findInlineMatches(content: string): Match[] {
	const matches: Match[] = [];
	const lines = content.split(/\r?\n/);
	const seen = new Set<string>();

	for (let index = 0; index < lines.length; index++) {
		const line = lines[index] ?? '';
		URL_LINE_PATTERN.lastIndex = 0;
		let candidate: null | RegExpExecArray;
		while ((candidate = URL_LINE_PATTERN.exec(line)) !== null) {
			const raw = candidate[1] ?? '';
			if (raw.length === 0) continue;
			const cleaned = raw.replace(/[.,;:!?)\]]+$/, '');
			const parsed = tryParseUrl(cleaned);
			if (parsed === null) continue;

			if (isShortenerHost(parsed.host)) {
				const key = `url-shortener::${cleaned}::${index + 1}`;
				if (!seen.has(key)) {
					seen.add(key);
					matches.push({
						evidence: line.trim().slice(0, 240),
						kind: 'url-shortener',
						line: index + 1,
						title: `URL shortener in install/source URL (${parsed.host})`,
						url: cleaned,
					});
				}
			}
			const adHits = detectAdParams(parsed);
			if (adHits.length > 0) {
				const key = `ad-marketing::${cleaned}::${index + 1}`;
				if (!seen.has(key)) {
					seen.add(key);
					matches.push({
						evidence: line.trim().slice(0, 240),
						kind: 'ad-marketing',
						line: index + 1,
						title: `Ad/marketing/referral parameter in install URL (${adHits.join(', ')})`,
						url: cleaned,
					});
				}
			}
		}
	}

	return matches;
}

export function findMatches(artifact: Artifact): Match[] {
	const json = findJsonMatches(artifact.content, artifact.type);
	return json.length > 0 ? json : findInlineMatches(artifact.content);
}
