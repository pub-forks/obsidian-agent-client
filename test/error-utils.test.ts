import { describe, it, expect, beforeEach } from "vitest";
import { Platform } from "obsidian";
import {
	extractErrorCode,
	extractErrorMessage,
	extractErrorData,
	getErrorTitle,
	getErrorSuggestion,
	toAcpError,
	toErrorInfo,
	isEmptyResponseError,
	isUserAbortedError,
	extractStderrErrorHint,
	getSpawnErrorInfo,
	getCommandNotFoundSuggestion,
} from "../src/utils/error-utils";
import { AcpErrorCode } from "../src/types/errors";

const FALLBACK_MESSAGE = "An unexpected error occurred.";

function resetPlatform(): void {
	Platform.isWin = false;
	Platform.isMacOS = false;
	Platform.isLinux = false;
	Platform.isDesktopApp = true;
}

beforeEach(resetPlatform);

describe("extractErrorCode", () => {
	it("returns numeric code from error object", () => {
		expect(extractErrorCode({ code: -32603 })).toBe(-32603);
	});

	it("returns undefined for non-numeric code", () => {
		expect(extractErrorCode({ code: "oops" })).toBeUndefined();
	});

	it("returns undefined for null / non-object / missing code", () => {
		expect(extractErrorCode(null)).toBeUndefined();
		expect(extractErrorCode("error")).toBeUndefined();
		expect(extractErrorCode({})).toBeUndefined();
	});
});

describe("extractErrorMessage", () => {
	it("prefers data.details over message (current behavior)", () => {
		// Agent-compat: some agents put the real error in data.details.
		// Do NOT reorder — see plan PR0.5.
		const error = {
			message: "generic message",
			data: { details: "specific details" },
		};
		expect(extractErrorMessage(error)).toBe("specific details");
	});

	it("falls back to message when data.details is absent", () => {
		expect(extractErrorMessage({ message: "the message" })).toBe(
			"the message",
		);
	});

	it("falls back to message when data.details is not a string", () => {
		const error = { message: "msg", data: { details: 42 } };
		expect(extractErrorMessage(error)).toBe("msg");
	});

	it("returns fallback text for null, non-object, or empty object", () => {
		expect(extractErrorMessage(null)).toBe(FALLBACK_MESSAGE);
		expect(extractErrorMessage("string error")).toBe(FALLBACK_MESSAGE);
		expect(extractErrorMessage({})).toBe(FALLBACK_MESSAGE);
	});

	it("returns fallback text when message is not a string", () => {
		expect(extractErrorMessage({ message: 123 })).toBe(FALLBACK_MESSAGE);
	});
});

describe("extractErrorData", () => {
	it("returns data field when present", () => {
		const data = { details: "x" };
		expect(extractErrorData({ data })).toBe(data);
	});

	it("returns undefined when absent", () => {
		expect(extractErrorData({})).toBeUndefined();
		expect(extractErrorData(null)).toBeUndefined();
	});
});

describe("getErrorTitle", () => {
	it("maps known ACP error codes to titles", () => {
		expect(getErrorTitle(AcpErrorCode.PARSE_ERROR)).toBe("Protocol Error");
		expect(getErrorTitle(AcpErrorCode.INVALID_REQUEST)).toBe(
			"Invalid Request",
		);
		expect(getErrorTitle(AcpErrorCode.METHOD_NOT_FOUND)).toBe(
			"Method Not Supported",
		);
		expect(getErrorTitle(AcpErrorCode.INVALID_PARAMS)).toBe(
			"Invalid Parameters",
		);
		expect(getErrorTitle(AcpErrorCode.INTERNAL_ERROR)).toBe(
			"Internal Error",
		);
		expect(getErrorTitle(AcpErrorCode.AUTHENTICATION_REQUIRED)).toBe(
			"Authentication Required",
		);
		expect(getErrorTitle(AcpErrorCode.RESOURCE_NOT_FOUND)).toBe(
			"Resource Not Found",
		);
	});

	it("returns generic title for unknown or undefined code", () => {
		expect(getErrorTitle(12345)).toBe("Agent Error");
		expect(getErrorTitle(undefined)).toBe("Agent Error");
	});
});

