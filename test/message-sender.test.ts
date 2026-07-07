/**
 * Characterization tests for src/services/message-sender.ts (Phase 0, PR0.4).
 * Freezes CURRENT behavior — see plan/202607070331_refactoring-codebase-notes.md
 * (INV-4) and plan/202607070332_refactoring-phase0-tests-guardrails.md (PR0.4).
 */

import { describe, test, expect, vi } from "vitest";
import {
	preparePrompt,
	sendPreparedPrompt,
	type PreparePromptInput,
	type SendPreparedPromptInput,
} from "../src/services/message-sender";
import type { AcpClient } from "../src/acp/acp-client";
import type { NoteMetadata } from "../src/services/vault-service";
import type { AuthenticationMethod } from "../src/types/session";
import type {
	PromptContent,
	TextPromptContent,
	ResourcePromptContent,
	ImagePromptContent,
	ResourceLinkPromptContent,
} from "../src/types/chat";
import { fakeVaultAccess, FAKE_MTIME } from "./helpers/fake-vault";

// ============================================================================
// Builders
// ============================================================================

function baseInput(
	overrides: Partial<PreparePromptInput> = {},
): PreparePromptInput {
	return {
		message: "hello",
		vaultBasePath: "/vault",
		convertToWsl: false,
		supportsEmbeddedContext: true,
		isFirstMessage: false,
		...overrides,
	};
}

function activeNote(overrides: Partial<NoteMetadata> = {}): NoteMetadata {
	return {
		path: "Active.md",
		name: "Active",
		extension: "md",
		created: FAKE_MTIME,
		modified: FAKE_MTIME,
		...overrides,
	};
}

/** Selection over 0-based lines 1..3 (1-based 2-4). */
const SELECTION = {
	from: { line: 1, ch: 0 },
	to: { line: 3, ch: 2 },
};

const FIVE_LINES = "line0\nline1\nline2\nline3\nline4";

async function run(
	overrides: Partial<PreparePromptInput>,
	notes: Record<string, string> = {},
) {
	const { vaultAccess } = fakeVaultAccess(notes);
	return preparePrompt(baseInput(overrides), vaultAccess, vaultAccess);
}

function texts(content: PromptContent[]): string[] {
	return content
		.filter((c): c is TextPromptContent => c.type === "text")
		.map((c) => c.text);
}

function resources(content: PromptContent[]): ResourcePromptContent[] {
	return content.filter(
		(c): c is ResourcePromptContent => c.type === "resource",
	);
}

const IMAGE: ImagePromptContent = {
	type: "image",
	data: "AAA=",
	mimeType: "image/png",
};

const RESOURCE_LINK: ResourceLinkPromptContent = {
	type: "resource_link",
	uri: "file:///attached.pdf",
	name: "attached.pdf",
};

// ============================================================================
// preparePrompt — embedded-context path (supportsEmbeddedContext: true)
// ============================================================================

