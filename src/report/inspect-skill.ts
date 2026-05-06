/**
 * `agentwatch inspect-skill` implementation.
 *
 * Reads a single skill/prompt artifact (typically SKILL.md) and runs the
 * skill-focused rule pack against it: memory-context-request,
 * trigger-based-invocation, credential-file-reference, and broad-tool-surface.
 * Findings are emitted via the shared human or JSON reporter so output is
 * consistent with `scan` and `inspect-mcp`.
 *
 * Read-only and non-destructive — the file is never executed. Returns 0 when
 * no finding meets the medium threshold, 1 when findings meet or exceed it,
 * and 2 on read errors.
 */

import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

import type { Artifact, Finding, Rule, Severity } from '../rules/types.ts';
import type { AgentPlatform } from '../scanner/agent-registry.ts';
import type { AgentSource } from '../scanner/targets.ts';

import { broadToolSurfaceRule } from '../rules/broad-tool-surface.ts';
import { credentialFileReferenceRule } from '../rules/credential-file-reference.ts';
import { memoryContextRequestRule } from '../rules/memory-context.ts';
import { triggerBasedInvocationRule } from '../rules/trigger-based-invocation.ts';
import { formatHuman, type ScanInventory } from './human.ts';
import { formatJson } from './json.ts';

const VERSION = '0.1.0';

const SKILL_RULES: readonly Rule[] = [
	memoryContextRequestRule,
	triggerBasedInvocationRule,
	credentialFileReferenceRule,
	broadToolSurfaceRule,
];

const SEVERITY_ORDER: readonly Severity[] = ['info', 'low', 'medium', 'high', 'critical'];
const DEFAULT_THRESHOLD: Severity = 'medium';

const PLATFORM_KEYS: ReadonlySet<AgentPlatform> = new Set(['win32', 'darwin', 'linux']);

function detectPlatform(): AgentPlatform {
	const p = process.platform;
	return PLATFORM_KEYS.has(p as AgentPlatform) ? (p as AgentPlatform) : 'linux';
}

export interface RunInspectSkillOptions {
	readonly json: boolean;
}

export async function runInspectSkill(
	file: string,
	options: RunInspectSkillOptions = { json: false }
): Promise<number> {
	const absolute = resolve(process.cwd(), file);

	let raw: string;
	try {
		raw = await readFile(absolute, 'utf8');
	} catch (err) {
		const message = err instanceof Error ? err.message : String(err);
		process.stderr.write(`inspect-skill: cannot read ${absolute}: ${message}\n`);
		return 2;
	}

	const source: AgentSource = { agent: 'custom', customPath: true, root: absolute };
	const artifact: Artifact = {
		content: raw,
		path: absolute,
		source,
		type: 'skill',
	};

	const ctx = { artifacts: [artifact], platform: detectPlatform() } as const;
	const collected: Finding[] = [];
	for (const rule of SKILL_RULES) {
		collected.push(...(await rule.scan(ctx)));
	}
	const findings = sortFindings(collected);

	const inventory: ScanInventory = {
		artifactCounts: { custom: { skill: 1 } },
		sources: [source],
		totalArtifacts: 1,
	};
	const meta = { scannedAt: new Date().toISOString(), version: VERSION };

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
