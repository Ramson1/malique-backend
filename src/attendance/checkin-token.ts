import { createHmac, randomBytes, timingSafeEqual } from 'crypto';

// Shared secret for signing staff badge QR tokens. Falls back to the JWT
// secret so the dev account never needs a second env var to get going.
function secret(): string {
  return (
    process.env.CHECKIN_SECRET ||
    process.env.JWT_SECRET ||
    'malique-dev-checkin-secret'
  );
}

/** Human-friendly, unique-ish staff code (e.g. MQ-4F2A9C). */
export function generateStaffCode(): string {
  return `MQ-${randomBytes(3).toString('hex').toUpperCase()}`;
}

/**
 * A badge token is a signed, offline-verifiable string:
 *   mqt:{userId}:{staffCode}:{sig}
 * The signature ties the printed QR to a specific staff record so a
 * photocopied or hand-typed code from another employee is rejected.
 */
export function signBadgeToken(userId: string, staffCode: string): string {
  const payload = `mqt:${userId}:${staffCode}`;
  const sig = createHmac('sha256', secret()).update(payload).digest('hex').slice(0, 24);
  return `${payload}:${sig}`;
}

export function verifyBadgeToken(
  token: string,
): { userId: string; staffCode: string } | null {
  const parts = String(token || '').split(':');
  if (parts.length !== 4 || parts[0] !== 'mqt') return null;
  const [, userId, staffCode, sig] = parts;
  const payload = `mqt:${userId}:${staffCode}`;
  const expected = createHmac('sha256', secret())
    .update(payload)
    .digest('hex')
    .slice(0, 24);
  const a = Buffer.from(sig);
  const b = Buffer.from(expected);
  if (a.length !== b.length) return null;
  if (!timingSafeEqual(a, b)) return null;
  return { userId, staffCode };
}
