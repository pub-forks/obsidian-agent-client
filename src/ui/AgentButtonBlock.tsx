import * as React from "react";
const { useCallback, useMemo } = React;
import { createRoot, type Root } from "react-dom/client";
import { Notice } from "obsidian";

import type AgentClientPlugin from "../plugin";
import type { AgentButtonBlockConfig } from "../utils/agent-block-parser";
import { findAgentSettings } from "../services/session-helpers";

interface AgentButtonBlockProps {
	plugin: AgentClientPlugin;
	config: AgentButtonBlockConfig;
	mountCtx: AgentButtonMountContext;
}

export interface AgentButtonMountContext {
	sourcePath: string;
	lineStart: number;
}

function resolveAgentId(
	plugin: AgentClientPlugin,
	preferred: string | undefined,
): string {
	// Resolution, not enumeration: an explicit `agent:` pin is honored even
	// while the agent is disabled (same semantics as pinned chat blocks).
	// Only an unknown id falls back to the default agent.
	if (preferred && findAgentSettings(plugin.settings, preferred)) {
		return preferred;
	}
	return plugin.settings.defaultAgentId;
}

function AgentButtonBlockComponent({
	plugin,
	config,
	mountCtx,
}: AgentButtonBlockProps) {
	const resolvedAgentId = useMemo(() => {
		return resolveAgentId(plugin, config.agent);
	}, [plugin, config.agent]);

	const { prompt, autoSend, viewType } = config;

	const handleClick = useCallback(async () => {
		try {
			await plugin.runPromptInChat({
				agentId: resolvedAgentId,
				prompt,
				autoSend: autoSend ?? false,
				viewType: viewType ?? "right-pane",
				sourcePath: mountCtx.sourcePath,
				lineStart: mountCtx.lineStart,
			});
		} catch (error) {
			console.error("[Agent Client] runPromptInChat failed:", error);
			new Notice("Failed to open chat with prompt.");
		}
	}, [
		plugin,
		resolvedAgentId,
		prompt,
		autoSend,
		viewType,
		mountCtx.sourcePath,
		mountCtx.lineStart,
	]);

	return (
		<div className="agent-client-button-block">
			<button
				type="button"
				className="agent-client-button-block-button mod-cta"
				onClick={() => void handleClick()}
			>
				<span className="agent-client-button-block-text">
					{config.text}
				</span>
			</button>
		</div>
	);
}

export function mountAgentButtonBlock(
	plugin: AgentClientPlugin,
	el: HTMLElement,
	config: AgentButtonBlockConfig,
	mountCtx: AgentButtonMountContext,
): Root {
	const container = el.createDiv();
	const root = createRoot(container);
	root.render(
		<AgentButtonBlockComponent
			plugin={plugin}
			config={config}
			mountCtx={mountCtx}
		/>,
	);
	return root;
}
