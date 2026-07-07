/**
 * Agent code block renderer
 *
 * Renders an `agent-client` / `agent` code block: dispatches to the embedded
 * chat or the quick-action button based on the parsed `type` field, and
 * collects non-fatal warnings. Moved verbatim from plugin.ts (PR3.3);
 * processor registration stays in plugin.onload.
 */

import {
	MarkdownRenderChild,
	type MarkdownPostProcessorContext,
} from "obsidian";
import type AgentClientPlugin from "../plugin";
import { parseAgentBlock } from "../utils/agent-block-parser";
import {
	findAgentSettings,
	isAgentEnabled,
} from "../services/session-helpers";
import { mountCodeBlockChat } from "./CodeBlockChatView";
import { mountAgentButtonBlock } from "./AgentButtonBlock";

/**
 * Render an `agent-client` code block. Dispatches to embedded chat or
 * quick-action button based on the parsed `type` field.
 */
export function renderAgentBlock(
	plugin: AgentClientPlugin,
	source: string,
	el: HTMLElement,
	ctx: MarkdownPostProcessorContext,
): void {
	const child = new MarkdownRenderChild(el);
	const parsed = parseAgentBlock(source);

	if (!parsed.ok) {
		const errorEl = el.createDiv({
			cls: "agent-client-code-block-error",
		});
		errorEl.createSpan({
			cls: "agent-client-code-block-error-label",
			text: "agent-client block error: ",
		});
		errorEl.createSpan({ text: parsed.error });
		const sourceEl = errorEl.createEl("pre", {
			cls: "agent-client-code-block-error-source",
		});
		sourceEl.setText(source);
		ctx.addChild(child);
		return;
	}

	// Collect non-fatal warnings: parser warnings plus a mount-side check
	// on the pinned agent id (#28). Copy the parser array rather than
	// mutating it, since parse results may be shared once cached.
	// Warnings match actual behavior, which differs by block type: a chat
	// block spawns the pinned agent as-is (unknown → startup error), a
	// button block falls back to the default agent when the id is unknown.
	// Both use a pinned agent even while it is disabled. Computed at
	// render time — a later toggle doesn't update an already-rendered
	// block (known limitation).
	const warnings = parsed.warnings ? [...parsed.warnings] : [];
	const requestedAgent = parsed.config.agent;
	if (requestedAgent) {
		const agentSettings = findAgentSettings(
			plugin.settings,
			requestedAgent,
		);
		if (!agentSettings) {
			warnings.push(
				parsed.config.type === "chat"
					? `Unknown agent "${requestedAgent}" — this block will fail to start. Check the agent id in Settings → Agent Client.`
					: `Unknown agent "${requestedAgent}", using the default agent instead.`,
			);
		} else if (!isAgentEnabled(agentSettings)) {
			warnings.push(
				`Agent "${requestedAgent}" is disabled in settings; this block pins it and will still use it.`,
			);
		}
	}

	if (warnings.length > 0) {
		const warnEl = el.createDiv({
			cls: "agent-client-code-block-warning",
		});
		for (const warning of warnings) {
			warnEl.createDiv({
				cls: "agent-client-code-block-warning-item",
				text: warning,
			});
		}
	}

	const sectionInfo = ctx.getSectionInfo(el);
	const sourcePath = ctx.sourcePath || "";
	const lineStart = sectionInfo?.lineStart ?? 0;
	const blockId = `${sourcePath || "untitled"}:${lineStart}`;

	if (parsed.config.type === "chat") {
		// Persist blocks lacking an id get a stable id auto-injected into
		// the fence, so the device-local persist mapping survives note
		// rename/move. Requires real section bounds. Runs once: the
		// re-render the edit triggers sees config.id and the guard inside
		// ensureEmbedId short-circuits.
		if (parsed.config.persist && !parsed.config.id && sectionInfo) {
			void plugin.embedIdInjector.ensureEmbedId(
				sourcePath,
				sectionInfo.lineStart,
				sectionInfo.lineEnd,
			);
		}
		const container = mountCodeBlockChat(plugin, el, parsed.config, {
			sourcePath,
			blockId: parsed.config.id ?? blockId,
			lineStart,
		});
		child.onunload = () => container.unmount();
	} else {
		const root = mountAgentButtonBlock(plugin, el, parsed.config, {
			sourcePath,
			lineStart,
		});
		child.onunload = () => root.unmount();
	}
	ctx.addChild(child);
}
