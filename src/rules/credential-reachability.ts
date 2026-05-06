/**
 * Rule: agent.connector-credential-reachability
 *
 * Detects agent-reachable credentials in connector-config and tool-manifest
 * artifacts. The rule deliberately scopes to artifacts the agent already
 * declares — we are NOT scanning the broader filesystem for secrets. A finding
 * means: an agent surface points at, references, or is configured with a way
 * to reach a credential (OAuth scope, token field, sensitive path, connector
 * permission scope).
 *
 * Score: each finding contributes the `credential-reach` signal (+20). When
 * paired with `remote-endpoint` elsewhere (see scoring escalations) the
 * combination escalates to `critical`.
 */

import type { Artifact, Finding, Rule, RuleContext } from './types.ts';

import { computeScore, computeSeverity, Signal } from './scoring.ts';

/** Categorical label for the kind of credential reachability detected. */
type CredentialKind =
	| 'api-key-field'
	| 'bearer-token'
	| 'client-secret'
	| 'connector-permission'
	| 'oauth-scope'
	| 'oauth-token'
	| 'sensitive-path-access';

interface PatternSpec {
	readonly kind: CredentialKind;
	readonly pattern: RegExp;
	readonly title: string;
}

/**
 * Patterns are deliberately conservative — each must clearly indicate that the
 * agent artifact is configured to reach a credential or credential-bearing
 * resource. Matches are evaluated per-line so we can attach a line number to
 * the finding.
 */
const PATTERNS: readonly PatternSpec[] = [
	{
		kind: 'oauth-scope',
		pattern:
			/\b(?:scope|scopes|oauth_scope|oauthScopes)\b["']?\s*[:=]|https?:\/\/(?:www\.)?googleapis\.com\/auth\/|\bmail\.google\.com\b|\bgmail\.(?:readonly|send|modify|labels)\b|\bcalendar\.(?:readonly|events|app)\b|\bdrive\.(?:readonly|file|metadata)\b|\b(?:repo|admin:org|workflow|gist|user:email)\b\s*[",]/i,
		title: 'OAuth scope grants credential reach',
	},
	{
		kind: 'oauth-token',
		pattern: /\b(?:oauth_token|access_token|accessToken|refresh_token|refreshToken)\b/i,
		title: 'OAuth token reference in agent artifact',
	},
	{
		kind: 'client-secret',
		pattern: /\b(?:client_secret|clientSecret)\b/i,
		title: 'OAuth client secret reference',
	},
	{
		kind: 'api-key-field',
		pattern: /\b(?:api_key|apiKey|api-key|x-api-key)\b["']?\s*[:=]/i,
		title: 'API key field declared in agent artifact',
	},
	{
		kind: 'bearer-token',
		pattern: /\bAuthorization\b\s*[:=].*\bBearer\b|"Bearer\s+[^"]+"/,
		title: 'Bearer token reference in agent artifact',
	},
	{
		kind: 'connector-permission',
		pattern:
			/"(?:connector(?:_type|Type)?|service|provider)"\s*:\s*"(gmail|google[_-]?drive|google[_-]?calendar|google[_-]?contacts|github|gitlab|slack|notion|jira|confluence|dropbox|box|onedrive|outlook|exchange|browser|fetch)"/i,
		title: 'Connector permission grants reach to user data',
	},
	{
		kind: 'sensitive-path-access',
		pattern:
			/[~/\\]\.(?:ssh|aws|gnupg|kube|docker|netrc)\b|\bid_(?:rsa|ed25519|ecdsa|dsa)\b|\b\.env(?:\.[A-Za-z0-9_-]+)?\b/,
		title: 'Sensitive credential path referenced',
	},
];

const RECOMMENDATION =
	'Treat any tokens or scopes referenced here as exposed: revoke and rotate them, ' +
	"audit the connector's scope set for least privilege, and confirm the agent's " +
	'access to this artifact is intentional. Consider moving secrets to a credential ' +
	'manager rather than referencing them from agent-readable files.';

interface Match {
	readonly evidence: string;
	readonly kind: CredentialKind;
	readonly line: number;
	readonly title: string;
}

function findMatches(content: string): Match[] {
	const seen = new Set<CredentialKind>();
	const matches: Match[] = [];
	const lines = content.split(/\r?\n/);

	for (let i = 0; i < lines.length; i++) {
		const line = lines[i] ?? '';
		for (const spec of PATTERNS) {
			if (seen.has(spec.kind)) continue;
			if (spec.pattern.test(line)) {
				seen.add(spec.kind);
				matches.push({
					evidence: line.trim().slice(0, 240),
					kind: spec.kind,
					line: i + 1,
					title: spec.title,
				});
			}
		}
	}

	return matches;
}

function isInScope(artifact: Artifact): boolean {
	return artifact.type === 'connector-config' || artifact.type === 'tool-manifest';
}

function buildFinding(artifact: Artifact, match: Match): Finding {
	const signals: readonly string[] = [Signal.CredentialReach];
	return {
		confidence: 'medium',
		evidence: `[${match.kind}] ${match.evidence}`,
		file: artifact.path,
		group: 'credential-reachability',
		id: `agent.connector-credential-reachability:${artifact.path}:${match.kind}:${match.line}`,
		line: match.line,
		recommendation: RECOMMENDATION,
		ruleId: 'agent.connector-credential-reachability',
		score: computeScore(signals),
		severity: computeSeverity(signals),
		signals,
		source: artifact.source,
		title: match.title,
	};
}

export const credentialReachabilityRule: Rule = {
	description:
		'Flags agent connector configs and tool manifests that reference OAuth scopes, ' +
		'tokens, or sensitive credential paths — i.e. artifacts that grant the agent a ' +
		'path to reach user credentials or credential-bearing resources.',
	group: 'credential-reachability',
	id: 'agent.connector-credential-reachability',
	async scan(ctx: RuleContext): Promise<Finding[]> {
		const findings: Finding[] = [];
		for (const artifact of ctx.artifacts) {
			if (!isInScope(artifact)) continue;
			for (const match of findMatches(artifact.content)) {
				findings.push(buildFinding(artifact, match));
			}
		}
		return findings;
	},
	title: 'Connector credential reachability',
};
