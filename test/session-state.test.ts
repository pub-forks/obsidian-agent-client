import { describe, it, expect, vi } from "vitest";
import {
	applyLegacyValue,
	tryRestoreConfigOption,
	restoreSavedConfigOptions,
	restoreLegacyConfig,
} from "../src/services/session-state";
import type {
	ChatSession,
	SessionConfigOption,
	SessionConfigSelectGroup,
	SessionConfigSelectOption,
	SessionResult,
	SessionModeState,
} from "../src/types/session";
import type { AcpClient } from "../src/acp/acp-client";

// ============================================================================
// Builders
// ============================================================================

const choices = (...values: string[]): SessionConfigSelectOption[] =>
	values.map((value) => ({ value, name: value }));

const selectOption = (
	overrides: Partial<
		Extract<SessionConfigOption, { type: "select" }>
	> = {},
): SessionConfigOption => ({
	id: "model",
	name: "Model",
	type: "select",
	category: "model",
	currentValue: "sonnet",
	options: choices("sonnet", "opus"),
	...overrides,
});

const booleanOption = (
	overrides: Partial<
		Extract<SessionConfigOption, { type: "boolean" }>
	> = {},
): SessionConfigOption => ({
	id: "verbose",
	name: "Verbose",
	type: "boolean",
	category: "model",
	currentValue: false,
	...overrides,
});

const groups = (
	...specs: Array<[string, string[]]>
): SessionConfigSelectGroup[] =>
	specs.map(([group, values]) => ({
		group,
		name: group,
		options: choices(...values),
	}));

const session = (overrides: Partial<ChatSession> = {}): ChatSession => ({
	sessionId: "s1",
	state: "ready",
	agentId: "claude-code-acp",
	agentDisplayName: "Claude Code",
	authMethods: [],
	createdAt: new Date(0),
	lastActivityAt: new Date(0),
	workingDirectory: "/vault",
	...overrides,
});

const modeState = (
	currentModeId: string,
	...ids: string[]
): SessionModeState => ({
	currentModeId,
	availableModes: ids.map((id) => ({ id, name: id })),
});

/** Minimal AcpClient mock — only the methods session-state uses. */
function makeClient(
	configResult: SessionConfigOption[] | (() => SessionConfigOption[]) = [],
) {
	const client = {
		setSessionConfigOption: vi.fn(async () =>
			typeof configResult === "function" ? configResult() : configResult,
		),
		setSessionMode: vi.fn(async () => {}),
	};
	return {
		client,
		asAcpClient: client as unknown as AcpClient,
	};
}

// ============================================================================
// applyLegacyValue
// ============================================================================

describe("applyLegacyValue", () => {
	it("replaces currentModeId when modes exist, without mutating the input", () => {
		const prev = session({ modes: modeState("build", "build", "plan") });
		const result = applyLegacyValue(prev, "plan");

		expect(result).not.toBe(prev);
		expect(result.modes?.currentModeId).toBe("plan");
		expect(result.modes?.availableModes).toBe(prev.modes?.availableModes);
		expect(prev.modes?.currentModeId).toBe("build");
	});

	it("is a no-op returning the same state reference when modes are absent", () => {
		const prev = session();
		expect(applyLegacyValue(prev, "plan")).toBe(prev);
	});
});

// ============================================================================
// tryRestoreConfigOption (INV-3 restore chain building block)
// ============================================================================