describe("preparePrompt / embedded context", () => {
	test("mention becomes a resource block with uri, mimeType, text, and annotations", async () => {
		const result = await run(
			{ message: "check @[[Note]]" },
			{ "Note.md": "note body" },
		);

		expect(result.agentContent).toEqual([
			{
				type: "resource",
				resource: {
					uri: "file:///vault/Note.md",
					mimeType: "text/markdown",
					text: "note body",
				},
				annotations: {
					audience: ["assistant"],
					priority: 1.0,
					lastModified: new Date(FAKE_MTIME).toISOString(),
				},
			},
			{ type: "text", text: "check @[[Note]]" },
		]);
	});

	test("mention with no matching note produces no resource block", async () => {
		const result = await run({ message: "see @[[Ghost]]" }, {});

		expect(result.agentContent).toEqual([
			{ type: "text", text: "see @[[Ghost]]" },
		]);
	});

	test("note longer than maxNoteLength is truncated with a truncation note", async () => {
		const result = await run(
			{ message: "check @[[Note]]", maxNoteLength: 10 },
			{ "Note.md": "a".repeat(25) },
		);

		const [res] = resources(result.agentContent);
		expect(res.resource.text).toBe(
			"a".repeat(10) + "\n\n[Note: Truncated from 25 to 10 characters]",
		);
	});

	test("active note with selection embeds only selected lines at priority 0.8 plus a focus text block", async () => {
		const result = await run(
			{ activeNote: activeNote({ selection: SELECTION }) },
			{ "Active.md": FIVE_LINES },
		);

		expect(result.agentContent[0]).toEqual({
			type: "resource",
			resource: {
				uri: "file:///vault/Active.md",
				mimeType: "text/markdown",
				text: "line1\nline2\nline3",
			},
			annotations: {
				audience: ["assistant"],
				priority: 0.8,
				lastModified: new Date(FAKE_MTIME).toISOString(),
			},
		});
		expect(result.agentContent[1]).toEqual({
			type: "text",
			text: "The user has selected lines 2-4 in the above note. This is what they are currently focusing on.",
		});
		// message text block carries the selection prefix
		expect(result.agentContent[2]).toEqual({
			type: "text",
			text: "@[[Active]]:2-4\nhello",
		});
	});

	test("selection longer than maxSelectionLength is truncated with a truncation note", async () => {
		const result = await run(
			{
				activeNote: activeNote({ selection: SELECTION }),
				maxSelectionLength: 5,
			},
			{ "Active.md": FIVE_LINES },
		);

		const [res] = resources(result.agentContent);
		expect(res.resource.text).toBe(
			"line1" + "\n\n[Note: Truncated from 17 to 5 characters]",
		);
	});

	test("active note without selection embeds no content — only a Read-tool pointer text block", async () => {
		const result = await run(
			{ activeNote: activeNote() },
			{ "Active.md": FIVE_LINES },
		);

		expect(resources(result.agentContent)).toEqual([]);
		expect(result.agentContent[0]).toEqual({
			type: "text",
			text: "The user has opened the note file:///vault/Active.md in Obsidian. This may or may not be related to the current conversation. If it seems relevant, consider using the Read tool to examine its content.",
		});
		expect(result.agentContent[1]).toEqual({
			type: "text",
			text: "@[[Active]]\nhello",
		});
	});

	test("selection read failure falls back to a Read-tool pointer text block", async () => {
		const spy = vi.spyOn(console, "error").mockImplementation(() => {});
		try {
			const result = await run(
				{
					activeNote: activeNote({
						path: "Missing.md",
						name: "Missing",
						selection: SELECTION,
					}),
				},
				{}, // Missing.md not readable
			);

			expect(resources(result.agentContent)).toEqual([]);
			expect(result.agentContent[0]).toEqual({
				type: "text",
				text: "The user has selected lines 2-4 in file:///vault/Missing.md. If relevant, use the Read tool to examine the specific lines.",
			});
		} finally {
			spy.mockRestore();
		}
	});

	test("agentContent order: system → mentioned resources → link blocks → auto-mention → text → images → resourceLinks", async () => {
		const { vaultAccess, wikilinkResolver } = fakeVaultAccess({
			"Note.md": "note body",
			"Active.md": FIVE_LINES,
		});
		wikilinkResolver.getNoteWikiLinks.mockImplementation((path) =>
			path === "Note.md"
				? [{ linkText: "Other", resolvedPath: "Other.md" }]
				: [],
		);

		const result = await preparePrompt(
			baseInput({
				message: "see @[[Note]]",
				activeNote: activeNote({ selection: SELECTION }),
				isFirstMessage: true,
				promptInjection: { wikiLinks: true },
				images: [IMAGE],
				resourceLinks: [RESOURCE_LINK],
				expandWikilinkContext: true,
				wikilinkResolver,
			}),
			vaultAccess,
			vaultAccess,
		);

		expect(result.agentContent.map((c) => c.type)).toEqual([
			"text", // system instruction
			"resource", // mentioned note
			"text", // <obsidian_note_links> sibling for mentioned note
			"resource", // auto-mention selection
			"text", // "selected lines" focus block
			"text", // prefix + message
			"image",
			"resource_link",
		]);
		const allTexts = texts(result.agentContent);
		expect(allTexts[0]).toContain("wikilink syntax");
		expect(allTexts[1]).toContain(
			'<obsidian_note_links ref="file:///vault/Note.md">',
		);
		expect(allTexts[2]).toContain("The user has selected lines 2-4");
		expect(allTexts[3]).toBe("@[[Active]]:2-4\nsee @[[Note]]");
	});

	test("INV-4(a): slash command gets no auto-mention prefix, but resource blocks and badge are kept", async () => {
		const result = await run(
			{
				message: "/compact @[[Note]]",
				activeNote: activeNote({ selection: SELECTION }),
			},
			{ "Note.md": "note body", "Active.md": FIVE_LINES },
		);

		// mentioned resource + auto-mention selection resource are still sent
		expect(resources(result.agentContent)).toHaveLength(2);
		// text block starts with "/" at character 0 (no prefix)
		const textBlocks = texts(result.agentContent);
		expect(textBlocks[textBlocks.length - 1]).toBe("/compact @[[Note]]");
		// badge is kept on the embedded path
		expect(result.autoMentionContext).toEqual({
			noteName: "Active",
			notePath: "Active.md",
			selection: { fromLine: 2, toLine: 4 },
		});
	});

	test("first message with promptInjection emits system blocks in wikiLinks → tables → latex order", async () => {
		const result = await run({
			isFirstMessage: true,
			promptInjection: { latex: true, wikiLinks: true, tables: true },
		});

		const [wiki, tables, latex] = texts(result.agentContent);
		expect(wiki).toBe(
			"When referencing notes in this vault, use [[Note Name]] wikilink syntax so they become clickable links.",
		);
		expect(tables).toBe(
			"Always leave a blank line before Markdown tables; without it Obsidian renders them as plain text.",
		);
		expect(latex).toBe(
			"This client uses Obsidian Flavored Markdown. For math, use $...$ for inline and $$...$$ for display (not \\(...\\) or \\[...\\]).",
		);
	});

	test("no system blocks when not first message or when promptInjection is undefined", async () => {
		const withInjection = await run({
			isFirstMessage: false,
			promptInjection: { wikiLinks: true },
		});
		expect(withInjection.agentContent).toEqual([
			{ type: "text", text: "hello" },
		]);

		const withoutInjection = await run({ isFirstMessage: true });
		expect(withoutInjection.agentContent).toEqual([
			{ type: "text", text: "hello" },
		]);
	});
});

