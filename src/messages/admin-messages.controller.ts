import {
  Body,
  Controller,
  Get,
  Param,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { MessagesService } from './messages.service';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { Roles } from '../common/decorators/roles.decorator';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { ReplyMessageDto, UpdateMessageStatusDto } from './dto/messages.dto';

// Admin communications inbox. Mounted under /admin/messages as its own
// controller so it never collides with the existing /admin BFF routes.
@Controller('admin/messages')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('super_admin', 'admin', 'branch_manager', 'staff')
export class AdminMessagesController {
  constructor(private readonly messagesService: MessagesService) {}

  @Get('unread-count')
  unreadCount() {
    return this.messagesService.unreadCount();
  }

  @Get()
  list(@Query('status') status?: string) {
    return this.messagesService.list(status);
  }

  @Get(':id')
  one(@Param('id') id: string) {
    return this.messagesService.one(id);
  }

  @Patch(':id')
  setStatus(@Param('id') id: string, @Body() dto: UpdateMessageStatusDto) {
    return this.messagesService.setStatus(id, dto);
  }

  @Post(':id/reply')
  @Roles('super_admin', 'admin', 'branch_manager', 'staff')
  reply(
    @Param('id') id: string,
    @Body() dto: ReplyMessageDto,
    @CurrentUser() user: any,
  ) {
    return this.messagesService.reply(id, dto, user?.id);
  }
}
