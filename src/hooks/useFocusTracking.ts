import * as React from "react";
const { useRef, useEffect } = React;

import type AgentClientPlugin from "../plugin";

export interface UseFocusTrackingOptions {
	plugin: AgentClientPlugin;
	viewId: string;
	/** External container element for focus tracking (floating uses parent's container) */
	containerElProp?: HTMLElement | null;
}

/**
 * Tracks which chat view was last active (capture-phase focus + click) so
 * workspace hotkeys resolve their target view, and marks this view active on
 * mount.
 *
 * Returns a ref the caller attaches to its rendered container div
 * (sidebar/embedded variants). The effect evaluates
 * `containerElProp ?? containerRef.current` at run time — passing a
 * render-time computed element instead would be null on the first render for
 * sidebar/embedded and, with unchanged deps, never re-run, silently breaking
 * focus tracking (= hotkey target resolution).
 */
export function useFocusTracking({
	plugin,
	viewId,
	containerElProp,
}: UseFocusTrackingOptions): React.RefObject<HTMLDivElement> {
	const containerRef = useRef<HTMLDivElement>(null);
	useEffect(() => {
		const handleFocus = () => {
			plugin.setLastActiveChatViewId(viewId);
		};

		const container = containerElProp ?? containerRef.current;
		if (!container) return;

		container.addEventListener("focus", handleFocus, true);
		container.addEventListener("click", handleFocus);

		// Set as active on mount (first opened view becomes active)
		plugin.setLastActiveChatViewId(viewId);

		return () => {
			container.removeEventListener("focus", handleFocus, true);
			container.removeEventListener("click", handleFocus);
		};
	}, [plugin, viewId, containerElProp]);

	return containerRef;
}
