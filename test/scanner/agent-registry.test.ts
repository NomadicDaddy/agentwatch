/**
 * Registry coverage of the canonical agent-home set.
 *
 * The canonical set is the agentwatch-recognized coding-agent homes. Every entry below
 * must be registered, and homes that exist under multiple paths must list each so any
 * install layout is discovered.
 */

import { describe, expect, test } from 'bun:test';

import {
	type AgentInfo,
	getAllAgents,
	getAgentByName,
	getSupportedAgentNames,
} from '../../src/scanner/agent-registry.ts';

// The complete stable public registry, including AgentWatch-only inspection surfaces and custom.
const SUPPORTED_AGENT_NAMES = [
	'claude',
	'codex',
	'opencode',
	'kilo',
	'cursor',
	'windsurf',
	'windsurf-next',
	'antigravity',
	'gemini',
	'grok',
	'kiro',
	'copilot',
	'zcode',
	'agents',
	'cline',
	'devin',
	'devin-next',
	't3code',
	'pi',
	'mcp',
	'skills',
	'custom',
] as const;

// The canonical agent-home set recognized by this registry (16 homes).
const CANONICAL_AGENTS = [
	'agents',
	'antigravity',
	'claude',
	'cline',
	'codex',
	'copilot',
	'cursor',
	'devin',
	'gemini',
	'grok',
	'kilo',
	'kiro',
	'opencode',
	't3code',
	'windsurf',
	'zcode',
] as const;

// Homes reachable under more than one root must list every root so no install layout
// is missed. For most agents that means the this-machine (legacy) path alongside the
// upstream-default path; for t3code it means the runtime home alongside the separate
// Electron userData tree the desktop shell writes.
const BOTH_PATH_EXPECTATIONS: readonly (readonly [string, readonly string[]])[] = [
	['kilo', ['~/.config/kilo', '~/.kilocode']],
	['opencode', ['~/.config/opencode', '~/.opencode']],
	['windsurf', ['~/.codeium/windsurf', '~/.windsurf']],
	['antigravity', ['~/.gemini/antigravity', '~/.antigravity']],
	['t3code', ['~/.t3', '%APPDATA%/t3code']],
	['devin', ['~/.devin', '~/.config/devin', '%APPDATA%/devin']],
	[
		'devin-next',
		[
			'~/.devin-next',
			'%APPDATA%/Devin - Next',
			'~/Library/Application Support/Devin - Next',
			'~/.config/Devin - Next',
		],
	],
] as const;

function allPathTemplates(agent: AgentInfo): readonly string[] {
	const { paths } = agent;
	return [...paths.cwd, ...paths.darwin, ...paths.linux, ...paths.win32];
}

describe('agent registry covers the canonical agent-home set', () => {
	test('publishes the complete stable supported-agent registry', () => {
		expect(getSupportedAgentNames()).toEqual(SUPPORTED_AGENT_NAMES);
	});

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
