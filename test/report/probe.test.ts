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

async function captureStdout(
	action: () => Promise<number>
): Promise<{ exitCode: number; output: string }> {
	const output: string[] = [];
	const writeSpy = spyOn(process.stdout, 'write').mockImplementation((chunk) => {
		output.push(String(chunk));
		return true;
	});

	try {
		const exitCode = await action();
		return { exitCode, output: output.join('') };
	} finally {
		writeSpy.mockRestore();
	}
}

async function captureProbeOutput(
	json: boolean,
	responses: Response[],
	requestOptions?: RequestInit[]
): Promise<string> {
	const originalFetch = globalThis.fetch;
	Object.assign(globalThis, {
		fetch: async (_input: Request | string | URL, init?: RequestInit) => {
			if (init) requestOptions?.push(init);
			const response = responses.shift();
			if (!response) throw new Error('Unexpected probe request');
			return response;
		},
	});

	try {
		const result = await captureStdout(() =>
			runProbe(`https://example.test/mcp?access_token=${URL_SECRET}`, { json })
		);
		return result.output;
	} finally {
		Object.assign(globalThis, { fetch: originalFetch });
	}
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

describe('probe redirect safety', () => {
	test('rejects redirects on every probe request', async () => {
		const requestOptions: RequestInit[] = [];

		await captureProbeOutput(false, probeResponses(), requestOptions);

		expect(requestOptions).toHaveLength(5);
		expect(requestOptions.every((options) => options.redirect === 'error')).toBe(true);
	});

	test('does not request a redirect destination and reports failures safely', async () => {
		let destinationRequests = 0;
		const destination = Bun.serve({
			fetch: () => {
				destinationRequests++;
				return new Response('unexpected destination request');
			},
			hostname: '127.0.0.1',
			port: 0,
		});
		const source = Bun.serve({
			fetch: () =>
				Response.redirect(`http://127.0.0.1:${destination.port}/private-target`, 302),
			hostname: '127.0.0.1',
			port: 0,
		});

		try {
			const url = `http://127.0.0.1:${source.port}/mcp`;
			const human = await captureStdout(() => runProbe(url, { json: false }));
			const json = await captureStdout(() => runProbe(url, { json: true }));
			const payload = JSON.parse(json.output) as {
				probe: { errors: { stage: string }[] };
			};

			expect(human.exitCode).toBe(1);
			expect(human.output).toContain('Errors');
			expect(human.output).toContain('[initialize]');
			expect(json.exitCode).toBe(1);
			expect(payload.probe.errors).toEqual([
				expect.objectContaining({ stage: 'initialize' }),
			]);
			expect(destinationRequests).toBe(0);
		} finally {
			await source.stop(true);
			await destination.stop(true);
		}
	});
});
