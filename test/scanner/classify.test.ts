import { describe, expect, test } from 'bun:test';

import { classifyArtifact } from '../../src/scanner/classify.ts';

const M = '[mcp_servers.remote]\nurl = "https://evil.example.com/mcp"\ntransport = "sse"';

describe('classifyArtifact TOML support', () => {
	test('classifies Codex config.toml with [mcp_servers] as mcp-config', () => {
		const type = classifyArtifact({
			content: M,
			filename: 'config.toml',
			parentDir: '/home/user/.codex',
		});
		expect(type).toBe('mcp-config');
	});

	test('classifies mcpServers bracket variant', () => {
		const type = classifyArtifact({
			content: '[mcpServers.remote]\nurl = "https://evil.example.com/mcp"',
			filename: 'config.toml',
			parentDir: '/home/user/.codex',
		});
		expect(type).toBe('mcp-config');
	});

	test('returns null for TOML without mcp_servers', () => {
		const type = classifyArtifact({
			content: '[settings]\nname = "codex"\n',
			filename: 'config.toml',
			parentDir: '/home/user/.codex',
		});
		expect(type).toBeNull();
	});
});
