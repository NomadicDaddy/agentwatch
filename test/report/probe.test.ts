import { describe, expect, spyOn, test } from 'bun:test';

import { isValidProbeUrl, runProbe } from '../../src/report/probe.ts';
import { maskSecrets } from '../../src/util/mask.ts';

const ERROR_SECRET = 'errorSecret123456';
const AWS_SECRET = 'AKIA1234567890ABCDEF';
const BASIC_SECRET = 'QWxhZGRpbjpvcGVu';
const BEARER_SECRET = 'bearerCredential123';
const GITHUB_SECRET = 'github_pat_1234567890abcdefgh';
const GOOGLE_SECRET = 'AIza1234567890abcdefghijklmnopqrstuvwxy';
const PROMPT_SECRET = 'promptSecret123456';
const RESOURCE_SECRET = 'resourceSecret123456';
const SCHEMA_SECRET = 'schemaSecret123456';
const SERVER_SECRET = 'serverSecret123456';
const TOOL_SECRET = 'toolSecret123456';
const TOKEN_SECRET = 'customCredential123';
const URL_SECRET = 'urlSecret123456';

const FORMAT_SECRETS = [
	AWS_SECRET,
	BASIC_SECRET,
	BEARER_SECRET,
	GITHUB_SECRET,
	GOOGLE_SECRET,
	TOKEN_SECRET,
] as const;

const FORMAT_MASKS = [
	'AKIA1234***',
	'AIza1234***',
	'github_pat_1234***',
	'Authorization: Bearer bear***',
	'Authorization: Basic QWxh***',
	'Authorization: Token cust***',
] as const;

function jsonResponse(result: unknown): Response {
	return new Response(JSON.stringify({ id: 1, jsonrpc: '2.0', result }));
}

