/**
 * Parser for the `agent-client` markdown code block.
 *
 * Pure function. No React, no Obsidian view APIs (parseYaml from obsidian
 * is the only Obsidian import, used as a YAML utility).
 *
 * Fence body is parsed as YAML and dispatched by a `type` discriminator:
 * - `chat` (default): embedded chat view
 * - `button`: quick-action button that opens a chat with a prompt
 */

import { parseYaml } from "obsidian";

export type AgentChatBlockConfig = {
	type: "chat";
	/**
	 * Device-neutral stable block id (persist mapping key).
	 * Hand-written ids are honored as-is; for persist blocks lacking one,
	 * the plugin auto-injects a generated id into the fence once.
	 */
	id?: string;
	agent?: string;
	model?: string;
	/** Max height of the messages area, e.g. "400px". */
	height?: string;
	/** Restore the latest saved session for this note + agent. */
	persist?: boolean;
	/** Pin auto-mention context to the note hosting this block. */
	noteContext?: "hosting";
};

export type AgentButtonBlockConfig = {
	type: "button";
	text: string;
	/** Prompt sent to the opened chat. */
	prompt: string;
	agent?: string;
	/** Where to open the chat when clicked. */
	viewType?: "right-pane" | "floating" | "editor-tab" | "embedded";
	/** Send immediately on open. */
	autoSend?: boolean;
};

export type AgentBlockConfig = AgentChatBlockConfig | AgentButtonBlockConfig;

export type AgentBlockParseResult =
	| { ok: true; config: AgentBlockConfig; warnings?: string[] }
	| { ok: false; error: string };

const VALID_TYPES = new Set<string>(["chat", "button"]);
const VALID_VIEW_TYPES = new Set<string>([
	"right-pane",
	"floating",
	"editor-tab",
	"embedded",
]);
const VALID_NOTE_CONTEXTS = new Set<string>(["hosting"]);

function normalizeViewType(
	value: string | undefined,
): AgentButtonBlockConfig["viewType"] | undefined {
	if (!value) return undefined;
	if (value === "right" || value === "right-tab") return "right-pane";
	if (value === "float" || value === "floating-chat") return "floating";
	if (value === "tab") return "editor-tab";
	if (value === "embed" || value === "embeddable") return "embedded";
	return VALID_VIEW_TYPES.has(value)
		? (value as AgentButtonBlockConfig["viewType"])
		: undefined;
}

function asString(value: unknown): string | undefined {
	return typeof value === "string" && value.trim().length > 0
		? value.trim()
		: undefined;
}

/**
 * True when a key is present (not undefined/null) yet asString() rejects it —
 * e.g. `type: 0`, `viewType: 1`, `noteContext: false`. Such a value is an
 * explicit invalid input, NOT an absent key, so it must surface the field's
 * configured error/warning instead of silently falling back to a default.
 */
function isPresentInvalid(value: unknown): boolean {
	return (
		value !== undefined && value !== null && asString(value) === undefined
	);
}

function asBoolean(value: unknown): boolean | undefined {
	if (typeof value === "boolean") return value;
	if (typeof value === "number") {
		if (value === 1) return true;
		if (value === 0) return false;
		return undefined;
	}
	if (typeof value === "string") {
		const v = value.trim().toLowerCase();
		if (v === "true" || v === "yes" || v === "on" || v === "1") return true;
		if (v === "false" || v === "no" || v === "off" || v === "0") {
			return false;
		}
	}
	return undefined;
}

/**
 * Parse an optional behavior flag (persist, autoSend).
 *
 * Absent value defaults to false silently. A present-but-unrecognized value
 * does NOT fail the block: it defaults to false and pushes a non-fatal
 * warning (surfaced subtly by renderAgentBlock).
 */
function parseOptionalBoolean(
	value: unknown,
	fieldName: string,
	warnings: string[],
): boolean {
	if (value === undefined || value === null) return false;
	const parsed = asBoolean(value);
	if (parsed === undefined) {
		warnings.push(
			`Unrecognized "${fieldName}" value: ${JSON.stringify(value)}. ` +
				`Expected a boolean (true/false). Defaulting to false.`,
		);
		return false;
	}
	return parsed;
}

