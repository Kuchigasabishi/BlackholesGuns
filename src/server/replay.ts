/**
 * §16 deterministic replay: "support deterministic replay from initial state
 * plus accepted action log. A replay under the same rules/matrix versions must
 * produce byte-stable canonical outcomes."
 *
 * A log is the series' initial state plus, per turn, the final (post-lock)
 * actions and the canonical outcome string recorded when the turn was resolved.
 * Replaying re-runs the pure engine and demands the exact same bytes.
 *
 * The timeout RNG is NOT needed to replay: timeout-chosen actions are already
 * recorded as ordinary actions. The seed is stored for audit / reproducing the
 * live session end to end.
 */
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import {
  MATRIX_VERSION,
  RULES_VERSION,
  resolveTurn,
  type Action,
  type GameState,
  type PlayerId,
  type ResolveTurnResult,
} from '../engine';

export type ReplayEntry =
  | {
      readonly type: 'TURN';
      readonly turnId: string;
      /** Final actions, one per living player, in seat order. */
      readonly actions: readonly Action[];
      /** `canonicalTurn(result)` captured when the turn was resolved live. */
      readonly canonical: string;
    }
  | {
      /** A developer test hook rewrote the state (charges, streak, fast-forward). */
      readonly type: 'OVERRIDE';
      readonly reason: string;
      readonly state: GameState;
    };

export interface ReplayLog {
  readonly formatVersion: 1;
  readonly seriesId: string;
  readonly seed: string;
  readonly rulesVersion: string;
  readonly matrixVersion: string;
  readonly initialState: GameState;
  readonly entries: readonly ReplayEntry[];
}

/** The byte-stable representation of one turn's outcome. */
export const canonicalTurn = (result: Pick<ResolveTurnResult, 'events' | 'outcome'>): string =>
  JSON.stringify({ events: result.events, outcome: result.outcome });

export class ReplayError extends Error {
  readonly code: 'VERSION_MISMATCH' | 'OUTCOME_MISMATCH' | 'BAD_LOG';
  readonly entryIndex: number | null;
  constructor(code: ReplayError['code'], message: string, entryIndex: number | null = null) {
    super(message);
    this.name = 'ReplayError';
    this.code = code;
    this.entryIndex = entryIndex;
  }
}

/** Re-executes the log and returns the canonical outcome of every TURN entry, in order. */
export function replay(log: ReplayLog): string[] {
  if (log.formatVersion !== 1) throw new ReplayError('BAD_LOG', `Unknown replay format ${String(log.formatVersion)}`);
  if (log.rulesVersion !== RULES_VERSION || log.matrixVersion !== MATRIX_VERSION) {
    throw new ReplayError(
      'VERSION_MISMATCH',
      `Log is rules ${log.rulesVersion} / matrix ${log.matrixVersion}; this engine is ${RULES_VERSION} / ${MATRIX_VERSION}`,
    );
  }
  let state = log.initialState;
  const outcomes: string[] = [];
  log.entries.forEach((entry, index) => {
    if (entry.type === 'OVERRIDE') {
      state = entry.state;
      return;
    }
    const locked: Record<PlayerId, Action> = {};
    for (const action of entry.actions) locked[action.playerId] = action;
    try {
      const result = resolveTurn(state, locked);
      outcomes.push(canonicalTurn(result));
      state = result.nextState;
    } catch (error) {
      throw new ReplayError('BAD_LOG', `Entry ${index} (${entry.turnId}) could not be resolved: ${String(error)}`, index);
    }
  });
  return outcomes;
}

/** Replays the log and requires every turn to reproduce its recorded bytes exactly. */
export function verifyReplay(log: ReplayLog): string[] {
  const outcomes = replay(log);
  let next = 0;
  log.entries.forEach((entry, index) => {
    if (entry.type !== 'TURN') return;
    if (outcomes[next] !== entry.canonical) {
      throw new ReplayError('OUTCOME_MISMATCH', `Turn ${entry.turnId} (entry ${index}) replayed differently from the recording`, index);
    }
    next++;
  });
  return outcomes;
}

export const serializeReplay = (log: ReplayLog): string => JSON.stringify(log);
export const parseReplay = (text: string): ReplayLog => JSON.parse(text) as ReplayLog;

export interface ReplayStore {
  save(log: ReplayLog): Promise<void>;
}

/** One JSON file per series: `<dir>/<seriesId>.replay.json`. Re-saving overwrites with the longer log. */
export function createFileReplayStore(dir: string): ReplayStore {
  return {
    async save(log) {
      await mkdir(dir, { recursive: true });
      await writeFile(join(dir, `${log.seriesId.replace(/[^A-Za-z0-9._-]/g, '_')}.replay.json`), serializeReplay(log), 'utf8');
    },
  };
}
