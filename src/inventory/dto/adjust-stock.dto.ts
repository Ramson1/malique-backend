import { IsString, IsNumber, IsOptional } from 'class-validator';

export class AdjustStockDto {
  @IsString()
  branchId: string;

  @IsString()
  productId: string;

  @IsNumber()
  sizeKg: number;

  @IsNumber()
  quantityChange: number;
}
