/**
 * Human-readable reporter for `agentwatch scan`.
 *
 * Renders a deterministic, terminal-friendly report:
 *   - header
 *   - agent surface inventory with artifact counts per type
 *   - finding severity summary
 *   - findings grouped by `FindingGroup`, each with rule id, agent, location,
 *     signals, score, evidence (when present), recommendation, and a "Why this
 *     matters" explanation for high/critical findings.
 *
 * The reporter is pure: it returns a string instead of writing to stdout so it
 * is trivially testable and composable.
 */

import type { ArtifactType, Finding, FindingGroup, Severity } from '../rules/types.ts';
import type { AgentSource } from '../scanner/targets.ts';

import { maskSecrets } from '../util/mask.ts';

export interface ScanInventory {
	/** Artifact counts keyed by agent name, then by artifact type. */
	readonly artifactCounts: Readonly<
		Record<string, Readonly<Partial<Record<ArtifactType, number>>>>
	>;
	readonly sources: readonly AgentSource[];
	/** Total artifacts considered during this scan. */
	readonly totalArtifacts: number;
}

export interface HumanReportOptions {
	readonly scannedAt: string;
	/** When true, render every finding. When false, hide findings below `threshold`. */
	readonly showAll?: boolean;
	/** Severity at or above which findings are rendered in detail. */
	readonly threshold?: Severity;
	readonly version: string;
}

const SEVERITY_RANK: Readonly<Record<Severity, number>> = {
	critical: 4,
	high: 3,
	info: 0,
	low: 1,
	medium: 2,
};

const SEVERITY_ORDER: readonly Severity[] = ['critical', 'high', 'medium', 'low', 'info'];

const GROUP_ORDER: readonly FindingGroup[] = [
	'remote-capabilities',
	'memory-context-exposure',
	'dynamic-tool-surfaces',
	'local-execution-bridges',
	'untrusted-provenance',
	'credential-reachability',
];

const GROUP_LABELS: Readonly<Record<FindingGroup, string>> = {
	'credential-reachability': 'Credential Reachability',
	'dynamic-tool-surfaces': 'Dynamic Tool Surfaces',
	'local-execution-bridges': 'Local Execution Bridges',
	'memory-context-exposure': 'Memory / Context Exposure',
	'remote-capabilities': 'Remote Capabilities',
	'untrusted-provenance': 'Untrusted Provenance',
};

const GROUP_RATIONALE: Readonly<Record<FindingGroup, string>> = {
	'credential-reachability':
		'Capabilities that can reach credentials, tokens, or browser state expand blast radius on compromise.',
	'dynamic-tool-surfaces':
		'Capabilities that can change after install make the agent surface hard to audit over time.',
	'local-execution-bridges':
		'Agent-driven paths to local command execution can be coerced into running attacker-controlled code.',
	'memory-context-exposure':
		'Skills or instructions that pull personal context can leak preferences, history, or profile data.',
	'remote-capabilities':
		'Remote endpoints can receive prompts, files, or memory and are controlled by a third party.',
	'untrusted-provenance':
		'Install metadata that hides publisher identity makes future updates hard to trust.',
};

const SEVERITY_LABEL_WIDTH = 'CRITICAL'.length;

function padSeverity(severity: Severity): string {
	const label = severity.toUpperCase();
	return label.padEnd(SEVERITY_LABEL_WIDTH, ' ');
}

function countSeverities(findings: readonly Finding[]): Record<Severity, number> {
	const counts: Record<Severity, number> = {
		critical: 0,
		high: 0,
		info: 0,
		low: 0,
		medium: 0,
	};
	for (const f of findings) counts[f.severity] += 1;
	return counts;
}

function compareFindings(a: Finding, b: Finding): number {
	const sevDelta = SEVERITY_ORDER.indexOf(a.severity) - SEVERITY_ORDER.indexOf(b.severity);
	if (sevDelta !== 0) return sevDelta;
	if (a.score !== b.score) return b.score - a.score;
	if (a.ruleId !== b.ruleId) return a.ruleId < b.ruleId ? -1 : 1;
	return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}

function groupFindings(
	findings: readonly Finding[]
): Readonly<Record<FindingGroup, readonly Finding[]>> {
	const buckets: Record<FindingGroup, Finding[]> = {
		'credential-reachability': [],
		'dynamic-tool-surfaces': [],
		'local-execution-bridges': [],
		'memory-context-exposure': [],
		'remote-capabilities': [],
		'untrusted-provenance': [],
	};
	for (const f of findings) buckets[f.group].push(f);
	for (const key of GROUP_ORDER) buckets[key].sort(compareFindings);
	return buckets;
}

function renderInventory(inventory: ScanInventory, lines: string[]): void {
	lines.push('Agent Surfaces');
	lines.push('--------------');
	if (inventory.sources.length === 0) {
		lines.push('  No agent surfaces discovered.');
		lines.push('');
		return;
	}

	for (const source of inventory.sources) {
		const tag = source.customPath ? ' [custom]' : '';
		lines.push(`  - ${source.agent}${tag}: ${source.root}`);
	}

	lines.push('');
	lines.push(`Artifacts (${inventory.totalArtifacts} total)`);
	lines.push('---------');
	const agents = Object.keys(inventory.artifactCounts).sort();
	if (agents.length === 0) {
		lines.push('  No artifacts read.');
		lines.push('');
		return;
	}
	for (const agent of agents) {
		const byType = inventory.artifactCounts[agent] ?? {};
		const parts = Object.entries(byType)
			.filter(([, count]) => typeof count === 'number' && count > 0)
			.sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
			.map(([type, count]) => `${type}=${count}`);
		const summary = parts.length === 0 ? '(none)' : parts.join(', ');
		lines.push(`  - ${agent}: ${summary}`);
	}
	lines.push('');
}