// ============================================================================
// preparePrompt — XML fallback path (supportsEmbeddedContext: false)
// ============================================================================

describe("preparePrompt / XML fallback", () => {
	test("mentioned note becomes an <obsidian_mentioned_note> block prepended to the message", async () => {
		const result = await run(
			{ message: "check @[[Note]]", supportsEmbeddedContext: false },
			{ "Note.md": "note body" },
		);

		expect(result.agentContent).toEqual([
			{
				type: "text",
				text:
					'<obsidian_mentioned_note ref="/vault/Note.md">\nnote body\n</obsidian_mentioned_note>' +
					"\n\ncheck @[[Note]]",
			},
		]);
	});

	test("XML truncation note uses the 'Original length' wording", async () => {
		const result = await run(
			{
				message: "check @[[Note]]",
				supportsEmbeddedContext: false,
				maxNoteLength: 10,
			},
			{ "Note.md": "a".repeat(25) },
		);

		const [text] = texts(result.agentContent);
		expect(text).toContain(
			"[Note: This note was truncated. Original length: 25 characters, showing first 10 characters]",
		);
	});

	test("selection becomes an <obsidian_opened_note selection=\"lines X-Y\"> block", async () => {
		const result = await run(
			{
				supportsEmbeddedContext: false,
				activeNote: activeNote({ selection: SELECTION }),
			},
			{ "Active.md": FIVE_LINES },
		);

		const expectedBlock = `<obsidian_opened_note selection="lines 2-4">
The user opened the note /vault/Active.md in Obsidian and selected the following text (lines 2-4):

line1
line2
line3

This is what the user is currently focusing on.
</obsidian_opened_note>`;
		expect(result.agentContent).toEqual([
			{
				type: "text",
				text: expectedBlock + "\n\n@[[Active]]:2-4\nhello",
			},
		]);
	});

	test("no-selection active note emits a pointer-only opened-note block", async () => {
		const result = await run(
			{
				supportsEmbeddedContext: false,
				activeNote: activeNote(),
			},
			{ "Active.md": FIVE_LINES },
		);

		const [text] = texts(result.agentContent);
		expect(text).toBe(
			"<obsidian_opened_note>The user opened the note /vault/Active.md in Obsidian. This may or may not be related to the current conversation. If it seems relevant, consider using the Read tool to examine the content.</obsidian_opened_note>" +
				"\n\n@[[Active]]\nhello",
		);
	});

	test("selection read failure emits a pointer-only block with the selection attribute", async () => {
		const spy = vi.spyOn(console, "error").mockImplementation(() => {});
		try {
			const result = await run(
				{
					supportsEmbeddedContext: false,
					activeNote: activeNote({
						path: "Missing.md",
						name: "Missing",
						selection: SELECTION,
					}),
				},
				{},
			);

			const [text] = texts(result.agentContent);
			expect(text).toContain(
				'<obsidian_opened_note selection="lines 2-4">The user opened the note /vault/Missing.md in Obsidian and is focusing on lines 2-4.',
			);
			expect(text).toContain(
				"consider using the Read tool to examine the specific lines",
			);
		} finally {
			spy.mockRestore();
		}
	});

	test("system instructions become <obsidian_system_instruction> blocks", async () => {
		const result = await run({
			supportsEmbeddedContext: false,
			isFirstMessage: true,
			promptInjection: { wikiLinks: true },
		});

		expect(result.agentContent).toEqual([
			{
				type: "text",
				text:
					"<obsidian_system_instruction>\nWhen referencing notes in this vault, use [[Note Name]] wikilink syntax so they become clickable links.\n</obsidian_system_instruction>" +
					"\n\nhello",
			},
		]);
	});

	test("INV-4(b)(c): slash command drops all context blocks and the autoMentionContext badge", async () => {
		const result = await run(
			{
				message: "/compact @[[Note]]",
				supportsEmbeddedContext: false,
				activeNote: activeNote({ selection: SELECTION }),
				isFirstMessage: true,
				promptInjection: { wikiLinks: true },
			},
			{ "Note.md": "note body", "Active.md": FIVE_LINES },
		);

		expect(result.agentContent).toEqual([
			{ type: "text", text: "/compact @[[Note]]" },
		]);
		expect(result.autoMentionContext).toBeUndefined();
	});
});

