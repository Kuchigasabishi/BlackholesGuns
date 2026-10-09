export type EngineErrorCode =
  | 'INVALID_LOBBY'
  | 'SERIES_COMPLETE'
  | 'MISSING_ACTION'
  | 'UNEXPECTED_ACTION'
  | 'INVALID_ACTION';

/** Thrown when the engine is handed input that violates its contract. */
export class EngineError extends Error {
  readonly code: EngineErrorCode;

  constructor(code: EngineErrorCode, message: string) {
    super(message);
    this.name = 'EngineError';
    this.code = code;
  }
}
