/**
 * Custom path attribution and end-to-end fixture scoring.
 *
 * Builds a temporary directory containing known-bad MCP and skill artifacts,
 * then verifies the scanner attributes findings to the custom source and that
 * the composite scoring matches the spec when the rules execute together.
 */

import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { mkdir, mkdtemp, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { readArtifacts } from '../../src/scanner/artifact-reader.ts';
import { discoverTargets, type AgentSource } from '../../src/scanner/targets.ts';
import { credentialReachabilityRule } from '../../src/rules/credential-reachability.ts';
import { dynamicToolRegistryRule } from '../../src/rules/dynamic-tools.ts';
import { localExecutionBridgeRule } from '../../src/rules/execution-bridges.ts';
import { remoteCapabilityRule } from '../../src/rules/remote-capabilities.ts';
import type { Finding } from '../../src/rules/types.ts';

let fixtureRoot: string;
let linkedDirectoryRoot: string;
let linkedFileRoot: string;
let workdir: string;

beforeAll(async () => {
	fixtureRoot = await mkdtemp(join(tmpdir(), 'agentwatch-itest-'));
	workdir = join(fixtureRoot, 'scan-root');
	const outsideRoot = join(fixtureRoot, 'outside-root');
	const outsideSkills = join(outsideRoot, 'skills');
	await mkdir(workdir);
	await mkdir(outsideSkills, { recursive: true });
	await writeFile(
		join(workdir, '.mcp.json'),
		[
			'{',
			'  "mcpServers": {',
			'    "remote": { "url": "https://gateway.example.com/mcp" },',
			'    "shell": { "command": "npx", "args": ["-y", "some-pkg"] }',
			'  }',
			'}',
		].join('\n')
	);
	await writeFile(
		join(workdir, 'connector.json'),
		'{\n  "connectors": [{ "service": "gmail" }],\n  "access_token": "REDACTED"\n}'
	);
	const outsideInstruction = join(outsideRoot, 'AGENTS.md');
	await writeFile(outsideInstruction, '# Outside instructions\n');
	await writeFile(join(outsideSkills, 'SKILL.md'), '# Outside skill\n');
	linkedFileRoot = join(workdir, 'AGENTS.md');
	linkedDirectoryRoot = join(workdir, 'linked-skills');
	await symlink(outsideInstruction, linkedFileRoot, 'file');
	await symlink(outsideSkills, linkedDirectoryRoot, 'dir');
});

afterAll(async () => {
	await rm(fixtureRoot, { recursive: true, force: true });
});

describe('custom path discovery and attribution', () => {
	test('discoverTargets attributes custom paths to the "custom" agent', async () => {
		const sources = await discoverTargets({
			agent: '__no_such_agent__', // suppress built-in agents in this run
			customPaths: [workdir],
		});
		const customSources = sources.filter((s) => s.customPath);
		expect(customSources).toHaveLength(1);
		expect(customSources[0]?.agent).toBe('custom');
		expect(customSources[0]?.root).toBe(workdir);
	});

	test('artifacts read under a custom path inherit the custom source', async () => {
		const sources = await discoverTargets({
			agent: '__no_such_agent__',
			customPaths: [workdir],
		});
		const artifacts = await readArtifacts(sources);
		expect(artifacts.length).toBeGreaterThan(0);
		expect(artifacts.every((a) => a.source.agent === 'custom')).toBe(true);
		expect(artifacts.every((a) => a.source.customPath === true)).toBe(true);
	});

	test('discoverTargets rejects registered and custom symbolic-link roots', async () => {
		const sources = await discoverTargets({
			agent: 'codex',
			customPaths: [linkedFileRoot, linkedDirectoryRoot],
			cwd: workdir,
			env: {},
			platform: 'linux',
		});

		expect(sources.some((source) => source.root === linkedFileRoot)).toBe(false);
		expect(sources.some((source) => source.root === linkedDirectoryRoot)).toBe(false);
	});

	test('readArtifacts rejects direct file and directory symbolic-link roots', async () => {
		const sources: AgentSource[] = [
			{ agent: 'codex', customPath: false, root: linkedFileRoot },
			{ agent: 'custom', customPath: true, root: linkedDirectoryRoot },
		];

		expect(await readArtifacts(sources)).toEqual([]);
	});
});

describe('agent surface scoring with fixture data', () => {
	test('rules together produce expected findings on the fixture set', async () => {
		const sources = await discoverTargets({
			agent: '__no_such_agent__',
			customPaths: [workdir],
		});
		const artifacts = await readArtifacts(sources);
		const ctx = { artifacts, platform: 'linux' as const };

		const findings: Finding[] = [
			...(await remoteCapabilityRule.scan(ctx)),
			...(await localExecutionBridgeRule.scan(ctx)),
			...(await dynamicToolRegistryRule.scan(ctx)),
			...(await credentialReachabilityRule.scan(ctx)),
		];

		expect(findings.some((f) => f.ruleId === 'agent.remote-capability')).toBe(true);
		expect(findings.some((f) => f.ruleId === 'agent.local-execution-bridge')).toBe(true);
		expect(findings.some((f) => f.ruleId === 'agent.connector-credential-reachability')).toBe(
			true
		);

		// Every produced finding must carry the custom-source attribution.
		expect(findings.every((f) => f.source.agent === 'custom')).toBe(true);
		expect(findings.every((f) => f.source.customPath === true)).toBe(true);

		const remote = findings.find((f) => f.ruleId === 'agent.remote-capability');
		expect(remote?.score).toBe(35);
		expect(remote?.severity).toBe('low');

		const local = findings.find((f) => f.ruleId === 'agent.local-execution-bridge');
		expect(local?.score).toBe(25);

		const cred = findings.find((f) => f.ruleId === 'agent.connector-credential-reachability');
		expect(cred?.score).toBe(20);
	});
});
