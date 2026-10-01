import { describe, expect, it } from 'vitest';
import {
  base32Decode,
  base32Encode,
  decryptSecret,
  encryptSecret,
  totpCode,
  verifyTotp,
} from '../src/auth/totp';
import { passwordProblem } from '../src/auth/password-policy';

const RFC_SECRET = base32Encode(Buffer.from('12345678901234567890'));

describe('totp', () => {
  it('base32 ida e volta', () => {
    expect(base32Decode(RFC_SECRET).toString()).toBe('12345678901234567890');
  });

  it('bate com o vetor da RFC 6238', () => {
    expect(totpCode(RFC_SECRET, Math.floor(59 / 30))).toBe('287082');
    expect(totpCode(RFC_SECRET, Math.floor(1111111109 / 30))).toBe('081804');
  });

  it('aceita janela ±1 e bloqueia reuso', () => {
    const now = 1_700_000_000_000;
    const step = Math.floor(now / 30000);
    const code = totpCode(RFC_SECRET, step);
    expect(verifyTotp(RFC_SECRET, code, null, now)).toBe(step);
    expect(verifyTotp(RFC_SECRET, code, step, now)).toBeNull();
    expect(verifyTotp(RFC_SECRET, '000000', null, now)).toBeNull();
    expect(verifyTotp(RFC_SECRET, 'abc', null, now)).toBeNull();
  });

  it('cifra e decifra o segredo (AES-GCM) e detecta adulteração', () => {
    const enc = encryptSecret('SEGREDO');
    expect(enc).not.toContain('SEGREDO');
    expect(decryptSecret(enc)).toBe('SEGREDO');
    const parts = enc.split(':');
    parts[3] = Buffer.from('xxxxxxx').toString('base64');
    expect(() => decryptSecret(parts.join(':'))).toThrow();
  });
});

describe('política de senha', () => {
  it('recusa fracas e aceita fortes', () => {
    expect(passwordProblem('curta1A!')).toMatch(/12/);
    expect(passwordProblem('troque-esta-senha')).toMatch(/comum/);
    expect(passwordProblem('somenteminusculas')).toMatch(/tipos/);
    expect(passwordProblem('Jantar-na-Serra-2026')).toBeNull();
  });
});
