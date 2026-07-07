// Characterization tests for src/utils/paths.ts (pure functions only).
// `resolveCommandPath` / `resolveCommandPathInWsl` spawn child processes
// (execFile) and are intentionally out of scope here — per plan PR0.5.
import { describe, it, expect } from "vitest";
import {
	isAbsolutePath,
	resolveCommandDirectory,
	resolveNodeDirectory,
	toRelativePath,
	resolveAbsolutePath,
	buildFileUri,
} from "../src/utils/paths";

describe("isAbsolutePath", () => {
	it("accepts Unix absolute paths", () => {
		expect(isAbsolutePath("/x")).toBe(true);
		expect(isAbsolutePath("/usr/local/bin/node")).toBe(true);
	});

	it("accepts Windows drive paths with either separator", () => {
		expect(isAbsolutePath("C:\\x")).toBe(true);
		expect(isAbsolutePath("C:/x")).toBe(true);
		expect(isAbsolutePath("c:/x")).toBe(true);
	});

	it("rejects relative paths and bare names", () => {
		expect(isAbsolutePath("./x")).toBe(false);
		expect(isAbsolutePath("x")).toBe(false);
		expect(isAbsolutePath("")).toBe(false);
		expect(isAbsolutePath("C:")).toBe(false);
	});
});

describe("resolveCommandDirectory", () => {
	it("returns the directory of a Unix command path", () => {
		expect(resolveCommandDirectory("/usr/local/bin/node")).toBe(
			"/usr/local/bin",
		);
	});

	it("returns the directory of a Windows command path", () => {
		expect(resolveCommandDirectory("C:\\nodejs\\node.exe")).toBe(
			"C:\\nodejs",
		);
	});

	it("uses the last separator of either kind", () => {
		expect(resolveCommandDirectory("C:/a\\b/cmd")).toBe("C:/a\\b");
	});

	it("returns null when there is no separator", () => {
		expect(resolveCommandDirectory("node")).toBe(null);
		expect(resolveCommandDirectory("")).toBe(null);
	});

	it("returns null when the only separator is leading (root-level command)", () => {
		expect(resolveCommandDirectory("/node")).toBe(null);
	});
});

describe("resolveNodeDirectory", () => {
	it("returns the directory for an absolute nodePath", () => {
		expect(resolveNodeDirectory("/usr/local/bin/node")).toBe(
			"/usr/local/bin",
		);
		expect(resolveNodeDirectory("C:\\nodejs\\node.exe")).toBe("C:\\nodejs");
	});

	it("trims surrounding whitespace before resolving", () => {
		expect(resolveNodeDirectory("  /usr/bin/node  ")).toBe("/usr/bin");
	});

	it("returns undefined for empty or undefined setting", () => {
		expect(resolveNodeDirectory(undefined)).toBeUndefined();
		expect(resolveNodeDirectory("")).toBeUndefined();
	});

	it("returns undefined for a bare command name (login shell resolves PATH)", () => {
		expect(resolveNodeDirectory("node")).toBeUndefined();
	});

	it("returns undefined for a root-level absolute path (current behavior)", () => {
		// resolveCommandDirectory("/node") is null, coerced to undefined.
		expect(resolveNodeDirectory("/node")).toBeUndefined();
	});
});

describe("toRelativePath", () => {
	it("relativizes a path under basePath", () => {
		expect(toRelativePath("/vault/notes/a.md", "/vault")).toBe(
			"notes/a.md",
		);
	});

	it("strips trailing slashes on both arguments before comparing", () => {
		expect(toRelativePath("/vault/notes/", "/vault/")).toBe("notes");
	});

	it("returns the absolute path unchanged when not under basePath", () => {
		expect(toRelativePath("/other/a.md", "/vault")).toBe("/other/a.md");
	});

	it("does not treat a sibling prefix as a match", () => {
		expect(toRelativePath("/vaultother/a.md", "/vault")).toBe(
			"/vaultother/a.md",
		);
	});

	it("returns the path unchanged when it equals basePath (current behavior)", () => {
		expect(toRelativePath("/vault", "/vault")).toBe("/vault");
	});
});

describe("resolveAbsolutePath", () => {
	it("joins vault base and relative path with a slash", () => {
		expect(resolveAbsolutePath("folder/note.md", "/vault", false)).toBe(
			"/vault/folder/note.md",
		);
	});

	it("returns the relative path as-is when base is empty", () => {
		expect(resolveAbsolutePath("folder/note.md", "", false)).toBe(
			"folder/note.md",
		);
	});

	it("converts to WSL form when convertToWsl is true", () => {
		expect(resolveAbsolutePath("note.md", "C:\\vault", true)).toBe(
			"/mnt/c/vault/note.md",
		);
	});

	it("leaves non-Windows paths unchanged under convertToWsl (current behavior)", () => {
		expect(resolveAbsolutePath("note.md", "/vault", true)).toBe(
			"/vault/note.md",
		);
	});
});

describe("buildFileUri", () => {
	it("builds file URI for a Unix path", () => {
		expect(buildFileUri("/Users/user/note.md")).toBe(
			"file:///Users/user/note.md",
		);
	});

	it("builds file URI for a Windows path, normalizing backslashes", () => {
		expect(buildFileUri("C:\\Users\\user\\note.md")).toBe(
			"file:///C:/Users/user/note.md",
		);
	});

	it("accepts forward-slash Windows paths", () => {
		expect(buildFileUri("C:/Users/user/note.md")).toBe(
			"file:///C:/Users/user/note.md",
		);
	});

	it("does not percent-encode spaces (current behavior)", () => {
		// QUIRK-8: spec change is a maintainer decision.
		expect(buildFileUri("/Users/user/my note.md")).toBe(
			"file:///Users/user/my note.md",
		);
	});
});
