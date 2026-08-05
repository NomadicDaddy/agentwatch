/**
 * Rule: agent.untrusted-install-source
 *
 * Flags provenance / install metadata that makes an agent surface hard to
 * audit: URL shorteners, ad/referral routing, missing publisher or version
 * fields, and source/API host mismatches.
 */

import type { Artifact, Finding, Rule, RuleContext } from './types.ts';
import type { IssueKind, Match } from './untrusted-install-source-matches.ts';

import { computeScore, computeSeverity, Signal } from './scoring.ts';
import { findMatches } from './untrusted-install-source-matches.ts';

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
	scan(ctx: RuleContext): Finding[] {
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
