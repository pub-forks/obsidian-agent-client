import { describe, it, expect } from "vitest";
import { ChatExporter } from "../src/services/chat-exporter";
import type { ChatMessage, MessageContent } from "../src/types/chat";
import {
	createFakePlugin,
	type FakeExportSettings,
	type FakePluginHarness,
} from "./helpers/fake-plugin";

// convertToolCallToMarkdown is private; we exercise it directly to guard how
// tool text output is fenced. The method only formats the content object (no
// plugin/vault access) and the constructor only grabs a logger, so a bare
// instance suffices.
type ToolCallContent = Extract<MessageContent, { type: "tool_call" }>;

function convert(content: ToolCallContent): string {
	const exporter = new ChatExporter(
		{} as unknown as ConstructorParameters<typeof ChatExporter>[0],
	);
	return (
		exporter as unknown as {
			convertToolCallToMarkdown(c: ToolCallContent): string;
		}
	).convertToolCallToMarkdown(content);
}

function toolCall(text: string): ToolCallContent {
	return {
		type: "tool_call",
		toolCallId: "t1",
		status: "completed",
		content: [{ type: "content", text }],
	};
}

describe("ChatExporter — tool text output fencing", () => {
	it("wraps plain text output in a triple-backtick fence", () => {
		expect(convert(toolCall("hello\nworld"))).toContain(
			"```\nhello\nworld\n```",
		);
	});

	it("uses a longer fence when the output itself contains a code fence", () => {
		// The output contains a 3-backtick run, so the wrapper must use >= 4
		// or the embedded fence would close the block and corrupt the export.
		expect(convert(toolCall("before\n```\ncode\n```\nafter"))).toContain(
			"````\nbefore\n```\ncode\n```\nafter\n````",
		);
	});
});

// ---------------------------------------------------------------------------
// Characterization tests for the full export pipeline (Phase 0, PR0.6).
// These freeze CURRENT behavior; suspicious behavior is marked
// "(current behavior)" and any change is a maintainer decision.
// ---------------------------------------------------------------------------

// Fixed local timestamp: 2026-01-05 09:07:03 → {date}=20260105, {time}=090703
const TS = new Date(2026, 0, 5, 9, 7, 3);
const BASE_NAME = "agent_client_20260105_090703";
const BASE_PATH = `Agent Client/${BASE_NAME}.md`;

let messageId = 0;
function message(
	role: ChatMessage["role"],
	content: MessageContent[],
	timestamp: Date = TS,
): ChatMessage {
	return { id: `m-${++messageId}`, role, content, timestamp };
}

function setup(overrides: Partial<FakeExportSettings> = {}) {
	const harness = createFakePlugin(overrides);
	const exporter = new ChatExporter(
		harness.plugin as ConstructorParameters<typeof ChatExporter>[0],
	);
	return { exporter, ...harness };
}

/** Export a single assistant message and return the written markdown. */
async function exportContent(
	content: MessageContent[],
	overrides: Partial<FakeExportSettings> = {},
	role: ChatMessage["role"] = "assistant",
): Promise<{ path: string; text: string } & FakePluginHarness> {
	const h = createFakePlugin(overrides);
	const exporter = new ChatExporter(
		h.plugin as ConstructorParameters<typeof ChatExporter>[0],
	);
	const path = await exporter.exportToMarkdown(
		[message(role, content)],
		"Claude Code",
		"claude-code",
		"sess-1",
		TS,
		false,
	);
	return { ...h, path, text: h.readText(path) };
}