// ============================================================================
// preparePrompt — shared behavior
// ============================================================================

describe("preparePrompt / shared behavior", () => {
	test("auto-mention prefix format: '@[[name]]\\n' without selection", async () => {
		const result = await run(
			{ activeNote: activeNote() },
			{ "Active.md": FIVE_LINES },
		);
		const textBlocks = texts(result.agentContent);
		expect(textBlocks[textBlocks.length - 1]).toBe("@[[Active]]\nhello");
		expect(result.autoMentionContext).toEqual({
			noteName: "Active",
			notePath: "Active.md",
			selection: undefined,
		});
	});

	test("auto-mention prefix format: '@[[name]]:12-34\\n' with 1-based line numbers", async () => {
		const result = await run(
			{
				activeNote: activeNote({
					selection: {
						from: { line: 11, ch: 0 },
						to: { line: 33, ch: 0 },
					},
				}),
			},
			{ "Active.md": "x\n".repeat(40) },
		);
		const textBlocks = texts(result.agentContent);
		expect(textBlocks[textBlocks.length - 1]).toBe("@[[Active]]:12-34\nhello");
		expect(result.autoMentionContext?.selection).toEqual({
			fromLine: 12,
			toLine: 34,
		});
	});

	test("isAutoMentionDisabled suppresses prefix, context blocks, and badge", async () => {
		const result = await run(
			{
				activeNote: activeNote({ selection: SELECTION }),
				isAutoMentionDisabled: true,
			},
			{ "Active.md": FIVE_LINES },
		);

		expect(result.agentContent).toEqual([{ type: "text", text: "hello" }]);
		expect(result.autoMentionContext).toBeUndefined();
	});

	test("displayContent contains only original text + images + resourceLinks (no injected context)", async () => {
		const result = await run(
			{
				message: "check @[[Note]]",
				activeNote: activeNote({ selection: SELECTION }),
				isFirstMessage: true,
				promptInjection: { wikiLinks: true },
				images: [IMAGE],
				resourceLinks: [RESOURCE_LINK],
			},
			{ "Note.md": "note body", "Active.md": FIVE_LINES },
		);

		expect(result.displayContent).toEqual([
			{ type: "text", text: "check @[[Note]]" },
			IMAGE,
			RESOURCE_LINK,
		]);
	});

	test("empty message produces no text block in agentContent or displayContent", async () => {
		const result = await run({ message: "", images: [IMAGE] });

		expect(result.agentContent).toEqual([IMAGE]);
		expect(result.displayContent).toEqual([IMAGE]);
	});

	test("convertToWsl converts embedded resource uri to /mnt/<drive> form", async () => {
		const result = await run(
			{
				message: "check @[[Note]]",
				vaultBasePath: "C:/vault",
				convertToWsl: true,
			},
			{ "Note.md": "note body" },
		);

		const [res] = resources(result.agentContent);
		expect(res.resource.uri).toBe("file:///mnt/c/vault/Note.md");
	});

	test("convertToWsl converts XML ref to /mnt/<drive> form", async () => {
		const result = await run(
			{
				message: "check @[[Note]]",
				vaultBasePath: "C:/vault",
				convertToWsl: true,
				supportsEmbeddedContext: false,
			},
			{ "Note.md": "note body" },
		);

		const [text] = texts(result.agentContent);
		expect(text).toContain(
			'<obsidian_mentioned_note ref="/mnt/c/vault/Note.md">',
		);
	});
});

