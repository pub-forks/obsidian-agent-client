import { describe, it, expect } from "vitest";
import {
	applySingleUpdate,
	applyUpsertToolCall,
	applyUpdateLastMessage,
	applyUpdateUserMessage,
	findActivePermission,
	mergeToolCallContent,
	rebuildToolCallIndex,
	selectOption,
	type ToolCallMessageContent,
} from "../src/services/message-state";
import type {
	ChatMessage,
	MessageContent,
	PermissionOption,
	Role,
	ToolCallContent,
	ToolCallStatus,
} from "../src/types/chat";
import type { SessionUpdate } from "../src/types/session";

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

// ============================================================================
// Shared builders
// ============================================================================

function msg(role: Role, content: MessageContent[]): ChatMessage {
	return {
		id: crypto.randomUUID(),
		role,
		content,
		timestamp: new Date(),
	};
}

function toolCallBlock(
	toolCallId: string,
	overrides: Partial<ToolCallMessageContent> = {},
): ToolCallMessageContent {
	return {
		type: "tool_call",
		toolCallId,
		status: "in_progress",
		...overrides,
	};
}

function permOptions(): PermissionOption[] {
	return [
		{ optionId: "allow", name: "Allow", kind: "allow_once" },
		{ optionId: "reject", name: "Reject", kind: "reject_once" },
	];
}

// ============================================================================
// mergeToolCallContent — field-level merge (INV-5)
// ============================================================================

describe("mergeToolCallContent — field merge (INV-5)", () => {
	it("keeps existing terminals when a re-sent diff replaces old diffs", () => {
		const existing = toolCall([
			{ type: "terminal", terminalId: "term-1" },
			{ type: "diff", path: "a.ts", newText: "v1" },
		]);
		const update = toolCall([{ type: "diff", path: "a.ts", newText: "v2" }]);
		expect(mergeToolCallContent(existing, update).content).toEqual([
			{ type: "terminal", terminalId: "term-1" },
			{ type: "diff", path: "a.ts", newText: "v2" },
		]);
	});

	it("appends a terminal-only update to existing content (accumulation)", () => {
		const existing = toolCall([{ type: "content", text: "out" }]);
		const update = toolCall([{ type: "terminal", terminalId: "term-1" }]);
		expect(mergeToolCallContent(existing, update).content).toEqual([
			{ type: "content", text: "out" },
			{ type: "terminal", terminalId: "term-1" },
		]);
	});

	it("keeps existing rawInput when the update's rawInput is undefined", () => {
		const existing = toolCallBlock("t1", { rawInput: { cmd: "ls" } });
		const update = toolCallBlock("t1");
		expect(mergeToolCallContent(existing, update).rawInput).toEqual({
			cmd: "ls",
		});
	});

	it("keeps existing rawInput when the update's rawInput is an empty object", () => {
		const existing = toolCallBlock("t1", { rawInput: { cmd: "ls" } });
		const update = toolCallBlock("t1", { rawInput: {} });
		expect(mergeToolCallContent(existing, update).rawInput).toEqual({
			cmd: "ls",
		});
	});

	it("replaces rawInput when the update's rawInput is a non-empty object", () => {
		const existing = toolCallBlock("t1", { rawInput: { cmd: "ls" } });
		const update = toolCallBlock("t1", { rawInput: { cmd: "cat" } });
		expect(mergeToolCallContent(existing, update).rawInput).toEqual({
			cmd: "cat",
		});
	});

	it("replaces permissionRequest wholesale when the update defines one", () => {
		const existing = toolCallBlock("t1", {
			permissionRequest: {
				requestId: "r1",
				options: permOptions(),
				isActive: true,
			},
		});
		const update = toolCallBlock("t1", {
			permissionRequest: {
				requestId: "r1",
				options: permOptions(),
				selectedOptionId: "allow",
				isActive: false,
			},
		});
		expect(mergeToolCallContent(existing, update).permissionRequest).toBe(
			update.permissionRequest,
		);
	});

	it("keeps title/kind/locations when the update leaves them undefined", () => {
		const existing = toolCallBlock("t1", {
			title: "Read file",
			kind: "read",
			locations: [{ path: "a.ts", line: 3 }],
		});
		const update = toolCallBlock("t1", { status: "completed" });
		const merged = mergeToolCallContent(existing, update);
		expect(merged.title).toBe("Read file");
		expect(merged.kind).toBe("read");
		expect(merged.locations).toEqual([{ path: "a.ts", line: 3 }]);
		expect(merged.status).toBe("completed");
	});

	it("keeps the existing status when the update carries no status", () => {
		// Only reachable via direct calls: applySingleUpdate forces
		// `status: update.status || "pending"` before merging.
		const existing = toolCallBlock("t1", { status: "in_progress" });
		const update = toolCallBlock("t1", {
			status: undefined as unknown as ToolCallStatus,
		});
		expect(mergeToolCallContent(existing, update).status).toBe(
			"in_progress",
		);
	});
});

