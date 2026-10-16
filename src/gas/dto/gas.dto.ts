import { Type } from 'class-transformer';
import {
  IsOptional,
  IsString,
  IsNumber,
  IsDateString,
  Min,
  MaxLength,
} from 'class-validator';

// A branch-scoped gas intake (stock-in) from a supplier.
export class CreateGasPurchaseDto {
  @IsString()
  branchId!: string;

  @IsString()
  @MaxLength(200)
  supplierName!: string;

  @IsDateString()
  purchaseDate!: string;

  @Type(() => Number)
  @IsNumber()
  @Min(0)
  volumeKg!: number;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  unitCost?: number;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  totalCost?: number;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  documentUrl?: string;

  @IsOptional()
  @IsString()
  @MaxLength(1000)
  notes?: string;
}

// A physical gauge reading of a bulk tank, recorded in litres.
export class CreateTankReadingDto {
  @IsString()
  branchId!: string;

  @IsOptional()
  @IsString()
  bulkStorageId?: string;

  @IsDateString()
  readAt!: string;

  @Type(() => Number)
  @IsNumber()
  @Min(0)
  volumeLiters!: number;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  note?: string;
}

// Gas actually dispensed into a cylinder, recorded in kg.
export class CreateCylinderFillDto {
  @IsString()
  cylinderId!: string;

  @IsString()
  branchId!: string;

  @Type(() => Number)
  @IsNumber()
  @Min(0)
  filledKg!: number;

  @IsDateString()
  filledAt!: string;

  @IsOptional()
  @IsString()
  fromReadingId?: string;
}

// Shared query shape for the balance engine + reconcile snapshot.
export class GasBalanceQueryDto {
  @IsOptional()
  @IsString()
  branchId?: string;

  @IsOptional()
  @IsDateString()
  from?: string;

  @IsOptional()
  @IsDateString()
  to?: string;
}
