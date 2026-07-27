/**
 * Rule: agent.credential-file-reference
 *
 * Flags references to credential-bearing files (.env, .npmrc, .netrc, .ssh,
 * .aws, .gnupg, private-key files) inside agent artifacts — i.e. an agent
 * surface (skill, prompt, MCP config, manifest, connector config) tells the
 * agent to read, load, or otherwise reach a credential file. Also flags
 * file-access wording that pairs read/load/open verbs with secret/token/
 * password/api-key/private-key/credentials keywords.
 *
 * Scope is intentionally limited to artifacts already discovered by agent
 * surface scanning. We do NOT scan the broader filesystem for secrets — a
 * finding means the agent artifact itself references the credential path.
 *
 * Score: each finding contributes the `credential-reach` signal (+20). When
 * paired with `remote-endpoint` upstream the combination escalates to
 * `critical` per the scoring engine.
 */

import type { Artifact, Finding, Rule, RuleContext } from './types.ts';

import { computeScore, computeSeverity, Signal } from './scoring.ts';

type CredentialFileKind =
	| 'aws-credentials-path'
	| 'dotenv-file'
	| 'gnupg-credentials-path'
	| 'npmrc-netrc-file'
	| 'private-key-file'
	| 'read-secret-file-wording'
	| 'ssh-key-path';

interface PatternSpec {
	readonly kind: CredentialFileKind;
	readonly pattern: RegExp;
	readonly title: string;
}

const PATTERNS: readonly PatternSpec[] = [
	{
		kind: 'dotenv-file',
		pattern:
			/(?<![A-Za-z0-9_])\.env(?:\.(?:local|development|production|staging|test|example|sample|template|defaults?))?(?![A-Za-z0-9_])|\bdotenv\b/,
		title: '.env file referenced in agent artifact',
	},
	{
		kind: 'npmrc-netrc-file',
		pattern: /\.(?:npmrc|netrc)\b/,
		title: 'npmrc/netrc credential file referenced',
	},
	{
		kind: 'ssh-key-path',
		pattern: /[~/\\]\.ssh\b|\bid_(?:rsa|ed25519|ecdsa|dsa)\b/,
		title: 'SSH key path referenced in agent artifact',
	},
	{
		kind: 'aws-credentials-path',
		pattern: /[~/\\]\.aws\b/,
		title: 'AWS credentials path referenced',
	},
	{
		kind: 'gnupg-credentials-path',
		pattern: /[~/\\]\.gnupg\b/,
		title: 'GnuPG credentials path referenced',
	},
	{
		kind: 'private-key-file',
		pattern: /\bprivate\s+key\b|\.(?:pem|p12|pfx)\b/i,
		title: 'Private key file referenced in agent artifact',
	},
	{
		kind: 'read-secret-file-wording',
		pattern:
			/\b(?:read|load|open|access|fetch|parse|consult|import|source)\b[^\n]{0,40}\b(?:api[ _-]?keys?|secrets?|tokens?|passwords?|credentials?|private\s+keys?)\b/i,
		title: 'Skill instructs agent to read a credential or secret',
	},
];

const RECOMMENDATION =
	'Remove credential file references from agent artifacts. Skills, prompts, ' +
	'and configs should not instruct the agent to read .env, .ssh, .aws, ' +
	'.npmrc/.netrc, or other credential-bearing files. Move secrets into a ' +
	'credential manager and grant the agent only the specific values it needs ' +
	'through a reviewed connector.';

const IN_SCOPE: ReadonlySet<Artifact['type']> = new Set([
	'skill',
	'agent-instruction',
	'mcp-config',
]);

interface Match {
	readonly evidence: string;
	readonly kind: CredentialFileKind;
	readonly line: number;
	readonly title: string;
}

function findMatches(content: string): Match[] {
	const seen = new Set<string>();
	const matches: Match[] = [];
	const lines = content.split(/\r?\n/);

	for (let i = 0; i < lines.length; i++) {
		const line = lines[i] ?? '';
		for (const spec of PATTERNS) {
			if (seen.has(`${spec.kind}:${i + 1}`)) continue;
			if (spec.pattern.test(line)) {
				seen.add(`${spec.kind}:${i + 1}`);
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

function buildFinding(artifact: Artifact, match: Match): Finding {
	const signals: readonly string[] = [Signal.CredentialReach];
	return {
		confidence: 'medium',
		evidence: `[${match.kind}] ${match.evidence}`,
		file: artifact.path,
		group: 'credential-reachability',
		id: `agent.credential-file-reference:${artifact.path}:${match.kind}:${match.line}`,
		line: match.line,
		recommendation: RECOMMENDATION,
		ruleId: 'agent.credential-file-reference',
		score: computeScore(signals),
		severity: computeSeverity(signals),
		signals,
		source: artifact.source,
		title: match.title,
	};
}

export const credentialFileReferenceRule: Rule = {
	description:
		'Flags skill, agent-instruction, and MCP-config artifacts that reference ' +
		'credential-bearing files (.env, .npmrc, .netrc, .ssh, .aws, .gnupg, ' +
		'private-key files) or instruct the agent to read secrets/tokens/' +
		'passwords/api-keys from disk.',
	group: 'credential-reachability',
	id: 'agent.credential-file-reference',
	async scan(ctx: RuleContext): Promise<Finding[]> {
		const findings: Finding[] = [];
		for (const artifact of ctx.artifacts) {
			if (!IN_SCOPE.has(artifact.type)) continue;
			for (const match of findMatches(artifact.content)) {
				findings.push(buildFinding(artifact, match));
			}
		}
		return findings;
	},
	title: 'Credential file reference in agent artifact',
};