// ============================================================================
// preparePrompt — wikilink expansion
// ============================================================================

describe("preparePrompt / wikilink expansion", () => {
	test("embedded: links produce a sibling <obsidian_note_links> block with ref = resource uri; note block unchanged", async () => {
		const { vaultAccess, wikilinkResolver } = fakeVaultAccess({
			"Note.md": "note body",
		});
		wikilinkResolver.getNoteWikiLinks.mockReturnValue([
			{ linkText: "Other", resolvedPath: "Other.md" },
		]);

		const result = await preparePrompt(
			baseInput({
				message: "check @[[Note]]",
				expandWikilinkContext: true,
				wikilinkResolver,
			}),
			vaultAccess,
			vaultAccess,
		);

		// resource block stays byte-identical to the note on disk
		const [res] = resources(result.agentContent);
		expect(res.resource.text).toBe("note body");
		// sibling text block follows the resource
		expect(result.agentContent[1].type).toBe("text");
		const linkBlock = (result.agentContent[1] as TextPromptContent).text;
		expect(linkBlock).toContain(
			'<obsidian_note_links ref="file:///vault/Note.md">',
		);
		expect(linkBlock).toContain('path="/vault/Other.md"');
		expect(linkBlock).toContain('resolved="true"');
	});

	test("XML: sibling links block uses the absolute path as ref", async () => {
		const { vaultAccess, wikilinkResolver } = fakeVaultAccess({
			"Note.md": "note body",
		});
		wikilinkResolver.getNoteWikiLinks.mockReturnValue([
			{ linkText: "Other", resolvedPath: "Other.md" },
		]);

		const result = await preparePrompt(
			baseInput({
				message: "check @[[Note]]",
				supportsEmbeddedContext: false,
				expandWikilinkContext: true,
				wikilinkResolver,
			}),
			vaultAccess,
			vaultAccess,
		);

		const [text] = texts(result.agentContent);
		expect(text).toContain('<obsidian_note_links ref="/vault/Note.md">');
		// mentioned-note block itself is unchanged
		expect(text).toContain(
			'<obsidian_mentioned_note ref="/vault/Note.md">\nnote body\n</obsidian_mentioned_note>',
		);
	});

	test("no links → no <obsidian_note_links> block at all", async () => {
		const { vaultAccess, wikilinkResolver } = fakeVaultAccess({
			"Note.md": "note body",
		});
		wikilinkResolver.getNoteWikiLinks.mockReturnValue([]);

		const result = await preparePrompt(
			baseInput({
				message: "check @[[Note]]",
				expandWikilinkContext: true,
				wikilinkResolver,
			}),
			vaultAccess,
			vaultAccess,
		);

		expect(
			texts(result.agentContent).some((t) =>
				t.includes("<obsidian_note_links"),
			),
		).toBe(false);
		expect(result.agentContent.map((c) => c.type)).toEqual([
			"resource",
			"text",
		]);
	});

	test("expandWikilinkContext=false (default) never calls the resolver", async () => {
		const { vaultAccess, wikilinkResolver } = fakeVaultAccess({
			"Note.md": "note body",
		});

		await preparePrompt(
			baseInput({ message: "check @[[Note]]", wikilinkResolver }),
			vaultAccess,
			vaultAccess,
		);

		expect(wikilinkResolver.getNoteWikiLinks).not.toHaveBeenCalled();
	});

	test("selection scoping: resolver receives the 0-based line range of the active note selection", async () => {
		const { vaultAccess, wikilinkResolver } = fakeVaultAccess({
			"Active.md": FIVE_LINES,
		});

		await preparePrompt(
			baseInput({
				activeNote: activeNote({ selection: SELECTION }),
				expandWikilinkContext: true,
				wikilinkResolver,
			}),
			vaultAccess,
			vaultAccess,
		);

		expect(wikilinkResolver.getNoteWikiLinks).toHaveBeenCalledWith(
			"Active.md",
			{ fromLine: 1, toLine: 3 },
		);
	});
});

