/**
 * Scan orchestrator.
 *
 * Discovers agent surface roots, reads classifiable artifacts under each
 * root, executes the registered rule packs against the collected artifacts,
 * and routes the results to the human or JSON reporter.
 *
 * Findings are deduplicated (same file + rule + signal set), sorted by score
 * descending, and the process exit code reflects whether any finding meets
 * the default severity threshold.
 */

import type { Artifact, Finding, Rule, Severity } from '../rules/types.ts';
import type { AgentPlatform } from './agent-registry.ts';

import { formatHuman, type ScanInventory } from '../report/human.ts';
import { formatJson } from '../report/json.ts';
import { broadToolSurfaceRule } from '../rules/broad-tool-surface.ts';
import { credentialFileReferenceRule } from '../rules/credential-file-reference.ts';
import { credentialReachabilityRule } from '../rules/credential-reachability.ts';
import { dynamicToolRegistryRule } from '../rules/dynamic-tools.ts';
import { localExecutionBridgeRule } from '../rules/execution-bridges.ts';
import { memoryContextRequestRule } from '../rules/memory-context.ts';
import { remoteCapabilityRule } from '../rules/remote-capabilities.ts';
import { remoteManifestRule } from '../rules/remote-manifest.ts';
import { remoteMcpGatewayRule } from '../rules/remote-mcp-gateway.ts';
import { triggerBasedInvocationRule } from '../rules/trigger-based-invocation.ts';
import { unpinnedExecutionBridgeRule } from '../rules/unpinned-execution-bridge.ts';
import { untrustedInstallSourceRule } from '../rules/untrusted-install-source.ts';
import { maskSecrets } from '../util/mask.ts';
import { PACKAGE_VERSION } from '../version.ts';
import { getSupportedAgentNames, isSupportedAgent } from './agent-registry.ts';
import { readArtifacts } from './artifact-reader.ts';
import { correlateFindings } from './finding-correlation.ts';
import { discoverTargets, type AgentSource } from './targets.ts';

export interface RunScanOptions {
	readonly agent?: string | undefined;
	readonly customPaths?: readonly string[] | undefined;
	readonly json: boolean;
	readonly showAll?: boolean | undefined;
	readonly threshold?: Severity | undefined;
}

/** Ordered severities (low → high). Index used for threshold comparison. */
const SEVERITY_ORDER: readonly Severity[] = ['info', 'low', 'medium', 'high', 'critical'];

export const DEFAULT_THRESHOLD: Severity = 'medium';

export function isSeverity(value: string): value is Severity {
	return (SEVERITY_ORDER as readonly string[]).includes(value);
}

function severityRank(severity: Severity): number {
	return SEVERITY_ORDER.indexOf(severity);
}

export interface ScanResult {
	readonly findings: readonly Finding[];
	readonly inventory: ScanInventory;
	readonly scannedAt: string;
	readonly sources: readonly AgentSource[];
	readonly version: string;
}

/** Rules registered with the orchestrator. Order is irrelevant; findings are sorted by score. */
const REGISTERED_RULES: readonly Rule[] = [
	remoteCapabilityRule,
	remoteManifestRule,
	remoteMcpGatewayRule,
	dynamicToolRegistryRule,
	triggerBasedInvocationRule,
	memoryContextRequestRule,
	localExecutionBridgeRule,
	unpinnedExecutionBridgeRule,
	credentialReachabilityRule,
	credentialFileReferenceRule,
	broadToolSurfaceRule,
	untrustedInstallSourceRule,
];

const PLATFORM_KEYS: ReadonlySet<AgentPlatform> = new Set(['win32', 'darwin', 'linux']);

function detectPlatform(): AgentPlatform {
	const p = process.platform;
	return PLATFORM_KEYS.has(p as AgentPlatform) ? (p as AgentPlatform) : 'linux';
}

