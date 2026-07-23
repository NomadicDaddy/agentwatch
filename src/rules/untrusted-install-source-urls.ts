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

export interface UrlEntry {
	readonly field: string;
	readonly parsed: URL;
	readonly url: string;
}

export function collectUrls(value: unknown): UrlEntry[] {
	const urls: UrlEntry[] = [];
	collectUrlValues(value, urls, null);
	return urls;
}

function collectUrlValues(value: unknown, urls: UrlEntry[], pathField: null | string): void {
	if (Array.isArray(value)) {
		for (const item of value) collectUrlValues(item, urls, pathField);
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
	for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
		collectUrlValues(child, urls, key.toLowerCase());
	}
}

export function detectAdParams(url: URL): string[] {
	const hits: string[] = [];
	for (const key of url.searchParams.keys()) {
		if (AD_PARAMS.has(key.toLowerCase())) hits.push(key);
	}
	return hits;
}

export function isApiField(field: string): boolean {
	return API_FIELDS.has(field);
}

export function isShortenerHost(host: string): boolean {
	const lower = host.toLowerCase();
	if (SHORTENER_HOSTS.has(lower)) return true;
	const parts = lower.split('.');
	return parts.length >= 2 && SHORTENER_HOSTS.has(parts.slice(-2).join('.'));
}

export function isSourceField(field: string): boolean {
	return SOURCE_FIELDS.has(field);
}

export function lineOf(content: string, needle: string): number {
	if (needle.length === 0) return 1;
	const index = content.indexOf(needle);
	if (index === -1) return 1;
	let line = 1;
	for (let position = 0; position < index; position++) {
		if (content.charCodeAt(position) === 0x0a) line++;
	}
	return line;
}

export function tryParseUrl(value: string): null | URL {
	try {
		return new URL(value);
	} catch {
		return null;
	}
}
