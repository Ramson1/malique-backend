import { IsOptional, IsString, MinLength, MaxLength } from 'class-validator';

// Identity is proven two ways at the terminal:
//   possession  -> a scanned, signed badge QR (qrToken) or a typed staff code
//   knowledge   -> the staff PIN (always required)
export class VerifyClockDto {
  @IsOptional()
  @IsString()
  @MaxLength(40)
  staffCode?: string;

  @IsOptional()
  @IsString()
  qrToken?: string;

  @IsString()
  @MinLength(4)
  @MaxLength(8)
  pin!: string;

  @IsString()
  branchId!: string;

  @IsOptional()
  @IsString()
  @MaxLength(300)
  deviceInfo?: string;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  location?: string;
}

// Clock-out needs the same proof but not a branch (they already have one).
export class VerifyClockOutDto {
  @IsOptional()
  @IsString()
  @MaxLength(40)
  staffCode?: string;

  @IsOptional()
  @IsString()
  qrToken?: string;

  @IsString()
  @MinLength(4)
  @MaxLength(8)
  pin!: string;
}
