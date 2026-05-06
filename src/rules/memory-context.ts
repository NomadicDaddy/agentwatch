/**
 * Rule: agent.memory-context-request
 *
 * Detects skills and agent instructions that request personal memory,
 * profile data, preferences, past conversations, or other personalized
 * context. Such requests give third-party-authored skills/instructions a
 * channel to read user-private context the agent has accumulated, which
 * can leak through any downstream remote tool the skill also invokes.
 *
 * Scope: skill and agent-instruction artifacts.
 *
 * Score: each finding contributes the `memory-request` signal (+25). When
 * paired with `remote-endpoint` plus `dynamic-registry` the combination
 * escalates to `critical` per the scoring engine.
 */

import type { Artifact, Finding, Rule, RuleContext } from './types.ts';

import { computeScore, computeSeverity, Signal } from './scoring.ts';

type MemoryKind =
	| 'memory-access'
	| 'my-role-company'
	| 'past-conversations'
	| 'personal-context'
	| 'personalized-tailored'
	| 'preferences'
	| 'user-profile';

interface PatternSpec {
	readonly kind: MemoryKind;
	readonly pattern: RegExp;
	readonly title: string;
}

const PATTERNS: readonly PatternSpec[] = [
	{
		kind: 'memory-access',
		pattern: /\b(?:use|read|access|consult|leverage|recall)\s+(?:my|the|user'?s?)\s+memory\b/i,
		title: 'Skill requests access to user memory',
	},
	{
		kind: 'user-profile',
		pattern: /\buser\s+profile\b|\bprofile\s+data\b|\babout[_-]?me\b/i,
		title: 'Skill requests user profile data',
	},
	{
		kind: 'preferences',
		pattern: /\b(?:user|my)\s+preferences\b|\bpersonal\s+preferences\b/i,
		title: 'Skill requests user preferences',
	},
	{
		kind: 'personal-context',
		pattern: /\bpersonal\s+context\b|\bcontext\s+from\s+(?:user|my)\s+profile\b/i,
		title: 'Skill requests personal context',
	},
	{
		kind: 'past-conversations',
		pattern:
			/\bpast\s+conversations?\b|\bprior\s+conversations?\b|\bconversation\s+history\b|\bchat\s+history\b/i,
		title: 'Skill requests past conversation history',
	},
	{
		kind: 'my-role-company',
		pattern: /\bmy\s+(?:role|company|employer|team|organization|job)\b/i,
		title: 'Skill requests user role or company information',
	},
	{
		kind: 'personalized-tailored',
		pattern: /\bpersonalized?\b|\btailored?\s+to\s+(?:the\s+)?user\b/i,
		title: 'Skill requests personalized or tailored output',
	},
];

const RECOMMENDATION =
	'Disable memory and personalization access for untrusted skills and ' +
	'agent instructions. Skills that read user memory, profile, preferences, ' +
	'or past conversations can exfiltrate that context through any other ' +
	'tool they invoke. Limit memory access to first-party, reviewed skills ' +
	'and confirm the data flow before granting it.';

const IN_SCOPE: ReadonlySet<Artifact['type']> = new Set(['skill', 'agent-instruction']);

interface Match {
	readonly evidence: string;
	readonly kind: MemoryKind;
	readonly line: number;
	readonly title: string;
}

function findMatches(content: string): Match[] {
	const seen = new Set<MemoryKind>();
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

function buildFinding(artifact: Artifact, match: Match): Finding {
	const signals: readonly string[] = [Signal.MemoryRequest];
	return {
		confidence: 'medium',
		evidence: `[${match.kind}] ${match.evidence}`,
		file: artifact.path,
		group: 'memory-context-exposure',
		id: `agent.memory-context-request:${artifact.path}:${match.kind}:${match.line}`,
		line: match.line,
		recommendation: RECOMMENDATION,
		ruleId: 'agent.memory-context-request',
		score: computeScore(signals),
		severity: computeSeverity(signals),
		signals,
		source: artifact.source,
		title: match.title,
	};
}

export const memoryContextRequestRule: Rule = {
	description:
		'Flags skill and agent-instruction artifacts that request user memory, ' +
		'profile, preferences, past conversations, or otherwise ask for ' +
		'personalized context — i.e. capability surfaces that pull private ' +
		'context into a third-party-authored skill.',
	group: 'memory-context-exposure',
	id: 'agent.memory-context-request',
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
	title: 'Memory / personal context request',
};
