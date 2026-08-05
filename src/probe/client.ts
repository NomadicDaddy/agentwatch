import type { ZodType } from 'zod';

import type { McpPromptInfo, McpResourceInfo, McpToolInfo, ProbeOptions } from './probe-types.ts';
import type { InitializeResult } from './response-validation.ts';

import { PACKAGE_VERSION } from '../version.ts';
import {
	INITIALIZE_RESULT_SCHEMA,
	JSON_RPC_RESPONSE_SCHEMA,
	parseJsonRpc,
	PROMPTS_LIST_RESULT_SCHEMA,
	RESOURCES_LIST_RESULT_SCHEMA,
	TOOLS_LIST_RESULT_SCHEMA,
	validationError,
} from './response-validation.ts';

export type { InitializeResult } from './response-validation.ts';

const PROTOCOL_VERSION = '2024-11-05';
const CLIENT_NAME = 'agentwatch';
const DEFAULT_TIMEOUT_MS = 15_000;
/**
 * Hard cap on the number of bytes read from a single probe response body.
 * Matches the artifact reader's `DEFAULT_MAX_FILE_BYTES` (1 MiB) so an
 * untrusted MCP endpoint cannot hold the CLI indefinitely or force an
 * unbounded allocation through a slow, never-closing, or oversized stream.
 */
const MAX_RESPONSE_BYTES = 1024 * 1024;

export class McpHttpClient {
	private nextId = 1;
	private sessionId?: string;
	private readonly url: string;
	private readonly authToken: string | undefined;
	private readonly extraHeaders: Readonly<Record<string, string>>;
	private readonly timeoutMs: number;

	constructor(options: ProbeOptions) {
		this.url = options.url;
		this.authToken = options.authToken;
		this.extraHeaders = options.headers ?? {};
		this.timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
	}

	async initialize(): Promise<InitializeResult> {
		return this.request('initialize', INITIALIZE_RESULT_SCHEMA, {
			capabilities: {},
			clientInfo: { name: CLIENT_NAME, version: PACKAGE_VERSION },
			protocolVersion: PROTOCOL_VERSION,
		});
	}

	async listPrompts(): Promise<readonly McpPromptInfo[]> {
		return (await this.request('prompts/list', PROMPTS_LIST_RESULT_SCHEMA, {})).prompts;
	}

	async listResources(): Promise<readonly McpResourceInfo[]> {
		return (await this.request('resources/list', RESOURCES_LIST_RESULT_SCHEMA, {})).resources;
	}

	async listTools(): Promise<readonly McpToolInfo[]> {
		return (await this.request('tools/list', TOOLS_LIST_RESULT_SCHEMA, {})).tools;
	}

	async notifyInitialized(): Promise<void> {
		await this.notify('notifications/initialized');
	}

	private buildHeaders(): Record<string, string> {
		const headers: Record<string, string> = {
			Accept: 'application/json, text/event-stream',
			'Content-Type': 'application/json',
			...this.extraHeaders,
		};
		if (this.authToken) headers.Authorization = `Bearer ${this.authToken}`;
		if (this.sessionId) headers['Mcp-Session-Id'] = this.sessionId;
		return headers;
	}

	/**
	 * Issue the POST with an AbortController whose timeout covers the entire
	 * request AND response body. The controller and timer stay live after the
	 * headers arrive so a slow, never-closing, or oversized stream still hits
	 * the deadline. The caller clears the timer once the body is fully read or
	 * rejected.
	 */
	private startTimedFetch(body: string): {
		controller: AbortController;
		promise: Promise<Response>;
		timer: ReturnType<typeof setTimeout>;
	} {
		const controller = new AbortController();
		const timer = setTimeout(() => controller.abort(), this.timeoutMs);
		const promise = fetch(this.url, {
			body,
			headers: this.buildHeaders(),
			method: 'POST',
			redirect: 'error',
			signal: controller.signal,
		});
		return { controller, promise, timer };
	}