// ============================================================================
// applySingleUpdate — dispatch
// ============================================================================

describe("applySingleUpdate — dispatch", () => {
	it("agent_message_chunk appends a new assistant message when the last message is from the user", () => {
		const prev = [msg("user", [{ type: "text", text: "hi" }])];
		const result = applySingleUpdate(
			prev,
			{ type: "agent_message_chunk", sessionId: "s1", text: "hello" },
			new Map(),
		);
		expect(result).toHaveLength(2);
		expect(result[1].role).toBe("assistant");
		expect(result[1].content).toEqual([{ type: "text", text: "hello" }]);
	});

	it("agent_message_chunk concatenates into the existing assistant text block (no new block)", () => {
		const prev = [msg("assistant", [{ type: "text", text: "hel" }])];
		const result = applySingleUpdate(
			prev,
			{ type: "agent_message_chunk", sessionId: "s1", text: "lo" },
			new Map(),
		);
		expect(result).toHaveLength(1);
		expect(result[0].content).toEqual([{ type: "text", text: "hello" }]);
	});

	it("agent_thought_chunk concatenates into the existing agent_thought block", () => {
		const prev = [
			msg("assistant", [{ type: "agent_thought", text: "thinking" }]),
		];
		const result = applySingleUpdate(
			prev,
			{ type: "agent_thought_chunk", sessionId: "s1", text: "..." },
			new Map(),
		);
		expect(result).toHaveLength(1);
		expect(result[0].content).toEqual([
			{ type: "agent_thought", text: "thinking..." },
		]);
	});

	it("user_message_chunk concatenates into the last user message (session/load replay)", () => {
		const prev = [msg("user", [{ type: "text", text: "part 1" }])];
		const result = applySingleUpdate(
			prev,
			{ type: "user_message_chunk", sessionId: "s1", text: " part 2" },
			new Map(),
		);
		expect(result).toHaveLength(1);
		expect(result[0].content).toEqual([
			{ type: "text", text: "part 1 part 2" },
		]);
	});

	it("user_message_chunk creates a new user message when the last message is from the assistant", () => {
		const prev = [msg("assistant", [{ type: "text", text: "done" }])];
		const result = applySingleUpdate(
			prev,
			{ type: "user_message_chunk", sessionId: "s1", text: "next" },
			new Map(),
		);
		expect(result).toHaveLength(2);
		expect(result[1].role).toBe("user");
		expect(result[1].content).toEqual([{ type: "text", text: "next" }]);
	});

	it("plan replaces the existing plan block instead of concatenating", () => {
		const prev = [
			msg("assistant", [
				{
					type: "plan",
					entries: [
						{
							content: "step 1",
							status: "pending",
							priority: "high",
						},
					],
				},
			]),
		];
		const result = applySingleUpdate(
			prev,
			{
				type: "plan",
				sessionId: "s1",
				entries: [
					{ content: "step 1", status: "completed", priority: "high" },
					{ content: "step 2", status: "pending", priority: "low" },
				],
			},
			new Map(),
		);
		expect(result).toHaveLength(1);
		expect(result[0].content).toEqual([
			{
				type: "plan",
				entries: [
					{ content: "step 1", status: "completed", priority: "high" },
					{ content: "step 2", status: "pending", priority: "low" },
				],
			},
		]);
	});

	it("tool_call creates a standalone assistant message and registers it in the index", () => {
		const prev = [msg("assistant", [{ type: "text", text: "working" }])];
		const index = new Map<string, number>();
		const result = applySingleUpdate(
			prev,
			{
				type: "tool_call",
				sessionId: "s1",
				toolCallId: "t1",
				status: "pending",
			},
			index,
		);
		// Not appended to the streaming text message — a new message is created.
		expect(result).toHaveLength(2);
		expect(result[0].content).toEqual([{ type: "text", text: "working" }]);
		expect(result[1].role).toBe("assistant");
		expect(result[1].content[0]).toMatchObject({
			type: "tool_call",
			toolCallId: "t1",
		});
		expect(index.get("t1")).toBe(1);
	});

	it("session-level updates return the previous array by reference", () => {
		const prev = [msg("user", [{ type: "text", text: "hi" }])];
		const sessionLevelUpdates: SessionUpdate[] = [
			{ type: "available_commands_update", sessionId: "s1", commands: [] },
			{ type: "current_mode_update", sessionId: "s1", currentModeId: "m" },
			{ type: "config_option_update", sessionId: "s1", configOptions: [] },
			{ type: "usage_update", sessionId: "s1", used: 1, size: 100 },
			{ type: "session_info_update", sessionId: "s1", title: "T" },
			{
				type: "process_error",
				sessionId: "",
				error: {
					type: "spawn_failed",
					agentId: "a1",
					title: "Spawn failed",
					message: "ENOENT",
				},
			},
		];
		for (const update of sessionLevelUpdates) {
			// Reference identity suppresses re-renders (INV-12/INV-15 family).
			expect(applySingleUpdate(prev, update, new Map())).toBe(prev);
		}
	});

	it("tool_call_update without status resets status to 'pending' (current behavior)", () => {
		const prev = [
			msg("assistant", [toolCallBlock("t1", { status: "completed" })]),
		];
		const index = new Map<string, number>([["t1", 0]]);
		const result = applySingleUpdate(
			prev,
			{
				type: "tool_call_update",
				sessionId: "s1",
				toolCallId: "t1",
				content: [{ type: "content", text: "out" }],
			},
			index,
		);
		// applySingleUpdate forces `status: update.status || "pending"`, so an
		// unspecified status overwrites the existing one instead of keeping it.
		expect(result[0].content[0]).toMatchObject({
			type: "tool_call",
			status: "pending",
		});
	});
});

