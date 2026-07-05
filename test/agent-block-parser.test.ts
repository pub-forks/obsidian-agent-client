import { describe, it, expect } from "vitest";
import {
	parseAgentBlock,
	type AgentChatBlockConfig,
	type AgentButtonBlockConfig,
} from "../src/utils/agent-block-parser";

describe("parseAgentBlock — chat blocks", () => {
	it("treats an empty body as a default chat (persist false, no warnings)", () => {
		const result = parseAgentBlock("");
		expect(result.ok).toBe(true);
		if (result.ok) {
			const config = result.config as AgentChatBlockConfig;
			expect(config.type).toBe("chat");
			expect(config.persist).toBe(false);
			expect(config.id).toBeUndefined();
			expect(config.agent).toBeUndefined();
			expect(config.model).toBeUndefined();
			expect(config.height).toBeUndefined();
			expect(config.noteContext).toBeUndefined();
			expect(result.warnings).toBeUndefined();
		}
	});

	it("treats a whitespace-only body as a default chat", () => {
		const result = parseAgentBlock("   \n\t\n   ");
		expect(result.ok).toBe(true);
		if (result.ok) {
			const config = result.config as AgentChatBlockConfig;
			expect(config.type).toBe("chat");
			expect(config.persist).toBe(false);
			expect(result.warnings).toBeUndefined();
		}
	});

	it("reads agent and model through unchanged", () => {
		const result = parseAgentBlock("agent: claude\nmodel: opus");
		expect(result.ok).toBe(true);
		if (result.ok) {
			const config = result.config as AgentChatBlockConfig;
			expect(config.agent).toBe("claude");
			expect(config.model).toBe("opus");
		}
	});

	it('accepts noteContext "hosting"', () => {
		const result = parseAgentBlock("noteContext: hosting");
		expect(result.ok).toBe(true);
		if (result.ok) {
			const config = result.config as AgentChatBlockConfig;
			expect(config.noteContext).toBe("hosting");
		}
	});

	it("rejects an unknown noteContext with a hard error", () => {
		const result = parseAgentBlock("noteContext: pinned");
		expect(result.ok).toBe(false);
		if (!result.ok) {
			expect(result.error).toContain("Unknown noteContext");
			expect(result.error).toBe(
				'Unknown noteContext: "pinned". Expected "hosting".',
			);
		}
	});
});

describe("parseAgentBlock — chat height normalization", () => {
	it('keeps "400px" unchanged', () => {
		const result = parseAgentBlock("height: 400px");
		expect(result.ok).toBe(true);
		if (result.ok) {
			const config = result.config as AgentChatBlockConfig;
			expect(config.height).toBe("400px");
			expect(result.warnings).toBeUndefined();
		}
	});

	it('collapses the space in "400 px" -> "400px"', () => {
		const result = parseAgentBlock("height: 400 px");
		expect(result.ok).toBe(true);
		if (result.ok) {
			const config = result.config as AgentChatBlockConfig;
			expect(config.height).toBe("400px");
			expect(result.warnings).toBeUndefined();
		}
	});

	it('normalizes "50.5 em" -> "50.5em"', () => {
		const result = parseAgentBlock("height: 50.5 em");
		expect(result.ok).toBe(true);
		if (result.ok) {
			const config = result.config as AgentChatBlockConfig;
			expect(config.height).toBe("50.5em");
			expect(result.warnings).toBeUndefined();
		}
	});

	it('drops an invalid height "tall" and emits a warning', () => {
		const result = parseAgentBlock("height: tall");
		expect(result.ok).toBe(true);
		if (result.ok) {
			const config = result.config as AgentChatBlockConfig;
			expect(config.height).toBeUndefined();
			expect(result.warnings).toBeDefined();
			expect(result.warnings?.length).toBeGreaterThan(0);
			expect(result.warnings?.[0]).toContain("height");
		}
	});
});

describe("parseAgentBlock — chat id", () => {
	it("preserves a hand-written id", () => {
		const result = parseAgentBlock("id: my-block-id");
		expect(result.ok).toBe(true);
		if (result.ok) {
			const config = result.config as AgentChatBlockConfig;
			expect(config.id).toBe("my-block-id");
		}
	});

	it("drops an empty id (asString discards blanks)", () => {
		const result = parseAgentBlock('id: ""');
		expect(result.ok).toBe(true);
		if (result.ok) {
			const config = result.config as AgentChatBlockConfig;
			expect(config.id).toBeUndefined();
		}
	});
});