// ============================================================================
// sendPreparedPrompt
// ============================================================================

describe("sendPreparedPrompt", () => {
	const AGENT_CONTENT: PromptContent[] = [{ type: "text", text: "hi" }];
	const DISPLAY_CONTENT: PromptContent[] = [{ type: "text", text: "hi" }];

	function sendInput(
		authMethods: AuthenticationMethod[] = [],
	): SendPreparedPromptInput {
		return {
			sessionId: "sess-1",
			agentContent: AGENT_CONTENT,
			displayContent: DISPLAY_CONTENT,
			authMethods,
		};
	}

	const method = (id: string): AuthenticationMethod => ({ id, name: id });

	function makeClient(mocks: {
		sendPrompt?: ReturnType<typeof vi.fn>;
		authenticate?: ReturnType<typeof vi.fn>;
	}) {
		const client = {
			sendPrompt: mocks.sendPrompt ?? vi.fn(async () => {}),
			authenticate: mocks.authenticate ?? vi.fn(async () => true),
		};
		return { client: client as unknown as AcpClient, mocks: client };
	}

	const AUTH_ERROR = { code: -32000, message: "Authentication required" };

	test("successful send returns success with content passed through", async () => {
		const { client, mocks } = makeClient({});

		const result = await sendPreparedPrompt(sendInput(), client);

		expect(result).toEqual({
			success: true,
			displayContent: DISPLAY_CONTENT,
			agentContent: AGENT_CONTENT,
		});
		expect(mocks.sendPrompt).toHaveBeenCalledWith("sess-1", AGENT_CONTENT);
	});

	test("'empty response text' internal error is treated as success", async () => {
		const { client } = makeClient({
			sendPrompt: vi.fn(async () => {
				// JSON-RPC errors arrive as plain objects, not Error instances —
				// the duck-typed shape is exactly what error-utils must handle.
				// eslint-disable-next-line @typescript-eslint/only-throw-error
				throw { code: -32603, message: "empty response text" };
			}),
		});

		const result = await sendPreparedPrompt(sendInput(), client);

		expect(result).toEqual({
			success: true,
			displayContent: DISPLAY_CONTENT,
			agentContent: AGENT_CONTENT,
		});
	});

	test("-32000 with a single auth method authenticates and retries successfully", async () => {
		const sendPrompt = vi
			.fn()
			.mockRejectedValueOnce(AUTH_ERROR)
			.mockResolvedValueOnce(undefined);
		const authenticate = vi.fn(async () => true);
		const { client } = makeClient({ sendPrompt, authenticate });

		const result = await sendPreparedPrompt(
			sendInput([method("api-key")]),
			client,
		);

		expect(authenticate).toHaveBeenCalledWith("api-key");
		expect(sendPrompt).toHaveBeenCalledTimes(2);
		expect(result.success).toBe(true);
		expect(result.retriedSuccessfully).toBe(true);
	});

	test("-32000 with multiple auth methods returns requiresAuth without authenticating", async () => {
		const sendPrompt = vi.fn().mockRejectedValue(AUTH_ERROR);
		const authenticate = vi.fn(async () => true);
		const { client } = makeClient({ sendPrompt, authenticate });

		const result = await sendPreparedPrompt(
			sendInput([method("api-key"), method("oauth")]),
			client,
		);

		expect(authenticate).not.toHaveBeenCalled();
		expect(result.success).toBe(false);
		expect(result.requiresAuth).toBe(true);
		expect(result.error?.code).toBe(-32000);
	});

	test("-32000 with single method but authenticate() false falls back to requiresAuth", async () => {
		const sendPrompt = vi.fn().mockRejectedValue(AUTH_ERROR);
		const authenticate = vi.fn(async () => false);
		const { client } = makeClient({ sendPrompt, authenticate });

		const result = await sendPreparedPrompt(
			sendInput([method("api-key")]),
			client,
		);

		expect(authenticate).toHaveBeenCalledWith("api-key");
		expect(sendPrompt).toHaveBeenCalledTimes(1); // no retry after failed auth
		expect(result.success).toBe(false);
		expect(result.requiresAuth).toBe(true);
	});

	test("-32000 retry send failure returns a plain error result (no requiresAuth)", async () => {
		const retryError = { code: -32603, message: "retry failed" };
		const sendPrompt = vi
			.fn()
			.mockRejectedValueOnce(AUTH_ERROR)
			.mockRejectedValueOnce(retryError);
		const authenticate = vi.fn(async () => true);
		const { client } = makeClient({ sendPrompt, authenticate });

		const result = await sendPreparedPrompt(
			sendInput([method("api-key")]),
			client,
		);

		expect(result.success).toBe(false);
		expect(result.requiresAuth).toBeUndefined();
		expect(result.error?.message).toBe("retry failed");
	});

	test("-32000 with no auth methods returns a plain error (no requiresAuth)", async () => {
		const sendPrompt = vi.fn().mockRejectedValue(AUTH_ERROR);
		const authenticate = vi.fn(async () => true);
		const { client } = makeClient({ sendPrompt, authenticate });

		const result = await sendPreparedPrompt(sendInput([]), client);

		expect(authenticate).not.toHaveBeenCalled();
		expect(result.success).toBe(false);
		expect(result.requiresAuth).toBeUndefined();
		expect(result.error?.code).toBe(-32000);
	});

	test("other errors return a toAcpError result — data.details preferred over message", async () => {
		const sendPrompt = vi.fn().mockRejectedValue({
			code: -32603,
			message: "generic failure",
			data: { details: "detailed reason" },
		});
		const { client } = makeClient({ sendPrompt });

		const result = await sendPreparedPrompt(sendInput(), client);

		expect(result.success).toBe(false);
		expect(result.requiresAuth).toBeUndefined();
		expect(result.error?.code).toBe(-32603);
		expect(result.error?.message).toBe("detailed reason");
		expect(result.error?.title).toBe("Internal Error");
		expect(result.error?.sessionId).toBe("sess-1");
	});
});
