import { describe, expect, test } from 'bun:test';

import { maskSecrets } from '../../src/util/mask.ts';

const PREFIX_CASES = [
	{
		masked: 'AKIA1234***',
		raw: 'AKIA1234567890ABCDEF',
	},
	{
		masked: 'AIza1234***',
		raw: 'AIza1234567890abcdefghijklmnopqrstuvwxy',
	},
	{
		masked: 'github_pat_1234***',
		raw: 'github_pat_1234567890abcdefgh',
	},
] as const;

const AUTHORIZATION_CASES = [
	{
		header: 'Authorization',
		maskedValue: 'Bearer bear***',
		rawCredential: 'bearerCredential123',
		scheme: 'Bearer',
	},
	{
		header: 'authorization',
		maskedValue: 'Basic QWxh***',
		rawCredential: 'QWxhZGRpbjpvcGVu',
		scheme: 'Basic',
	},
	{
		header: 'AUTHORIZATION',
		maskedValue: 'Token cust***',
		rawCredential: 'customCredential123',
		scheme: 'Token',
	},
] as const;

describe('credential masking formats', () => {
	test('masks standalone provider credentials and Authorization forms', () => {
		for (const { masked, raw } of PREFIX_CASES) {
			const output = maskSecrets(raw);

			expect(output).toBe(masked);
			expect(output).not.toContain(raw);
		}

		for (const { header, maskedValue, rawCredential, scheme } of AUTHORIZATION_CASES) {
			const output = maskSecrets(`${header}: ${scheme} ${rawCredential}`);

			expect(output).toContain(`${header}: ${maskedValue}`);
			expect(output).not.toContain(rawCredential);
		}
	});

	test('masks provider credentials and Authorization forms in nested objects', () => {
		for (const { masked, raw } of PREFIX_CASES) {
			const output = maskSecrets(JSON.stringify({ nested: { credential: raw } }));

			expect(output).toContain(masked);
			expect(output).not.toContain(raw);
		}

		for (const { header, maskedValue, rawCredential, scheme } of AUTHORIZATION_CASES) {
			const output = maskSecrets(
				JSON.stringify({ nested: { [header]: `${scheme} ${rawCredential}` } })
			);

			expect(output).toContain(`"${header}":"${maskedValue}"`);
			expect(output).not.toContain(rawCredential);
		}
	});
});