describe("ChatExporter — filename generation", () => {
	it("uses the default template with local date/time of the first message timestamp", async () => {
		const { exporter, create } = setup();
		const path = await exporter.exportToMarkdown(
			[message("user", [{ type: "text", text: "hi" }])],
			"Claude Code",
			"claude-code",
			"sess-1",
			new Date(2020, 5, 1), // sessionCreatedAt ignored when messages exist
			false,
		);
		expect(path).toBe(BASE_PATH);
		expect(create).toHaveBeenCalledWith(BASE_PATH, expect.any(String));
	});

	it("replaces {date} and {time} placeholders only once (current behavior)", async () => {
		// String.prototype.replace with a string pattern replaces the first
		// occurrence only; repeated placeholders survive literally.
		const { exporter } = setup({
			filenameTemplate: "{date}_{time}_{date}_{time}",
		});
		const path = await exporter.exportToMarkdown(
			[message("user", [{ type: "text", text: "hi" }])],
			"Claude Code",
			"claude-code",
			"sess-1",
			TS,
			false,
		);
		expect(path).toBe("Agent Client/20260105_090703_{date}_{time}.md");
	});

	it("falls back to the default template when filenameTemplate is empty", async () => {
		const { exporter } = setup({ filenameTemplate: "" });
		const path = await exporter.exportToMarkdown(
			[message("user", [{ type: "text", text: "hi" }])],
			"Claude Code",
			"claude-code",
			"sess-1",
			TS,
			false,
		);
		expect(path).toBe(BASE_PATH);
	});

	it("falls back to session creation time when there are no messages", async () => {
		const { exporter } = setup();
		const path = await exporter.exportToMarkdown(
			[],
			"Claude Code",
			"claude-code",
			"sess-1",
			new Date(2025, 11, 31, 23, 59, 58),
			false,
		);
		expect(path).toBe("Agent Client/agent_client_20251231_235958.md");
	});

	it("creates the export folder when missing and skips creation when it exists", async () => {
		const first = await exportContent([{ type: "text", text: "hi" }]);
		expect(first.createFolder).toHaveBeenCalledWith("Agent Client");

		const h = setup();
		h.folders.add("Agent Client");
		await h.exporter.exportToMarkdown(
			[message("user", [{ type: "text", text: "hi" }])],
			"Claude Code",
			"claude-code",
			"sess-1",
			TS,
			false,
		);
		expect(h.createFolder).not.toHaveBeenCalled();
	});

	it("falls back to 'Agent Client' when defaultFolder is empty", async () => {
		const { path } = await exportContent([{ type: "text", text: "hi" }], {
			defaultFolder: "",
		});
		expect(path).toBe(BASE_PATH);
	});
});

describe("ChatExporter — frontmatter", () => {
	it("writes created (local time, no timezone suffix), agent identity, session_id and tags", async () => {
		const { text } = await exportContent([{ type: "text", text: "hi" }]);
		expect(text).toMatch(/^created: 2026-01-05T09:07:03$/m);
		expect(text).toContain("agentDisplayName: Claude Code");
		expect(text).toContain("agentId: claude-code");
		expect(text).toContain("session_id: sess-1");
		expect(text).toContain("tags: [agent-client]");
	});

	it("omits the tags line entirely when frontmatterTag is blank", async () => {
		const { text } = await exportContent([{ type: "text", text: "hi" }], {
			frontmatterTag: "  ",
		});
		expect(text).not.toContain("tags:");
		// session_id line is directly followed by the closing fence
		expect(text).toMatch(/session_id: sess-1\n---/);
	});
});

describe("ChatExporter — export path resolution", () => {
	function exportWith(h: ReturnType<typeof setup>, sessionId: string) {
		return h.exporter.exportToMarkdown(
			[message("user", [{ type: "text", text: "hi" }])],
			"Claude Code",
			"claude-code",
			sessionId,
			TS,
			false,
		);
	}

	it("creates a new file at the base path when it is free", async () => {
		const h = setup();
		const path = await exportWith(h, "sess-1");
		expect(path).toBe(BASE_PATH);
		expect(h.create).toHaveBeenCalledTimes(1);
		expect(h.modify).not.toHaveBeenCalled();
	});

	it("overwrites the base file when its frontmatter session_id matches", async () => {
		const h = setup();
		h.files.set(BASE_PATH, "---\nsession_id: sess-1\n---\nold");
		const path = await exportWith(h, "sess-1");
		expect(path).toBe(BASE_PATH);
		expect(h.modify).toHaveBeenCalledTimes(1);
		expect(h.create).not.toHaveBeenCalled();
		expect(h.readText(BASE_PATH)).not.toContain("old");
	});

	it("moves to a _2 suffix when the base file belongs to another session", async () => {
		const h = setup();
		h.files.set(BASE_PATH, "---\nsession_id: other\n---\nx");
		const path = await exportWith(h, "sess-1");
		expect(path).toBe(`Agent Client/${BASE_NAME}_2.md`);
		expect(h.create).toHaveBeenCalledTimes(1);
	});

	it("overwrites the _2 file when it holds this session's id", async () => {
		const h = setup();
		h.files.set(BASE_PATH, "---\nsession_id: other\n---\nx");
		h.files.set(
			`Agent Client/${BASE_NAME}_2.md`,
			"---\nsession_id: sess-1\n---\nx",
		);
		const path = await exportWith(h, "sess-1");
		expect(path).toBe(`Agent Client/${BASE_NAME}_2.md`);
		expect(h.modify).toHaveBeenCalledTimes(1);
		expect(h.create).not.toHaveBeenCalled();
	});

	it("treats an existing file without session_id frontmatter as another session", async () => {
		const h = setup();
		h.files.set(BASE_PATH, "no frontmatter here");
		const path = await exportWith(h, "sess-1");
		expect(path).toBe(`Agent Client/${BASE_NAME}_2.md`);
	});
});