describe("parseAgentBlock — boolean spellings (persist)", () => {
	const truthy: Array<{ label: string; yaml: string }> = [
		{ label: "bare boolean true", yaml: "persist: true" },
		{ label: 'quoted "true"', yaml: 'persist: "true"' },
		{ label: "bare yes", yaml: "persist: yes" },
		{ label: "bare on", yaml: "persist: on" },
		{ label: "mixed-case YES", yaml: "persist: YES" },
		{ label: "mixed-case On", yaml: "persist: On" },
		{ label: 'quoted "1"', yaml: 'persist: "1"' },
		{ label: "bare numeric 1", yaml: "persist: 1" },
	];

	for (const { label, yaml } of truthy) {
		it(`parses persist ${label} -> true with no warnings`, () => {
			const result = parseAgentBlock(yaml);
			expect(result.ok).toBe(true);
			if (result.ok) {
				const config = result.config as AgentChatBlockConfig;
				expect(config.persist).toBe(true);
				expect(result.warnings).toBeUndefined();
			}
		});
	}

	const falsy: Array<{ label: string; yaml: string }> = [
		{ label: "bare boolean false", yaml: "persist: false" },
		{ label: 'quoted "false"', yaml: 'persist: "false"' },
		{ label: "bare no", yaml: "persist: no" },
		{ label: "bare off", yaml: "persist: off" },
		{ label: "mixed-case NO", yaml: "persist: NO" },
		{ label: "mixed-case Off", yaml: "persist: Off" },
		{ label: 'quoted "0"', yaml: 'persist: "0"' },
		{ label: "bare numeric 0", yaml: "persist: 0" },
	];

	for (const { label, yaml } of falsy) {
		it(`parses persist ${label} -> false with no warnings`, () => {
			const result = parseAgentBlock(yaml);
			expect(result.ok).toBe(true);
			if (result.ok) {
				const config = result.config as AgentChatBlockConfig;
				expect(config.persist).toBe(false);
				expect(result.warnings).toBeUndefined();
			}
		});
	}

	it("defaults an unrecognized persist value to false and warns", () => {
		const result = parseAgentBlock("persist: maybe");
		expect(result.ok).toBe(true);
		if (result.ok) {
			const config = result.config as AgentChatBlockConfig;
			expect(config.persist).toBe(false);
			expect(result.warnings).toBeDefined();
			expect(result.warnings?.length).toBeGreaterThan(0);
			expect(result.warnings?.[0]).toContain("persist");
		}
	});
});

describe("parseAgentBlock — button blocks", () => {
	it("requires a non-empty text field", () => {
		const result = parseAgentBlock("type: button\nprompt: Do it");
		expect(result.ok).toBe(false);
		if (!result.ok) {
			expect(result.error).toContain('requires a non-empty "text" field');
			expect(result.error).toBe(
				'Button block requires a non-empty "text" field.',
			);
		}
	});

	it("requires a non-empty prompt field", () => {
		const result = parseAgentBlock("type: button\ntext: Click me");
		expect(result.ok).toBe(false);
		if (!result.ok) {
			expect(result.error).toContain(
				'requires a non-empty "prompt" field',
			);
			expect(result.error).toBe(
				'Button block requires a non-empty "prompt" field.',
			);
		}
	});

	it('defaults viewType to "right-pane" and autoSend to false', () => {
		const result = parseAgentBlock(
			"type: button\ntext: Click me\nprompt: Do the thing",
		);
		expect(result.ok).toBe(true);
		if (result.ok) {
			const config = result.config as AgentButtonBlockConfig;
			expect(config.type).toBe("button");
			expect(config.text).toBe("Click me");
			expect(config.prompt).toBe("Do the thing");
			expect(config.viewType).toBe("right-pane");
			expect(config.autoSend).toBe(false);
			expect(result.warnings).toBeUndefined();
		}
	});

	it("rejects an unknown viewType with a hard error", () => {
		const result = parseAgentBlock(
			"type: button\ntext: Click me\nprompt: Do it\nviewType: sidebar",
		);
		expect(result.ok).toBe(false);
		if (!result.ok) {
			expect(result.error).toContain("Unknown viewType");
			expect(result.error).toBe(
				'Unknown viewType: "sidebar". Expected "right-pane", "floating", "editor-tab", or "embedded".',
			);
		}
	});

	it("defaults an unrecognized autoSend value to false and warns", () => {
		const result = parseAgentBlock(
			"type: button\ntext: Click me\nprompt: Do it\nautoSend: perhaps",
		);
		expect(result.ok).toBe(true);
		if (result.ok) {
			const config = result.config as AgentButtonBlockConfig;
			expect(config.autoSend).toBe(false);
			expect(result.warnings).toBeDefined();
			expect(result.warnings?.length).toBeGreaterThan(0);
			expect(result.warnings?.[0]).toContain("autoSend");
		}
	});
});

