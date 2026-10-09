/** Deployment settings (GDD §18 "Operational configuration"). Gameplay rules are NOT configurable. */
export interface ServerConfig {
  /** Public site origin; invite links are `${baseUrl}/join/{ROOM_CODE}` (§20.3). */
  readonly baseUrl: string;
  /** Length of the COMMIT window in ms. */
  readonly commitWindowMs: number;
  /** How long a disconnected player's seat is held (lobby) / how long an empty room lingers. */
  readonly reconnectGraceMs: number;
  /** Pause between a turn's result and the next OPEN, so clients can animate the reveal (§13). */
  readonly interTurnDelayMs: number;
  readonly roomCodeLength: number;
  /** Allowed CORS origin(s) for the Socket.IO endpoint. */
  readonly corsOrigin: string | readonly string[];
  /**
   * Tunnel mode: build each room's invite link from the request's forwarded host (X-Forwarded-Host/Proto)
   * instead of `baseUrl`, so links point at the ngrok URL whatever it is this session.
   */
  readonly inferBaseUrl: boolean;
  /** Fixes the timeout-attack RNG (tests / replay). Unset = a fresh random seed per room. */
  readonly seed: string | undefined;
  /** Server clock, epoch ms. */
  readonly now: () => number;
}

export const DEFAULT_CONFIG: ServerConfig = {
  baseUrl: 'https://blackholesandguns.io',
  commitWindowMs: 30_000,
  reconnectGraceMs: 60_000,
  interTurnDelayMs: 4_000,
  roomCodeLength: 6,
  corsOrigin: 'https://blackholesandguns.io',
  inferBaseUrl: false,
  seed: undefined,
  now: () => Date.now(),
};