// ============================================================================
// applyUpsertToolCall — index maintenance
// ============================================================================

describe("applyUpsertToolCall — index maintenance", () => {
	it("merges via index hit and replaces only the target message in the array", () => {
		const prev = [
			msg("user", [{ type: "text", text: "hi" }]),
			msg("assistant", [toolCallBlock("t1", { title: "old" })]),
		];
		const index = new Map<string, number>([["t1", 1]]);
		const result = applyUpsertToolCall(
			prev,
			toolCallBlock("t1", { title: "new", status: "completed" }),
			index,
		);
		expect(result).not.toBe(prev);
		expect(result[0]).toBe(prev[0]); // untouched message keeps identity
		expect(result[1]).not.toBe(prev[1]);
		expect(result[1].content[0]).toMatchObject({
			type: "tool_call",
			toolCallId: "t1",
			title: "new",
			status: "completed",
		});
	});

	it("falls back to linear scan and self-repairs a stale index", () => {
		const prev = [
			msg("assistant", [{ type: "text", text: "no tool here" }]),
			msg("assistant", [toolCallBlock("t1", { title: "old" })]),
		];
		const index = new Map<string, number>([["t1", 0]]); // stale: points at msg 0
		const result = applyUpsertToolCall(
			prev,
			toolCallBlock("t1", { title: "new" }),
			index,
		);
		expect(index.get("t1")).toBe(1); // self-repaired
		expect(result[1].content[0]).toMatchObject({
			type: "tool_call",
			toolCallId: "t1",
			title: "new",
		});
	});

	it("appends a new assistant message and registers the index when the tool call is unknown", () => {
		const prev = [msg("user", [{ type: "text", text: "hi" }])];
		const index = new Map<string, number>();
		const result = applyUpsertToolCall(prev, toolCallBlock("t9"), index);
		expect(result).toHaveLength(2);
		expect(result[1].role).toBe("assistant");
		expect(result[1].content).toEqual([toolCallBlock("t9")]);
		expect(index.get("t9")).toBe(1);
	});

	it("keeps the existing status when the update carries no status (direct call path)", () => {
		const prev = [
			msg("assistant", [toolCallBlock("t1", { status: "in_progress" })]),
		];
		const index = new Map<string, number>([["t1", 0]]);
		const result = applyUpsertToolCall(
			prev,
			toolCallBlock("t1", {
				status: undefined as unknown as ToolCallStatus,
			}),
			index,
		);
		expect(result[0].content[0]).toMatchObject({
			type: "tool_call",
			status: "in_progress",
		});
	});
});

// ============================================================================
// rebuildToolCallIndex
// ============================================================================

describe("rebuildToolCallIndex", () => {
	it("clears stale entries and rebuilds from all messages", () => {
		const messages = [
			msg("assistant", [toolCallBlock("t1")]),
			msg("user", [{ type: "text", text: "hi" }]),
			msg("assistant", [
				{ type: "text", text: "and" },
				toolCallBlock("t2"),
			]),
		];
		const index = new Map<string, number>([
			["stale", 99],
			["t1", 5],
		]);
		rebuildToolCallIndex(messages, index);
		expect(index.size).toBe(2);
		expect(index.get("t1")).toBe(0);
		expect(index.get("t2")).toBe(2);
		expect(index.has("stale")).toBe(false);
	});
});

// ============================================================================
// findActivePermission
// ============================================================================

