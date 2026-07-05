import { describe, it, expect } from "vitest";
import {
	mergeToolCallContent,
	type ToolCallMessageContent,
} from "../src/services/message-state";
import type { ToolCallContent } from "../src/types/chat";

// mergeToolCallContent folds a tool_call_update into an existing tool call.
// Agents re-send diffs and text "content" as the tool's latest full state, so
// those kinds must be REPLACED (not appended) to avoid duplicated/growing
// panels. Terminals are referenced by id and stay append-only.

function toolCall(content: ToolCallContent[]): ToolCallMessageContent {
	return {
		type: "tool_call",
		toolCallId: "t1",
		status: "in_progress",
		content,
	};
}

describe("mergeToolCallContent — content de-duplication", () => {
	it("replaces re-sent text content instead of appending", () => {
		const existing = toolCall([{ type: "content", text: "line 1" }]);
		const update = toolCall([{ type: "content", text: "line 1\nline 2" }]);
		expect(mergeToolCallContent(existing, update).content).toEqual([
			{ type: "content", text: "line 1\nline 2" },
		]);
	});

	it("replaces re-sent diffs (existing behavior preserved)", () => {
		const existing = toolCall([
			{ type: "diff", path: "a.ts", newText: "v1" },
		]);
		const update = toolCall([
			{ type: "diff", path: "a.ts", newText: "v2" },
		]);
		expect(mergeToolCallContent(existing, update).content).toEqual([
			{ type: "diff", path: "a.ts", newText: "v2" },
		]);
	});

	it("replaces both diff and content when both are re-sent", () => {
		const existing = toolCall([
			{ type: "content", text: "old" },
			{ type: "diff", path: "a.ts", newText: "v1" },
		]);
		const update = toolCall([
			{ type: "content", text: "new" },
			{ type: "diff", path: "a.ts", newText: "v2" },
		]);
		expect(mergeToolCallContent(existing, update).content).toEqual([
			{ type: "content", text: "new" },
			{ type: "diff", path: "a.ts", newText: "v2" },
		]);
	});

	it("keeps terminals append-only (referenced by id, not replaced)", () => {
		const existing = toolCall([{ type: "terminal", terminalId: "x" }]);
		const update = toolCall([{ type: "content", text: "out" }]);
		expect(mergeToolCallContent(existing, update).content).toEqual([
			{ type: "terminal", terminalId: "x" },
			{ type: "content", text: "out" },
		]);
	});

	it("adds content when the tool call had none", () => {
		const existing = toolCall([]);
		const update = toolCall([{ type: "content", text: "out" }]);
		expect(mergeToolCallContent(existing, update).content).toEqual([
			{ type: "content", text: "out" },
		]);
	});

	it("preserves existing content when the update carries no content array", () => {
		const existing = toolCall([{ type: "content", text: "keep" }]);
		const update: ToolCallMessageContent = {
			type: "tool_call",
			toolCallId: "t1",
			status: "completed",
		};
		expect(mergeToolCallContent(existing, update).content).toEqual([
			{ type: "content", text: "keep" },
		]);
	});
});