describe("getErrorSuggestion", () => {
	it("suggests compact for INTERNAL_ERROR with context exhaustion keywords", () => {
		const expected =
			"The conversation is too long. Try using a compact command if available, or start a new chat.";
		for (const msg of [
			"context window exceeded",
			"token limit reached",
			"max_tokens exceeded",
			"prompt is too long",
		]) {
			expect(getErrorSuggestion(AcpErrorCode.INTERNAL_ERROR, msg)).toBe(
				expected,
			);
		}
	});

	it("matches context keywords case-insensitively", () => {
		expect(
			getErrorSuggestion(AcpErrorCode.INTERNAL_ERROR, "CONTEXT limit"),
		).toBe(
			"The conversation is too long. Try using a compact command if available, or start a new chat.",
		);
	});

	it("suggests waiting for INTERNAL_ERROR with overloaded/capacity keywords", () => {
		const expected =
			"The service is busy. Please wait a moment and try again.";
		expect(
			getErrorSuggestion(AcpErrorCode.INTERNAL_ERROR, "Overloaded"),
		).toBe(expected);
		expect(
			getErrorSuggestion(AcpErrorCode.INTERNAL_ERROR, "at capacity"),
		).toBe(expected);
	});

	it("ignores context keywords when code is not INTERNAL_ERROR (current behavior)", () => {
		expect(getErrorSuggestion(undefined, "context too long")).toBe(
			"Try again or restart the agent session.",
		);
	});

	it("suggests key check for AUTHENTICATION_REQUIRED", () => {
		expect(
			getErrorSuggestion(AcpErrorCode.AUTHENTICATION_REQUIRED, "auth"),
		).toBe(
			"Check if you are logged in or if your API key is set correctly.",
		);
	});

	it("maps remaining codes to their static suggestions", () => {
		expect(getErrorSuggestion(AcpErrorCode.PARSE_ERROR, "x")).toBe(
			"Try restarting the agent session.",
		);
		expect(getErrorSuggestion(AcpErrorCode.INVALID_REQUEST, "x")).toBe(
			"Try restarting the agent session.",
		);
		expect(getErrorSuggestion(AcpErrorCode.METHOD_NOT_FOUND, "x")).toBe(
			"Try restarting the agent session.",
		);
		expect(getErrorSuggestion(AcpErrorCode.INVALID_PARAMS, "x")).toBe(
			"Check your agent configuration in settings.",
		);
		expect(getErrorSuggestion(AcpErrorCode.INTERNAL_ERROR, "plain")).toBe(
			"Try again or restart the agent session.",
		);
		expect(getErrorSuggestion(AcpErrorCode.RESOURCE_NOT_FOUND, "x")).toBe(
			"Check if the file or resource exists.",
		);
		expect(getErrorSuggestion(undefined, "x")).toBe(
			"Try again or restart the agent session.",
		);
	});
});

describe("toAcpError", () => {
	it("builds AcpError with data.details as the message (current behavior)", () => {
		const original = {
			code: AcpErrorCode.INTERNAL_ERROR,
			message: "generic",
			data: { details: "the real error" },
		};
		const acpError = toAcpError(original, "session-1");
		expect(acpError.code).toBe(AcpErrorCode.INTERNAL_ERROR);
		expect(acpError.message).toBe("the real error");
		expect(acpError.data).toBe(original.data);
		expect(acpError.sessionId).toBe("session-1");
		expect(acpError.originalError).toBe(original);
		expect(acpError.title).toBe("Internal Error");
	});

	it("defaults code to -1 when the error has no code", () => {
		const acpError = toAcpError(new Error("boom"));
		expect(acpError.code).toBe(-1);
		expect(acpError.message).toBe("boom");
		expect(acpError.title).toBe("Agent Error");
		expect(acpError.sessionId).toBeUndefined();
	});
});

describe("toErrorInfo", () => {
	it("projects title/message/suggestion only", () => {
		const acpError = toAcpError({
			code: AcpErrorCode.RESOURCE_NOT_FOUND,
			message: "not found",
		});
		expect(toErrorInfo(acpError)).toEqual({
			title: "Resource Not Found",
			message: "not found",
			suggestion: "Check if the file or resource exists.",
		});
	});
});

describe("isEmptyResponseError", () => {
	it("returns true for INTERNAL_ERROR containing 'empty response text'", () => {
		expect(
			isEmptyResponseError({
				code: AcpErrorCode.INTERNAL_ERROR,
				message: "received empty response text from agent",
			}),
		).toBe(true);
	});

	it("returns false for other codes even with the same message", () => {
		expect(
			isEmptyResponseError({
				code: AcpErrorCode.INVALID_REQUEST,
				message: "empty response text",
			}),
		).toBe(false);
	});

	it("returns false for INTERNAL_ERROR without the marker text", () => {
		expect(
			isEmptyResponseError({
				code: AcpErrorCode.INTERNAL_ERROR,
				message: "something else",
			}),
		).toBe(false);
	});

	it("reads the marker from data.details too (message extraction priority)", () => {
		expect(
			isEmptyResponseError({
				code: AcpErrorCode.INTERNAL_ERROR,
				message: "generic",
				data: { details: "empty response text" },
			}),
		).toBe(true);
	});
});