export async function runScan(options: RunScanOptions): Promise<number> {
	if (options.agent !== undefined && !isSupportedAgent(options.agent)) {
		const supported = getSupportedAgentNames().join(', ');
		process.stderr.write(
			`error: unsupported agent '${options.agent}'. Supported agents: ${supported}\n`
		);
		return 2;
	}

	const progress = options.json ? noopProgress : stderrProgress;

	progress('Discovering agent surfaces…');
	const sources = await discoverTargets({
		...(options.agent !== undefined ? { agent: options.agent } : {}),
		...(options.customPaths !== undefined ? { customPaths: options.customPaths } : {}),
	});
	progress(`Discovered ${sources.length} source${sources.length === 1 ? '' : 's'}.`);
	for (const source of sources) progress(`  · ${source.agent}: ${maskSecrets(source.root)}`);

	progress('Reading artifacts…');
	const artifacts = await readArtifacts(sources, {
		onSource: (source, count) =>
			progress(`  · ${source.agent}: ${count} files (${maskSecrets(source.root)})`),
	});
	progress(`Read ${artifacts.length} artifact${artifacts.length === 1 ? '' : 's'}.`);

	const inventory = buildInventory(sources, artifacts);
	progress(`Running ${REGISTERED_RULES.length} rule packs…`);
	const findings = await executeRules(artifacts, (rule, produced) =>
		progress(`  · ${rule.id}: ${produced} finding${produced === 1 ? '' : 's'}`)
	);
	progress(`Produced ${findings.length} finding${findings.length === 1 ? '' : 's'}.`);

	const result: ScanResult = {
		findings,
		inventory,
		scannedAt: new Date().toISOString(),
		sources,
		version: PACKAGE_VERSION,
	};

	if (options.json) {
		process.stdout.write(
			formatJson(findings, inventory, {
				scannedAt: result.scannedAt,
				version: result.version,
			})
		);
	} else {
		process.stdout.write(
			formatHuman(findings, inventory, {
				scannedAt: result.scannedAt,
				showAll: options.showAll === true,
				threshold: options.threshold ?? DEFAULT_THRESHOLD,
				version: result.version,
			})
		);
	}

	const threshold = options.threshold ?? DEFAULT_THRESHOLD;
	const minRank = severityRank(threshold);
	return findings.some((f) => severityRank(f.severity) >= minRank) ? 1 : 0;
}

async function executeRules(
	artifacts: readonly Artifact[],
	onRule?: (rule: Rule, produced: number) => void
): Promise<readonly Finding[]> {
	const ctx = { artifacts, platform: detectPlatform() } as const;
	const collected: Finding[] = [];
	for (const rule of REGISTERED_RULES) {
		const produced = await rule.scan(ctx);
		onRule?.(rule, produced.length);
		collected.push(...produced);
	}
	const deduplicated = dedupeFindings(collected);
	return sortFindings(correlateFindings(deduplicated));
}

function stderrProgress(message: string): void {
	process.stderr.write(`${message}\n`);
}

function noopProgress(_message: string): void {}

function dedupeKey(finding: Finding): string {
	const signals = [...finding.signals].sort().join('|');
	return `${finding.ruleId}::${finding.file ?? ''}::${finding.line ?? ''}::${signals}`;
}

function dedupeFindings(findings: readonly Finding[]): Finding[] {
	const seen = new Set<string>();
	const out: Finding[] = [];
	for (const finding of findings) {
		const key = dedupeKey(finding);
		if (seen.has(key)) continue;
		seen.add(key);
		out.push(finding);
	}
	return out;
}

function sortFindings(findings: readonly Finding[]): Finding[] {
	return [...findings].sort((a, b) => {
		if (b.score !== a.score) return b.score - a.score;
		if (a.ruleId !== b.ruleId) return a.ruleId.localeCompare(b.ruleId);
		return a.id.localeCompare(b.id);
	});
}

function buildInventory(
	sources: readonly AgentSource[],
	artifacts: readonly Artifact[]
): ScanInventory {
	const counts: Record<string, Partial<Record<Artifact['type'], number>>> = {};
	for (const source of sources) {
		counts[source.agent] ??= {};
	}
	for (const artifact of artifacts) {
		const bucket = (counts[artifact.source.agent] ??= {});
		bucket[artifact.type] = (bucket[artifact.type] ?? 0) + 1;
	}
	return {
		artifactCounts: counts,
		sources,
		totalArtifacts: artifacts.length,
	};
}
