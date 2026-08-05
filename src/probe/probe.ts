/**
 * Minimal MCP probe orchestration over Streamable HTTP.
 *
 * Enumerates a remote server's declared tool, prompt, and resource surface.
 * Network access stays limited to the operator-selected URL, and no tool is
 * ever invoked.
 */

import type { InitializeResult } from './client.ts';
import type {
	McpPromptInfo,
	McpResourceInfo,
	McpToolInfo,
	ProbeError,
	ProbeOptions,
	ProbeResult,
} from './probe-types.ts';

import { McpHttpClient } from './client.ts';

export type { ProbeOptions, ProbeResult, ProbeStage } from './probe-types.ts';

function errMsg(error: unknown): string {
	if (error instanceof Error) {
		if (error.name === 'AbortError') return 'request timed out';
		return error.message;
	}
	return String(error);
}

/**
 * Probe a remote MCP server and return its declared surface.
 *
 * Errors at any stage are captured in `result.errors` so callers can render
 * any partial surface that was discovered.
 */
export async function probeMcp(options: ProbeOptions): Promise<ProbeResult> {
	const client = new McpHttpClient(options);
	const errors: ProbeError[] = [];
	let init: InitializeResult | undefined;
	let tools: readonly McpToolInfo[] = [];
	let prompts: readonly McpPromptInfo[] = [];
	let resources: readonly McpResourceInfo[] = [];

	try {
		init = await client.initialize();
		try {
			await client.notifyInitialized();
		} catch {
			// Notifications are best-effort.
		}
	} catch (err) {
		errors.push({ message: errMsg(err), stage: 'initialize' });
	}

	if (init) {
		try {
			tools = await client.listTools();
		} catch (err) {
			errors.push({ message: errMsg(err), stage: 'tools/list' });
		}

		if (init.capabilities.prompts) {
			try {
				prompts = await client.listPrompts();
			} catch (err) {
				errors.push({ message: errMsg(err), stage: 'prompts/list' });
			}
		}
		if (init.capabilities.resources) {
			try {
				resources = await client.listResources();
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
