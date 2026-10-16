// Server-authoritative unit-price resolution shared by the website catalog
// (GET /catalog) and order intake (OrdersService.create). The client never
// decides prices — it only displays what this function resolves.
//
// Resolution order for (product, branch, sizeKg):
//  1. Active ProductPrice override for that exact branch + size (latest
//     effectiveFrom within its validity window wins).
//  2. refill / new_cylinder: basePrice scales linearly by kg against the
//     product's primary size (basePrice is defined for sizes[0]).
//  3. Otherwise (accessories): flat basePrice.

export type PriceProduct = {
  category: string;
  sizes: unknown; // Prisma Float[] -> number[]
  basePrice: unknown; // Prisma Decimal -> Number()
};

export type PriceRow = {
  sizeKg: unknown;
  price: unknown;
  effectiveFrom: Date;
  effectiveTo: Date | null;
};

export function resolveUnitPrice(
  product: PriceProduct,
  prices: PriceRow[],
  sizeKg: number,
): number {
  const base = Number(product.basePrice ?? 0);
  const now = Date.now();

  const candidates = prices
    .filter((p) => Number(p.sizeKg) === Number(sizeKg))
    .filter(
      (p) =>
        p.effectiveFrom.getTime() <= now &&
        (!p.effectiveTo || p.effectiveTo.getTime() >= now),
    )
    .sort((a, b) => b.effectiveFrom.getTime() - a.effectiveFrom.getTime());

  if (candidates.length) {
    return Math.round(Number(candidates[0].price));
  }

  const sizes = Array.isArray(product.sizes) ? (product.sizes as number[]) : [];
  const primary = sizes[0];
  const kgBased =
    product.category === 'refill' || product.category === 'new_cylinder';
  if (kgBased && primary && primary > 0) {
    return Math.round((base * Number(sizeKg)) / primary);
  }
  return Math.round(base);
}
