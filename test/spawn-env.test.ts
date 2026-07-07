import { describe, it, expect, vi } from "vitest";
import { buildSpawnEnv } from "../src/acp/spawn-env";
import type { SpawnEnvOptions } from "../src/acp/spawn-env";

function baseOptions(
	overrides: Partial<SpawnEnvOptions> = {},
): SpawnEnvOptions {
	return {
		baseEnv: { PATH: "/usr/bin", HOME: "/home/me" },
		isWin: false,
		wslMode: false,
		...overrides,
	};
}

describe("buildSpawnEnv", () => {
	it("merges configEnv over baseEnv (configEnv wins)", () => {
		const env = buildSpawnEnv(
			baseOptions({
				baseEnv: { PATH: "/usr/bin", FOO: "base" },
				configEnv: { FOO: "config", BAR: "extra" },
			}),
		);
		expect(env.FOO).toBe("config");
		expect(env.BAR).toBe("extra");
		expect(env.PATH).toBe("/usr/bin");
	});

	it("does not mutate the input baseEnv", () => {
		const input = { PATH: "/usr/bin" };
		buildSpawnEnv(
			baseOptions({
				baseEnv: input,
				configEnv: { PATH: "/other" },
				nodeDir: "/opt/node/bin",
			}),
		);
		expect(input).toEqual({ PATH: "/usr/bin" });
	});

	describe("Windows PATH enhancement", () => {
		it("does not call enhanceWindowsEnv on non-Windows", () => {
			const enhance = vi.fn((env: NodeJS.ProcessEnv) => env);
			buildSpawnEnv(
				baseOptions({ isWin: false, enhanceWindowsEnv: enhance }),
			);
			expect(enhance).not.toHaveBeenCalled();
		});

		it("applies enhanceWindowsEnv on Windows non-WSL", () => {
			const enhance = vi.fn((env: NodeJS.ProcessEnv) => ({
				...env,
				PATH: `C:\\registry;${env.PATH}`,
			}));
			const env = buildSpawnEnv(
				baseOptions({
					baseEnv: { PATH: "C:\\base" },
					isWin: true,
					wslMode: false,
					enhanceWindowsEnv: enhance,
				}),
			);
			expect(enhance).toHaveBeenCalledTimes(1);
			expect(env.PATH).toBe("C:\\registry;C:\\base");
		});

		it("does not call enhanceWindowsEnv on Windows in WSL mode", () => {
			const enhance = vi.fn((env: NodeJS.ProcessEnv) => env);
			buildSpawnEnv(
				baseOptions({
					isWin: true,
					wslMode: true,
					enhanceWindowsEnv: enhance,
				}),
			);
			expect(enhance).not.toHaveBeenCalled();
		});
	});

	describe("nodeDir PATH prepend", () => {
		it("prepends nodeDir with ':' on non-Windows", () => {
			const env = buildSpawnEnv(
				baseOptions({
					baseEnv: { PATH: "/usr/bin" },
					nodeDir: "/opt/node/bin",
				}),
			);
			expect(env.PATH).toBe("/opt/node/bin:/usr/bin");
		});

		it("prepends nodeDir with ';' on Windows", () => {
			const env = buildSpawnEnv(
				baseOptions({
					baseEnv: { PATH: "C:\\Windows" },
					isWin: true,
					nodeDir: "C:\\node",
				}),
			);
			expect(env.PATH).toBe("C:\\node;C:\\Windows");
		});

		it("sets PATH to nodeDir alone when PATH is absent", () => {
			const env = buildSpawnEnv(
				baseOptions({ baseEnv: {}, nodeDir: "/opt/node/bin" }),
			);
			expect(env.PATH).toBe("/opt/node/bin");
		});

		it("prepends nodeDir AFTER the Windows enhancement (nodeDir wins)", () => {
			// Order check (INV-17): registry repair runs first, then nodeDir
			// is prepended so it ends up in FRONT of the enhanced PATH.
			const env = buildSpawnEnv(
				baseOptions({
					baseEnv: { PATH: "C:\\base" },
					isWin: true,
					wslMode: false,
					nodeDir: "C:\\node",
					enhanceWindowsEnv: (e) => ({
						...e,
						PATH: `C:\\registry;${e.PATH}`,
					}),
				}),
			);
			expect(env.PATH).toBe("C:\\node;C:\\registry;C:\\base");
		});
	});

	describe("API key injection (INV-17)", () => {
		it("injects the key when the secret value is non-empty", () => {
			const env = buildSpawnEnv(
				baseOptions({
					apiKey: {
						envVarName: "ANTHROPIC_API_KEY",
						secretValue: "sk-test",
					},
				}),
			);
			expect(env.ANTHROPIC_API_KEY).toBe("sk-test");
		});

		it("does not create the key at all when the secret is null", () => {
			const env = buildSpawnEnv(
				baseOptions({
					apiKey: {
						envVarName: "ANTHROPIC_API_KEY",
						secretValue: null,
					},
				}),
			);
			expect("ANTHROPIC_API_KEY" in env).toBe(false);
		});

		it("does not create the key at all when the secret is empty (empty breaks OAuth logins)", () => {
			const env = buildSpawnEnv(
				baseOptions({
					apiKey: {
						envVarName: "ANTHROPIC_API_KEY",
						secretValue: "",
					},
				}),
			);
			expect("ANTHROPIC_API_KEY" in env).toBe(false);
		});
	});

	describe("WSL mode WSLENV forwarding (#312)", () => {
		it("forwards configEnv keys AND the apiKey env var name via WSLENV", () => {
			// #312 regression: the API key is injected into the spawn env
			// (not config.env), so its name must be added explicitly and
			// the WSLENV build must run AFTER the secret injection.
			const env = buildSpawnEnv(
				baseOptions({
					baseEnv: { PATH: "C:\\Windows" },
					configEnv: { MY_VAR: "value" },
					isWin: true,
					wslMode: true,
					apiKey: {
						envVarName: "ANTHROPIC_API_KEY",
						secretValue: "sk-test",
					},
				}),
			);
			expect(env.WSLENV).toBe("MY_VAR/u:ANTHROPIC_API_KEY/u");
			expect(env.ANTHROPIC_API_KEY).toBe("sk-test");
		});

		it("does not list the apiKey name in WSLENV when the secret is empty", () => {
			// buildWslEnv skips names whose value is absent/empty, so an
			// uninjected key never reaches WSLENV either.
			const env = buildSpawnEnv(
				baseOptions({
					baseEnv: { PATH: "C:\\Windows" },
					configEnv: { MY_VAR: "value" },
					isWin: true,
					wslMode: true,
					apiKey: { envVarName: "ANTHROPIC_API_KEY", secretValue: "" },
				}),
			);
			expect(env.WSLENV).toBe("MY_VAR/u");
			expect("ANTHROPIC_API_KEY" in env).toBe(false);
		});

		it("does not build WSLENV outside WSL mode", () => {
			const env = buildSpawnEnv(
				baseOptions({
					configEnv: { MY_VAR: "value" },
					isWin: true,
					wslMode: false,
				}),
			);
			expect("WSLENV" in env).toBe(false);
		});
	});
});
