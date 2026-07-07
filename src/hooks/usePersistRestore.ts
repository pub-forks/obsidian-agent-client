import * as React from "react";
const { useRef, useEffect } = React;

import type { SavedSessionInfo } from "../types/session";

export interface UsePersistRestoreOptions {
	/** True only for `variant === "embedded" && embeddedConfig.persist && embeddedConfig.id`. */
	enabled: boolean;
	/** Stable block id (from AgentChatBlockConfig.id; used as embedId). */
	embedId: string | undefined;
	isSessionReady: boolean;
	/** Current session id (short-circuits when the saved session is already live). */
	sessionId: string | null;
	/** Current agent id (drives the re-spawn pass when the saved agent differs). */
	currentAgentId: string;
	/** sessionHistory.canRestore — bail-out guard when the agent can't load/resume. */
	canRestore: boolean;
	getSavedSessionByEmbedId: (
		embedId: string,
	) => SavedSessionInfo | undefined;
	restoreSession: (sessionId: string, cwd: string) => Promise<void>;
	restartSession: (
		newAgentId?: string,
		overrideCwd?: string,
	) => Promise<void>;
	setAgentCwd: (cwd: string) => void;
}

/**
 * Two-pass restore for persistent embedded blocks: on first ready, look up the
 * block's latest saved conversation by embedId; if it ran under a different
 * agent, re-spawn under that agent first (pass 1), then restore the
 * conversation (pass 2).
 *
 * Coordinates with ChatPanel's mount-init effect (lastInitAgentRef key): that
 * effect is guarded so agentCwd changes made here never re-spawn the agent.
 */
export function usePersistRestore({
	enabled,
	embedId,
	isSessionReady,
	sessionId,
	currentAgentId,
	canRestore,
	getSavedSessionByEmbedId,
	restoreSession,
	restartSession,
	setAgentCwd,
}: UsePersistRestoreOptions): void {
	const persistRestoreAttemptedRef = useRef(false);
	// Tracks whether we've already re-spawned the agent to match a saved
	// conversation before restoring it (prevents a restart loop).
	const persistRestartedRef = useRef(false);

	useEffect(() => {
		if (!enabled || !embedId) return;
		if (!isSessionReady || !sessionId || !currentAgentId) return;
		if (persistRestoreAttemptedRef.current) return;

		// Resolve by the device-neutral embedId ALONE — not filtered by the
		// current agent/cwd — so an unpinned block that switched agents, or one
		// whose conversation lives under a custom "New chat in directory…" cwd,
		// still finds its last session (#5, #11).
		const savedSession = getSavedSessionByEmbedId(embedId);
		if (!savedSession || savedSession.sessionId === sessionId) {
			persistRestoreAttemptedRef.current = true;
			return;
		}

		// restoreSession loads against the CURRENT agent process and cannot
		// switch agents (loadSession/resumeSession run on the live connection).
		// If the saved conversation used a different agent, re-spawn under it
		// first (adopting its cwd), then let this effect re-run to perform the
		// load. setAgentCwd is safe here because the mount-init effect is
		// guarded to run once (hasInitializedRef).
		if (
			savedSession.agentId !== currentAgentId &&
			!persistRestartedRef.current
		) {
			persistRestartedRef.current = true;
			setAgentCwd(savedSession.cwd);
			void restartSession(savedSession.agentId, savedSession.cwd);
			return;
		}

		if (!canRestore) {
			persistRestoreAttemptedRef.current = true;
			return;
		}

		persistRestoreAttemptedRef.current = true;
		// Align agentCwd with the restored conversation so the cwd banner and
		// later first-message saves reflect its real directory (restoreSession
		// itself does not touch agentCwd). Safe under the mount-init guard.
		setAgentCwd(savedSession.cwd);
		void restoreSession(savedSession.sessionId, savedSession.cwd);
	}, [
		enabled,
		embedId,
		isSessionReady,
		sessionId,
		currentAgentId,
		canRestore,
		restoreSession,
		getSavedSessionByEmbedId,
		restartSession,
	]);
}
