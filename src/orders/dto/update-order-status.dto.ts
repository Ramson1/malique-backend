import { IsString, IsOptional } from 'class-validator';

export class UpdateOrderStatusDto {
  @IsString()
  status: string;

  @IsOptional()
  @IsString()
  cancelReason?: string;
}
