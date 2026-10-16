import { Body, Controller, Ip, Post } from '@nestjs/common';
import { MessagesService } from './messages.service';
import { CreateMessageDto } from './dto/messages.dto';

// Public contact endpoint used by the marketing website. No auth guard — this
// is the intake path for customer enquiries. Throttled in the service.
@Controller('messages')
export class MessagesController {
  constructor(private readonly messagesService: MessagesService) {}

  @Post()
  create(@Body() dto: CreateMessageDto, @Ip() ip: string) {
    return this.messagesService.create(dto, ip || 'unknown');
  }
}
