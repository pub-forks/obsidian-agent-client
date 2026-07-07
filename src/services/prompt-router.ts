/**
 * PromptRouter
 *
 * Owns prompt delivery into chat views: the pending-prompt handler registry
 * (deterministic mount handshake), the queue for prompts that arrive before
 * their target ChatPanel mounts, view targeting (findNearestEmbeddedChat),
 * and runPromptInChat (open/locate a view, then deliver). Moved verbatim from
 * plugin.ts (PR3.3); the plugin keeps thin delegate methods with unchanged
 * signatures (runPromptInChat / registerPendingPromptHandler /
 * findNearestEmbeddedChat).
 *
 * Takes the plugin instance because runPromptInChat creates views through it
 * (same precedent as settings-service). services/ only forbids React imports.
 */

import { Notice } from "obsidian";
import type AgentClientPlugin from "../plugin";
import { VIEW_TYPE_CHAT, type ChatView } from "../ui/ChatView";
import { EmbeddedChatViewContainer } from "../ui/CodeBlockChatView";

export class PromptRouter {
	/**
	 * Pending-prompt handlers keyed by viewId. A ChatPanel registers its
	 * handler on mount; runPromptInChat delivers through it (deterministic
	 * handshake that replaces a timed workspace broadcast).
	 */
	private _pendingPromptHandlers = new Map<
		string,
		(prompt: string, autoSend: boolean) => void
	>();
	/** Prompts queued before their target ChatPanel registered a handler. */
	private _pendingPrompts = new Map<
		string,
		Array<{ prompt: string; autoSend: boolean }>
	>();

	constructor(private plugin: AgentClientPlugin) {}

	findNearestEmbeddedChat(
		sourcePath: string,
		lineStart: number,
	): string | null {
		// Prefer the embedded chat closest at/above the target line (a button
		// usually sits just below its chat). If none are at/above, fall back to
		// the highest chat below. The secondary sort by lineStart keeps the
		// "below" pick deterministic without relying on registry iteration
		// order (which shifts when a block unregisters/re-registers on
		// re-render).
		let above: EmbeddedChatViewContainer | null = null;
		let aboveDistance = Number.POSITIVE_INFINITY;
		let below: EmbeddedChatViewContainer | null = null;

		for (const container of this.plugin.viewRegistry.getByType(
			"embedded",
		)) {
			if (!(container instanceof EmbeddedChatViewContainer)) continue;
			if (container.sourcePath !== sourcePath) continue;
			const distance = lineStart - container.lineStart;
			if (distance >= 0) {
				if (distance < aboveDistance) {
					above = container;
					aboveDistance = distance;
				}
			} else if (!below || container.lineStart < below.lineStart) {
				below = container;
			}
		}

		return (above ?? below)?.viewId ?? null;
	}

	/**
	 * Open a chat view and inject a prompt into it. Used by quick-action
	 * buttons (embedded code blocks, command palette entries, etc.).
	 *
	 * Delivers the prompt to the target ChatPanel via the pending-prompt
	 * registry (see registerPendingPromptHandler): synchronous if the panel is
	 * already mounted, otherwise queued and drained on its next mount.
	 */
	async runPromptInChat(options: {
		agentId: string;
		prompt: string;
		autoSend: boolean;
		viewType: "right-pane" | "floating" | "editor-tab" | "embedded";
		sourcePath?: string;
		lineStart?: number;
	}): Promise<void> {
		const { agentId, prompt, autoSend, viewType, sourcePath, lineStart } =
			options;
		let targetViewId: string | null = null;

		if (viewType === "embedded") {
			targetViewId =
				sourcePath && typeof lineStart === "number"
					? this.findNearestEmbeddedChat(sourcePath, lineStart)
					: null;
			if (!targetViewId) {
				new Notice("No embedded chat block found in this note.");
				return;
			}
		} else if (viewType === "floating") {
			const counterBefore = this.plugin.floatingChatCounter;
			this.plugin.openNewFloatingChat(true);
			targetViewId = `floating-chat-${counterBefore}`;
		} else if (viewType === "editor-tab") {
			const leaf = this.plugin.app.workspace.getLeaf("tab");
			await leaf.setViewState({
				type: VIEW_TYPE_CHAT,
				active: true,
				state: { initialAgentId: agentId },
			});
			await this.plugin.app.workspace.revealLeaf(leaf);
			const view = leaf.view as ChatView;
			targetViewId = view?.viewId ?? null;
		} else {
			// viewType === "right-pane": honor it literally, independent of the
			// user's chatViewLocation default (floating/editor-tab handled above).
			targetViewId = await this.plugin.openNewChatViewWithAgent(
				agentId,
				"right-pane",
			);
		}

		if (!targetViewId) return;

		// Deterministic handshake: deliver now if the target ChatPanel has
		// registered its handler, otherwise queue until it mounts. Replaces a
		// 100ms setTimeout + workspace broadcast that could drop the prompt if
		// the React root mounted late.
		this.deliverPrompt(targetViewId, prompt, autoSend);
	}

	/**
	 * Register a ChatPanel's pending-prompt handler (called on mount). If a
	 * prompt was queued before the panel mounted (runPromptInChat ran first),
	 * it is delivered synchronously here. Returns an unregister function.
	 */
	registerPendingPromptHandler(
		viewId: string,
		handler: (prompt: string, autoSend: boolean) => void,
	): () => void {
		this._pendingPromptHandlers.set(viewId, handler);
		const queued = this._pendingPrompts.get(viewId);
		if (queued) {
			this._pendingPrompts.delete(viewId);
			for (const item of queued) {
				handler(item.prompt, item.autoSend);
			}
		}
		return () => {
			if (this._pendingPromptHandlers.get(viewId) === handler) {
				this._pendingPromptHandlers.delete(viewId);
			}
		};
	}

	private deliverPrompt(
		viewId: string,
		prompt: string,
		autoSend: boolean,
	): void {
		const handler = this._pendingPromptHandlers.get(viewId);
		if (handler) {
			handler(prompt, autoSend);
		} else {
			// Panel not mounted yet; drained by registerPendingPromptHandler.
			const queue = this._pendingPrompts.get(viewId);
			if (queue) {
				queue.push({ prompt, autoSend });
			} else {
				this._pendingPrompts.set(viewId, [{ prompt, autoSend }]);
			}
		}
	}

	/**
	 * Drop any undelivered pending-prompt handlers and queued prompts
	 * (plugin-unload path).
	 */
	clear(): void {
		this._pendingPromptHandlers.clear();
		this._pendingPrompts.clear();
	}
}
