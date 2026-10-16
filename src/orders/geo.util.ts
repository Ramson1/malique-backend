import { BadRequestException } from '@nestjs/common';

// Great-circle distance between two coordinates in kilometres.
export function haversineKm(
  lat1: number,
  lng1: number,
  lat2: number,
  lng2: number,
): number {
  const R = 6371;
  const toRad = (deg: number) => (deg * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

export type FeeBranch = {
  latitude: number | null;
  longitude: number | null;
  deliveryRadiusKm: unknown; // Prisma Decimal -> Number()
};

// Automated delivery-zone fee, computed server-side so the client can never
// tamper with it. Tiers: <=10km ₦1,000, <=25km ₦2,500, anything else still
// inside the branch service radius ₦3,500. Beyond the radius the address is
// rejected. When no coordinates are available a flat ₦1,500 zone fee applies.
export function computeDeliveryFee(
  branch: FeeBranch | null,
  deliveryLat?: number | null,
  deliveryLng?: number | null,
): number {
  if (
    branch &&
    branch.latitude != null &&
    branch.longitude != null &&
    deliveryLat != null &&
    deliveryLng != null
  ) {
    const km = haversineKm(branch.latitude, branch.longitude, deliveryLat, deliveryLng);
    const radius = Number(branch.deliveryRadiusKm ?? 25);
    if (km > radius) {
      throw new BadRequestException(
        'Delivery address is outside the branch service area',
      );
    }
    if (km <= 10) return 1000;
    if (km <= 25) return 2500;
    return 3500;
  }
  return 1500;
}