describe("parseAgentBlock — normalizeViewType aliases", () => {
	const aliases: Array<[string, AgentButtonBlockConfig["viewType"]]> = [
		["right", "right-pane"],
		["right-tab", "right-pane"],
		["float", "floating"],
		["floating-chat", "floating"],
		["tab", "editor-tab"],
		["embed", "embedded"],
		["embeddable", "embedded"],
		["right-pane", "right-pane"],
		["floating", "floating"],
		["editor-tab", "editor-tab"],
		["embedded", "embedded"],
	];

	for (const [alias, expected] of aliases) {
		it(`maps viewType "${alias}" -> "${expected}"`, () => {
			const result = parseAgentBlock(
				`type: button\ntext: Click me\nprompt: Do it\nviewType: ${alias}`,
			);
			expect(result.ok).toBe(true);
			if (result.ok) {
				const config = result.config as AgentButtonBlockConfig;
				expect(config.viewType).toBe(expected);
			}
		});
	}
});

describe("parseAgentBlock — present-but-invalid values (#7)", () => {
	it("rejects a present-but-non-string type (type: 0)", () => {
		const result = parseAgentBlock("type: 0");
		expect(result.ok).toBe(false);
		if (!result.ok) {
			expect(result.error).toBe(
				'Unknown type: 0. Expected "chat" or "button".',
			);
		}
	});

	it("rejects a present empty-string type", () => {
		const result = parseAgentBlock('type: ""');
		expect(result.ok).toBe(false);
		if (!result.ok) {
			expect(result.error).toContain("Unknown type");
		}
	});

	it("rejects a present-but-non-string noteContext (noteContext: false)", () => {
		const result = parseAgentBlock("noteContext: false");
		expect(result.ok).toBe(false);
		if (!result.ok) {
			expect(result.error).toBe(
				'Unknown noteContext: false. Expected "hosting".',
			);
		}
	});

	it("drops a numeric height (height: 400) with a warning", () => {
		const result = parseAgentBlock("height: 400");
		expect(result.ok).toBe(true);
		if (result.ok) {
			const config = result.config as AgentChatBlockConfig;
			expect(config.height).toBeUndefined();
			expect(result.warnings).toBeDefined();
			expect(result.warnings?.[0]).toContain("height");
		}
	});

	it("rejects a present-but-non-string viewType (viewType: 1)", () => {
		const result = parseAgentBlock(
			"type: button\ntext: Click me\nprompt: Do it\nviewType: 1",
		);
		expect(result.ok).toBe(false);
		if (!result.ok) {
			expect(result.error).toBe(
				'Unknown viewType: 1. Expected "right-pane", "floating", "editor-tab", or "embedded".',
			);
		}
	});
});

describe("parseAgentBlock — structural errors", () => {
	it("reports malformed YAML with an Invalid YAML error", () => {
		const result = parseAgentBlock("foo: : bar");
		expect(result.ok).toBe(false);
		if (!result.ok) {
			expect(result.error).toContain("Invalid YAML");
		}
	});

	it("rejects a sequence body (mapping required)", () => {
		const result = parseAgentBlock("- one\n- two");
		expect(result.ok).toBe(false);
		if (!result.ok) {
			expect(result.error).toContain("must be a YAML mapping");
			expect(result.error).toBe(
				"Block body must be a YAML mapping (key: value pairs).",
			);
		}
	});

	it("rejects a scalar body (mapping required)", () => {
		const result = parseAgentBlock("just a scalar");
		expect(result.ok).toBe(false);
		if (!result.ok) {
			expect(result.error).toContain("must be a YAML mapping");
			expect(result.error).toBe(
				"Block body must be a YAML mapping (key: value pairs).",
			);
		}
	});

	it("rejects an unknown type", () => {
		const result = parseAgentBlock("type: widget");
		expect(result.ok).toBe(false);
		if (!result.ok) {
			expect(result.error).toContain("Unknown type");
			expect(result.error).toBe(
				'Unknown type: "widget". Expected "chat" or "button".',
			);
		}
	});
});
