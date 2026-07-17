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

const PROTOCOL_VERSION = '2024-11-05';
const CLIENT_NAME = 'agentwatch';
const CLIENT_VERSION = '0.1.0';
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

interface JsonRpcError {
	readonly code: number;
	readonly message: string;
}

interface JsonRpcResponse {
	readonly error?: JsonRpcError;
	readonly id?: number | string;
	readonly jsonrpc: '2.0';
	readonly result?: unknown;
}

interface InitializeResult {
	readonly capabilities: Record<string, unknown>;
	readonly protocolVersion: string;
	readonly serverInfo: { readonly name: string; readonly version: string };
}

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

	async request<T>(method: string, params?: unknown): Promise<T> {
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
		if (!parsed) throw new Error('Empty or unparseable response body');
		if (parsed.error) {
			throw new Error(`JSON-RPC ${parsed.error.code}: ${parsed.error.message}`);
		}
		if (parsed.result === undefined) throw new Error('Response missing result');
		return parsed.result as T;
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
				signal: controller.signal,
			});
		} finally {
			clearTimeout(timer);
		}
	}
}

function parseJsonRpc(text: string): JsonRpcResponse | null {
	const trimmed = text.trim();
	if (!trimmed) return null;
	if (trimmed.startsWith('{') || trimmed.startsWith('[')) {
		try {
			const parsed: unknown = JSON.parse(trimmed);
			if (Array.isArray(parsed)) return (parsed[0] as JsonRpcResponse | undefined) ?? null;
			return parsed as JsonRpcResponse;
		} catch {
			// fall through to SSE parsing
		}
	}
	for (const line of trimmed.split(/\r?\n/)) {
		if (!line.startsWith('data:')) continue;
		const payload = line.slice(5).trim();
		if (!payload || payload === '[DONE]') continue;
		try {
			return JSON.parse(payload) as JsonRpcResponse;
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

function asTools(value: unknown): readonly McpToolInfo[] {
	if (!value || typeof value !== 'object') return [];
	const list = (value as { tools?: unknown }).tools;
	if (!Array.isArray(list)) return [];
	return list
		.filter((t): t is Record<string, unknown> => typeof t === 'object' && t !== null)
		.map((t) => ({
			...(typeof t.description === 'string' ? { description: t.description } : {}),
			...(t.inputSchema !== undefined ? { inputSchema: t.inputSchema } : {}),
			name: typeof t.name === 'string' ? t.name : '(unnamed)',
		}));
}

function asPrompts(value: unknown): readonly McpPromptInfo[] {
	if (!value || typeof value !== 'object') return [];
	const list = (value as { prompts?: unknown }).prompts;
	if (!Array.isArray(list)) return [];
	return list
		.filter((p): p is Record<string, unknown> => typeof p === 'object' && p !== null)
		.map((p) => ({
			...(typeof p.description === 'string' ? { description: p.description } : {}),
			name: typeof p.name === 'string' ? p.name : '(unnamed)',
		}));
}

function asResources(value: unknown): readonly McpResourceInfo[] {
	if (!value || typeof value !== 'object') return [];
	const list = (value as { resources?: unknown }).resources;
	if (!Array.isArray(list)) return [];
	return list
		.filter((r): r is Record<string, unknown> => typeof r === 'object' && r !== null)
		.map((r) => ({
			...(typeof r.description === 'string' ? { description: r.description } : {}),
			...(typeof r.mimeType === 'string' ? { mimeType: r.mimeType } : {}),
			...(typeof r.name === 'string' ? { name: r.name } : {}),
			uri: typeof r.uri === 'string' ? r.uri : '(missing-uri)',
		}));
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
		init = await client.request<InitializeResult>('initialize', {
			capabilities: {},
			clientInfo: { name: CLIENT_NAME, version: CLIENT_VERSION },
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
			tools = asTools(await client.request('tools/list', {}));
		} catch (err) {
			errors.push({ message: errMsg(err), stage: 'tools/list' });
		}

		const caps = init.capabilities ?? {};
		if (caps.prompts) {
			try {
				prompts = asPrompts(await client.request('prompts/list', {}));
			} catch (err) {
				errors.push({ message: errMsg(err), stage: 'prompts/list' });
			}
		}
		if (caps.resources) {
			try {
				resources = asResources(await client.request('resources/list', {}));
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