function dedent(source: string): string {
	const normalized = source.replace(/\r\n?/g, "\n");
	const lines = normalized.split("\n");
	const indents = lines
		.filter((line) => line.trim().length > 0)
		.map((line) => line.match(/^[ \t]*/)?.[0].length ?? 0);
	const minIndent = indents.length > 0 ? Math.min(...indents) : 0;

	if (minIndent === 0) return normalized.trim();

	return lines
		.map((line) => (line.trim().length > 0 ? line.slice(minIndent) : line))
		.join("\n")
		.trim();
}

function normalizeCssLength(
	value: string | undefined,
	fieldName: string,
	warnings: string[],
): string | undefined {
	if (!value) return undefined;
	// Strict: reject anything that is not a bare CSS length. Drop the
	// leading "-?" so negative lengths (invalid for a height) are rejected
	// too. Both "400px" and "400 px" normalize to "400px".
	const match = value.match(/^(\d+(?:\.\d+)?)\s*(px|em|rem|vh|vw|%)$/i);
	if (!match) {
		warnings.push(
			`Unrecognized "${fieldName}" value: ${JSON.stringify(value)}. ` +
				`Expected a CSS length like "400px". Ignoring.`,
		);
		return undefined;
	}
	return `${match[1]}${match[2].toLowerCase()}`;
}

/**
 * Parse the fence body. An empty body yields a default `chat` block.
 *
 * Returns a discriminated result. Callers should render an inline error
 * (createDiv/createSpan, never innerHTML) when ok is false.
 */
export function parseAgentBlock(source: string): AgentBlockParseResult {
	const trimmed = dedent(source);
	const warnings: string[] = [];

	let raw: unknown;
	if (trimmed.length === 0) {
		raw = {};
	} else {
		try {
			raw = parseYaml(trimmed);
		} catch (error) {
			const message =
				error instanceof Error ? error.message : String(error);
			return { ok: false, error: `Invalid YAML: ${message}` };
		}
	}

	if (raw === null || typeof raw !== "object" || Array.isArray(raw)) {
		return {
			ok: false,
			error: "Block body must be a YAML mapping (key: value pairs).",
		};
	}

	const obj = raw as Record<string, unknown>;
	const typeValue = asString(obj.type) ?? "chat";

	if (!VALID_TYPES.has(typeValue) || isPresentInvalid(obj.type)) {
		return {
			ok: false,
			error: `Unknown type: ${JSON.stringify(obj.type)}. Expected "chat" or "button".`,
		};
	}

	if (typeValue === "chat") {
		const rawNoteContext = asString(obj.noteContext);
		const noteContext = rawNoteContext
			? VALID_NOTE_CONTEXTS.has(rawNoteContext)
				? (rawNoteContext as AgentChatBlockConfig["noteContext"])
				: undefined
			: undefined;
		if (
			(rawNoteContext && !noteContext) ||
			isPresentInvalid(obj.noteContext)
		) {
			return {
				ok: false,
				error: `Unknown noteContext: ${JSON.stringify(obj.noteContext)}. Expected "hosting".`,
			};
		}

		const config: AgentChatBlockConfig = {
			type: "chat",
			id: asString(obj.id),
			agent: asString(obj.agent),
			model: asString(obj.model),
			height: normalizeCssLength(
				asString(obj.height) ??
					(isPresentInvalid(obj.height)
						? String(obj.height)
						: undefined),
				"height",
				warnings,
			),
			persist: parseOptionalBoolean(obj.persist, "persist", warnings),
			noteContext,
		};
		return {
			ok: true,
			config,
			warnings: warnings.length > 0 ? warnings : undefined,
		};
	}

	const text = asString(obj.text);
	if (!text) {
		return {
			ok: false,
			error: 'Button block requires a non-empty "text" field.',
		};
	}

	const prompt = asString(obj.prompt);
	if (!prompt) {
		return {
			ok: false,
			error: 'Button block requires a non-empty "prompt" field.',
		};
	}

	const rawViewType = asString(obj.viewType);
	const viewType = normalizeViewType(rawViewType);
	if ((rawViewType && !viewType) || isPresentInvalid(obj.viewType)) {
		return {
			ok: false,
			error: `Unknown viewType: ${JSON.stringify(obj.viewType)}. Expected "right-pane", "floating", "editor-tab", or "embedded".`,
		};
	}

	const config: AgentButtonBlockConfig = {
		type: "button",
		text,
		prompt,
		agent: asString(obj.agent),
		viewType: viewType ?? "right-pane",
		autoSend: parseOptionalBoolean(obj.autoSend, "autoSend", warnings),
	};
	return {
		ok: true,
		config,
		warnings: warnings.length > 0 ? warnings : undefined,
	};
}
