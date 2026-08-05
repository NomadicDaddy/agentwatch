/**
 * Shared type definitions for the rule system.
 *
 * Rules consume `RuleContext` (artifacts + platform), emit `Finding[]`, and are
 * registered against a `FindingGroup`. Severity is derived from the composite
 * score via `severityFromScore` (see spec.md scoring table).
 */

import type { AgentPlatform } from '../scanner/agent-registry.ts';
import type { AgentSource } from '../scanner/targets.ts';

/** Categorical type of an inspected artifact. Mirrors spec.md "Artifact Types". */
export type ArtifactType =
	| 'agent-instruction'
	| 'connector-config'
	| 'mcp-config'
	| 'memory-config'
	| 'permission-config'
	| 'provenance'
	| 'skill'
	| 'tool-manifest';

/** Risk category a finding belongs to. Mirrors spec.md "Risk Categories". */
export type FindingGroup =
	| 'credential-reachability'
	| 'dynamic-tool-surfaces'
	| 'local-execution-bridges'
	| 'memory-context-exposure'
	| 'remote-capabilities'
	| 'untrusted-provenance';

export type Severity = 'critical' | 'high' | 'info' | 'low' | 'medium';

export type Confidence = 'high' | 'low' | 'medium';

/** A single artifact read from disk during the scan. */
export interface Artifact {
	/** Raw file contents (text). Binary artifacts are filtered upstream. */
	readonly content: string;
	/** Absolute path to the artifact on disk. */
	readonly path: string;
	/** The agent source this artifact was discovered under. */
	readonly source: AgentSource;
	/** Categorical type, assigned by the artifact classifier. */
	readonly type: ArtifactType;
}

/** A single finding produced by a rule. */
export interface Finding {
	readonly confidence: Confidence;
	/** Masked excerpt of the offending content. */
	readonly evidence?: string;
	readonly file?: string;
	readonly group: FindingGroup;
	/** Stable, human-readable id for this specific finding instance. */
	readonly id: string;
	readonly line?: number;
	readonly recommendation: string;
	/** Id of the rule that produced this finding (e.g. `agent.remote-capability`). */
	readonly ruleId: string;
	/** Composite score per spec.md scoring table. */
	readonly score: number;
	readonly severity: Severity;
	/** Signal labels that contributed to the score. */
	readonly signals: readonly string[];
	readonly source: AgentSource;
	/** Short title describing the finding. */
	readonly title: string;
}

/** Context passed to every rule's `scan` method. */
export interface RuleContext {
	readonly artifacts: readonly Artifact[];
	readonly platform: AgentPlatform;
}

/** Contract for a rule. Rules are pure functions over context. */
export interface Rule {
	readonly description: string;
	readonly group: FindingGroup;
	readonly id: string;
	scan(ctx: RuleContext): Promise<Finding[]>;
	readonly title: string;
}

/**
 * Map a composite score to a severity bucket.
 *
 * Boundaries (per spec.md): 0-29 info, 30-59 low, 60-89 medium, 90-119 high, 120+ critical.
 * Negative scores collapse to `info`.
 */
export function severityFromScore(score: number): Severity {
	if (score >= 120) return 'critical';
	if (score >= 90) return 'high';
	if (score >= 60) return 'medium';
	if (score >= 30) return 'low';
	return 'info';
}
