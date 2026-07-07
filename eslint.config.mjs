import tsparser from "@typescript-eslint/parser";
import { defineConfig } from "eslint/config";
import obsidianmd from "eslint-plugin-obsidianmd";
import tseslint from "typescript-eslint";

export default defineConfig([
	{
		ignores: ["node_modules/", "main.js", "docs/", "coverage/"],
	},
	...obsidianmd.configs.recommended,
	...tseslint.configs.recommended,
	{
		files: ["**/*.ts", "**/*.tsx"],
		languageOptions: {
			parser: tsparser,
			parserOptions: { project: "./tsconfig.eslint.json" },
		},
		rules: {
			// Preserve existing rules
			"@typescript-eslint/no-unused-vars": ["error", { args: "none" }],
			"@typescript-eslint/ban-ts-comment": "off",
			"@typescript-eslint/no-empty-function": "off",
			// Brand/agent names routinely trip this and the PR template already
			// treats those hits as acceptable — keep them visible, don't fail.
			"obsidianmd/ui/sentence-case": "warn",
		},
	},
	// --- Layer dependency rules ---
	// types/ is the dependency-free vocabulary layer.
	{
		files: ["src/types/**/*.ts"],
		rules: {
			"no-restricted-imports": [
				"error",
				{
					patterns: [
						{
							group: [
								"obsidian",
								"react",
								"react-dom",
								"@agentclientprotocol/*",
								"electron",
							],
							message: "types/ must stay dependency-free.",
						},
					],
				},
			],
		},
	},
	// services/ holds non-React business logic; the ACP SDK is confined to acp/.
	{
		files: ["src/services/**/*.ts"],
		rules: {
			"no-restricted-imports": [
				"error",
				{
					patterns: [
						{
							group: ["react", "react-dom"],
							message: "services/ must not import React.",
						},
						{
							group: ["@agentclientprotocol/*"],
							message: "ACP SDK is confined to src/acp/.",
						},
					],
				},
			],
		},
	},
	// Everything outside acp/ must not touch the ACP SDK.
	{
		files: [
			"src/hooks/**/*.ts",
			"src/ui/**/*.ts",
			"src/ui/**/*.tsx",
			"src/utils/**/*.ts",
			"src/plugin.ts",
			"src/main.ts",
		],
		rules: {
			"no-restricted-imports": [
				"error",
				{
					patterns: [
						{
							group: ["@agentclientprotocol/*"],
							message: "ACP SDK is confined to src/acp/.",
						},
					],
				},
			],
		},
	},
	// acp/ must not import React. Its ../plugin imports are type-only today and
	// will be banned entirely once AcpClientHost lands (refactor phase 2, PR2.1).
	{
		files: ["src/acp/**/*.ts"],
		rules: {
			"@typescript-eslint/no-restricted-imports": [
				"error",
				{
					paths: [],
					patterns: [
						{
							group: ["react", "react-dom"],
							message: "acp/ must not import React.",
						},
						{
							group: ["../plugin", "**/plugin"],
							allowTypeImports: true,
							message:
								"acp/ may only type-import the plugin until AcpClientHost lands (phase 2).",
						},
					],
				},
			],
		},
	},
]);
