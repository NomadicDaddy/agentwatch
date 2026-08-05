import { z } from 'zod';

import type { McpPromptInfo, McpResourceInfo, McpToolInfo } from './probe-types.ts';

export const JSON_RPC_RESPONSE_SCHEMA = z
	.object({
		error: z.object({ code: z.number(), message: z.string() }).optional(),
		id: z.union([z.number(), z.string()]).optional(),
		jsonrpc: z.literal('2.0'),
		result: z.unknown().optional(),
	})
	.refine((response) => response.error !== undefined || response.result !== undefined, {
		message: 'response must include result or error',
	});

export const INITIALIZE_RESULT_SCHEMA = z.object({
	capabilities: z.record(z.string(), z.unknown()),
	protocolVersion: z.string(),
	serverInfo: z.object({ name: z.string(), version: z.string() }),
});

export const PROMPTS_LIST_RESULT_SCHEMA = z.object({
	prompts: z.array(
		z
			.object({ description: z.string().optional(), name: z.string() })
			.transform((prompt): McpPromptInfo => ({
				...(prompt.description !== undefined ? { description: prompt.description } : {}),
				name: prompt.name,
			}))
	),
});

export const RESOURCES_LIST_RESULT_SCHEMA = z.object({
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

export const TOOLS_LIST_RESULT_SCHEMA = z.object({
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

export type InitializeResult = z.infer<typeof INITIALIZE_RESULT_SCHEMA>;

export function parseJsonRpc(text: string): null | unknown {
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

export function validationError(label: string, error: z.ZodError): Error {
	const issue = error.issues[0];
	const location = issue && issue.path.length > 0 ? ` at ${issue.path.join('.')}` : '';
	return new Error(`Invalid ${label}${location}: ${issue?.message ?? 'schema mismatch'}`);
}
