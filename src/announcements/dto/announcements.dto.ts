import {
  IsBoolean,
  IsDateString,
  IsIn,
  IsOptional,
  IsString,
  MaxLength,
  MinLength,
} from 'class-validator';

export const ANNOUNCEMENT_TYPES = ['general', 'stock', 'promo', 'price', 'news'] as const;
export const ANNOUNCEMENT_STATUSES = ['draft', 'published', 'archived'] as const;

export type AnnouncementTypeValue = (typeof ANNOUNCEMENT_TYPES)[number];
export type AnnouncementStatusValue = (typeof ANNOUNCEMENT_STATUSES)[number];

// Admin-authored broadcast shown on the marketing website (stock alerts,
// promo prices, price news, general updates). Title + body are required;
// everything else refines how/when it is surfaced.
export class CreateAnnouncementDto {
  @IsString()
  @MinLength(2, { message: 'Title is too short' })
  @MaxLength(160)
  title!: string;

  @IsString()
  @MinLength(2, { message: 'Message is too short' })
  @MaxLength(5000)
  body!: string;

  @IsOptional()
  @IsIn(ANNOUNCEMENT_TYPES, { message: 'type must be general | stock | promo | price | news' })
  type?: AnnouncementTypeValue;

  @IsOptional()
  @IsIn(ANNOUNCEMENT_STATUSES, { message: 'status must be draft | published | archived' })
  status?: AnnouncementStatusValue;

  @IsOptional()
  @IsBoolean()
  pinned?: boolean;

  @IsOptional()
  @IsString()
  @MaxLength(60)
  linkLabel?: string;

  // Either an absolute URL (https://…) or an in-app path (e.g. /order).
  @IsOptional()
  @IsString()
  @MaxLength(500)
  linkUrl?: string;

  @IsOptional()
  @IsDateString()
  startsAt?: string;

  @IsOptional()
  @IsDateString()
  endsAt?: string;
}

// Every field optional so a single PATCH can flip status or edit one column.
export class UpdateAnnouncementDto {
  @IsOptional()
  @IsString()
  @MinLength(2, { message: 'Title is too short' })
  @MaxLength(160)
  title?: string;

  @IsOptional()
  @IsString()
  @MinLength(2, { message: 'Message is too short' })
  @MaxLength(5000)
  body?: string;

  @IsOptional()
  @IsIn(ANNOUNCEMENT_TYPES, { message: 'type must be general | stock | promo | price | news' })
  type?: AnnouncementTypeValue;

  @IsOptional()
  @IsIn(ANNOUNCEMENT_STATUSES, { message: 'status must be draft | published | archived' })
  status?: AnnouncementStatusValue;

  @IsOptional()
  @IsBoolean()
  pinned?: boolean;

  @IsOptional()
  @IsString()
  @MaxLength(60)
  linkLabel?: string;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  linkUrl?: string;

  @IsOptional()
  @IsDateString()
  startsAt?: string;

  @IsOptional()
  @IsDateString()
  endsAt?: string;
}