describe("isUserAbortedError", () => {
	it("returns true for INTERNAL_ERROR containing 'user aborted'", () => {
		expect(
			isUserAbortedError({
				code: AcpErrorCode.INTERNAL_ERROR,
				message: "Request failed: user aborted",
			}),
		).toBe(true);
	});

	it("returns false for other codes", () => {
		expect(
			isUserAbortedError({ code: -1, message: "user aborted" }),
		).toBe(false);
	});

	it("returns false for INTERNAL_ERROR without the marker text", () => {
		expect(
			isUserAbortedError({
				code: AcpErrorCode.INTERNAL_ERROR,
				message: "timeout",
			}),
		).toBe(false);
	});
});

describe("extractStderrErrorHint", () => {
	it("detects missing API key patterns", () => {
		const expected =
			"The agent's API key may be missing. For custom agents, add the required API key (e.g., ANTHROPIC_API_KEY) in the agent's Environment Variables setting.";
		expect(extractStderrErrorHint("Error: API key is missing")).toBe(
			expected,
		);
		expect(extractStderrErrorHint("LoadAPIKeyError: no key found")).toBe(
			expected,
		);
	});

	it("detects authentication patterns", () => {
		const expected =
			"The agent reported an authentication error. Check that your API key or credentials are valid.";
		expect(extractStderrErrorHint("authentication failed")).toBe(expected);
		expect(extractStderrErrorHint("request was unauthorized")).toBe(
			expected,
		);
		expect(extractStderrErrorHint("HTTP 401 returned")).toBe(expected);
	});

	it("matches authentication patterns case-sensitively (current behavior)", () => {
		// "Authentication"/"Unauthorized" with capital letters do NOT match.
		expect(extractStderrErrorHint("Authentication failed")).toBeNull();
		expect(extractStderrErrorHint("Unauthorized")).toBeNull();
	});

	it("returns null for empty or unrecognized stderr", () => {
		expect(extractStderrErrorHint("")).toBeNull();
		expect(extractStderrErrorHint("some unrelated warning")).toBeNull();
	});
});

describe("getSpawnErrorInfo", () => {
	function enoent(): Error {
		const err = new Error("spawn foo ENOENT") as NodeJS.ErrnoException;
		err.code = "ENOENT";
		return err;
	}

	it("maps ENOENT to Command Not Found with command and agent label", () => {
		const info = getSpawnErrorInfo(enoent(), "claude", "Claude Code", false);
		expect(info.title).toBe("Command Not Found");
		expect(info.message).toBe(
			'The command "claude" could not be found. Please check the path configuration for Claude Code.',
		);
		expect(info.suggestion).toBe(
			getCommandNotFoundSuggestion("claude", false),
		);
	});

	it("maps other errors to Agent Startup Error", () => {
		const info = getSpawnErrorInfo(
			new Error("EACCES: permission denied"),
			"claude",
			"Claude Code",
			false,
		);
		expect(info.title).toBe("Agent Startup Error");
		expect(info.message).toBe(
			"Failed to start Claude Code: EACCES: permission denied",
		);
		expect(info.suggestion).toBe(
			"Please check the agent configuration in settings.",
		);
	});
});

describe("getCommandNotFoundSuggestion", () => {
	it("suggests WSL 'which' when Windows + WSL mode", () => {
		Platform.isWin = true;
		const suggestion = getCommandNotFoundSuggestion(
			"/usr/local/bin/claude",
			true,
		);
		expect(suggestion).toContain('"which claude" in your WSL terminal');
		expect(suggestion).toContain('"which node"');
	});

	it("suggests 'where' on Windows without WSL", () => {
		Platform.isWin = true;
		const suggestion = getCommandNotFoundSuggestion(
			"C:\\tools\\claude.exe",
			false,
		);
		expect(suggestion).toContain('"where claude.exe" in Command Prompt');
		expect(suggestion).toContain('"where node"');
	});

	it("suggests 'which' in Terminal on Unix", () => {
		Platform.isMacOS = true;
		const suggestion = getCommandNotFoundSuggestion("claude", false);
		expect(suggestion).toContain('"which claude" in Terminal');
	});

	it("ignores wslMode when not on Windows (current behavior)", () => {
		Platform.isLinux = true;
		const suggestion = getCommandNotFoundSuggestion("claude", true);
		expect(suggestion).toContain('"which claude" in Terminal');
	});

	it("falls back to 'command' for empty command string", () => {
		const suggestion = getCommandNotFoundSuggestion("", false);
		expect(suggestion).toContain('"which command"');
	});
});
