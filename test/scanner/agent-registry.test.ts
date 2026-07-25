/**
 * Registry coverage of the canonical agent-home set.
 *
 * The canonical set is the agentwatch-recognized coding-agent homes. Every entry below
 * must be registered, and homes that exist under multiple paths must list each so any
 * install layout is discovered.
 */

import { describe, expect, test } from 'bun:test';

import { type AgentInfo, getAllAgents, getAgentByName } from '../../src/scanner/agent-registry.ts';

// The canonical agent-home set recognized by this registry (14 homes).
const CANONICAL_AGENTS = [
	'agents',
	'antigravity',
	'claude',
	'cline',
	'codex',
	'copilot',
	'cursor',
	'gemini',
	'grok',
	'kilo',
	'kiro',
	'opencode',
	'windsurf',
	'zcode',
] as const;

// Homes that exist under different paths on different machines must list both the
// this-machine (legacy) path and the upstream-default path so either is discovered.
const BOTH_PATH_EXPECTATIONS: readonly (readonly [string, readonly string[]])[] = [
	['kilo', ['~/.config/kilo', '~/.kilocode']],
	['opencode', ['~/.config/opencode', '~/.opencode']],
	['windsurf', ['~/.codeium/windsurf', '~/.windsurf']],
	['antigravity', ['~/.gemini/antigravity', '~/.antigravity']],
] as const;

function allPathTemplates(agent: AgentInfo): readonly string[] {
	const { paths } = agent;
	return [...paths.cwd, ...paths.darwin, ...paths.linux, ...paths.win32];
}

describe('agent registry covers the canonical agent-home set', () => {
	test('every canonical agent home is registered', () => {
		for (const name of CANONICAL_AGENTS) {
			expect(getAgentByName(name), `expected agent '${name}' to be registered`).toBeDefined();
		}
	});

	test('no duplicate agent names are registered', () => {
		const names = getAllAgents().map((a) => a.name);
		expect(new Set(names).size).toBe(names.length);
	});

	test('conflicting homes list both this-machine and upstream paths', () => {
		for (const [name, expectedPaths] of BOTH_PATH_EXPECTATIONS) {
			const agent = getAgentByName(name);
			expect(agent, `expected agent '${name}' to be registered`).toBeDefined();
			if (!agent) continue;
			const templates = allPathTemplates(agent);
			for (const expected of expectedPaths) {
				expect(
					templates.includes(expected),
					`agent '${name}' should list path '${expected}'`
				).toBe(true);
			}
		}
	});
});
