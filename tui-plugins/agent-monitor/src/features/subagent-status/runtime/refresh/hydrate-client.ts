// Status-hydration — client API / TUI state wrappers around shared hydration logic.
//
// Originally part of refresh.ts; extracted here to reduce file sprawl.

import type { TuiPluginApi } from '@opencode-ai/plugin/tui';

import { deriveSessionStatus, deriveTerminalSessionStatus } from '../../domain/session-status.ts';
import { markChildRunning, markChildStatus } from '../../domain/state/mutations.ts';
import type { SubagentState } from '../../domain/types.ts';
import { debugLog } from '../../shared/display.ts';

import { createSessionClientBoundary } from '../session/session-client.ts';

import {
  analyzeMessages,
  createTuiMessageActivityCache,
  emptyMessageActivity,
  groupTargetRowsBySessionID,
  hydrateChildFromSessionActivity,
  isRecoveryProtectedFromRunning,
  type MessageActivity,
  type RunningEvidenceCollector,
  type StatusHydrationOptions,
} from './hydrate.ts';

export const hydrateChildStatusesFromClient = async (
  api: TuiPluginApi,
  state: SubagentState,
  targetSessionIDs: readonly string[],
  runningEvidenceSessionIDs?: RunningEvidenceCollector,
  options?: StatusHydrationOptions,
): Promise<boolean> => {
  if (targetSessionIDs.length === 0) return false;

  const sessionClient = createSessionClientBoundary(api);
  const targetSessionIDSet = new Set(targetSessionIDs);

  const targetsBySessionID = groupTargetRowsBySessionID(state, targetSessionIDSet);
  if (targetsBySessionID.size === 0) return false;

  let statusBySessionID: Record<string, unknown> = {};
  let statusFetchFailed = false;

  try {
    statusBySessionID = await sessionClient.readStatusMap();
  } catch (e) {
    console.warn(
      '[agent-monitor] Failed to fetch client session status map:',
      e instanceof Error ? e.message : String(e),
    );
    statusBySessionID = {};
    statusFetchFailed = true;
  }

  let changed = false;
  const getTuiMessageActivity = createTuiMessageActivityCache(api);

  await Promise.all(
    [...targetsBySessionID.entries()].map(async ([sessionId, children]) => {
      const clientSessionStatus = statusBySessionID[sessionId];
      if (statusFetchFailed) runningEvidenceSessionIDs?.add(sessionId);
      const clientStatus = deriveSessionStatus(clientSessionStatus);
      const blockRunningEvidence = isRecoveryProtectedFromRunning(sessionId, options);
      const clientTerminalStatus = deriveTerminalSessionStatus(clientSessionStatus);

      // Running path — client-specific: enriches timestamp with TUI live activity fallback
      if (clientStatus === 'running') {
        if (blockRunningEvidence) {
          debugLog(`[subagent-status] hydration-client: ${sessionId} protected from running (recovery terminal)`);
          return;
        }

        let clientActivity = emptyMessageActivity();

        try {
          clientActivity = analyzeMessages(await sessionClient.readMessages(sessionId));
        } catch (e) {
          console.warn(
            `[agent-monitor] Failed to read messages for session ${sessionId}:`,
            e instanceof Error ? e.message : String(e),
          );
          runningEvidenceSessionIDs?.add(sessionId);
          clientActivity = emptyMessageActivity();
        }

        if (clientActivity.summary.evidence !== 'ambiguous' && clientActivity.summary.status) {
          for (const child of children) {
            changed =
              markChildStatus(state, child.id, clientActivity.summary.status, clientActivity.summary.endedAt) ||
              changed;
          }
          return;
        }

        const latestActivityAt =
          clientActivity.latestLiveActivityAt ?? getTuiMessageActivity(sessionId).latestLiveActivityAt;

        runningEvidenceSessionIDs?.add(sessionId);
        for (const child of children) {
          changed = markChildRunning(state, child.id, latestActivityAt ?? child.updatedAt) || changed;
        }

        return;
      }

      // Non-running — read client messages and build activity
      let clientActivity = emptyMessageActivity();

      try {
        clientActivity = analyzeMessages(await sessionClient.readMessages(sessionId));
      } catch (e) {
        console.warn(
          `[agent-monitor] Failed to read messages for session ${sessionId}:`,
          e instanceof Error ? e.message : String(e),
        );
        runningEvidenceSessionIDs?.add(sessionId);
        clientActivity = emptyMessageActivity();
      }

      const nextStatus = clientTerminalStatus ?? clientActivity.summary.status;
      debugLog(
        `[subagent-status] hydration-client: ${sessionId} clientStatus=${clientStatus} clientTerminal=${clientTerminalStatus} nextStatus=${nextStatus}`,
      );

      // Enrich latestActivityAt with TUI fallback (for terminal path endedAt)
      // latestLiveActivityAt is NOT enriched (no-status running evidence uses client-only timestamps)
      const tuiActivity = getTuiMessageActivity(sessionId);
      const enrichedActivity: MessageActivity = {
        summary: clientActivity.summary,
        latestActivityAt: clientActivity.latestActivityAt ?? tuiActivity.latestActivityAt,
        latestLiveActivityAt: clientActivity.latestLiveActivityAt,
      };

      // Delegate all non-running paths (no-status running evidence, terminal, ambiguous guard) to shared function
      changed =
        hydrateChildFromSessionActivity(sessionId, children, clientSessionStatus, enrichedActivity, state, {
          runningEvidenceIDs: runningEvidenceSessionIDs,
          options,
        }) || changed;
    }),
  );

  if (changed) state.updatedAt = new Date().toISOString();

  return changed;
};

export const hydrateChildStatusesFromTuiState = (
  api: TuiPluginApi,
  state: SubagentState,
  targetSessionIDs: readonly string[],
  runningEvidenceSessionIDs?: RunningEvidenceCollector,
  options?: StatusHydrationOptions,
): boolean => {
  if (targetSessionIDs.length === 0) return false;

  const targetSessionIDSet = new Set(targetSessionIDs);
  const targetsBySessionID = groupTargetRowsBySessionID(state, targetSessionIDSet);
  const getTuiMessageActivity = createTuiMessageActivityCache(api);
  let changed = false;

  for (const [sessionId, children] of targetsBySessionID) {
    const sessionStatus = api.state.session.status(sessionId);

    // TUI-specific early error path: uses latestLiveActivityAt for endedAt
    // (different from the standard endedAt chain used by the shared function)
    if (deriveSessionStatus(sessionStatus) === 'error') {
      const blockRunningEvidence = isRecoveryProtectedFromRunning(sessionId, options);
      if (blockRunningEvidence) continue;

      const latestActivityAt = getTuiMessageActivity(sessionId).latestLiveActivityAt;
      for (const child of children) {
        const endedAt = latestActivityAt ?? child.endedAt ?? child.updatedAt;
        changed = markChildStatus(state, child.id, 'error', endedAt) || changed;
      }
      continue;
    }

    // All other paths (running, terminal from messages, running evidence) handled by shared logic
    const messageActivity = getTuiMessageActivity(sessionId);
    changed =
      hydrateChildFromSessionActivity(sessionId, children, sessionStatus, messageActivity, state, {
        runningEvidenceIDs: runningEvidenceSessionIDs,
        options,
      }) || changed;
  }

  if (changed) state.updatedAt = new Date().toISOString();

  return changed;
};