describe("findActivePermission", () => {
	it("returns requestId/toolCallId/options of the active permission", () => {
		const options = permOptions();
		const messages = [
			msg("assistant", [
				toolCallBlock("t1", {
					permissionRequest: {
						requestId: "r1",
						options,
						isActive: true,
					},
				}),
			]),
		];
		expect(findActivePermission(messages)).toEqual({
			requestId: "r1",
			toolCallId: "t1",
			options,
		});
	});

	it("returns the first (oldest) active permission when several are active (current behavior)", () => {
		const messages = [
			msg("assistant", [
				toolCallBlock("t1", {
					permissionRequest: {
						requestId: "r1",
						options: permOptions(),
						isActive: true,
					},
				}),
			]),
			msg("assistant", [
				toolCallBlock("t2", {
					permissionRequest: {
						requestId: "r2",
						options: permOptions(),
						isActive: true,
					},
				}),
			]),
		];
		expect(findActivePermission(messages)?.requestId).toBe("r1");
	});

	it("ignores resolved, cancelled, and inactive permissions", () => {
		const messages = [
			msg("assistant", [
				toolCallBlock("t1", {
					permissionRequest: {
						requestId: "r1",
						options: permOptions(),
						selectedOptionId: "allow",
						isActive: false,
					},
				}),
			]),
			msg("assistant", [
				toolCallBlock("t2", {
					permissionRequest: {
						requestId: "r2",
						options: permOptions(),
						isCancelled: true,
						isActive: false,
					},
				}),
			]),
			msg("assistant", [
				toolCallBlock("t3", {
					permissionRequest: {
						requestId: "r3",
						options: permOptions(),
					},
				}),
			]),
		];
		expect(findActivePermission(messages)).toBeNull();
	});

	it("keys solely on isActive — a resolved permission still flagged active is returned (current behavior)", () => {
		// The pipeline always clears isActive when resolving/cancelling, so this
		// state should not occur in practice; documenting that the function does
		// not double-check selectedOptionId/isCancelled itself.
		const messages = [
			msg("assistant", [
				toolCallBlock("t1", {
					permissionRequest: {
						requestId: "r1",
						options: permOptions(),
						selectedOptionId: "allow",
						isCancelled: true,
						isActive: true,
					},
				}),
			]),
		];
		expect(findActivePermission(messages)?.requestId).toBe("r1");
	});
});

// ============================================================================
// selectOption
// ============================================================================

describe("selectOption", () => {
	const options: PermissionOption[] = [
		{ optionId: "allow-always", name: "Always", kind: "allow_always" },
		{ optionId: "allow-once", name: "Once", kind: "allow_once" },
		{ optionId: "reject-once", name: "No", kind: "reject_once" },
	];

	it("picks the first matching kind in preferredKinds order", () => {
		const selected = selectOption(options, ["allow_once", "allow_always"]);
		expect(selected?.optionId).toBe("allow-once");
	});

	it("uses the fallback predicate when no preferred kind matches", () => {
		const selected = selectOption(
			options,
			["reject_always"],
			(opt) => opt.optionId === "reject-once",
		);
		expect(selected?.optionId).toBe("reject-once");
	});

	it("falls back to options[0] when neither kinds nor predicate match (current behavior)", () => {
		// QUIRK-3: even a reject-intent lookup ends up pressing the first
		// option; changing this is a maintainer decision.
		const selected = selectOption(
			options,
			["reject_always"],
			() => false,
		);
		expect(selected?.optionId).toBe("allow-always");
	});

	it("returns undefined for an empty options list", () => {
		expect(selectOption([], ["allow_once"])).toBeUndefined();
	});
});

// ============================================================================
// INV-15 — in-place content array mutation
// ============================================================================

describe("in-place content mutation (INV-15)", () => {
	it("applyUpdateLastMessage returns a new message object but reuses (and mutates) the previous content array (current behavior)", () => {
		const prev = [msg("assistant", [{ type: "text", text: "a" }])];
		const prevContent = prev[0].content;
		const result = applyUpdateLastMessage(prev, {
			type: "text",
			text: "b",
		});
		expect(result[0]).not.toBe(prev[0]); // message object: new identity
		expect(result[0].content).toBe(prevContent); // content array: same identity
		// The previous state's content array was mutated in place.
		expect(prev[0].content).toEqual([{ type: "text", text: "ab" }]);
	});

	it("applyUpdateUserMessage returns a new message object but reuses (and mutates) the previous content array (current behavior)", () => {
		const prev = [msg("user", [{ type: "text", text: "a" }])];
		const prevContent = prev[0].content;
		const result = applyUpdateUserMessage(prev, {
			type: "text",
			text: "b",
		});
		expect(result[0]).not.toBe(prev[0]);
		expect(result[0].content).toBe(prevContent);
		expect(prev[0].content).toEqual([{ type: "text", text: "ab" }]);
	});
});