describe("ChatExporter — message body conversion", () => {
	it("renders the agent title, role headings and message separators", async () => {
		const { text } = await exportContent(
			[{ type: "text", text: "hello" }],
			{},
			"user",
		);
		expect(text).toContain("# Claude Code\n\n");
		expect(text).toMatch(/## .+ - User\n\nhello\n\n\n---\n/);
	});

	it("labels assistant messages as Assistant", async () => {
		const { text } = await exportContent([{ type: "text", text: "yo" }]);
		expect(text).toMatch(/## .+ - Assistant\n/);
	});

	it("prefixes text_with_context with @[[name]]:from-to when a selection exists", async () => {
		const { text } = await exportContent([
			{
				type: "text_with_context",
				text: "question",
				autoMentionContext: {
					noteName: "Note",
					notePath: "Note.md",
					selection: { fromLine: 3, toLine: 7 },
				},
			},
		]);
		expect(text).toContain("@[[Note]]:3-7\nquestion\n\n");
	});

	it("prefixes text_with_context with @[[name]] when there is no selection", async () => {
		const { text } = await exportContent([
			{
				type: "text_with_context",
				text: "question",
				autoMentionContext: {
					noteName: "Note",
					notePath: "Note.md",
				},
			},
		]);
		expect(text).toContain("@[[Note]]\nquestion\n\n");
	});

	it("renders text_with_context without autoMentionContext as bare text", async () => {
		const { text } = await exportContent([
			{ type: "text_with_context", text: "bare" },
		]);
		expect(text).toContain("\n\nbare\n\n");
		expect(text).not.toContain("@[[");
	});

	it("renders agent_thought as a collapsed Thinking callout with quoted lines", async () => {
		const { text } = await exportContent([
			{ type: "agent_thought", text: "line1\nline2" },
		]);
		expect(text).toContain("> [!info]- Thinking\n> line1\n> line2\n\n");
	});

	it("renders tool_call title, locations and status", async () => {
		const { text } = await exportContent([
			{
				type: "tool_call",
				toolCallId: "t1",
				title: "Edit file",
				status: "completed",
				locations: [{ path: "a.md", line: 3 }, { path: "b.md" }],
			},
		]);
		expect(text).toContain("### 🔧 Edit file\n\n");
		expect(text).toContain("**Locations**: `a.md:3`, `b.md`\n\n");
		expect(text).toContain("**Status**: completed\n\n");
	});

	it("falls back to 'Tool' when a tool_call has no title", async () => {
		const { text } = await exportContent([
			{ type: "tool_call", toolCallId: "t1", status: "pending" },
		]);
		expect(text).toContain("### 🔧 Tool\n\n");
	});

	it("exports tool_call diffs and fenced text output but drops terminal content (current behavior)", async () => {
		const { text } = await exportContent([
			{
				type: "tool_call",
				toolCallId: "t1",
				title: "Run",
				status: "completed",
				content: [
					{ type: "diff", path: "a.md", oldText: "x", newText: "y" },
					{ type: "terminal", terminalId: "term-1234" },
					{ type: "content", text: "tool output" },
				],
			},
		]);
		expect(text).toContain("**File**: `a.md`\n\n");
		expect(text).toContain("```\ntool output\n```\n\n");
		expect(text).not.toContain("term-1234");
	});

	it("renders diffs as a naive full replace: all old lines '-', all new lines '+' (current behavior)", async () => {
		const { text } = await exportContent([
			{
				type: "tool_call",
				toolCallId: "t1",
				status: "completed",
				content: [
					{
						type: "diff",
						path: "a.md",
						oldText: "keep\nold",
						newText: "keep\nnew",
					},
				],
			},
		]);
		// Even the unchanged "keep" line appears as removed + re-added.
		expect(text).toContain(
			"```diff\n- keep\n- old\n+ keep\n+ new\n```\n\n",
		);
	});

	it("renders an empty-string oldText diff as a new file — added lines only (current behavior)", async () => {
		// QUIRK-7: oldText === "" (replacing an empty file) is displayed as a
		// new file. Changing this is a maintainer decision.
		const { text } = await exportContent([
			{
				type: "tool_call",
				toolCallId: "t1",
				status: "completed",
				content: [
					{
						type: "diff",
						path: "new.md",
						oldText: "",
						newText: "a\nb",
					},
				],
			},
		]);
		expect(text).toContain("```diff\n+ a\n+ b\n```\n\n");
		expect(text).not.toMatch(/^- /m);
	});

	it("renders a null/undefined oldText diff as a new file", async () => {
		const { text } = await exportContent([
			{
				type: "tool_call",
				toolCallId: "t1",
				status: "completed",
				content: [
					{
						type: "diff",
						path: "new.md",
						oldText: null,
						newText: "only",
					},
				],
			},
		]);
		expect(text).toContain("```diff\n+ only\n```\n\n");
	});

	it("renders plan entries as a callout with status emoji (✅/🔄/⏳)", async () => {
		const { text } = await exportContent([
			{
				type: "plan",
				entries: [
					{ content: "done", status: "completed", priority: "high" },
					{
						content: "doing",
						status: "in_progress",
						priority: "medium",
					},
					{ content: "todo", status: "pending", priority: "low" },
				],
			},
		]);
		expect(text).toContain(
			"> [!plan] Plan\n> ✅ done\n> 🔄 doing\n> ⏳ todo\n",
		);
	});

	it("renders resource_link as a markdown link", async () => {
		const { text } = await exportContent([
			{
				type: "resource_link",
				uri: "file:///vault/doc.pdf",
				name: "doc.pdf",
			},
		]);
		expect(text).toContain("[doc.pdf](file:///vault/doc.pdf)\n\n");
	});

	it("renders permission_request with Requested/Cancelled status", async () => {
		const { text } = await exportContent([
			{
				type: "permission_request",
				toolCall: { toolCallId: "t1", title: "Write file" },
				options: [],
			},
			{
				type: "permission_request",
				toolCall: { toolCallId: "t2", title: "Delete file" },
				options: [],
				isCancelled: true,
			},
		]);
		expect(text).toContain("### ⚠️ Permission: Write file (Requested)");
		expect(text).toContain("### ⚠️ Permission: Delete file (Cancelled)");
	});

	it("renders top-level terminal content as a heading with the first 8 chars of the id", async () => {
		const { text } = await exportContent([
			{ type: "terminal", terminalId: "abcdefgh-1234" },
		]);
		expect(text).toContain("### 🖥️ Terminal: abcdefgh\n\n");
	});

	it("renders unknown content types as empty string (current behavior)", async () => {
		const { text } = await exportContent([
			{ type: "bogus" } as unknown as MessageContent,
		]);
		expect(text).toMatch(/- Assistant\n\n\n---\n/);
	});
});

describe("ChatExporter — image export", () => {
	// "aGk=" is base64 for "hi" (valid input for atob)
	const image: MessageContent = {
		type: "image",
		data: "aGk=",
		mimeType: "image/png",
	};

	it("skips images when includeImages is false", async () => {
		const { text, createBinary } = await exportContent([image], {
			includeImages: false,
		});
		expect(text).not.toContain("![");
		expect(createBinary).not.toHaveBeenCalled();
	});

	it("uses the external uri as-is when present", async () => {
		const { text, createBinary } = await exportContent([
			{ ...image, uri: "https://example.com/pic.png" },
		]);
		expect(text).toContain("![Image](https://example.com/pic.png)\n\n");
		expect(createBinary).not.toHaveBeenCalled();
	});

	it("embeds a data URI in base64 mode", async () => {
		const { text, createBinary } = await exportContent([image], {
			imageLocation: "base64",
		});
		expect(text).toContain("![Image](data:image/png;base64,aGk=)\n\n");
		expect(createBinary).not.toHaveBeenCalled();
	});

	it("custom mode writes the image to the custom folder and embeds by filename", async () => {
		const { text, createBinary, createFolder } = await exportContent(
			[image],
			{ imageLocation: "custom", imageCustomFolder: "Attachments" },
		);
		expect(createFolder).toHaveBeenCalledWith("Attachments");
		expect(createBinary).toHaveBeenCalledWith(
			`Attachments/${BASE_NAME}_001.png`,
			expect.any(ArrayBuffer),
		);
		expect(text).toContain(`![[${BASE_NAME}_001.png]]\n\n`);
	});

	it("custom mode skips writing when the image file already exists (dedupe)", async () => {
		const h = createFakePlugin({
			imageLocation: "custom",
			imageCustomFolder: "Attachments",
		});
		h.files.set(`Attachments/${BASE_NAME}_001.png`, new ArrayBuffer(1));
		const exporter = new ChatExporter(
			h.plugin as ConstructorParameters<typeof ChatExporter>[0],
		);
		const path = await exporter.exportToMarkdown(
			[message("assistant", [image])],
			"Claude Code",
			"claude-code",
			"sess-1",
			TS,
			false,
		);
		expect(h.createBinary).not.toHaveBeenCalled();
		expect(h.readText(path)).toContain(`![[${BASE_NAME}_001.png]]\n\n`);
	});

	it("custom mode numbers images sequentially per export", async () => {
		const { createBinary } = await exportContent([image, image], {
			imageLocation: "custom",
			imageCustomFolder: "Attachments",
		});
		expect(createBinary).toHaveBeenNthCalledWith(
			1,
			`Attachments/${BASE_NAME}_001.png`,
			expect.any(ArrayBuffer),
		);
		expect(createBinary).toHaveBeenNthCalledWith(
			2,
			`Attachments/${BASE_NAME}_002.png`,
			expect.any(ArrayBuffer),
		);
	});

	it("obsidian mode saves via getAvailablePathForAttachment", async () => {
		const { text, createBinary, getAvailablePathForAttachment } =
			await exportContent([image], { imageLocation: "obsidian" });
		expect(getAvailablePathForAttachment).toHaveBeenCalledWith(
			`${BASE_NAME}_001.png`,
			BASE_PATH,
		);
		expect(createBinary).toHaveBeenCalledWith(
			`${BASE_NAME}_001.png`,
			expect.any(ArrayBuffer),
		);
		expect(text).toContain(`![[${BASE_NAME}_001.png]]\n\n`);
	});

	it("obsidian mode treats a suffixed available path as an existing file: skips the write and strips the suffix (current behavior)", async () => {
		const h = createFakePlugin({ imageLocation: "obsidian" });
		h.getAvailablePathForAttachment.mockResolvedValue(
			`attachments/${BASE_NAME}_001 1.png`,
		);
		const exporter = new ChatExporter(
			h.plugin as ConstructorParameters<typeof ChatExporter>[0],
		);
		const path = await exporter.exportToMarkdown(
			[message("assistant", [image])],
			"Claude Code",
			"claude-code",
			"sess-1",
			TS,
			false,
		);
		expect(h.createBinary).not.toHaveBeenCalled();
		expect(h.readText(path)).toContain(`![[${BASE_NAME}_001.png]]\n\n`);
	});

	it("falls back to base64 embedding when the attachment save fails", async () => {
		const h = createFakePlugin({ imageLocation: "obsidian" });
		h.getAvailablePathForAttachment.mockRejectedValue(
			new Error("no attachment folder"),
		);
		const exporter = new ChatExporter(
			h.plugin as ConstructorParameters<typeof ChatExporter>[0],
		);
		const path = await exporter.exportToMarkdown(
			[message("assistant", [image])],
			"Claude Code",
			"claude-code",
			"sess-1",
			TS,
			false,
		);
		expect(h.readText(path)).toContain(
			"![Image](data:image/png;base64,aGk=)\n\n",
		);
	});
});

describe("ChatExporter — openFile behavior", () => {
	it("opens the exported file when openFile is true", async () => {
		const h = setup();
		await h.exporter.exportToMarkdown(
			[message("user", [{ type: "text", text: "hi" }])],
			"Claude Code",
			"claude-code",
			"sess-1",
			TS,
			true,
		);
		expect(h.getLeaf).toHaveBeenCalledWith(false);
		expect(h.openFile).toHaveBeenCalledTimes(1);
		expect(h.openFile.mock.calls[0][0]).toMatchObject({
			path: BASE_PATH,
		});
	});

	it("does not touch the workspace when openFile is false", async () => {
		const { getLeaf, openFile } = await exportContent([
			{ type: "text", text: "hi" },
		]);
		expect(getLeaf).not.toHaveBeenCalled();
		expect(openFile).not.toHaveBeenCalled();
	});
});
