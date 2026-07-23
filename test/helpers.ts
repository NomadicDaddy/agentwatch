/**
 * Shared helpers for the integration test suite.
 *
 * Provides ergonomic factories for the `Artifact` and `RuleContext` shapes so
 * each test can declare a focused fixture without re-spelling the full type.
 */

import type { Artifact, ArtifactType, RuleContext } from '../src/rules/types.ts';
import type { AgentPlatform } from '../src/scanner/agent-registry.ts';
import type { AgentSource } from '../src/scanner/targets.ts';

export function makeSource(overrides: Partial<AgentSource> = {}): AgentSource {
	return {
		agent: 'claude',
		customPath: false,
		root: '/fixture/root',
		...overrides,
	};
}

interface ArtifactInit {
	readonly content: string;
	readonly path?: string;
	readonly source?: AgentSource;
	readonly type: ArtifactType;
}

export function makeArtifact(init: ArtifactInit): Artifact {
	return {
		content: init.content,
		path: init.path ?? `/fixture/root/${init.type}.json`,
		source: init.source ?? makeSource(),
		type: init.type,
	};
}

export function makeContext(
	artifacts: readonly Artifact[],
	platform: AgentPlatform = 'linux'
): RuleContext {
	return { artifacts, platform };
}
