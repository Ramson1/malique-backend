import { Type } from 'class-transformer';
import {
  ArrayMinSize,
  IsArray,
  IsBoolean,
  IsIn,
  IsNumber,
  IsOptional,
  IsString,
  MinLength,
  ValidateNested,
} from 'class-validator';

export const PRODUCT_CHANGE_TYPES = ['create', 'edit', 'price'] as const;

// One proposed per-size price inside a "price" change. Mirrors the entries
// shape accepted by PUT /admin/products/:id/prices (admin.service.ts).
export class PriceEntryDto {
  @IsNumber()
  sizeKg: number;

  @IsNumber()
  price: number;
}

export class CreateProductChangeDto {
  @IsIn(PRODUCT_CHANGE_TYPES)
  type: string;

  // Required for "edit"/"price"; ignored for "create".
  @IsOptional()
  @IsString()
  productId?: string;

  // create/edit fields (UI category tokens, same as the admin products form).
  @IsOptional()
  @IsString()
  @MinLength(2)
  name?: string;

  @IsOptional()
  @IsString()
  category?: string;

  @IsOptional()
  @IsNumber()
  weight?: number;

  @IsOptional()
  @IsNumber()
  price?: number;

  @IsOptional()
  @IsString()
  description?: string;

  @IsOptional()
  @IsString()
  imageUrl?: string;

  // price fields
  @IsOptional()
  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => PriceEntryDto)
  entries?: PriceEntryDto[];

  @IsOptional()
  @IsBoolean()
  allBranches?: boolean;

  @IsOptional()
  @IsString()
  branchId?: string;
}

export class RejectProductChangeDto {
  @IsString()
  @MinLength(3)
  reason: string;
}
