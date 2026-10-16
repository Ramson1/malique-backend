import { Type } from 'class-transformer';
import {
  IsIn,
  IsNumber,
  IsOptional,
  IsString,
  Matches,
  Min,
} from 'class-validator';

const PERIOD = /^\d{4}-\d{2}-\d{2}$/;
const ENTRY_TYPES = [
  'basic',
  'allowance',
  'deduction',
  'overtime',
  'bonus',
  'increment',
  'penalty',
] as const;

// Generate draft payslips for a period across a branch (or all branches).
export class GeneratePayrollDto {
  @Matches(PERIOD, { message: 'period must be YYYY-MM-DD' })
  period!: string;

  @IsOptional()
  @IsString()
  branchId?: string;
}

// Add an auditable line item to a staff member's period payslip.
export class AddPayrollEntryDto {
  @IsString()
  userId!: string;

  @Matches(PERIOD, { message: 'period must be YYYY-MM-DD' })
  period!: string;

  @IsIn(ENTRY_TYPES, { message: 'type must be one of ' + ENTRY_TYPES.join(', ') })
  type!: (typeof ENTRY_TYPES)[number];

  @Type(() => Number)
  @IsNumber()
  @Min(0)
  amount!: number;

  @IsOptional()
  @IsString()
  reason?: string;
}

// Move a payslip through draft -> approved -> paid.
export class SetPayrollStatusDto {
  @IsIn(['draft', 'approved', 'paid'], {
    message: 'status must be draft | approved | paid',
  })
  status!: 'draft' | 'approved' | 'paid';
}

export class ListPayrollQueryDto {
  @IsOptional()
  @IsString()
  branchId?: string;

  @IsOptional()
  @Matches(PERIOD, { message: 'period must be YYYY-MM-DD' })
  period?: string;
}
