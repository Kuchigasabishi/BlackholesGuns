/** Rule constants fixed by GDD v1.0.4. Nothing here is tunable at runtime. */

/** 1.1.0: attack-vs-attack collisions only happen between players attacking EACH OTHER (see resolveTurn). */
export const RULES_VERSION = '1.1.0';
export const MATRIX_VERSION = 'v2';

export const MIN_PLAYERS = 2;
export const MAX_PLAYERS = 8;

/** §3: Charge cap. A Charge action at the cap leaves the balance at the cap. */
export const MAX_CHARGE = 5;

/** §2: the first player to this many Match Wins wins the series. */
export const SERIES_WIN_TARGET = 10;
/** The host-selectable series targets; `SERIES_WIN_TARGET` is the default. */
export const SERIES_WIN_TARGET_OPTIONS = [3, 5, 10] as const;

/** §9: consecutive no-elimination turns (two players alive) before Sudden Death. */
export const SUDDEN_DEATH_AFTER = 10;
/** §9: consecutive no-elimination turns (10 + 5 additional) before Overtime. */
export const OVERTIME_AFTER = 15;

/** §7: 3-hit Combo, Grenade and Katana select up to this many distinct opponents. */
export const MULTI_TARGET_LIMIT = 3;
