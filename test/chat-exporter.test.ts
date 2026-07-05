import { describe, it, expect } from "vitest";
import { ChatExporter } from "../src/services/chat-exporter";
import type { MessageContent } from "../src/types/chat";

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
