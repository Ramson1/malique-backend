import {
  Controller,
  Get,
  Post,
  Patch,
  Delete,
  Param,
  Body,
  Query,
  UseGuards,
} from '@nestjs/common';
import { CustomersService } from './customers.service';
import { UpdateProfileDto } from './dto/update-profile.dto';
import { CreateAddressDto } from './dto/address.dto';
import { UpdateAddressDto } from './dto/update-address.dto';
import { JwtAnyAuthGuard } from '../common/guards/jwt-any-auth.guard';
import { CurrentUser } from '../common/decorators/current-user.decorator';

@Controller('customers')
@UseGuards(JwtAnyAuthGuard)
export class CustomersController {
  constructor(private readonly customersService: CustomersService) {}

  @Get('profile')
  getProfile(@CurrentUser() user: any) {
    return this.customersService.getProfile(user.id);
  }

  @Patch('profile')
  updateProfile(
    @CurrentUser() user: any,
    @Body() dto: UpdateProfileDto,
  ) {
    return this.customersService.updateProfile(user.id, dto);
  }

  @Get('orders')
  getOrderHistory(
    @CurrentUser() user: any,
    @Query('page') page: number = 1,
    @Query('limit') limit: number = 10,
  ) {
    return this.customersService.getOrderHistory(user.id, page, limit);
  }

  @Get('addresses')
  getAddresses(@CurrentUser() user: any) {
    return this.customersService.getAddresses(user.id);
  }

  @Post('addresses')
  addAddress(
    @CurrentUser() user: any,
    @Body() dto: CreateAddressDto,
  ) {
    return this.customersService.addAddress(user.id, dto);
  }

  @Patch('addresses/:id')
  updateAddress(
    @CurrentUser() user: any,
    @Param('id') id: string,
    @Body() dto: UpdateAddressDto,
  ) {
    return this.customersService.updateAddress(user.id, id, dto);
  }

  @Delete('addresses/:id')
  removeAddress(
    @CurrentUser() user: any,
    @Param('id') id: string,
  ) {
    return this.customersService.removeAddress(user.id, id);
  }
}
