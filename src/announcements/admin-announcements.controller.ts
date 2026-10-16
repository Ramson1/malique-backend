import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { AnnouncementsService } from './announcements.service';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { Roles } from '../common/decorators/roles.decorator';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import {
  CreateAnnouncementDto,
  UpdateAnnouncementDto,
} from './dto/announcements.dto';

// Admin management of website announcements. Mounted under /admin/announcements
// so it never collides with the public /announcements feed or the /admin BFF.
@Controller('admin/announcements')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('super_admin', 'admin', 'branch_manager')
export class AdminAnnouncementsController {
  constructor(private readonly announcementsService: AnnouncementsService) {}

  @Get()
  list(@Query('status') status?: string) {
    return this.announcementsService.list(status);
  }

  @Get(':id')
  one(@Param('id') id: string) {
    return this.announcementsService.one(id);
  }

  @Post()
  create(@Body() dto: CreateAnnouncementDto, @CurrentUser() user: any) {
    return this.announcementsService.create(dto, user?.id);
  }

  @Patch(':id')
  update(
    @Param('id') id: string,
    @Body() dto: UpdateAnnouncementDto,
    @CurrentUser() user: any,
  ) {
    return this.announcementsService.update(id, dto, user?.id);
  }

  @Delete(':id')
  remove(@Param('id') id: string) {
    return this.announcementsService.remove(id);
  }
}
