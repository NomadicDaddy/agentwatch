/**
 * Credential masking utility.
 *
 * `maskSecrets` rewrites a free-form evidence string so likely credentials,
 * tokens, and sensitive paths are partially redacted before display or
 * serialization. The goal is forensic-friendly output: enough context for a
 * human to recognize the artifact without leaking the raw secret.
 *
 * Patterns covered (per spec.md / feature.json):
 *   1. Prefixed API keys — `sk-…`, `pk-…`, `key-…`, etc.
 *   2. `Bearer <token>` headers.
 *   3. Quoted/unquoted values after `token:` / `key:` / `password:` / `secret:` / `api_key:`.
 *   4. Email addresses — `u***@domain.com`.
 *   5. Sensitive filesystem paths — `.ssh/`, `.aws/`, and `.env*` files.
 *   6. Long opaque alphanumeric tokens (40+ chars) as a final catch-all.
 */

/** Visible prefix length kept when masking; tuned to remain useful for debugging. */
const KEEP_PREFIX = 4;

/** Minimum value length before quoted-secret masking kicks in. */
const MIN_SECRET_VALUE_LENGTH = 8;

/** Length threshold for generic alphanumeric token catch-all. */
const GENERIC_TOKEN_MIN_LENGTH = 40;

function maskTail(value: string, keep: number = KEEP_PREFIX): string {
	if (value.length <= keep + 3) return '***';
	return `${value.slice(0, keep)}***`;
}

/** Prefixed API key: `sk-…`, `pk-…`, `key-…`, `rk-…`, `sess-…`, plus `ghp_…`/`gho_…`-style underscore prefixes. */
const API_KEY_REGEX =
	/\b((?:sk|pk|rk|key|sess|ghp|gho|ghu|ghs|ghr|xoxb|xoxp)[-_])([A-Za-z0-9_-]{8,})\b/g;

/** `Authorization: Bearer <token>` style. */
const BEARER_REGEX = /\b(Bearer\s+)([A-Za-z0-9._-]{8,})/g;

/** `key: value` / `"key": "value"` for sensitive keys. Matches both quoted and bare values. */
const KEYED_SECRET_REGEX =
	/(["']?(?:token|secret|password|passwd|api[_-]?key|access[_-]?token|client[_-]?secret|auth)["']?\s*[:=]\s*)(["']?)([^"'\s,;}\]]+)\2/gi;

/** Email address — keeps first char of local-part and full domain. */
const EMAIL_REGEX = /\b([A-Za-z0-9])[A-Za-z0-9._%+-]{1,}(@[A-Za-z0-9.-]+\.[A-Za-z]{2,})/g;

/** Sensitive directories — replace everything after the marker segment with a mask. */
const SENSITIVE_DIR_REGEX = /(\.(?:ssh|aws|gnupg|kube|docker)\/)([^\s"'`,;)]+)/gi;

/** `.env`, `.env.production`, etc. filenames — mask the suffix after `.env`. */
const ENV_FILE_REGEX = /(\.env)(\.[A-Za-z0-9_.-]+)?\b/g;

/** Generic long opaque tokens (40+ alphanumerics). Last-resort catch-all. */
const GENERIC_TOKEN_REGEX = new RegExp(`\\b([A-Za-z0-9_-]{${GENERIC_TOKEN_MIN_LENGTH},})\\b`, 'g');

/**
 * Mask likely credentials in `text`. Always returns a string; never throws.
 *
 * Ordering matters — earlier patterns run first so that a masked sub-string
 * is not re-processed by later (broader) patterns. The generic long-token
 * catch-all runs last and skips strings that already contain `***`.
 */
export function maskSecrets(text: string): string {
	if (!text) return text;
	let out = text;

	out = out.replace(
		API_KEY_REGEX,
		(_match, prefix: string, body: string) => `${prefix}${maskTail(body)}`
	);
	out = out.replace(
		BEARER_REGEX,
		(_match, prefix: string, body: string) => `${prefix}${maskTail(body)}`
	);

	out = out.replace(KEYED_SECRET_REGEX, (match, lead: string, quote: string, value: string) => {
		if (value.length < MIN_SECRET_VALUE_LENGTH) return match;
		return `${lead}${quote}${maskTail(value)}${quote}`;
	});

	out = out.replace(
		EMAIL_REGEX,
		(_match, firstChar: string, domain: string) => `${firstChar}***${domain}`
	);

	out = out.replace(
		SENSITIVE_DIR_REGEX,
		(_match, prefix: string, tail: string) => `${prefix}${maskTail(tail, 1)}`
	);
	out = out.replace(ENV_FILE_REGEX, (match, base: string, suffix: string | undefined) => {
		if (!suffix) return match;
		return `${base}${suffix.length <= 4 ? suffix : `.${maskTail(suffix.slice(1), 1)}`}`;
	});

	out = out.replace(GENERIC_TOKEN_REGEX, (match) => {
		if (match.includes('***')) return match;
		return maskTail(match);
	});

	return out;
}