describe("tryRestoreConfigOption", () => {
	it("returns input unchanged without RPC when savedValue is undefined", async () => {
		const { client, asAcpClient } = makeClient();
		const options = [selectOption()];

		const result = await tryRestoreConfigOption(
			asAcpClient,
			"s1",
			options,
			"model",
			undefined,
		);

		expect(result).toBe(options);
		expect(client.setSessionConfigOption).not.toHaveBeenCalled();
	});

	it("returns input unchanged without RPC when no option matches the category", async () => {
		const { client, asAcpClient } = makeClient();
		const options = [selectOption({ category: "mode" })];

		const result = await tryRestoreConfigOption(
			asAcpClient,
			"s1",
			options,
			"model",
			"opus",
		);

		expect(result).toBe(options);
		expect(client.setSessionConfigOption).not.toHaveBeenCalled();
	});

	it("skips boolean options even when the category matches", async () => {
		const { client, asAcpClient } = makeClient();
		const options = [booleanOption({ category: "model" })];

		const result = await tryRestoreConfigOption(
			asAcpClient,
			"s1",
			options,
			"model",
			"opus",
		);

		expect(result).toBe(options);
		expect(client.setSessionConfigOption).not.toHaveBeenCalled();
	});

	it("does not call RPC when savedValue equals currentValue", async () => {
		const { client, asAcpClient } = makeClient();
		const options = [selectOption({ currentValue: "opus" })];

		const result = await tryRestoreConfigOption(
			asAcpClient,
			"s1",
			options,
			"model",
			"opus",
		);

		expect(result).toBe(options);
		expect(client.setSessionConfigOption).not.toHaveBeenCalled();
	});

	it("does not call RPC when savedValue is not among flat choices", async () => {
		const { client, asAcpClient } = makeClient();
		const options = [selectOption({ options: choices("sonnet", "opus") })];

		const result = await tryRestoreConfigOption(
			asAcpClient,
			"s1",
			options,
			"model",
			"haiku",
		);

		expect(result).toBe(options);
		expect(client.setSessionConfigOption).not.toHaveBeenCalled();
	});

	it("does not call RPC when savedValue is not among grouped choices", async () => {
		const { client, asAcpClient } = makeClient();
		const options = [
			selectOption({
				options: groups(
					["fast", ["sonnet"]],
					["smart", ["opus"]],
				),
			}),
		];

		const result = await tryRestoreConfigOption(
			asAcpClient,
			"s1",
			options,
			"model",
			"haiku",
		);

		expect(result).toBe(options);
		expect(client.setSessionConfigOption).not.toHaveBeenCalled();
	});

	it("restores a value found inside grouped choices via flattenConfigSelectOptions", async () => {
		const authoritative = [selectOption({ currentValue: "opus" })];
		const { client, asAcpClient } = makeClient(authoritative);
		const options = [
			selectOption({
				options: groups(
					["fast", ["sonnet"]],
					["smart", ["opus"]],
				),
			}),
		];

		const result = await tryRestoreConfigOption(
			asAcpClient,
			"s1",
			options,
			"model",
			"opus",
		);

		expect(client.setSessionConfigOption).toHaveBeenCalledWith(
			"s1",
			"model",
			"opus",
		);
		expect(result).toBe(authoritative);
	});

	it("calls setSessionConfigOption and returns the authoritative response array", async () => {
		const authoritative = [selectOption({ currentValue: "opus" })];
		const { client, asAcpClient } = makeClient(authoritative);
		const options = [selectOption()];

		const result = await tryRestoreConfigOption(
			asAcpClient,
			"s1",
			options,
			"model",
			"opus",
		);

		expect(client.setSessionConfigOption).toHaveBeenCalledTimes(1);
		expect(client.setSessionConfigOption).toHaveBeenCalledWith(
			"s1",
			"model",
			"opus",
		);
		expect(result).toBe(authoritative);
	});

	it("swallows RPC errors and returns the input unchanged", async () => {
		const { client, asAcpClient } = makeClient();
		client.setSessionConfigOption.mockRejectedValueOnce(
			new Error("boom"),
		);
		const options = [selectOption()];

		const result = await tryRestoreConfigOption(
			asAcpClient,
			"s1",
			options,
			"model",
			"opus",
		);

		expect(client.setSessionConfigOption).toHaveBeenCalledTimes(1);
		expect(result).toBe(options);
	});
});

// ============================================================================
// restoreSavedConfigOptions
// ============================================================================

