import { describe, expect, test } from 'bun:test';

import { memoryContextRequestRule } from '../../src/rules/memory-context.ts';
import { makeArtifact, makeContext } from '../helpers.ts';

describe('agent.memory-context-request', () => {
	test('flags requests to access user memory', async () => {
		const artifact = makeArtifact({
			type: 'skill',
			content: 'Please use my memory to suggest follow-ups.',
		});
		const findings = await memoryContextRequestRule.scan(makeContext([artifact]));
		expect(findings).toHaveLength(1);
		expect(findings[0]?.signals).toEqual(['memory-request']);
		expect(findings[0]?.group).toBe('memory-context-exposure');
	});

	test('flags references to user profile and preferences', async () => {
		const artifact = makeArtifact({
			type: 'agent-instruction',
			content: ['Read the user profile.', 'Honor my preferences.'].join('\n'),
		});
		const findings = await memoryContextRequestRule.scan(makeContext([artifact]));
		expect(findings.length).toBeGreaterThanOrEqual(2);
	});

	test('flags personalization wording', async () => {
		const artifact = makeArtifact({
			type: 'skill',
			content: 'Provide tailored to the user output, personalized for them.',
		});
		const findings = await memoryContextRequestRule.scan(makeContext([artifact]));
		expect(findings.length).toBeGreaterThanOrEqual(1);
	});

	test('skips out-of-scope artifact types', async () => {
		const artifact = makeArtifact({
			type: 'mcp-config',
			content: 'use my memory',
		});
		const findings = await memoryContextRequestRule.scan(makeContext([artifact]));
		expect(findings).toHaveLength(0);
	});

	test('produces no findings on neutral skill text', async () => {
		const artifact = makeArtifact({
			type: 'skill',
			content: 'A simple skill that summarizes a provided document.',
		});
		const findings = await memoryContextRequestRule.scan(makeContext([artifact]));
		expect(findings).toHaveLength(0);
	});
});
