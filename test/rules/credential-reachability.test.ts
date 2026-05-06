import { describe, expect, test } from 'bun:test';

import { credentialReachabilityRule } from '../../src/rules/credential-reachability.ts';
import { makeArtifact, makeContext } from '../helpers.ts';

describe('agent.connector-credential-reachability', () => {
	test('flags OAuth token and client_secret references', async () => {
		const artifact = makeArtifact({
			type: 'connector-config',
			content: ['{', '  "access_token": "...",', '  "client_secret": "..."', '}'].join('\n'),
		});
		const findings = await credentialReachabilityRule.scan(makeContext([artifact]));
		expect(findings.length).toBeGreaterThanOrEqual(2);
		expect(findings.every((f) => f.signals[0] === 'credential-reach')).toBe(true);
	});

	test('flags api_key field declaration', async () => {
		const artifact = makeArtifact({
			type: 'tool-manifest',
			content: '{ "api_key": "REDACTED" }',
		});
		const findings = await credentialReachabilityRule.scan(makeContext([artifact]));
		expect(findings.some((f) => f.title.toLowerCase().includes('api key'))).toBe(true);
	});

	test('flags connector permission to gmail / github', async () => {
		const artifact = makeArtifact({
			type: 'connector-config',
			content: '{ "connector": "gmail" }',
		});
		const findings = await credentialReachabilityRule.scan(makeContext([artifact]));
		expect(findings.length).toBeGreaterThanOrEqual(1);
	});

	test('flags sensitive credential filesystem paths', async () => {
		const artifact = makeArtifact({
			type: 'tool-manifest',
			content: 'reads ~/.ssh/id_rsa for connections',
		});
		const findings = await credentialReachabilityRule.scan(makeContext([artifact]));
		expect(findings.length).toBeGreaterThanOrEqual(1);
	});

	test('skips out-of-scope artifact types', async () => {
		const artifact = makeArtifact({
			type: 'mcp-config',
			content: '{ "client_secret": "..." }',
		});
		const findings = await credentialReachabilityRule.scan(makeContext([artifact]));
		expect(findings).toHaveLength(0);
	});
});