describe("restoreSavedConfigOptions", () => {
	it("returns input unchanged when savedById is undefined", async () => {
		const { client, asAcpClient } = makeClient();
		const options = [selectOption()];

		const result = await restoreSavedConfigOptions(
			asAcpClient,
			"s1",
			options,
			undefined,
		);

		expect(result).toBe(options);
		expect(client.setSessionConfigOption).not.toHaveBeenCalled();
	});

	it("applies each saved id sequentially, feeding each authoritative result into the next lookup", async () => {
		const first = [
			selectOption({ id: "model", currentValue: "opus" }),
			selectOption({
				id: "mode",
				category: "mode",
				currentValue: "build",
				options: choices("build", "plan"),
			}),
		];
		const second = [
			selectOption({ id: "model", currentValue: "opus" }),
			selectOption({
				id: "mode",
				category: "mode",
				currentValue: "plan",
				options: choices("build", "plan"),
			}),
		];
		const { client, asAcpClient } = makeClient();
		client.setSessionConfigOption
			.mockResolvedValueOnce(first)
			.mockResolvedValueOnce(second);

		const options = [
			selectOption({ id: "model", currentValue: "sonnet" }),
			selectOption({
				id: "mode",
				category: "mode",
				currentValue: "build",
				options: choices("build", "plan"),
			}),
		];

		const result = await restoreSavedConfigOptions(
			asAcpClient,
			"s1",
			options,
			{ model: "opus", mode: "plan" },
		);

		expect(client.setSessionConfigOption.mock.calls).toEqual([
			["s1", "model", "opus"],
			["s1", "mode", "plan"],
		]);
		expect(result).toBe(second);
	});

	it("uses the chained result for validation: a value already applied by a previous RPC is skipped", async () => {
		// First RPC returns options where "mode" already has the saved value,
		// so the second entry must be skipped (savedValue === currentValue).
		const first = [
			selectOption({ id: "model", currentValue: "opus" }),
			selectOption({
				id: "mode",
				category: "mode",
				currentValue: "plan",
				options: choices("build", "plan"),
			}),
		];
		const { client, asAcpClient } = makeClient();
		client.setSessionConfigOption.mockResolvedValueOnce(first);

		const options = [
			selectOption({ id: "model", currentValue: "sonnet" }),
			selectOption({
				id: "mode",
				category: "mode",
				currentValue: "build",
				options: choices("build", "plan"),
			}),
		];

		const result = await restoreSavedConfigOptions(
			asAcpClient,
			"s1",
			options,
			{ model: "opus", mode: "plan" },
		);

		expect(client.setSessionConfigOption).toHaveBeenCalledTimes(1);
		expect(client.setSessionConfigOption).toHaveBeenCalledWith(
			"s1",
			"model",
			"opus",
		);
		expect(result).toBe(first);
	});

	it("continues with remaining ids when one RPC throws", async () => {
		const second = [
			selectOption({ id: "model", currentValue: "sonnet" }),
			selectOption({
				id: "mode",
				category: "mode",
				currentValue: "plan",
				options: choices("build", "plan"),
			}),
		];
		const { client, asAcpClient } = makeClient();
		client.setSessionConfigOption
			.mockRejectedValueOnce(new Error("boom"))
			.mockResolvedValueOnce(second);

		const options = [
			selectOption({ id: "model", currentValue: "sonnet" }),
			selectOption({
				id: "mode",
				category: "mode",
				currentValue: "build",
				options: choices("build", "plan"),
			}),
		];

		const result = await restoreSavedConfigOptions(
			asAcpClient,
			"s1",
			options,
			{ model: "opus", mode: "plan" },
		);

		expect(client.setSessionConfigOption.mock.calls).toEqual([
			["s1", "model", "opus"],
			["s1", "mode", "plan"],
		]);
		expect(result).toBe(second);
	});

	it("skips unknown ids, unchanged values, and values missing from choices", async () => {
		const { client, asAcpClient } = makeClient();
		const options = [
			selectOption({ id: "model", currentValue: "sonnet" }),
			booleanOption({ id: "verbose" }),
		];

		const result = await restoreSavedConfigOptions(
			asAcpClient,
			"s1",
			options,
			{
				nonexistent: "x", // unknown id
				model: "sonnet", // same as currentValue — but also would match choices
				verbose: "true", // boolean option — skipped
			},
		);

		expect(client.setSessionConfigOption).not.toHaveBeenCalled();
		expect(result).toBe(options);

		// Stale value not among choices is also skipped.
		const result2 = await restoreSavedConfigOptions(
			asAcpClient,
			"s1",
			options,
			{ model: "haiku" },
		);
		expect(client.setSessionConfigOption).not.toHaveBeenCalled();
		expect(result2).toBe(options);
	});
});

