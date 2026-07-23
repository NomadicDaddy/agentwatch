import { describe, expect, test } from 'bun:test';

import { localExecutionBridgeRule } from '../../src/rules/execution-bridges.ts';
import { makeArtifact, makeContext } from '../helpers.ts';

describe('agent.local-execution-bridge', () => {
	test('flags npx, bunx, and uvx launchers in MCP configs', async () => {
		const artifact = makeArtifact({
			content: [
				'{',
				'  "mcpServers": {',
				'    "a": { "command": "npx", "args": ["-y", "pkg-a"] },',
				'    "b": { "command": "bunx", "args": ["pkg-b"] },',
				'    "c": { "command": "uvx", "args": ["pkg-c"] }',
				'  }',
				'}',
			].join('\n'),
			type: 'mcp-config',
		});
		const findings = await localExecutionBridgeRule.scan(makeContext([artifact]));
		const kinds = findings.map((f) => f.evidence?.split(']')[0]?.replace('[', ''));
		expect(kinds).toContain('npx-command');
		expect(kinds).toContain('bunx-command');
		expect(kinds).toContain('uvx-command');
	});

	test('flags POSIX shell launchers', async () => {
		const artifact = makeArtifact({
			content: '{ "command": "bash" }',
			type: 'mcp-config',
		});
		const findings = await localExecutionBridgeRule.scan(makeContext([artifact]));
		expect(findings).toHaveLength(1);
		expect(findings[0]?.signals).toEqual(['local-execution']);
	});

	test('flags stdio transport declaration', async () => {
		const artifact = makeArtifact({
			content: '{ "transport": "stdio" }',
			type: 'mcp-config',
		});
		const findings = await localExecutionBridgeRule.scan(makeContext([artifact]));
		expect(findings).toHaveLength(1);
		expect(findings[0]?.title).toMatch(/stdio/i);
	});

	test('flags absolute local binary paths', async () => {
		const artifact = makeArtifact({
			content: '{ "command": "/usr/local/bin/my-tool" }',
			type: 'mcp-config',
		});
		const findings = await localExecutionBridgeRule.scan(makeContext([artifact]));
		expect(findings.some((f) => f.evidence?.includes('local-binary'))).toBe(true);
	});

	test('skips out-of-scope artifact types', async () => {
		const artifact = makeArtifact({
			content: '{ "command": "npx" }',
			type: 'skill',
		});
		const findings = await localExecutionBridgeRule.scan(makeContext([artifact]));
		expect(findings).toHaveLength(0);
	});
});
