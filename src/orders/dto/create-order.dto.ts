import { IsString, IsOptional, IsNumber, IsArray, IsBoolean, ValidateNested } from 'class-validator';
import { Type } from 'class-transformer';

export class OrderItemDto {
  @IsString()
  productId: string;

  @IsNumber()
  sizeKg: number;

  @IsNumber()
  quantity: number;

  @IsNumber()
  unitPrice: number;

  @IsOptional()
  @IsBoolean()
  isRefill?: boolean;

  @IsOptional()
  @IsString()
  cylinderSerial?: string;
}

export class CreateOrderDto {
  @IsString()
  branchId: string;

  // Staff (admin/secretary) may create an order on behalf of a customer.
  // Ignored for customer tokens — the JWT subject always wins.
  @IsOptional()
  @IsString()
  customerId?: string;

  @IsOptional()
  @IsString()
  orderType?: string;

  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => OrderItemDto)
  items: OrderItemDto[];

  @IsOptional()
  @IsNumber()
  deliveryFee?: number;

  @IsOptional()
  @IsNumber()
  discount?: number;

  @IsOptional()
  @IsString()
  notes?: string;

  @IsOptional()
  @IsString()
  deliveryAddress?: string;

  // Contact number for the drop-off (website wizard). Stored on the order
  // notes when provided so riders can call even if the profile lag is stale.
  @IsOptional()
  @IsString()
  deliveryPhone?: string;

  @IsOptional()
  @IsNumber()
  deliveryLat?: number;

  @IsOptional()
  @IsNumber()
  deliveryLng?: number;

  @IsOptional()
  @IsString()
  paymentMethod?: string;
}
