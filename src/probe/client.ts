import { z } from 'zod';

import type { McpPromptInfo, McpResourceInfo, McpToolInfo, ProbeOptions } from './probe-types.ts';

import { PACKAGE_VERSION } from '../version.ts';

const PROTOCOL_VERSION = '2024-11-05';
const CLIENT_NAME = 'agentwatch';
const DEFAULT_TIMEOUT_MS = 15_000;

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

export type InitializeResult = z.infer<typeof INITIALIZE_RESULT_SCHEMA>;

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

	private async notify(method: string, params?: unknown): Promise<void> {
		const body = JSON.stringify({ jsonrpc: '2.0', method, ...(params ? { params } : {}) });
		await this.fetchWithTimeout(body);
	}

	private async request<T>(
		method: string,
		resultSchema: z.ZodType<T>,
		params?: unknown
	): Promise<T> {
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

		const parsed = parseJsonRpc(await response.text());
		if (parsed === null) throw new Error('Empty or unparseable response body');
		const envelope = JSON_RPC_RESPONSE_SCHEMA.safeParse(parsed);
		if (!envelope.success) throw validationError('JSON-RPC response', envelope.error);
		if (envelope.data.error) {
			throw new Error(`JSON-RPC ${envelope.data.error.code}: ${envelope.data.error.message}`);
		}
		const result = resultSchema.safeParse(envelope.data.result);
		if (!result.success) throw validationError(`${method} result`, result.error);
		return result.data;
	}
}

function parseJsonRpc(text: string): null | unknown {
	const trimmed = text.trim();
	if (!trimmed) return null;
	if (trimmed.startsWith('{') || trimmed.startsWith('[')) {
		try {
			const parsed: unknown = JSON.parse(trimmed);
			return Array.isArray(parsed) ? (parsed[0] ?? null) : parsed;
		} catch {
			// Fall through to SSE parsing.
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

function validationError(label: string, error: z.ZodError): Error {
	const issue = error.issues[0];
	const location = issue && issue.path.length > 0 ? ` at ${issue.path.join('.')}` : '';
	return new Error(`Invalid ${label}${location}: ${issue?.message ?? 'schema mismatch'}`);
}
