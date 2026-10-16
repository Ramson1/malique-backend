import { PrismaClient } from '@prisma/client';

/**
 * Generate an order number in the historical Malique format: MOQ-YYYYMMDD-XXX,
 * where XXX is a 1-based sequence within the day. Extracted from OrdersService so
 * both web/phone orders and POS counter sales share a single, consistent generator.
 *
 * This is a best-effort sequence derived from a same-day count; callers creating
 * orders should retry once on a P2002 unique-constraint violation to tolerate the
 * small race window between concurrent sales.
 */
export async function generateOrderNumber(
  prisma: PrismaClient,
  prefix = 'MOQ',
): Promise<string> {
  const today = new Date();
  const dateStr = today.toISOString().slice(0, 10).replace(/-/g, '');

  const startOfDay = new Date(today.setHours(0, 0, 0, 0));
  const endOfDay = new Date(today.setHours(23, 59, 59, 999));

  const todayOrderCount = await prisma.order.count({
    where: {
      createdAt: {
        gte: startOfDay,
        lte: endOfDay,
      },
    },
  });

  const sequence = String(todayOrderCount + 1).padStart(3, '0');
  return `${prefix}-${dateStr}-${sequence}`;
}

/** True when a Prisma error is a unique-constraint violation (P2002). */
export function isUniqueViolation(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    (error as any).code === 'P2002'
  );
}
