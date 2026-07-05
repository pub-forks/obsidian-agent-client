import { useCallback, useRef, useSyncExternalStore } from "react";
import type AgentClientPlugin from "../plugin";
import type { AgentClientPluginSettings } from "../plugin";

/**
 * Hook for subscribing to plugin settings changes.
 *
 * Uses useSyncExternalStore to safely subscribe to the external settings store,
 * ensuring React re-renders when settings change.
 *
 * @param plugin - Plugin instance containing the settings store
 * @returns Current settings snapshot (AgentClientPluginSettings)
 */
export function useSettings(plugin: AgentClientPlugin) {
	return useSyncExternalStore(
		plugin.settingsService.subscribe,
		plugin.settingsService.getSnapshot,
		plugin.settingsService.getSnapshot,
	);
}

/**
 * Subscribe to a *slice* of settings. The selection is cached with a custom
 * equality check so the component re-renders only when the selected slice
 * actually changes — not on every unrelated settings write (#20).
 *
 * settingsService.updateSettings replaces the whole settings object on every
 * write, so plain useSettings re-renders on any change. This re-implements the
 * cached-snapshot strategy (the same idea as the direct subscribe in
 * useSessionHistory) without pulling in use-sync-external-store/with-selector.
 *
 * `selector` and `isEqual` MUST be referentially stable (module-level or
 * memoized by the caller).
 */
export function useSettingsSelector<T>(
	plugin: AgentClientPlugin,
	selector: (settings: AgentClientPluginSettings) => T,
	isEqual: (a: T, b: T) => boolean,
): T {
	const cacheRef = useRef<{ value: T } | null>(null);

	const getSelection = useCallback((): T => {
		const next = selector(plugin.settingsService.getSnapshot());
		const prev = cacheRef.current;
		if (prev && isEqual(prev.value, next)) {
			// Return the cached reference so useSyncExternalStore sees no change.
			return prev.value;
		}
		cacheRef.current = { value: next };
		return next;
	}, [plugin, selector, isEqual]);

	return useSyncExternalStore(
		plugin.settingsService.subscribe,
		getSelection,
		getSelection,
	);
}
