import {
  BadRequestException,
  Body,
  Controller,
  Headers,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  RawBodyRequest,
  Req,
  UseGuards,
} from '@nestjs/common';
import { Request } from 'express';
import { PaymentsService } from './payments.service';
import { JwtAnyAuthGuard } from '../common/guards/jwt-any-auth.guard';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { Roles } from '../common/decorators/roles.decorator';
import { CurrentUser } from '../common/decorators/current-user.decorator';

@Controller('payments')
export class PaymentsController {
  constructor(private readonly paymentsService: PaymentsService) {}

  // Start a Paystack checkout for one of the caller's orders.
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
    @Req() req: RawBodyRequest<Request>,
    @Body() body: any,
    @Headers('x-paystack-signature') signature: string,
  ) {
    // Paystack signs the exact raw JSON body with HMAC-SHA512. Reject
    // anything that does not match the secret key's signature.
    if (!this.paymentsService.isValidWebhookSignature(req.rawBody, signature)) {
      throw new BadRequestException('Invalid webhook signature');
    }
    return this.paymentsService.handleWebhook(body);
  }
}
