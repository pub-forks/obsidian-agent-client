/**
 * Wikilink resolver vocabulary
 *
 * Pure types and helpers for wikilink resolution — no Obsidian imports, so
 * utils/ stays Obsidian-free. The actual resolution against Obsidian's
 * metadata cache lives in `services/wikilink-service.ts`; `VaultService`
 * implements the `IWikilinkResolver` port by delegating there.
 */

export interface LinkedNoteMetadata {
	/** Target note name as written (`[[Foo#Bar]]` → "Foo"). */
	linkText: string;
	/** User-typed alias (`[[Foo|bar]]` → "bar"); undefined when none. */
	displayText?: string;
	/** Section/anchor (`[[Foo#Bar]]` → "Bar"); undefined when none. */
	section?: string;
	/** Vault-relative path of the resolved file; undefined = unresolved. */
	resolvedPath?: string;
}

/** 0-based inclusive line range for scoping links to a selection. */
export interface LineRange {
	fromLine: number;
	toLine: number;
}

/**
 * VaultService-implemented port. Lets `preparePrompt` request resolver work
 * without taking an `App` dependency itself.
 */
export interface IWikilinkResolver {
	getNoteWikiLinks(
		notePath: string,
		lineRange?: LineRange,
	): LinkedNoteMetadata[];
}

/**
 * Extract the user-typed alias from a wikilink's raw text. Obsidian's
 * `displayText` is auto-populated for section links (e.g. "Foo > Bar") even
 * with no alias, so it can't be used as an alias flag — parse `original`
 * instead. Operates on the clean per-link string, not the document, so it is
 * immune to the code-block issue that motivated the cache migration.
 */
export function extractAlias(original: string): string | undefined {
	const inner = original.replace(/^\[\[/, "").replace(/\]\]$/, "");
	const pipe = inner.indexOf("|");
	if (pipe === -1) return undefined;
	const alias = inner.slice(pipe + 1).trim();
	return alias.length > 0 ? alias : undefined;
}
