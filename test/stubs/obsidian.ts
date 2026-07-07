/**
 * Lightweight `obsidian` stub for unit tests.
 *
 * The real `obsidian` module only exists inside the Obsidian runtime, so
 * `vitest.config.mts` aliases the bare `obsidian` import to this file.
 *
 * Exports provided:
 * - `Platform`: flags read at call time by `src/utils/platform.ts` /
 *   `src/utils/paths.ts`. Tests mutate these to exercise platform branches.
 * - `parseYaml`: YAML parser used by `src/utils/agent-block-parser.ts`,
 *   delegated to the `yaml` package.
 * - `TFile` / `TFolder`: class stand-ins with real-class identity so that
 *   `instanceof` checks in the code under test work with fixtures.
 */

import { parse as parseYamlImpl } from "yaml";

export const Platform = {
	isWin: false,
	isMacOS: false,
	isLinux: false,
	isDesktopApp: true,
};

/**
 * Minimal `TFile` stand-in for tests that resolve wikilinks. Only the fields
 * the resolver reads (`path`, `basename`) plus real-class identity so that
 * `resolved instanceof TFile` works with fixtures.
 */
export class TFile {
	path: string;
	basename: string;
	constructor(path: string, basename: string) {
		this.path = path;
		this.basename = basename;
	}
}

/**
 * Minimal `TFolder` stand-in. Used by fakes (e.g. `test/helpers/fake-plugin.ts`)
 * so that folders returned from `getAbstractFileByPath` are truthy but fail
 * `instanceof TFile` checks, matching Obsidian's behavior.
 */
export class TFolder {
	path: string;
	name: string;
	constructor(path: string) {
		this.path = path;
		this.name = path.split("/").pop() ?? path;
	}
}

/**
 * Parse a YAML document. Mirrors Obsidian's `parseYaml`, which is a thin
 * wrapper over the `yaml` package.
 */
export function parseYaml(content: string): unknown {
	return parseYamlImpl(content);
}

/**
 * Split a linktext into path + subpath. Mirrors Obsidian's `parseLinktext`:
 * the subpath keeps its leading '#' and is '' when absent.
 */
export function parseLinktext(linktext: string): {
	path: string;
	subpath: string;
} {
	const hash = linktext.indexOf("#");
	if (hash === -1) return { path: linktext, subpath: "" };
	return { path: linktext.slice(0, hash), subpath: linktext.slice(hash) };
}
