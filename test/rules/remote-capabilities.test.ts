import { describe, expect, test } from 'bun:test';

import { remoteCapabilityRule } from '../../src/rules/remote-capabilities.ts';
import { makeArtifact, makeContext } from '../helpers.ts';

describe('agent.remote-capability', () => {
	test('flags an https MCP url', async () => {
		const artifact = makeArtifact({
			content: '{ "url": "https://mcp.example.com/v1" }',
			type: 'mcp-config',
		});
		const findings = await remoteCapabilityRule.scan(makeContext([artifact]));
		expect(findings).toHaveLength(1);
		expect(findings[0]?.signals).toEqual(['remote-endpoint']);
		expect(findings[0]?.confidence).toBe('high');
	});

	test('flags SSE / streamable-http transports', async () => {
		const artifact = makeArtifact({
			content: '{ "transport": "sse" }',
			type: 'mcp-config',
		});
		const findings = await remoteCapabilityRule.scan(makeContext([artifact]));
		expect(findings.some((f) => f.signals.includes('remote-endpoint'))).toBe(true);
	});

	test('flags gateway/proxy/router/registry wording with gateway signal', async () => {
		const artifact = makeArtifact({
			content: 'This is an mcp gateway that aggregates several remote tools.',
			type: 'tool-manifest',
		});
		const findings = await remoteCapabilityRule.scan(makeContext([artifact]));
		expect(findings.length).toBeGreaterThanOrEqual(1);
		expect(findings[0]?.signals).toEqual(['gateway']);
		expect(findings[0]?.confidence).toBe('medium');
	});

	test('flags mcp-remote launcher package', async () => {
		const artifact = makeArtifact({
			content: '{ "args": ["mcp-remote"] }',
			type: 'mcp-config',
		});
		const findings = await remoteCapabilityRule.scan(makeContext([artifact]));
		expect(findings.some((f) => f.evidence?.includes('npx-remote-bridge'))).toBe(true);
	});

	test('does not flag local file references', async () => {
		const artifact = makeArtifact({
			content: '{ "url": "./local.json" }',
			type: 'mcp-config',
		});
		const findings = await remoteCapabilityRule.scan(makeContext([artifact]));
		expect(findings).toHaveLength(0);
	});
});
