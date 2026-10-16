import { Type } from 'class-transformer';
import {
  IsBoolean,
  IsInt,
  IsOptional,
  IsString,
  Matches,
  Min,
} from 'class-validator';

const HHMM = /^\d{2}:\d{2}$/;

export class CreateShiftDto {
  @IsString()
  branchId!: string;

  @IsString()
  name!: string;

  // Accepted as "HH:mm" wall-clock time.
  @Matches(HHMM, { message: 'startTime must be HH:mm' })
  startTime!: string;

  @Matches(HHMM, { message: 'endTime must be HH:mm' })
  endTime!: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  minStaff?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  capacity?: number;

  @IsOptional()
  @IsBoolean()
  isDefault?: boolean;

  @IsOptional()
  @IsString()
  description?: string;
}

// Assign a staff member to a shift on a specific day.
export class AssignShiftDto {
  @IsString()
  shiftId!: string;

  @IsString()
  userId!: string;

  @Matches(/^\d{4}-\d{2}-\d{2}$/, { message: 'workDate must be YYYY-MM-DD' })
  workDate!: string;

  @IsOptional()
  @IsString()
  branchId?: string;

  @IsOptional()
  @IsString()
  note?: string;
}

export class UpdateAssignmentStatusDto {
  @IsString()
  @Matches(/^(scheduled|present|absent|swapped)$/, {
    message: 'status must be scheduled | present | absent | swapped',
  })
  status!: string;
}