// ============================================================================
// restoreLegacyConfig
// ============================================================================

describe("restoreLegacyConfig", () => {
	const sessionResult = (
		overrides: Partial<SessionResult> = {},
	): SessionResult => ({
		sessionId: "s1",
		modes: modeState("build", "build", "plan"),
		...overrides,
	});

	it("restores mode when savedModeId is available and differs from current", async () => {
		const { client, asAcpClient } = makeClient();
		const input = sessionResult();

		const result = await restoreLegacyConfig(asAcpClient, input, "plan");

		expect(client.setSessionMode).toHaveBeenCalledTimes(1);
		expect(client.setSessionMode).toHaveBeenCalledWith("s1", "plan");
		expect(result.modes?.currentModeId).toBe("plan");
		// Input modes are not mutated.
		expect(input.modes?.currentModeId).toBe("build");
	});

	it("does not call RPC when savedModeId is not among availableModes", async () => {
		const { client, asAcpClient } = makeClient();
		const input = sessionResult();

		const result = await restoreLegacyConfig(
			asAcpClient,
			input,
			"unknown-mode",
		);

		expect(client.setSessionMode).not.toHaveBeenCalled();
		expect(result.modes).toBe(input.modes);
	});

	it("does not call RPC when savedModeId equals the current mode", async () => {
		const { client, asAcpClient } = makeClient();
		const input = sessionResult();

		const result = await restoreLegacyConfig(asAcpClient, input, "build");

		expect(client.setSessionMode).not.toHaveBeenCalled();
		expect(result.modes).toBe(input.modes);
	});

	it("does not call RPC when savedModeId is undefined", async () => {
		const { client, asAcpClient } = makeClient();
		const input = sessionResult();

		const result = await restoreLegacyConfig(asAcpClient, input, undefined);

		expect(client.setSessionMode).not.toHaveBeenCalled();
		expect(result.modes).toBe(input.modes);
	});

	it("does not call RPC and returns undefined modes when modes are absent", async () => {
		const { client, asAcpClient } = makeClient();
		const input = sessionResult({ modes: undefined });

		const result = await restoreLegacyConfig(asAcpClient, input, "plan");

		expect(client.setSessionMode).not.toHaveBeenCalled();
		expect(result.modes).toBeUndefined();
	});

	it("returns original modes early when sessionId is empty", async () => {
		const { client, asAcpClient } = makeClient();
		const input = sessionResult({ sessionId: "" });

		const result = await restoreLegacyConfig(asAcpClient, input, "plan");

		expect(client.setSessionMode).not.toHaveBeenCalled();
		expect(result.modes).toBe(input.modes);
	});

	it("swallows RPC errors and returns the original modes", async () => {
		const { client, asAcpClient } = makeClient();
		client.setSessionMode.mockRejectedValueOnce(new Error("boom"));
		const input = sessionResult();

		const result = await restoreLegacyConfig(asAcpClient, input, "plan");

		expect(client.setSessionMode).toHaveBeenCalledTimes(1);
		expect(result.modes).toBe(input.modes);
		expect(result.modes?.currentModeId).toBe("build");
	});

	it("legacy path restores mode only — no model restore", async () => {
		const { client, asAcpClient } = makeClient();
		const input = sessionResult();

		const result = await restoreLegacyConfig(asAcpClient, input, "plan");

		// The return shape carries modes only; there is no model field and
		// no model-related RPC on the legacy path.
		expect(Object.keys(result)).toEqual(["modes"]);
		expect(client.setSessionConfigOption).not.toHaveBeenCalled();
	});
});
