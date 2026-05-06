import { describe, expect, test } from 'bun:test';

import { dynamicToolRegistryRule } from '../../src/rules/dynamic-tools.ts';
import { makeArtifact, makeContext } from '../helpers.ts';

describe('agent.dynamic-tool-registry', () => {
	test('flags MCP tools/list discovery method', async () => {
		const artifact = makeArtifact({
			type: 'mcp-config',
			content: ['{', '  "rpc": "tools/list"', '}'].join('\n'),
		});
		const findings = await dynamicToolRegistryRule.scan(makeContext([artifact]));
		expect(findings).toHaveLength(1);
		expect(findings[0]?.ruleId).toBe('agent.dynamic-tool-registry');
		expect(findings[0]?.signals).toEqual(['dynamic-registry']);
		expect(findings[0]?.line).toBe(2);
	});

	test('flags registerTool API references in skill artifacts', async () => {
		const artifact = makeArtifact({
			type: 'skill',
			content: 'this skill calls registerTool() at runtime',
			path: '/fixture/skills/foo/skill.md',
		});
		const findings = await dynamicToolRegistryRule.scan(makeContext([artifact]));
		expect(findings).toHaveLength(1);
		expect(findings[0]?.title).toMatch(/registration/i);
	});

	test('flags remote tool registry wording in tool manifests', async () => {
		const artifact = makeArtifact({
			type: 'tool-manifest',
			content: 'this manifest pulls from a remote registry of tools',
		});
		const findings = await dynamicToolRegistryRule.scan(makeContext([artifact]));
		// Both 'tool registry' and 'remote registry' wording variants may match;
		// each kind dedupes per-file, so we expect at least one.
		expect(findings.length).toBeGreaterThanOrEqual(1);
		expect(findings.every((f) => f.group === 'dynamic-tool-surfaces')).toBe(true);
	});

	test('skips out-of-scope artifact types', async () => {
		const artifact = makeArtifact({
			type: 'connector-config',
			content: 'tools/list referenced here should be ignored',
		});
		const findings = await dynamicToolRegistryRule.scan(makeContext([artifact]));
		expect(findings).toHaveLength(0);
	});

	test('produces no findings on a benign artifact', async () => {
		const artifact = makeArtifact({
			type: 'mcp-config',
			content:
				'{\n  "mcpServers": { "local": { "command": "node", "args": ["server.js"] } }\n}',
		});
		const findings = await dynamicToolRegistryRule.scan(makeContext([artifact]));
		expect(findings).toHaveLength(0);
	});
});
