import { Controller, Get } from '@nestjs/common';
import { AnnouncementsService } from './announcements.service';

// Public read-only feed consumed by the marketing website. No auth guard —
// this surfaces currently-active published announcements to visitors.
@Controller('announcements')
export class AnnouncementsController {
  constructor(private readonly announcementsService: AnnouncementsService) {}

  @Get('active')
  active() {
    return this.announcementsService.active();
  }
}