function renderSummary(findings: readonly Finding[], lines: string[]): void {
	const counts = countSeverities(findings);
	lines.push('Findings Summary');
	lines.push('----------------');
	lines.push(`  Total: ${findings.length}`);
	for (const sev of SEVERITY_ORDER) {
		lines.push(`  ${padSeverity(sev)}  ${counts[sev]}`);
	}
	lines.push('');
}

function renderLocation(finding: Finding): string {
	if (finding.file === undefined) return finding.source.root;
	if (finding.line === undefined) return finding.file;
	return `${finding.file}:${finding.line}`;
}

function renderFinding(finding: Finding, lines: string[]): void {
	lines.push(`  [${padSeverity(finding.severity)}] ${finding.title}`);
	lines.push(`      Rule:     ${finding.ruleId}`);
	lines.push(`      Agent:    ${finding.source.agent}`);
	lines.push(`      Location: ${renderLocation(finding)}`);
	const signals = finding.signals.length === 0 ? '(none)' : finding.signals.join(', ');
	lines.push(`      Signals:  ${signals}`);
	lines.push(`      Score:    ${finding.score} (confidence: ${finding.confidence})`);
	if (finding.evidence !== undefined && finding.evidence.length > 0) {
		lines.push(`      Evidence: ${maskSecrets(finding.evidence)}`);
	}
	if (finding.severity === 'high' || finding.severity === 'critical') {
		lines.push(`      Why this matters: ${GROUP_RATIONALE[finding.group]}`);
	}
	lines.push('');
}

function renderRuleRecommendations(findings: readonly Finding[], lines: string[]): void {
	const seen = new Map<string, string>();
	for (const f of findings) {
		if (!seen.has(f.ruleId)) seen.set(f.ruleId, f.recommendation);
	}
	if (seen.size === 0) return;
	lines.push('Recommendations');
	lines.push('---------------');
	for (const [ruleId, recommendation] of seen) {
		lines.push(`  ${ruleId}:`);
		lines.push(`    ${recommendation}`);
		lines.push('');
	}
}

function renderHiddenSummary(
	hiddenCounts: Record<Severity, number>,
	thresholdName: Severity,
	lines: string[]
): void {
	const total = Object.values(hiddenCounts).reduce((sum, n) => sum + n, 0);
	if (total === 0) return;
	const parts = SEVERITY_ORDER.filter((s) => hiddenCounts[s] > 0).map(
		(s) => `${hiddenCounts[s]} ${s}`
	);
	lines.push(
		`(${total} finding${total === 1 ? '' : 's'} below threshold '${thresholdName}' hidden: ${parts.join(', ')}. Re-run with --all to show.)`
	);
	lines.push('');
}

function renderFindings(
	findings: readonly Finding[],
	threshold: Severity,
	showAll: boolean,
	lines: string[]
): {
	hidden: Record<Severity, number>;
	visible: readonly Finding[];
} {
	const minRank = SEVERITY_RANK[threshold];
	const visible: Finding[] = [];
	const hidden: Record<Severity, number> = { critical: 0, high: 0, info: 0, low: 0, medium: 0 };
	for (const f of findings) {
		if (showAll || SEVERITY_RANK[f.severity] >= minRank) visible.push(f);
		else hidden[f.severity] += 1;
	}

	if (visible.length === 0 && findings.length === 0) {
		lines.push('No findings.');
		lines.push('');
		return { hidden, visible };
	}
	if (visible.length === 0) {
		lines.push(`No findings at or above threshold '${threshold}'.`);
		lines.push('');
		return { hidden, visible };
	}

	const grouped = groupFindings(visible);
	for (const group of GROUP_ORDER) {
		const bucket = grouped[group];
		if (bucket.length === 0) continue;
		lines.push(`${GROUP_LABELS[group]} (${bucket.length})`);
		lines.push('-'.repeat(`${GROUP_LABELS[group]} (${bucket.length})`.length));
		for (const finding of bucket) renderFinding(finding, lines);
	}
	return { hidden, visible };
}

/**
 * Format a scan result as human-readable text.
 *
 * Returns a single string ending with a newline. Output is deterministic given
 * the same inputs: sources are emitted in their incoming order, artifact
 * agents and types are sorted alphabetically, and findings are sorted by
 * severity desc, score desc, rule id, then finding id.
 */
export function formatHuman(
	findings: readonly Finding[],
	inventory: ScanInventory,
	options: HumanReportOptions
): string {
	const lines: string[] = [];
	lines.push(`AgentWatch scan complete (v${options.version})`);
	lines.push(`Scanned at: ${options.scannedAt}`);
	lines.push('');
	renderInventory(inventory, lines);
	renderSummary(findings, lines);
	const threshold = options.threshold ?? 'medium';
	const showAll = options.showAll === true;
	const { hidden, visible } = renderFindings(findings, threshold, showAll, lines);
	if (!showAll) renderHiddenSummary(hidden, threshold, lines);
	renderRuleRecommendations(visible, lines);
	return `${lines.join('\n').replace(/\n+$/u, '')}\n`;
}
