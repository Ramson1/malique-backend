import { IsEmail, IsIn, IsOptional, IsString, MaxLength, MinLength } from 'class-validator';

// Public contact-form submission. Only `message` is required; everything else
// is best-effort so the form stays friction-friendly.
export class CreateMessageDto {
  @IsOptional()
  @IsString()
  @MaxLength(120)
  name?: string;

  @IsOptional()
  @IsEmail({}, { message: 'Please provide a valid email address' })
  email?: string;

  @IsOptional()
  @IsString()
  @MaxLength(40)
  phone?: string;

  @IsOptional()
  @IsString()
  @MaxLength(160)
  subject?: string;

  @IsString()
  @MinLength(2, { message: 'Message is too short' })
  @MaxLength(5000)
  message!: string;

  @IsOptional()
  @IsString()
  relatedOrderId?: string;
}

export class UpdateMessageStatusDto {
  @IsIn(['new', 'read', 'replied', 'archived'], {
    message: 'status must be new | read | replied | archived',
  })
  status!: 'new' | 'read' | 'replied' | 'archived';
}

// Reply to a message: recorded on the row and emailed to the sender when an
// email address is available.
export class ReplyMessageDto {
  @IsString()
  @MinLength(1, { message: 'Reply cannot be empty' })
  response!: string;

  @IsOptional()
  @IsString()
  @MaxLength(160)
  emailSubject?: string;
}
