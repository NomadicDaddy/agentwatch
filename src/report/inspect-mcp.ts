/**
 * `agentwatch inspect-mcp` implementation.
 *
 * Reads a single MCP server config file (JSON or TOML), classifies it as an
 * `mcp-config` artifact, and runs the MCP-focused rule pack against it:
 * remote-capability, remote-manifest, dynamic-tool-registry,
 * local-execution-bridge, and unpinned-execution-bridge. Findings are emitted
 * via the shared human or JSON reporter so output is consistent with `scan`.
 *
 * Read-only. Returns 0 when no finding meets the medium threshold, 1 when
 * findings meet or exceed it, and 2 on read or parse errors.
 */

import { readFile } from 'node:fs/promises';
import { extname, resolve } from 'node:path';

import type { Artifact, Finding, Rule, Severity } from '../rules/types.ts';
import type { AgentPlatform } from '../scanner/agent-registry.ts';
import type { AgentSource } from '../scanner/targets.ts';

import { dynamicToolRegistryRule } from '../rules/dynamic-tools.ts';
import { localExecutionBridgeRule } from '../rules/execution-bridges.ts';
import { remoteCapabilityRule } from '../rules/remote-capabilities.ts';
import { remoteManifestRule } from '../rules/remote-manifest.ts';
import { unpinnedExecutionBridgeRule } from '../rules/unpinned-execution-bridge.ts';
import { correlateFindings } from '../scanner/finding-correlation.ts';
import { PACKAGE_VERSION } from '../version.ts';
import { formatHuman, type ScanInventory } from './human.ts';
import { formatJson } from './json.ts';

const MCP_RULES: readonly Rule[] = [
	remoteCapabilityRule,
	remoteManifestRule,
	dynamicToolRegistryRule,
	localExecutionBridgeRule,
	unpinnedExecutionBridgeRule,
];

const SEVERITY_ORDER: readonly Severity[] = ['info', 'low', 'medium', 'high', 'critical'];
const DEFAULT_THRESHOLD: Severity = 'medium';

const PLATFORM_KEYS: ReadonlySet<AgentPlatform> = new Set(['win32', 'darwin', 'linux']);

function detectPlatform(): AgentPlatform {
	const p = process.platform;
	return PLATFORM_KEYS.has(p as AgentPlatform) ? (p as AgentPlatform) : 'linux';
}

export interface RunInspectMcpOptions {
	readonly json: boolean;
}

export async function runInspectMcp(
	file: string,
	options: RunInspectMcpOptions = { json: false }
): Promise<number> {
	const absolute = resolve(process.cwd(), file);

	let raw: string;
	try {
		raw = await readFile(absolute, 'utf8');
	} catch (err) {
		const message = err instanceof Error ? err.message : String(err);
		process.stderr.write(`inspect-mcp: cannot read ${absolute}: ${message}\n`);
		return 2;
	}

	const ext = extname(absolute).toLowerCase();
	const isToml = ext === '.toml';
	try {
		if (isToml) {
			Bun.TOML.parse(raw);
		} else {
			JSON.parse(raw);
		}
	} catch (err) {
		const message = err instanceof Error ? err.message : String(err);
		const fmt = isToml ? 'TOML' : 'JSON';
		process.stderr.write(`inspect-mcp: ${absolute} is not valid ${fmt}: ${message}\n`);
		return 2;
	}

	const source: AgentSource = { agent: 'custom', customPath: true, root: absolute };
	const artifact: Artifact = {
		content: raw,
		path: absolute,
		source,
		type: 'mcp-config',
	};

	const ctx = { artifacts: [artifact], platform: detectPlatform() } as const;
	const collected: Finding[] = [];
	for (const rule of MCP_RULES) {
		collected.push(...(await rule.scan(ctx)));
	}
	// Same-source, same-artifact correlation as `scan`: focused inspection must
	// not bypass the critical signal combinations the orchestrator synthesizes.
	const correlated = correlateFindings(collected);
	const findings = sortFindings(correlated);

	const inventory: ScanInventory = {
		artifactCounts: { custom: { 'mcp-config': 1 } },
		sources: [source],
		totalArtifacts: 1,
	};
	const meta = { scannedAt: new Date().toISOString(), version: PACKAGE_VERSION };

	const out = options.json
		? formatJson(findings, inventory, meta)
		: formatHuman(findings, inventory, meta);
	process.stdout.write(out);

	const minRank = SEVERITY_ORDER.indexOf(DEFAULT_THRESHOLD);
	return findings.some((f) => SEVERITY_ORDER.indexOf(f.severity) >= minRank) ? 1 : 0;
}

function sortFindings(findings: readonly Finding[]): Finding[] {
	return [...findings].sort((a, b) => {
		if (b.score !== a.score) return b.score - a.score;
		if (a.ruleId !== b.ruleId) return a.ruleId.localeCompare(b.ruleId);
		return a.id.localeCompare(b.id);
	});
}
