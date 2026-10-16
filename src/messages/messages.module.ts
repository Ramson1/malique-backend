import { Module } from '@nestjs/common';
import { MessagesController } from './messages.controller';
import { AdminMessagesController } from './admin-messages.controller';
import { MessagesService } from './messages.service';

// MailModule is @Global, so MailService (used to email replies) injects without
// an explicit import here.
@Module({
  controllers: [MessagesController, AdminMessagesController],
  providers: [MessagesService],
  exports: [MessagesService],
})
export class MessagesModule {}
