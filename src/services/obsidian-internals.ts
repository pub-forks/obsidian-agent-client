/**
 * Obsidian Internals
 *
 * Single home for every access to undocumented/internal Obsidian APIs.
 * These exist at runtime but are not part of the public type definitions and
 * may change or disappear in any Obsidian release. Each wrapper is one
 * function per internal API, documents what it depends on and how the plugin
 * degrades when the API is gone, and keeps the fallback local so callers
 * never touch the internals directly.
 *
 * Official public APIs (e.g. `app.secretStorage`, `activeDocument`) do NOT
 * belong here — call them directly.
 */

import {
	Notice,
	type App,
	type DataAdapter,
	type Editor,
	type Vault,
	type WorkspaceLeaf,
} from "obsidian";
import type { EditorView } from "@codemirror/view";

/**
 * `editor.cm` — Obsidian's internal reference to the CodeMirror 6 EditorView.
 * Required for real-time selection tracking via EditorView.updateListener.
 * Returns null when unavailable (internal change or legacy editor mode);
 * callers degrade gracefully (vault-service logs and skips selection tracking).
 */
export function getCm6EditorView(editor: Editor): EditorView | null {
	return (editor as unknown as { cm?: EditorView }).cm ?? null;
}

/**
 * `leaf.updateHeader()` — undocumented method Obsidian core itself uses to
 * refresh tab headers. No-op when missing (the tab title just goes stale
 * until the next re-render).
 */
export function updateLeafHeader(leaf: WorkspaceLeaf): void {
	(leaf as unknown as { updateHeader?: () => void }).updateHeader?.();
}

/**
 * `leaf.id` — undocumented stable identifier of a workspace leaf.
 * Returns null when missing; callers generate their own UUID instead.
 */
export function getStableLeafId(leaf: WorkspaceLeaf): string | null {
	return (leaf as unknown as { id?: string }).id ?? null;
}

/**
 * `vault.getConfig("spellcheck")` — undocumented reader for Obsidian's
 * editor config. Defaults to true when the API or the value is unavailable.
 */
export function getObsidianSpellcheck(app: App): boolean {
	const vault = app.vault as Vault & {
		getConfig?: (key: string) => unknown;
	};
	return (vault.getConfig?.("spellcheck") as boolean | undefined) ?? true;
}

/**
 * `app.setting.open()` / `app.setting.openTabById()` — undocumented settings
 * dialog controller. Shows a Notice when unavailable instead of throwing.
 */
export function openPluginSettingsTab(app: App, pluginId: string): void {
	const setting = (
		app as unknown as {
			setting?: {
				open: () => void;
				openTabById: (id: string) => void;
			};
		}
	).setting;
	if (!setting) {
		new Notice("Unable to open the plugin settings tab.");
		return;
	}
	setting.open();
	setting.openTabById(pluginId);
}

/**
 * `adapter.getResourcePath()` — resolves a vault path to a URI the browser
 * engine can load. Guarded defensively (optional call) in case an adapter
 * implementation lacks it; returns null so callers fall back (icon instead
 * of image).
 */
export function getAdapterResourcePath(
	adapter: DataAdapter,
	path: string,
): string | null {
	return (
		(
			adapter as DataAdapter & {
				getResourcePath?: (path: string) => string;
			}
		).getResourcePath?.(path) ?? null
	);
}
