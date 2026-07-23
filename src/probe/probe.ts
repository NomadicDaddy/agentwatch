/**
 * Minimal MCP probe client over Streamable HTTP.
 *
 * Speaks just enough of the MCP JSON-RPC handshake to enumerate a remote
 * server's tool / prompt / resource surface — `initialize` →
 * `notifications/initialized` → `tools/list` (+ `prompts/list`,
 * `resources/list` if the server advertises those capabilities).
 *
 * Network access is intentional and limited to the URL the user passed on
 * the CLI. No tool is ever invoked. Responses may arrive as plain JSON or
 * as a single SSE event; both forms are accepted.
 */

import { z } from 'zod';

import { PACKAGE_VERSION } from '../version.ts';

const PROTOCOL_VERSION = '2024-11-05';
const CLIENT_NAME = 'agentwatch';
const DEFAULT_TIMEOUT_MS = 15_000;

export interface McpToolInfo {
	readonly description?: string;
	readonly inputSchema?: unknown;
	readonly name: string;
}

export interface McpPromptInfo {
	readonly description?: string;
	readonly name: string;
}

export interface McpResourceInfo {
	readonly description?: string;
	readonly mimeType?: string;
	readonly name?: string;
	readonly uri: string;
}

export interface ProbeOptions {
	readonly authToken?: string;
	readonly headers?: Readonly<Record<string, string>>;
	readonly timeoutMs?: number;
	readonly url: string;
}

export type ProbeStage = 'initialize' | 'prompts/list' | 'resources/list' | 'tools/list';

export interface ProbeError {
	readonly message: string;
	readonly stage: ProbeStage;
}

export interface ProbeResult {
	readonly capabilities?: Readonly<Record<string, unknown>>;
	readonly errors: readonly ProbeError[];
	readonly probedAt: string;
	readonly prompts: readonly McpPromptInfo[];
	readonly protocolVersion?: string;
	readonly resources: readonly McpResourceInfo[];
	readonly serverInfo?: { readonly name: string; readonly version: string };
	readonly tools: readonly McpToolInfo[];
	readonly url: string;
}

const JSON_RPC_RESPONSE_SCHEMA = z
	.object({
		error: z.object({ code: z.number(), message: z.string() }).optional(),
		id: z.union([z.number(), z.string()]).optional(),
		jsonrpc: z.literal('2.0'),
		result: z.unknown().optional(),
	})
	.refine((response) => response.error !== undefined || response.result !== undefined, {
		message: 'response must include result or error',
	});
const INITIALIZE_RESULT_SCHEMA = z.object({
	capabilities: z.record(z.string(), z.unknown()),
	protocolVersion: z.string(),
	serverInfo: z.object({ name: z.string(), version: z.string() }),
});
const TOOLS_LIST_RESULT_SCHEMA = z.object({
	tools: z.array(
		z
			.object({
				description: z.string().optional(),
				inputSchema: z.unknown().optional(),
				name: z.string(),
			})
			.transform((tool): McpToolInfo => ({
				...(tool.description !== undefined ? { description: tool.description } : {}),
				...(tool.inputSchema !== undefined ? { inputSchema: tool.inputSchema } : {}),
				name: tool.name,
			}))
	),
});
const PROMPTS_LIST_RESULT_SCHEMA = z.object({
	prompts: z.array(
		z
			.object({ description: z.string().optional(), name: z.string() })
			.transform((prompt): McpPromptInfo => ({
				...(prompt.description !== undefined ? { description: prompt.description } : {}),
				name: prompt.name,
			}))
	),
});
const RESOURCES_LIST_RESULT_SCHEMA = z.object({
	resources: z.array(
		z
			.object({
				description: z.string().optional(),
				mimeType: z.string().optional(),
				name: z.string().optional(),
				uri: z.string(),
			})
			.transform((resource): McpResourceInfo => ({
				...(resource.description !== undefined
					? { description: resource.description }
					: {}),
				...(resource.mimeType !== undefined ? { mimeType: resource.mimeType } : {}),
				...(resource.name !== undefined ? { name: resource.name } : {}),
				uri: resource.uri,
			}))
	),
});

type InitializeResult = z.infer<typeof INITIALIZE_RESULT_SCHEMA>;

class McpHttpClient {
	private nextId = 1;
	private sessionId?: string;
	private readonly url: string;
	private readonly authToken: string | undefined;
	private readonly extraHeaders: Readonly<Record<string, string>>;
	private readonly timeoutMs: number;

	constructor(
		url: string,
		authToken?: string,
		extraHeaders: Readonly<Record<string, string>> = {},
		timeoutMs: number = DEFAULT_TIMEOUT_MS
	) {
		this.url = url;
		this.authToken = authToken;
		this.extraHeaders = extraHeaders;
		this.timeoutMs = timeoutMs;
	}

	async notify(method: string, params?: unknown): Promise<void> {
		const body = JSON.stringify({ jsonrpc: '2.0', method, ...(params ? { params } : {}) });
		await this.fetchWithTimeout(body);
	}