	/**
	 * Read a response body incrementally with an active deadline and a hard
	 * 1 MiB byte cap. Replaces the previous `response.text()` call, which read
	 * the full body with no deadline once the headers arrived.
	 *
	 * - Declared `Content-Length` above the cap is rejected before any bytes
	 *   are pulled, so a server cannot advertise a huge body and still pin the
	 *   connection while we buffer it.
	 * - Streamed responses are read in fixed chunks; if the cumulative byte
	 *   count exceeds the cap the read is cancelled and rejected.
	 * - The request's `AbortController` and timer stay active for the duration
	 *   of the read, so a never-closing stream aborts at the deadline instead
	 *   of hanging the CLI.
	 */
	private async readBoundedText(response: Response): Promise<string> {
		const declared = response.headers.get('content-length');
		if (declared !== null) {
			const parsed = Number.parseInt(declared, 10);
			if (Number.isSafeInteger(parsed) && parsed > MAX_RESPONSE_BYTES) {
				throw new Error(
					`Response body exceeds ${MAX_RESPONSE_BYTES} byte cap (declared ${parsed})`
				);
			}
		}

		// Responses without a usable body (e.g. 204) resolve to an empty
		// string without touching the stream.
		if (response.body === null) return '';

		const reader = (response.body as ReadableStream<Uint8Array>).getReader();
		const decoder = new TextDecoder();
		const chunks: string[] = [];
		let total = 0;

		try {
			for (;;) {
				const { done, value } = await reader.read();
				if (done) break;
				// `value` is a Uint8Array chunk from the stream.
				if (value !== undefined) {
					total += value.byteLength;
					if (total > MAX_RESPONSE_BYTES) {
						await reader.cancel().catch(() => {
							// Best-effort cancel; the rejection path below is authoritative.
						});
						throw new Error(
							`Response body exceeded ${MAX_RESPONSE_BYTES} byte cap after ${total} bytes`
						);
					}
					chunks.push(decoder.decode(value, { stream: true }));
				}
			}
			chunks.push(decoder.decode());
			return chunks.join('');
		} finally {
			reader.releaseLock();
		}
	}

	private async notify(method: string, params?: unknown): Promise<void> {
		const body = JSON.stringify({ jsonrpc: '2.0', method, ...(params ? { params } : {}) });
		const { promise, timer } = this.startTimedFetch(body);
		try {
			await promise;
		} finally {
			clearTimeout(timer);
		}
	}

	private async request<T>(
		method: string,
		resultSchema: ZodType<T>,
		params?: unknown
	): Promise<T> {
		const id = this.nextId++;
		const body = JSON.stringify({
			id,
			jsonrpc: '2.0',
			method,
			...(params !== undefined ? { params } : {}),
		});
		const { controller, promise, timer } = this.startTimedFetch(body);
		try {
			const response = await promise;

			const sessionHeader = response.headers.get('mcp-session-id');
			if (sessionHeader) this.sessionId = sessionHeader;

			if (response.status === 204) {
				throw new Error('Server returned 204 with no JSON-RPC payload');
			}
			if (!response.ok) {
				throw new Error(`HTTP ${response.status} ${response.statusText}`);
			}

			const text = await this.readBoundedText(response);
			const parsed = parseJsonRpc(text);
			if (parsed === null) throw new Error('Empty or unparseable response body');
			const envelope = JSON_RPC_RESPONSE_SCHEMA.safeParse(parsed);
			if (!envelope.success) throw validationError('JSON-RPC response', envelope.error);
			if (envelope.data.error) {
				throw new Error(
					`JSON-RPC ${envelope.data.error.code}: ${envelope.data.error.message}`
				);
			}
			const result = resultSchema.safeParse(envelope.data.result);
			if (!result.success) throw validationError(`${method} result`, result.error);
			return result.data;
		} finally {
			clearTimeout(timer);
			// Ensure a late abort cannot fire after the request resolved/rejected.
			controller.abort();
		}
	}
}
