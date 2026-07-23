import { describe, expect, test } from 'bun:test';

import { credentialReachabilityRule } from '../../src/rules/credential-reachability.ts';
import { makeArtifact, makeContext } from '../helpers.ts';

describe('agent.connector-credential-reachability', () => {
	test('flags OAuth token and client_secret references', async () => {
		const artifact = makeArtifact({
			content: ['{', '  "access_token": "...",', '  "client_secret": "..."', '}'].join('\n'),
			type: 'connector-config',
		});
		const findings = await credentialReachabilityRule.scan(makeContext([artifact]));
		expect(findings.length).toBeGreaterThanOrEqual(2);
		expect(findings.every((f) => f.signals[0] === 'credential-reach')).toBe(true);
	});

	test('flags api_key field declaration', async () => {
		const artifact = makeArtifact({
			content: '{ "api_key": "REDACTED" }',
			type: 'tool-manifest',
		});
		const findings = await credentialReachabilityRule.scan(makeContext([artifact]));
		expect(findings.some((f) => f.title.toLowerCase().includes('api key'))).toBe(true);
	});

	test('flags connector permission to gmail / github', async () => {
		const artifact = makeArtifact({
			content: '{ "connector": "gmail" }',
			type: 'connector-config',
		});
		const findings = await credentialReachabilityRule.scan(makeContext([artifact]));
		expect(findings.length).toBeGreaterThanOrEqual(1);
	});

	test('flags sensitive credential filesystem paths', async () => {
		const artifact = makeArtifact({
			content: 'reads ~/.ssh/id_rsa for connections',
			type: 'tool-manifest',
		});
		const findings = await credentialReachabilityRule.scan(makeContext([artifact]));
		expect(findings.length).toBeGreaterThanOrEqual(1);
	});

	test('skips out-of-scope artifact types', async () => {
		const artifact = makeArtifact({
			content: '{ "client_secret": "..." }',
			type: 'mcp-config',
		});
		const findings = await credentialReachabilityRule.scan(makeContext([artifact]));
		expect(findings).toHaveLength(0);
	});
});
