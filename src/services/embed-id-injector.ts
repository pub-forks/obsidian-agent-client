/**
 * EmbedIdInjector
 *
 * Injects a generated stable id into persist embedded-chat fences that lack
 * one, so the device-local persist mapping survives note rename/move. Moved
 * verbatim from plugin.ts (PR3.3). Depends only on the vault (constructor)
 * and the agent-block parser (import) — not the whole plugin.
 *
 * Defense layers (all preserved, none optional): in-flight guard keyed by
 * sourcePath:lineStart, atomic vault.process read-modify-write, live fence
 * regex sanity check, and re-parse of the live block body before splicing.
 */

import { TFile, type Vault } from "obsidian";
import { parseAgentBlock } from "../utils/agent-block-parser";
import { getLogger } from "../utils/logger";

/**
 * Generate a short, device-neutral block id for persist embedded chats.
 * 16 hex chars derived from crypto.randomUUID — enough entropy for per-note
 * blocks, short enough to hand-edit. Mirrors crypto.randomUUID usage already
 * present across the codebase (e.g. ui/ChatView.tsx, services/message-state.ts).
 */
export function generateEmbedId(): string {
	return crypto.randomUUID().replace(/-/g, "").slice(0, 16);
}

export class EmbedIdInjector {
	/** Guards against concurrent embed-id injection for the same block. */
	private embedIdInjectionInFlight = new Set<string>();

	constructor(private vault: Vault) {}

	/**
	 * Inject a generated stable id into a persist chat fence that lacks one.
	 *
	 * Device-neutral persist mapping keys on this id (not the note path), so
	 * rename/move stays safe. Idempotent: an in-flight guard prevents
	 * concurrent double-injection, and a content check skips fences that
	 * already declare an id (covering the re-render the edit itself triggers).
	 *
	 * Uses app.vault.process (atomic read-modify-write) rather than
	 * vault.modify, per the settled design.
	 */
	async ensureEmbedId(
		sourcePath: string,
		lineStart: number,
		lineEnd: number,
	): Promise<void> {
		if (!sourcePath) return;
		const guardKey = `${sourcePath}:${lineStart}`;
		if (this.embedIdInjectionInFlight.has(guardKey)) return;

		const file = this.vault.getAbstractFileByPath(sourcePath);
		if (!(file instanceof TFile)) return;

		this.embedIdInjectionInFlight.add(guardKey);
		try {
			await this.vault.process(file, (content) => {
				const lines = content.split("\n");
				// Bounds + fence sanity: section info must still match the file.
				if (
					lineStart < 0 ||
					lineEnd >= lines.length ||
					lineStart >= lineEnd
				) {
					return content;
				}
				// Fence sanity: the captured section may be stale (a user
				// edit can move/replace the block before this async pass).
				// Require the live fence to still be an agent-client/agent
				// fence so an unrelated fence never gets an id spliced in.
				if (
					!/^\s*`{3,}\s*(agent-client|agent)(?:\s|$)/.test(
						lines[lineStart],
					)
				) {
					return content;
				}

				// Re-validate the live body through the real parser (single
				// source of truth). Inject only when it is still a persist
				// chat block lacking an id — this also short-circuits the
				// re-render the edit itself triggers.
				const body = lines.slice(lineStart + 1, lineEnd);
				const liveParsed = parseAgentBlock(body.join("\n"));
				if (
					!liveParsed.ok ||
					liveParsed.config.type !== "chat" ||
					!liveParsed.config.persist ||
					liveParsed.config.id
				) {
					return content;
				}

				const indent = lines[lineStart].match(/^\s*/)?.[0] ?? "";
				lines.splice(
					lineStart + 1,
					0,
					`${indent}id: ${generateEmbedId()}`,
				);
				return lines.join("\n");
			});
		} catch (error) {
			getLogger().error(
				`[AgentClient] Failed to inject embed id: ${error}`,
			);
		} finally {
			this.embedIdInjectionInFlight.delete(guardKey);
		}
	}
}