	async request<T>(method: string, resultSchema: z.ZodType<T>, params?: unknown): Promise<T> {
		const id = this.nextId++;
		const body = JSON.stringify({
			id,
			jsonrpc: '2.0',
			method,
			...(params !== undefined ? { params } : {}),
		});
		const response = await this.fetchWithTimeout(body);

		const sessionHeader = response.headers.get('mcp-session-id');
		if (sessionHeader) this.sessionId = sessionHeader;

		if (response.status === 204) {
			throw new Error('Server returned 204 with no JSON-RPC payload');
		}
		if (!response.ok) {
			throw new Error(`HTTP ${response.status} ${response.statusText}`);
		}

		const text = await response.text();
		const parsed = parseJsonRpc(text);
		if (parsed === null) throw new Error('Empty or unparseable response body');
		const envelope = JSON_RPC_RESPONSE_SCHEMA.safeParse(parsed);
		if (!envelope.success) {
			throw validationError('JSON-RPC response', envelope.error);
		}
		if (envelope.data.error) {
			throw new Error(`JSON-RPC ${envelope.data.error.code}: ${envelope.data.error.message}`);
		}
		const result = resultSchema.safeParse(envelope.data.result);
		if (!result.success) throw validationError(`${method} result`, result.error);
		return result.data;
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

	private async fetchWithTimeout(body: string): Promise<Response> {
		const controller = new AbortController();
		const timer = setTimeout(() => controller.abort(), this.timeoutMs);
		try {
			return await fetch(this.url, {
				body,
				headers: this.buildHeaders(),
				method: 'POST',
				redirect: 'error',
				signal: controller.signal,
			});
		} finally {
			clearTimeout(timer);
		}
	}
}

function parseJsonRpc(text: string): null | unknown {
	const trimmed = text.trim();
	if (!trimmed) return null;
	if (trimmed.startsWith('{') || trimmed.startsWith('[')) {
		try {
			const parsed: unknown = JSON.parse(trimmed);
			if (Array.isArray(parsed)) return parsed[0] ?? null;
			return parsed;
		} catch {
			// fall through to SSE parsing
		}
	}
	for (const line of trimmed.split(/\r?\n/)) {
		if (!line.startsWith('data:')) continue;
		const payload = line.slice(5).trim();
		if (!payload || payload === '[DONE]') continue;
		try {
			const parsed: unknown = JSON.parse(payload);
			return parsed;
		} catch {
			continue;
		}
	}
	return null;
}

function errMsg(err: unknown): string {
	if (err instanceof Error) {
		if (err.name === 'AbortError') return 'request timed out';
		return err.message;
	}
	return String(err);
}

function validationError(label: string, error: z.ZodError): Error {
	const issue = error.issues[0];
	const location = issue && issue.path.length > 0 ? ` at ${issue.path.join('.')}` : '';
	return new Error(`Invalid ${label}${location}: ${issue?.message ?? 'schema mismatch'}`);
}

/**
 * Probe a remote MCP server and return its declared surface.
 *
 * Performs at most four JSON-RPC requests:
 *   1. `initialize`
 *   2. `notifications/initialized` (notification, no response expected)
 *   3. `tools/list`
 *   4. `prompts/list` and `resources/list` when the server's `initialize`
 *      response advertises the matching capability
 *
 * Errors at any stage are captured in `result.errors` rather than thrown,
 * so the caller can render whatever partial surface was discovered.
 */
export async function probeMcp(options: ProbeOptions): Promise<ProbeResult> {
	const client = new McpHttpClient(
		options.url,
		options.authToken,
		options.headers ?? {},
		options.timeoutMs ?? DEFAULT_TIMEOUT_MS
	);

	const errors: ProbeError[] = [];
	let init: InitializeResult | undefined;
	let tools: readonly McpToolInfo[] = [];
	let prompts: readonly McpPromptInfo[] = [];
	let resources: readonly McpResourceInfo[] = [];

	try {
		init = await client.request('initialize', INITIALIZE_RESULT_SCHEMA, {
			capabilities: {},
			clientInfo: { name: CLIENT_NAME, version: PACKAGE_VERSION },
			protocolVersion: PROTOCOL_VERSION,
		});
		try {
			await client.notify('notifications/initialized');
		} catch {
			// notifications are best-effort
		}
	} catch (err) {
		errors.push({ message: errMsg(err), stage: 'initialize' });
	}

	if (init) {
		try {
			tools = (await client.request('tools/list', TOOLS_LIST_RESULT_SCHEMA, {})).tools;
		} catch (err) {
			errors.push({ message: errMsg(err), stage: 'tools/list' });
		}

		const caps = init.capabilities ?? {};
		if (caps.prompts) {
			try {
				prompts = (await client.request('prompts/list', PROMPTS_LIST_RESULT_SCHEMA, {}))
					.prompts;
			} catch (err) {
				errors.push({ message: errMsg(err), stage: 'prompts/list' });
			}
		}
		if (caps.resources) {
			try {
				resources = (
					await client.request('resources/list', RESOURCES_LIST_RESULT_SCHEMA, {})
				).resources;
			} catch (err) {
				errors.push({ message: errMsg(err), stage: 'resources/list' });
			}
		}
	}

	return {
		errors,
		probedAt: new Date().toISOString(),
		prompts,
		resources,
		tools,
		url: options.url,
		...(init?.protocolVersion ? { protocolVersion: init.protocolVersion } : {}),
		...(init?.serverInfo ? { serverInfo: init.serverInfo } : {}),
		...(init?.capabilities ? { capabilities: init.capabilities } : {}),
	};
}
