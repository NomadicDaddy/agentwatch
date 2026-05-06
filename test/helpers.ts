/**
 * Shared helpers for the integration test suite.
 *
 * Provides ergonomic factories for the `Artifact` and `RuleContext` shapes so
 * each test can declare a focused fixture without re-spelling the full type.
 */

import type { AgentPlatform } from '../src/scanner/agent-registry.ts';
import type { AgentSource } from '../src/scanner/targets.ts';
import type { Artifact, ArtifactType, RuleContext } from '../src/rules/types.ts';

export function makeSource(overrides: Partial<AgentSource> = {}): AgentSource {
	return {
		agent: 'claude',
		root: '/fixture/root',
		customPath: false,
		...overrides,
	};
}

interface ArtifactInit {
	readonly path?: string;
	readonly content: string;
	readonly type: ArtifactType;
	readonly source?: AgentSource;
}

export function makeArtifact(init: ArtifactInit): Artifact {
	return {
		path: init.path ?? `/fixture/root/${init.type}.json`,
		content: init.content,
		type: init.type,
		source: init.source ?? makeSource(),
	};
}

export function makeContext(
	artifacts: readonly Artifact[],
	platform: AgentPlatform = 'linux'
): RuleContext {
	return { artifacts, platform };
}
