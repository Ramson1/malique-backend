import {
  BadRequestException,
  Body,
  Controller,
  Headers,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  UseGuards,
} from '@nestjs/common';
import { PaymentsService } from './payments.service';
import { JwtAnyAuthGuard } from '../common/guards/jwt-any-auth.guard';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { Roles } from '../common/decorators/roles.decorator';
import { CurrentUser } from '../common/decorators/current-user.decorator';

@Controller('payments')
export class PaymentsController {
  constructor(private readonly paymentsService: PaymentsService) {}

  // Start a Flutterwave checkout for one of the caller's orders.
  @Post('init')
  @UseGuards(JwtAnyAuthGuard)
  @HttpCode(HttpStatus.OK)
  async initPayment(
    @Body() body: { orderId: string },
    @CurrentUser() user: any,
  ) {
    return this.paymentsService.initPayment(body.orderId, user);
  }

  @Post('verify')
  @UseGuards(JwtAnyAuthGuard)
  @HttpCode(HttpStatus.OK)
  async verifyPayment(@Body() body: { reference: string }) {
    return this.paymentsService.verifyPayment(body.reference);
  }

  // Staff confirmation of cash/POS/transfer payments collected in the field.
  @Post(':orderId/confirm')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('super_admin', 'admin', 'branch_manager', 'staff')
  @HttpCode(HttpStatus.OK)
  confirmPayment(
    @Param('orderId') orderId: string,
    @CurrentUser() user: any,
  ) {
    return this.paymentsService.confirmPayment(orderId, user);
  }

  @Post('webhook')
  @HttpCode(HttpStatus.OK)
  async handleWebhook(
    @Body() body: any,
    @Headers('verif-hash') signature: string,
  ) {
    // Flutterwave sends a plain `verif-hash` header that must match the
    // Secret Hash configured in the dashboard. Reject anything else.
    if (!this.paymentsService.isValidWebhookSignature(signature)) {
      throw new BadRequestException('Invalid webhook signature');
    }
    return this.paymentsService.handleWebhook(body);
  }
}
