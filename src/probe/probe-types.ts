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
