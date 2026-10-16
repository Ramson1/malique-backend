import { IsIn, IsOptional, IsString } from 'class-validator';

// Set / edit a delivery's scheduling window and priority on the dispatch board.
export class ScheduleDeliveryDto {
  // Accepts an ISO datetime string (from an <input type="datetime-local">).
  @IsOptional()
  @IsString()
  scheduledAt?: string;

  @IsOptional()
  @IsString()
  windowLabel?: string;

  @IsOptional()
  @IsIn(['low', 'normal', 'high'], { message: 'priority must be low | normal | high' })
  priority?: 'low' | 'normal' | 'high';

  @IsOptional()
  @IsString()
  notes?: string;
}

// Move a delivery to a different rider.
export class ReassignRiderDto {
  @IsString()
  riderId!: string;
}

// Drag-and-drop / manual status change on the dispatch board.
export class UpdateBoardStatusDto {
  @IsIn(['assigned', 'picked_up', 'in_transit', 'delivered', 'failed', 'returned'], {
    message: 'invalid delivery status',
  })
  status!: string;
}
