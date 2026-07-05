/**
 * Wikilink resolver
 *
 * Reads a note's wikilinks from Obsidian's metadata cache — never by scanning
 * raw note text. The cache excludes links inside code blocks/inline code and
 * separates embeds (`.embeds`) and frontmatter links (`.frontmatterLinks`), so
 * we get body wikilinks only, already tokenized. Each is resolved to its single
 * destination via Obsidian's own linkpath resolution (`getFirstLinkpathDest`).
 */

import { TFile, parseLinktext, type App } from "obsidian";

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
function extractAlias(original: string): string | undefined {
	const inner = original.replace(/^\[\[/, "").replace(/\]\]$/, "");
	const pipe = inner.indexOf("|");
	if (pipe === -1) return undefined;
	const alias = inner.slice(pipe + 1).trim();
	return alias.length > 0 ? alias : undefined;
}

/**
 * Wikilinks in a note's body, from the metadata cache. When `lineRange` is
 * given, only links whose position falls fully within it (for selection
 * scoping). Markdown links and embeds are excluded; each wikilink resolves to
 * a single destination (or unresolved).
 */
export function getNoteWikiLinks(
	app: App,
	notePath: string,
	lineRange?: LineRange,
): LinkedNoteMetadata[] {
	const file = app.vault.getFileByPath(notePath);
	if (!(file instanceof TFile)) return [];

	const links = app.metadataCache.getFileCache(file)?.links ?? [];
	const result: LinkedNoteMetadata[] = [];
	const seen = new Set<string>();

	for (const link of links) {
		// Wikilinks only (skip markdown links [t](p)); embeds live in .embeds.
		if (!link.original.startsWith("[[")) continue;

		// Selection scoping: keep only links fully inside the selected lines.
		if (
			lineRange &&
			(link.position.start.line < lineRange.fromLine ||
				link.position.end.line > lineRange.toLine)
		) {
			continue;
		}

		const { path, subpath } = parseLinktext(link.link);
		if (!path) continue; // in-document anchor like [[#Heading]]

		const section = subpath.startsWith("#") ? subpath.slice(1) : undefined;
		const displayText = extractAlias(link.original);

		const key = `${path}|${displayText ?? ""}|${section ?? ""}`;
		if (seen.has(key)) continue;
		seen.add(key);

		const dest = app.metadataCache.getFirstLinkpathDest(path, notePath);
		result.push({
			linkText: path,
			displayText,
			section: section || undefined,
			resolvedPath: dest?.path,
		});
	}

	return result;
}
