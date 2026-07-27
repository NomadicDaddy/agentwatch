/**
 * Scanner-level finding correlation.
 *
 * Rules remain pure and artifact-local. This stage combines their distinct
 * signals only when the findings belong to the same source and artifact *and*
 * sit close together within it, then emits one synthetic critical finding per
 * such cluster while preserving the rule findings.
 *
 * The proximity constraint matters: registry-style artifacts (marketplace
 * catalogs, plugin caches) list many independent capabilities in one file.
 * Without it, a remote URL from one catalog entry and a credential reference
 * from an unrelated entry hundreds of lines away would union into a bogus
 * "critical signal combination in one agent artifact". Real capability chains
 * are local — the signals describing a single tool, skill, or server sit within
 * a handful of lines of each other.
 */

import type { Finding } from '../rules/types.ts';

import { computeScore, shouldEscalateToCritical } from '../rules/scoring.ts';

export const CRITICAL_CORRELATION_RULE_ID = 'agent.critical-signal-combination';

/**
 * Maximum line gap between consecutive findings that still counts as one
 * capability chain. Bad-actor fixtures keep their signals within ~20 lines;
 * catalog entries are separated by hundreds. 50 clears the former with margin
 * while never bridging the latter.
 */
const MAX_CORRELATION_LINE_GAP = 50;

/**
 * Basenames of plugin *registry* files — catalogs that enumerate many
 * independent, third-party plugins that are *available* to install, not
 * capabilities the workstation actually runs. Correlating across such a listing
 * fabricates a bogus "single capability chain" from unrelated entries, so these
 * are excluded from critical synthesis. (This is also the only reliable guard
 * for minified catalogs, where every match collapses onto line 1 and line
 * proximity cannot separate the entries.) The underlying per-signal rule
 * findings still surface individually.
 */
const REGISTRY_CATALOG_BASENAMES: ReadonlySet<string> = new Set([
	'marketplace.json',
	'plugin-catalog-cache.json',
]);

function isRegistryCatalog(file: string): boolean {
	const basename = file.split(/[\\/]/).pop()?.toLowerCase() ?? '';
	return REGISTRY_CATALOG_BASENAMES.has(basename);
}

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
	// One file can host several disjoint clusters, so anchor the id on the
	// cluster's first line to keep ids unique within a file.
	const anchor = first.line ?? 0;
	return {
		confidence: 'medium',
		evidence: formatEvidence(findings),
		file: first.file,
		group: 'remote-capabilities',
		id: `${CRITICAL_CORRELATION_RULE_ID}:${first.source.agent}:${first.source.root}:${first.file}:${anchor}`,
		recommendation: RECOMMENDATION,
		ruleId: CRITICAL_CORRELATION_RULE_ID,
		score: computeScore(signals),
		severity: 'critical',
		signals,
		source: first.source,
		title: 'Critical signal combination in one agent artifact',
	};
}

/**
 * Split a file's findings into clusters of lines that sit within
 * {@link MAX_CORRELATION_LINE_GAP} of one another. Findings are ordered by line
 * so each cluster represents one contiguous stretch of the artifact.
 */
function clusterByProximity(findings: readonly Finding[]): Finding[][] {
	const ordered = [...findings].sort((a, b) => (a.line ?? 0) - (b.line ?? 0));
	const clusters: Finding[][] = [];
	let current: Finding[] = [];
	let previousLine: null | number = null;
	for (const finding of ordered) {
		const line = finding.line ?? 0;
		if (previousLine !== null && line - previousLine > MAX_CORRELATION_LINE_GAP) {
			clusters.push(current);
			current = [];
		}
		current.push(finding);
		previousLine = line;
	}
	if (current.length > 0) clusters.push(current);
	return clusters;
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
		const file = group[0]?.file;
		if (file !== undefined && isRegistryCatalog(file)) continue;
		for (const cluster of clusterByProximity(group)) {
			const signals = collectSignals(cluster);
			if (shouldEscalateToCritical(signals)) {
				correlated.push(buildCriticalFinding(cluster, signals));
			}
		}
	}
	return correlated;
}
