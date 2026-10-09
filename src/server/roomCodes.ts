import { randomInt } from 'node:crypto';

/** No 0/O/1/I so codes survive being read aloud or typed from a screenshot. */
export const ROOM_CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

export function generateRoomCode(length: number, isTaken: (code: string) => boolean): string {
  for (let attempt = 0; attempt < 1000; attempt++) {
    let code = '';
    for (let i = 0; i < length; i++) code += ROOM_CODE_ALPHABET[randomInt(ROOM_CODE_ALPHABET.length)];
    if (!isTaken(code)) return code;
  }
  throw new Error('Could not allocate a unique room code');
}

export const inviteUrl = (baseUrl: string, roomCode: string): string =>
  `${baseUrl.replace(/\/+$/, '')}/join/${roomCode}`;

const CODE_PATTERN = /^[A-Z0-9]{4,12}$/;

/**
 * Accepts either a bare code ("k7m2qp") or a canonical invite link
 * (".../join/K7M2QP") and returns the normalised code, or null.
 */
export function extractRoomCode(input: unknown): string | null {
  if (typeof input !== 'string') return null;
  const trimmed = input.trim();
  const fromLink = /\/join\/([^/?#\s]+)\/?(?:[?#].*)?$/i.exec(trimmed);
  const candidate = (fromLink ? fromLink[1]! : trimmed).toUpperCase();
  return CODE_PATTERN.test(candidate) ? candidate : null;
}
