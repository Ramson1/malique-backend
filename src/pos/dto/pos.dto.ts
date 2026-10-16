import {
  ArrayMinSize,
  IsArray,
  IsBoolean,
  IsIn,
  IsNumber,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';
import { PaginationDto } from '../../common/dto/pagination.dto';

// Payment channels a secretary can settle a counter sale with. Online (card/
// gateway) is intentionally excluded — POS takes physical cash, bank transfer
// confirmation, or a terminal (pos) swipe.
export const POS_PAYMENT_METHODS = ['cash', 'transfer', 'pos'] as const;
export type PosPaymentMethod = (typeof POS_PAYMENT_METHODS)[number];

export class SaleItemDto {
  @IsString()
  productId!: string;

  @IsNumber()
  @Min(0.1)
  sizeKg!: number;

  @IsNumber()
  @Min(1)
  quantity!: number;

  // Optional: overrides the branch catalog price (e.g. a negotiated counter
  // price). When omitted the current ProductPrice for the branch is used.
  @IsOptional()
  @IsNumber()
  @Min(0)
  unitPrice?: number;

  @IsOptional()
  @IsBoolean()
  isRefill?: boolean;

  @IsOptional()
  @IsString()
  @MaxLength(60)
  cylinderSerial?: string;
}

export class CreateSaleDto {
  // Managers may pass a branch explicitly; staff are forced to their own branch
  // server-side regardless of what is sent here.
  @IsOptional()
  @IsString()
  branchId?: string;

  @IsArray()
  @ArrayMinSize(1, { message: 'A sale must contain at least one item' })
  @ValidateNested({ each: true })
  @Type(() => SaleItemDto)
  items!: SaleItemDto[];

  @IsIn(POS_PAYMENT_METHODS, {
    message: `paymentMethod must be one of: ${POS_PAYMENT_METHODS.join(', ')}`,
  })
  paymentMethod!: PosPaymentMethod;

  // Cash tendered (used to compute change). When omitted, the sale is treated
  // as fully settled.
  @IsOptional()
  @IsNumber()
  @Min(0)
  amountPaid?: number;

  @IsOptional()
  @IsNumber()
  @Min(0)
  discount?: number;

  @IsOptional()
  @IsString()
  @Matches(/^\+?[\d\s-]{7,20}$/, { message: 'customerPhone looks invalid' })
  customerPhone?: string;

  @IsOptional()
  @IsString()
  @MaxLength(120)
  customerName?: string;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  notes?: string;
}

export class VoidSaleDto {
  @IsString()
  @MaxLength(300)
  reason!: string;
}

export class PosSalesQueryDto extends PaginationDto {
  @IsOptional()
  @IsString()
  branchId?: string;

  @IsOptional()
  @IsString()
  staffId?: string;

  @IsOptional()
  @IsString()
  mine?: string;

  @IsOptional()
  @IsString()
  from?: string;

  @IsOptional()
  @IsString()
  to?: string;

  @IsOptional()
  @IsString()
  status?: string;

  @IsOptional()
  @IsString()
  search?: string;
}
