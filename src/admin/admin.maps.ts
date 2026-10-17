// Shared status/enum mapping tokens between the Prisma DB enums and the admin
// portal UI. Both AdminService and ReportsService import these so an exported
// file always shows the exact same labels the dashboard table shows (no drift).

// Coerce a Prisma Decimal | number | null into a plain JS number.
export function num(v: any): number {
  if (v === null || v === undefined) return 0;
  if (typeof v === 'number') return v;
  if (typeof v.toNumber === 'function') return v.toNumber();
  return Number(v) || 0;
}

// Round to 2 decimals for money display/export.
export function money(n: any): number {
  return Math.round((Number(n) || 0) * 100) / 100;
}

// Product category: DB enum <-> admin UI token
export const CATEGORY_TO_UI: Record<string, string> = {
  refill: 'cylinder-refill',
  new_cylinder: 'new-cylinder',
  accessory: 'accessory',
};
export const CATEGORY_TO_DB: Record<string, string> = {
  'cylinder-refill': 'refill',
  'new-cylinder': 'new_cylinder',
  accessory: 'accessory',
};

// Order status: DB enum <-> admin UI token
export const ORDER_STATUS_TO_UI: Record<string, string> = {
  pending: 'pending',
  confirmed: 'confirmed',
  preparing: 'processing',
  out_for_delivery: 'delivering',
  delivered: 'delivered',
  cancelled: 'cancelled',
};
export const ORDER_STATUS_TO_DB: Record<string, string> = {
  pending: 'pending',
  confirmed: 'confirmed',
  processing: 'preparing',
  delivering: 'out_for_delivery',
  delivered: 'delivered',
  cancelled: 'cancelled',
};

// Delivery status: DB enum <-> admin UI token
export const DELIVERY_STATUS_TO_UI: Record<string, string> = {
  assigned: 'pending',
  picked_up: 'delivering',
  in_transit: 'delivering',
  delivered: 'delivered',
  failed: 'pending',
  returned: 'cancelled',
};
export const DELIVERY_STATUS_TO_DB: Record<string, string> = {
  pending: 'assigned',
  delivering: 'in_transit',
  delivered: 'delivered',
  cancelled: 'returned',
};

// Staff role: DB enum <-> admin UI token.
// super_admin is intentionally absent from ROLE_TO_DB so it can never be
// created or assigned through the admin portal (dev-only, seeded directly).
export const ROLE_TO_UI: Record<string, string> = {
  super_admin: 'admin',
  admin: 'admin',
  branch_manager: 'manager',
  staff: 'staff',
  rider: 'rider',
};
export const ROLE_TO_DB: Record<string, string> = {
  admin: 'admin',
  manager: 'branch_manager',
  staff: 'staff',
  rider: 'rider',
};

// Derived stock health label used by the inventory table + exports.
export function inventoryStatus(qty: number, min: number): string {
  if (qty <= 0) return 'out_of_stock';
  if (qty <= Math.floor(min / 2)) return 'critical';
  if (qty <= min) return 'low';
  return 'in_stock';
}
