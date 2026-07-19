import { describe, expect, spyOn, test } from 'bun:test';

import { runProbe } from '../../src/report/probe.ts';
import { maskSecrets } from '../../src/util/mask.ts';

const ERROR_SECRET = 'errorSecret123456';
const PROMPT_SECRET = 'promptSecret123456';
const RESOURCE_SECRET = 'resourceSecret123456';
const SCHEMA_SECRET = 'schemaSecret123456';
const SERVER_SECRET = 'serverSecret123456';
const TOOL_SECRET = 'toolSecret123456';
const URL_SECRET = 'urlSecret123456';

function jsonResponse(result: unknown): Response {
	return new Response(JSON.stringify({ id: 1, jsonrpc: '2.0', result }));
}

function probeResponses(): Response[] {
	return [
		jsonResponse({
			capabilities: { prompts: {}, resources: {}, token: SCHEMA_SECRET },
			protocolVersion: '2025-06-18',
			serverInfo: { name: `token=${SERVER_SECRET}`, version: '1.0.0' },
		}),
		new Response(null, { status: 204 }),
		jsonResponse({
			tools: [
				{
					description: `Bearer ${TOOL_SECRET}`,
					inputSchema: {
						properties: { token: { default: SCHEMA_SECRET } },
						type: 'object',
					},
					name: 'gateway',
				},
			],
		}),
		jsonResponse({ prompts: [{ description: `secret=${PROMPT_SECRET}`, name: 'prompt' }] }),
		jsonResponse({
			resources: [
				{ name: 'resource', uri: `https://example.test/data?api_key=${RESOURCE_SECRET}` },
			],
		}),
	];
}

async function captureProbeOutput(json: boolean, responses: Response[]): Promise<string> {
	const output: string[] = [];
	const writeSpy = spyOn(process.stdout, 'write').mockImplementation((chunk) => {
		output.push(String(chunk));
		return true;
	});
	const originalFetch = globalThis.fetch;
	Object.assign(globalThis, {
		fetch: async () => {
			const response = responses.shift();
			if (!response) throw new Error('Unexpected probe request');
			return response;
		},
	});

	try {
		await runProbe(`https://example.test/mcp?access_token=${URL_SECRET}`, { json });
	} finally {
		Object.assign(globalThis, { fetch: originalFetch });
		writeSpy.mockRestore();
	}

	return output.join('');
}

describe('probe report credential masking', () => {
	test('masks quoted JSON secret values', () => {
		const masked = maskSecrets(`{ "token": "${SCHEMA_SECRET}" }`);

		expect(masked).not.toContain(SCHEMA_SECRET);
		expect(masked).toContain('sche***');
	});

	test('masks server-controlled values in human and JSON output', async () => {
		for (const json of [false, true]) {
			const output = await captureProbeOutput(json, probeResponses());
			for (const secret of [
				PROMPT_SECRET,
				RESOURCE_SECRET,
				SCHEMA_SECRET,
				SERVER_SECRET,
				TOOL_SECRET,
				URL_SECRET,
			]) {
				expect(output).not.toContain(secret);
			}
			expect(output).toContain('***');
		}
	});

	test('masks secrets echoed in probe errors', async () => {
		const output = await captureProbeOutput(false, [
			new Response(null, {
				status: 401,
				statusText: `Unauthorized token=${ERROR_SECRET}`,
			}),
		]);

		expect(output).not.toContain(ERROR_SECRET);
		expect(output).toContain('token=erro***');
	});
});
