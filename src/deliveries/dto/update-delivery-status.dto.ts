import { IsString, IsOptional, IsIn } from 'class-validator';

export class UpdateDeliveryStatusDto {
  @IsString()
  status: string;

  @IsOptional()
  @IsString()
  riderNote?: string;

  @IsOptional()
  @IsString()
  failureReason?: string;

  // Handover verification: a delivery can only be closed once the rider has
  // logged how the customer paid at the door.
  @IsOptional()
  @IsIn(['cash', 'pos', 'transfer'])
  paymentMethod?: 'cash' | 'pos' | 'transfer';

  @IsOptional()
  amountCollected?: string | number;

  @IsOptional()
  @IsString()
  paymentReference?: string;
}
