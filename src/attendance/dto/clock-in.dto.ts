import { IsString, IsOptional } from 'class-validator';

export class ClockInDto {
  @IsString()
  branchId: string;

  @IsOptional()
  @IsString()
  shiftType?: string;

  @IsOptional()
  @IsString()
  notes?: string;
}
