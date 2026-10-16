import { IsIn, IsOptional, IsString, Matches } from 'class-validator';

export const REPORT_FORMATS = ['pdf', 'xlsx', 'docx', 'csv'] as const;
export type ReportFormat = (typeof REPORT_FORMATS)[number];

// Shared filter set for every report. Dates are inclusive, "YYYY-MM-DD".
export class ReportQueryDto {
  // Optional so the JSON preview (`:kind/data`) validates without it;
  // the file export falls back to CSV when no format is supplied.
  @IsOptional()
  @IsIn(REPORT_FORMATS, { message: 'format must be pdf | xlsx | docx | csv' })
  format?: ReportFormat;

  @IsOptional()
  @IsString()
  branchId?: string;

  @IsOptional()
  @Matches(/^\d{4}-\d{2}-\d{2}$/, { message: 'from must be YYYY-MM-DD' })
  from?: string;

  @IsOptional()
  @Matches(/^\d{4}-\d{2}-\d{2}$/, { message: 'to must be YYYY-MM-DD' })
  to?: string;

  // Payroll only: the payslip period (YYYY-MM-DD, day ignored).
  @IsOptional()
  @Matches(/^\d{4}-\d{2}-\d{2}$/, { message: 'period must be YYYY-MM-DD' })
  period?: string;

  // Free-text search matched against the dataset's key columns (per builder).
  @IsOptional()
  @IsString()
  search?: string;

  // Status filter (order/delivery/staff/inventory/etc. depending on kind).
  @IsOptional()
  @IsString()
  status?: string;

  // POS/secretary scope: restrict rows to a single staff member id.
  @IsOptional()
  @IsString()
  staffId?: string;

  // Optional explicit row selection (comma-separated uuids) for "export selected".
  @IsOptional()
  @IsString()
  ids?: string;

  // Products only: category filter (UI token, e.g. cylinder-refill).
  @IsOptional()
  @IsString()
  category?: string;

  // Staff only: role filter (UI token, e.g. admin/manager/staff/rider).
  @IsOptional()
  @IsString()
  role?: string;

  // Announcements only: type filter (e.g. promo, notice).
  @IsOptional()
  @IsString()
  type?: string;

  // POS sales only: 'true' = own sales only, 'false' = whole branch scope.
  @IsOptional()
  @IsString()
  mine?: string;
}

// Parse the comma-separated `ids` filter into a clean uuid array (or [] if absent).
export function parseIds(raw?: string): string[] {
  if (!raw) return [];
  return raw
    .split(',')
    .map((s) => s.trim())
    .filter((s) => /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(s));
}

// A neutral, format-agnostic table produced by the data builders.
export interface ReportDataset {
  title: string;
  subtitle: string;
  meta: { label: string; value: string }[];
  headers: string[];
  rows: (string | number)[][];
  // Column indexes that hold currency and should be right-aligned.
  numericCols: number[];
}

export function toRange(from?: string, to?: string): { gte?: Date; lte?: Date } {
  const range: { gte?: Date; lte?: Date } = {};
  if (from) range.gte = new Date(`${from}T00:00:00.000Z`);
  if (to) range.lte = new Date(`${to}T23:59:59.999Z`);
  return range;
}
