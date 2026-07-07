import { describe, it, expect } from "vitest";
import { truncateTitle } from "../src/utils/text";

describe("truncateTitle", () => {
	it("returns text unchanged when it fits maxLength", () => {
		expect(truncateTitle("short", 10)).toBe("short");
	});

	it("returns text unchanged when length equals maxLength", () => {
		expect(truncateTitle("abcde", 5)).toBe("abcde");
	});

	it("truncates with ellipsis so total length equals maxLength", () => {
		const result = truncateTitle("abcdefghij", 8);
		expect(result).toBe("abcde...");
		expect(result.length).toBe(8);
	});

	it("uses default maxLength of 50", () => {
		const long = "x".repeat(60);
		const result = truncateTitle(long);
		expect(result).toBe("x".repeat(47) + "...");
		expect(result.length).toBe(50);
	});

	it("hard-slices without ellipsis when maxLength <= 3", () => {
		expect(truncateTitle("abcdef", 3)).toBe("abc");
		expect(truncateTitle("abcdef", 2)).toBe("ab");
		expect(truncateTitle("abcdef", 1)).toBe("a");
		expect(truncateTitle("abcdef", 0)).toBe("");
	});

	it("keeps one character plus ellipsis at maxLength 4", () => {
		expect(truncateTitle("abcdef", 4)).toBe("a...");
	});

	it("returns empty string unchanged", () => {
		expect(truncateTitle("", 5)).toBe("");
	});
});
