import { IsString, IsEmail, IsOptional, MinLength } from 'class-validator';

export class CreateStaffDto {
  @IsEmail()
  email: string;

  @IsString()
  @MinLength(6)
  password: string;

  @IsString()
  @MinLength(2)
  fullName: string;

  @IsOptional()
  @IsString()
  phone?: string;

  @IsString()
  role: string;

  @IsOptional()
  @IsString()
  branchId?: string;
}
