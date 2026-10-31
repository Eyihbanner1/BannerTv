import type { SyncCrypto } from './crypto';

/**
 * The pair relay's alphabet (services/pair/src/rules.ts): no I, L, O, 0 or 1,
 * which are easy to misread on a TV.
 */
export const ACCOUNT_CODE_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
/** 20 symbols of 31: about 99 bits, too many to guess, so no slow key derivation is needed. */
export const ACCOUNT_CODE_LENGTH = 20;

/** A new account code from secure random bytes. */
export function newAccountCode(crypto: Pick<SyncCrypto, 'random'>): string {
  const size = ACCOUNT_CODE_ALPHABET.length;
  // Bytes from here up would make the first few symbols likelier than the rest.
  const limit = 256 - (256 % size);
  let code = '';
  while (code.length < ACCOUNT_CODE_LENGTH) {
    const bytes = crypto.random(32);
    for (let i = 0; i < bytes.length && code.length < ACCOUNT_CODE_LENGTH; i++) {
      const byte = bytes[i]!;
      if (byte < limit) code += ACCOUNT_CODE_ALPHABET.charAt(byte % size);
    }
  }
  return code;
}

/**
 * The code in `input` as typed on the on-screen keyboard, whatever the case
 * and with or without spaces and dashes; null when it cannot be one.
 */
export function readAccountCode(input: string): string | null {
  const code = input.toUpperCase().replace(/[\s-]+/g, '');
  if (code.length !== ACCOUNT_CODE_LENGTH) return null;
  for (let i = 0; i < code.length; i++) {
    if (ACCOUNT_CODE_ALPHABET.indexOf(code.charAt(i)) === -1) return null;
  }
  return code;
}

/** The code as shown: five groups of four, `K7QM 3XTP W9RD HE4A 6BNC`. */
export function formatAccountCode(code: string): string {
  const groups: string[] = [];
  for (let i = 0; i < code.length; i += 4) groups.push(code.substr(i, 4));
  return groups.join(' ');
}
