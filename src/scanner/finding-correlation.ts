/**
 * Scanner-level finding correlation.
 *
 * Rules remain pure and artifact-local. This stage combines their distinct
 * signals only when the findings belong to the same source and artifact, then
 * emits one synthetic critical finding while preserving the rule findings.
 */

import type { Finding } from '../rules/types.ts';

import { computeScore, shouldEscalateToCritical } from '../rules/scoring.ts';

export const CRITICAL_CORRELATION_RULE_ID = 'agent.critical-signal-combination';

const RECOMMENDATION =
	'Review this artifact as one capability chain. Remove or constrain the remote endpoint, ' +
	'dynamic registration, local execution, memory access, or credential reach that creates ' +
	'the critical combination.';

function groupKey(finding: Finding): null | string {
	if (finding.file === undefined) return null;
	return JSON.stringify([
		finding.source.agent,
		finding.source.customPath,
		finding.source.root,
		finding.file,
	]);
}

function compareContributors(a: Finding, b: Finding): number {
	if (a.ruleId !== b.ruleId) return a.ruleId.localeCompare(b.ruleId);
	if ((a.line ?? 0) !== (b.line ?? 0)) return (a.line ?? 0) - (b.line ?? 0);
	return a.id.localeCompare(b.id);
}

function collectSignals(findings: readonly Finding[]): string[] {
	return [...new Set(findings.flatMap((finding) => finding.signals))].sort();
}

function selectContributors(findings: readonly Finding[]): Finding[] {
	const coveredSignals = new Set<string>();
	const contributors: Finding[] = [];
	for (const finding of [...findings].sort(compareContributors)) {
		const contributes = finding.signals.some((signal) => !coveredSignals.has(signal));
		if (!contributes) continue;
		contributors.push(finding);
		for (const signal of finding.signals) coveredSignals.add(signal);
	}
	return contributors;
}

function formatEvidence(findings: readonly Finding[]): string {
	return selectContributors(findings)
		.map((finding) => {
			const location =
				finding.line === undefined ? finding.ruleId : `${finding.ruleId}:${finding.line}`;
			const signals = [...finding.signals].sort().join(', ');
			return `${location} [${signals}] ${finding.evidence ?? finding.title}`;
		})
		.join(' | ');
}

function buildCriticalFinding(findings: readonly Finding[], signals: readonly string[]): Finding {
	const first = findings[0];
	if (first === undefined || first.file === undefined) {
		throw new Error('Critical correlation requires at least one file-backed finding.');
	}
	return {
		confidence: 'medium',
		evidence: formatEvidence(findings),
		file: first.file,
		group: 'remote-capabilities',
		id: `${CRITICAL_CORRELATION_RULE_ID}:${first.source.agent}:${first.source.root}:${first.file}`,
		recommendation: RECOMMENDATION,
		ruleId: CRITICAL_CORRELATION_RULE_ID,
		score: computeScore(signals),
		severity: 'critical',
		signals,
		source: first.source,
		title: 'Critical signal combination in one agent artifact',
	};
}

export function correlateFindings(findings: readonly Finding[]): Finding[] {
	const groups = new Map<string, Finding[]>();
	for (const finding of findings) {
		const key = groupKey(finding);
		if (key === null) continue;
		const group = groups.get(key);
		if (group === undefined) groups.set(key, [finding]);
		else group.push(finding);
	}

	const correlated = [...findings];
	for (const group of groups.values()) {
		const signals = collectSignals(group);
		if (shouldEscalateToCritical(signals)) {
			correlated.push(buildCriticalFinding(group, signals));
		}
	}
	return correlated;
}
