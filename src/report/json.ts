/**
 * JSON reporter for `agentwatch scan --json`.
 *
 * Emits a deterministic, machine-readable payload:
 *   - `version` / `scannedAt` metadata
 *   - `inventory` with agent surface roots and per-agent artifact-type counts
 *   - `findings` grouped by `FindingGroup`, each with rule id, title, severity,
 *     score, confidence, signals, source agent + root, location, and masked
 *     evidence.
 *
 * Pure function: returns a string (pretty-printed JSON, 2-space indent, trailing
 * newline). Findings are sorted within each group identically to the human
 * reporter so the two outputs stay in lock-step.
 */

import type { Finding, FindingGroup } from '../rules/types.ts';
import type { ScanInventory } from './human.ts';

import { maskSecrets } from '../util/mask.ts';

export interface JsonReportOptions {
	readonly scannedAt: string;
	readonly version: string;
}

interface JsonInventoryAgent {
	readonly agent: string;
	readonly artifactCounts: Readonly<Record<string, number>>;
	readonly customPath: boolean;
	readonly root: string;
}

interface JsonInventory {
	readonly agents: readonly JsonInventoryAgent[];
	readonly totalArtifacts: number;
}

interface JsonFinding {
	readonly confidence: string;
	readonly evidence?: string;
	readonly file?: string;
	readonly group: FindingGroup;
	readonly id: string;
	readonly line?: number;
	readonly recommendation: string;
	readonly ruleId: string;
	readonly score: number;
	readonly severity: string;
	readonly signals: readonly string[];
	readonly source: {
		readonly agent: string;
		readonly customPath: boolean;
		readonly root: string;
	};
	readonly title: string;
}

interface JsonFindingsGroup {
	readonly count: number;
	readonly findings: readonly JsonFinding[];
	readonly group: FindingGroup;
}

interface JsonReport {
	readonly findings: readonly JsonFindingsGroup[];
	readonly inventory: JsonInventory;
	readonly scannedAt: string;
	readonly summary: {
		readonly bySeverity: Readonly<Record<string, number>>;
		readonly totalFindings: number;
	};
	readonly version: string;
}

const SEVERITY_ORDER: readonly Finding['severity'][] = [
	'critical',
	'high',
	'medium',
	'low',
	'info',
];

const GROUP_ORDER: readonly FindingGroup[] = [
	'remote-capabilities',
	'memory-context-exposure',
	'dynamic-tool-surfaces',
	'local-execution-bridges',
	'untrusted-provenance',
	'credential-reachability',
];

function compareFindings(a: Finding, b: Finding): number {
	const sevDelta = SEVERITY_ORDER.indexOf(a.severity) - SEVERITY_ORDER.indexOf(b.severity);
	if (sevDelta !== 0) return sevDelta;
	if (a.score !== b.score) return b.score - a.score;
	if (a.ruleId !== b.ruleId) return a.ruleId < b.ruleId ? -1 : 1;
	return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}

function buildInventory(inventory: ScanInventory): JsonInventory {
	const agents: JsonInventoryAgent[] = inventory.sources.map((source) => {
		const raw = inventory.artifactCounts[source.agent] ?? {};
		const counts: Record<string, number> = {};
		for (const [type, count] of Object.entries(raw)) {
			if (typeof count === 'number' && count > 0) counts[type] = count;
		}
		return {
			agent: source.agent,
			artifactCounts: counts,
			customPath: source.customPath === true,
			root: source.root,
		};
	});
	return {
		agents,
		totalArtifacts: inventory.totalArtifacts,
	};
}

function toJsonFinding(finding: Finding): JsonFinding {
	return {
		confidence: finding.confidence,
		group: finding.group,
		id: finding.id,
		ruleId: finding.ruleId,
		score: finding.score,
		severity: finding.severity,
		signals: [...finding.signals],
		source: {
			agent: finding.source.agent,
			customPath: finding.source.customPath === true,
			root: finding.source.root,
		},
		title: finding.title,
		...(finding.file !== undefined ? { file: finding.file } : {}),
		...(finding.line !== undefined ? { line: finding.line } : {}),
		...(finding.evidence !== undefined && finding.evidence.length > 0
			? { evidence: maskSecrets(finding.evidence) }
			: {}),
		recommendation: finding.recommendation,
	};
}

function buildFindings(findings: readonly Finding[]): readonly JsonFindingsGroup[] {
	const buckets: Record<FindingGroup, Finding[]> = {
		'credential-reachability': [],
		'dynamic-tool-surfaces': [],
		'local-execution-bridges': [],
		'memory-context-exposure': [],
		'remote-capabilities': [],
		'untrusted-provenance': [],
	};
	for (const f of findings) buckets[f.group].push(f);
	const groups: JsonFindingsGroup[] = [];
	for (const group of GROUP_ORDER) {
		const bucket = buckets[group].slice().sort(compareFindings);
		groups.push({
			count: bucket.length,
			findings: bucket.map(toJsonFinding),
			group,
		});
	}
	return groups;
}

function buildSummary(findings: readonly Finding[]): JsonReport['summary'] {
	const bySeverity: Record<string, number> = {
		critical: 0,
		high: 0,
		info: 0,
		low: 0,
		medium: 0,
	};
	for (const f of findings) bySeverity[f.severity] = (bySeverity[f.severity] ?? 0) + 1;
	return {
		bySeverity,
		totalFindings: findings.length,
	};
}

/**
 * Format a scan result as a pretty-printed JSON string (2-space indent,
 * trailing newline). Always emits a syntactically valid JSON document, even
 * when there are no findings.
 */
export function formatJson(
	findings: readonly Finding[],
	inventory: ScanInventory,
	options: JsonReportOptions
): string {
	const payload: JsonReport = {
		findings: buildFindings(findings),
		inventory: buildInventory(inventory),
		scannedAt: options.scannedAt,
		summary: buildSummary(findings),
		version: options.version,
	};
	return `${JSON.stringify(payload, null, 2)}\n`;
}