function probeResponses(): Response[] {
	return [
		jsonResponse({
			capabilities: { prompts: {}, resources: {}, token: SCHEMA_SECRET },
			protocolVersion: '2025-06-18',
			serverInfo: {
				name: `token=${SERVER_SECRET} aws=${AWS_SECRET}`,
				version: `google=${GOOGLE_SECRET}`,
			},
		}),
		new Response(null, { status: 204 }),
		jsonResponse({
			tools: [
				{
					description:
						`${GITHUB_SECRET} Authorization: Basic ${BASIC_SECRET} ` +
						`Bearer ${TOOL_SECRET}`,
					inputSchema: {
						properties: { token: { default: SCHEMA_SECRET } },
						type: 'object',
					},
					name: 'gateway',
				},
			],
		}),
		jsonResponse({
			prompts: [
				{
					description: `secret=${PROMPT_SECRET} Authorization: Bearer ${BEARER_SECRET}`,
					name: 'prompt',
				},
			],
		}),
		jsonResponse({
			resources: [
				{
					name: 'resource',
					uri:
						`Authorization: Token ${TOKEN_SECRET} ` +
						`https://example.test/data?api_key=${RESOURCE_SECRET}`,
				},
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
			for (const secret of FORMAT_SECRETS) {
				expect(output).not.toContain(secret);
			}
			for (const masked of FORMAT_MASKS) {
				expect(output).toContain(masked);
			}
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

describe('probe response validation', () => {
	test('reports wrong-type initialize fields in human and JSON output', async () => {
		const responses = (): Response[] => [
			jsonResponse({
				capabilities: {},
				protocolVersion: 20250618,
				serverInfo: { name: 42, version: null },
			}),
		];

		const human = await captureProbeOutput(false, responses());
		const json = await captureProbeOutput(true, responses());
		const payload = JSON.parse(json) as {
			probe: {
				errors: { message: string; stage: string }[];
				serverInfo?: unknown;
			};
		};

		expect(human).toContain('[initialize] Invalid initialize result');
		expect(payload.probe.errors).toEqual([
			expect.objectContaining({
				message: expect.stringContaining('Invalid initialize result'),
				stage: 'initialize',
			}),
		]);
		expect(payload.probe.serverInfo).toBeUndefined();
	});

	test('reports wrong-type and missing list fields without partial entries', async () => {
		const responses = (): Response[] => [
			jsonResponse({
				capabilities: { prompts: {}, resources: {} },
				protocolVersion: '2025-06-18',
				serverInfo: { name: 'test', version: '1.0.0' },
			}),
			new Response(null, { status: 204 }),
			jsonResponse({ tools: [{ name: 42 }] }),
			jsonResponse({ prompts: [{ description: 'missing name' }] }),
			jsonResponse({ resources: [{ name: 'missing uri' }] }),
		];

		const human = await captureProbeOutput(false, responses());
		const json = await captureProbeOutput(true, responses());
		const payload = JSON.parse(json) as {
			probe: {
				errors: { stage: string }[];
				prompts: unknown[];
				resources: unknown[];
				tools: unknown[];
			};
		};

		for (const stage of ['tools/list', 'prompts/list', 'resources/list']) {
			expect(human).toContain(`[${stage}] Invalid ${stage} result`);
		}
		expect(payload.probe.errors.map((error) => error.stage)).toEqual([
			'tools/list',
			'prompts/list',
			'resources/list',
		]);
		expect(payload.probe.tools).toEqual([]);
		expect(payload.probe.prompts).toEqual([]);
		expect(payload.probe.resources).toEqual([]);
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

describe('probe URL validation', () => {
	test.each([
		['http with hostname', 'http://example.test/mcp', true],
		['https with hostname', 'https://example.test/mcp', true],
		['http with IP and port', 'http://127.0.0.1:8080/mcp', true],
		['bare http prefix', 'http://', false],
		['bare https prefix', 'https://', false],
		['ftp protocol', 'ftp://example.test', false],
		['schemeless', 'example.test/mcp', false],
		['empty', '', false],
	])('isValidProbeUrl(%s) returns %s', (_label, url, expected) => {
		expect(isValidProbeUrl(url)).toBe(expected);
	});
});

describe('probe exit code for partial and total failure', () => {
	test('partial success with zero tools does not trigger all-stages-failed exit 1', async () => {
		// initialize succeeds, prompts/list succeeds, but tools/list fails.
		// The old predicate (errors > 0 && tools empty) would have exited 1
		// even though a partial surface was discovered.
		const responses: Response[] = [
			jsonResponse({
				capabilities: { prompts: {}, resources: {} },
				protocolVersion: '2025-06-18',
				serverInfo: { name: 'partial', version: '1.0.0' },
			}),
			new Response(null, { status: 204 }),
			new Response(null, { status: 500, statusText: 'tools broken' }),
			jsonResponse({ prompts: [{ name: 'prompt-a' }] }),
			jsonResponse({ resources: [{ uri: 'res://x' }] }),
		];

		const originalFetch = globalThis.fetch;
		Object.assign(globalThis, {
			fetch: async (_input: Request | string | URL, _init?: RequestInit) => {
				const response = responses.shift();
				if (!response) throw new Error('Unexpected probe request');
				return response;
			},
		});

		try {
			const { exitCode, output } = await captureStdout(() =>
				runProbe('https://example.test/mcp', { json: false })
			);
			// initialize and notifications succeed; tools/list errored but
			// prompts/list and resources/list succeeded — not all stages failed.
			// The HTTP target is HTTPS so no non-https issue; exit falls through
			// to severity-based code. No medium+ issues => exit 0.
			expect(exitCode).toBe(0);
			expect(output).toContain('[tools/list]');
			expect(output).toContain('prompt-a');
			expect(output).toContain('res://x');
		} finally {
			Object.assign(globalThis, { fetch: originalFetch });
		}
	});

	test('genuine all-stages failure returns exit 1 regardless of issues', async () => {
		// initialize fails — that is the only stage attempted, and it errored.
		const originalFetch = globalThis.fetch;
		Object.assign(globalThis, {
			fetch: async (_input: Request | string | URL, _init?: RequestInit) => {
				return new Response(null, { status: 503, statusText: 'unavailable' });
			},
		});

		try {
			const { exitCode } = await captureStdout(() =>
				runProbe('https://example.test/mcp', { json: false })
			);
			expect(exitCode).toBe(1);
		} finally {
			Object.assign(globalThis, { fetch: originalFetch });
		}
	});
});

describe('probe deep masking of object keys and non-string values', () => {
	const KEY_TOKEN_SECRET = 'keyBearerSecret123';
	const NUMERIC_TOKEN_SECRET = '9876543210';

	/**
	 * Schema-valid initialize response that hides a bearer token inside an
	 * object KEY (a capability sub-field) and a numeric value beneath a
	 * sensitive field name. Before the fix, maskProbeRecord preserved the
	 * raw key verbatim and maskProbeValue returned numbers unchanged.
	 */
	function deepMaskResponses(): Response[] {
		return [
			jsonResponse({
				capabilities: {
					// Token smuggled into the key name itself.
					[`Bearer ${KEY_TOKEN_SECRET}`]: 'nested',
					prompts: {},
					resources: {},
					// Numeric value beneath a sensitive field name.
					token: NUMERIC_TOKEN_SECRET,
				},
				protocolVersion: '2025-06-18',
				serverInfo: { name: 'deep-mask-test', version: '1.0.0' },
			}),
			new Response(null, { status: 204 }),
			jsonResponse({ tools: [] }),
			jsonResponse({ prompts: [] }),
			jsonResponse({ resources: [] }),
		];
	}

	test('masks auth token reflected in a capability object key', async () => {
		for (const json of [false, true]) {
			const output = await captureProbeOutput(json, deepMaskResponses());
			expect(output).not.toContain(KEY_TOKEN_SECRET);
		}
	});

	test('replaces numeric value beneath a sensitive field name', async () => {
		for (const json of [false, true]) {
			const output = await captureProbeOutput(json, deepMaskResponses());
			expect(output).not.toContain(NUMERIC_TOKEN_SECRET);
		}
	});
});

describe('probe response body bounds (time and size)', () => {
	test('clears the request timeout when fetch rejects before headers', async () => {
		const originalFetch = globalThis.fetch;
		const timer = setTimeout(() => undefined, 0);
		clearTimeout(timer);
		const setTimeoutSpy = spyOn(globalThis, 'setTimeout').mockReturnValue(timer);
		const clearTimeoutSpy = spyOn(globalThis, 'clearTimeout');
		Object.assign(globalThis, {
			fetch: async () => {
				throw new Error('connection failed before headers');
			},
		});

		try {
			const { exitCode, output } = await captureStdout(() =>
				runProbe('https://example.test/mcp', { json: false, timeoutMs: 60_000 })
			);

			expect(exitCode).toBe(1);
			expect(output).toContain('[initialize] connection failed before headers');
			expect(setTimeoutSpy).toHaveBeenCalledTimes(1);
			expect(clearTimeoutSpy).toHaveBeenCalledWith(timer);
		} finally {
			Object.assign(globalThis, { fetch: originalFetch });
			clearTimeoutSpy.mockRestore();
			setTimeoutSpy.mockRestore();
		}
	});

	/**
	 * Build a ReadableStream that never produces a chunk and never closes on
	 * its own, simulating a malicious or wedged MCP endpoint. The stream is
	 * tied to the fetch's AbortSignal: when the probe's timeout fires and
	 * aborts the controller, the stream errors so the pending read rejects.
	 * A real fetch response body behaves the same way — its underlying stream
	 * is cancelled/errored when the fetch signal aborts.
	 */
	function neverClosingStream(signal: AbortSignal): ReadableStream<Uint8Array> {
		return new ReadableStream<Uint8Array>({
			start(controller) {
				signal.addEventListener(
					'abort',
					() => {
						controller.error(new DOMException('Aborted', 'AbortError'));
					},
					{ once: true }
				);
				// Intentionally never enqueue or close on its own.
			},
		});
	}

	test('a never-closing response body aborts within the timeout instead of hanging', async () => {
		const originalFetch = globalThis.fetch;
		Object.assign(globalThis, {
			fetch: async (_input: Request | string | URL, init?: RequestInit) => {
				const signal = init?.signal ?? new AbortController().signal;
				return new Response(neverClosingStream(signal), {
					headers: { 'content-type': 'application/json' },
				});
			},
		});

		try {
			const start = Date.now();
			const { exitCode, output } = await captureStdout(() =>
				runProbe('https://example.test/mcp', { json: false, timeoutMs: 200 })
			);
			const elapsed = Date.now() - start;

			// initialize never resolves because the body never arrives, so it
			// becomes an initialize-stage error and all-stages-failed exits 1.
			expect(exitCode).toBe(1);
			expect(output).toContain('[initialize]');
			// Must return well before the 5s idle-killer — the body read was
			// bounded by the timeout, not left pending.
			expect(elapsed).toBeLessThan(4000);
		} finally {
			Object.assign(globalThis, { fetch: originalFetch });
		}
	});

	test('an oversized streamed body is rejected at the 1 MiB cap', async () => {
		// Stream just over 1 MiB in 256 KiB chunks; the reader must cancel and
		// reject once the cumulative byte count exceeds the cap.
		const chunk = new Uint8Array(256 * 1024).fill(0x61); // 'a'
		function oversizedStream(): ReadableStream<Uint8Array> {
			let sent = 0;
			return new ReadableStream<Uint8Array>({
				pull(controller) {
					if (sent < 5) {
						controller.enqueue(chunk);
						sent++;
					} else {
						controller.close();
					}
				},
			});
		}

		const originalFetch = globalThis.fetch;
		Object.assign(globalThis, {
			fetch: async (_input: Request | string | URL, _init?: RequestInit) =>
				new Response(oversizedStream(), {
					headers: { 'content-type': 'application/json' },
				}),
		});

		try {
			const { exitCode, output } = await captureStdout(() =>
				runProbe('https://example.test/mcp', { json: false })
			);

			// The initialize request body exceeds the cap, so initialize errors
			// and all attempted stages (initialize only) errored -> exit 1.
			expect(exitCode).toBe(1);
			expect(output).toContain('[initialize]');
			expect(output).toContain('byte cap');
		} finally {
			Object.assign(globalThis, { fetch: originalFetch });
		}
	});

	test('a declared Content-Length above the cap is rejected without buffering the body', async () => {
		const originalFetch = globalThis.fetch;
		Object.assign(globalThis, {
			fetch: async (_input: Request | string | URL, _init?: RequestInit) => {
				// Stream that would be expensive to buffer: 2 MiB of data. The
				// Content-Length check must reject before the full body is read.
				const chunk = new Uint8Array(64 * 1024).fill(0x61);
				return new Response(
					new ReadableStream<Uint8Array>({
						pull(controller) {
							controller.enqueue(chunk);
						},
					}),
					{
						headers: {
							'content-length': String(2 * 1024 * 1024),
							'content-type': 'application/json',
						},
					}
				);
			},
		});

		try {
			const start = Date.now();
			const { exitCode, output } = await captureStdout(() =>
				runProbe('https://example.test/mcp', { json: false })
			);
			const elapsed = Date.now() - start;

			expect(exitCode).toBe(1);
			expect(output).toContain('[initialize]');
			expect(output).toContain('byte cap');
			// The declared-length check rejects immediately rather than draining
			// the full oversized stream — the rejection returns in milliseconds.
			expect(elapsed).toBeLessThan(2000);
		} finally {
			Object.assign(globalThis, { fetch: originalFetch });
		}
	});
});
