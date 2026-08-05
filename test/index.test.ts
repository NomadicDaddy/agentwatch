import { describe, expect, test } from 'bun:test';

import {
	broadToolSurfaceRule,
	credentialFileReferenceRule,
	credentialReachabilityRule,
	dynamicToolRegistryRule,
	localExecutionBridgeRule,
	memoryContextRequestRule,
	remoteCapabilityRule,
	remoteManifestRule,
	remoteMcpGatewayRule,
	triggerBasedInvocationRule,
	unpinnedExecutionBridgeRule,
	untrustedInstallSourceRule,
} from '../src/index.ts';

const PUBLIC_RULES = [
	remoteCapabilityRule,
	remoteManifestRule,
	remoteMcpGatewayRule,
	dynamicToolRegistryRule,
	triggerBasedInvocationRule,
	memoryContextRequestRule,
	localExecutionBridgeRule,
	unpinnedExecutionBridgeRule,
	credentialReachabilityRule,
	credentialFileReferenceRule,
	broadToolSurfaceRule,
	untrustedInstallSourceRule,
] as const;

describe('public library entry point', () => {
	test('exports every registered rule implementation', () => {
		expect(PUBLIC_RULES.map((rule) => rule.id)).toEqual([
			'agent.remote-capability',
			'agent.remote-manifest',
			'agent.remote-generic-mcp-gateway',
			'agent.dynamic-tool-registry',
			'agent.trigger-based-invocation',
			'agent.memory-context-request',
			'agent.local-execution-bridge',
			'agent.unpinned-execution-bridge',
			'agent.connector-credential-reachability',
			'agent.credential-file-reference',
			'agent.broad-tool-surface',
			'agent.untrusted-install-source',
		]);
	});
});
