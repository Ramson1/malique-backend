import { Body, Controller, Get, Post, UseGuards } from '@nestjs/common';
import { PushService, ClientSubscription } from './push.service';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { CurrentUser } from '../common/decorators/current-user.decorator';

// Web-push endpoints. Riders are staff-table users, so subscribe/unsubscribe
// require a staff token; the VAPID public key is public so the PWA can read it
// before it ever signs in.
@Controller('push')
export class PushController {
  constructor(private readonly pushService: PushService) {}

  @Get('vapid-public-key')
  getVapidPublicKey() {
    return { key: this.pushService.publicKey };
  }

  @UseGuards(JwtAuthGuard)
  @Post('subscribe')
  subscribe(@CurrentUser() user: any, @Body() body: ClientSubscription) {
    return this.pushService.subscribe(user.id, body);
  }

  @UseGuards(JwtAuthGuard)
  @Post('unsubscribe')
  unsubscribe(@Body() body: { endpoint?: string }) {
    return this.pushService.unsubscribe(body?.endpoint ?? '');
  }
}
