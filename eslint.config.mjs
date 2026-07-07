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
	// utils/ must stay Obsidian-free.
	// Sanctioned exceptions: Platform detection (platform/error-utils/paths) and
	// Obsidian's bundled YAML parser (agent-block-parser). See refactoring plan.
	{
		files: ["src/utils/**/*.ts"],
		ignores: [
			"src/utils/platform.ts",
			"src/utils/error-utils.ts",
			"src/utils/paths.ts",
			"src/utils/agent-block-parser.ts",
		],
		rules: {
			"no-restricted-imports": [
				"error",
				{
					patterns: [
						{
							group: ["obsidian"],
							message:
								"utils/ must stay Obsidian-free (see refactoring plan).",
						},
						// Re-stated here because this block's rule entry replaces
						// the earlier "outside acp/" one for these files.
						{
							group: ["@agentclientprotocol/*"],
							message: "ACP SDK is confined to src/acp/.",
						},
					],
				},
			],
		},
	},
	// acp/ must not import React, and must not import the plugin at all
	// (type imports included) — it talks to its host via AcpClientHost
	// (src/acp/host.ts) instead.
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
							message:
								"acp/ must not depend on the plugin — use AcpClientHost (src/acp/host.ts).",
						},
					],
				},
			],
		},
	},
]);
