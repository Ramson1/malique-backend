import {
  BadRequestException,
  Injectable,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createHmac, randomBytes, timingSafeEqual } from 'crypto';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class PaymentsService {
  constructor(
    private prisma: PrismaService,
    private configService: ConfigService,
  ) {}

  /**
   * Start a Paystack checkout for an order. Amount always comes from the
   * server-computed order total — never from the request body.
   */
  async initPayment(orderId: string, user: any) {
    const secret = this.configService.get<string>('PAYSTACK_SECRET_KEY');
    if (!secret) {
      throw new ServiceUnavailableException('Payments gateway not configured');
    }

    const order = await this.prisma.order.findUnique({
      where: { id: orderId },
      include: { customer: true },
    });
    if (!order) throw new NotFoundException('Order not found');
    if (user?.role === 'customer' && order.customerId !== user.id) {
      throw new NotFoundException('Order not found');
    }

    // Each initiation gets a fresh gateway reference; older pending attempts
    // stay as-is and only the one the customer actually completes flips to
    // success (verify + webhook both resolve by reference).
    const reference = `MLQ-${order.orderNumber}-${randomBytes(4).toString('hex').toUpperCase()}`;

    const webUrl = (
      this.configService.get<string>('WEB_APP_URL') || 'http://localhost:3000'
    ).replace(/\/+$/, '');

    const response = await fetch('https://api.paystack.co/transaction/initialize', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${secret}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        email: order.customer.email,
        amount: Math.round(Number(order.totalAmount) * 100), // kobo
        reference,
        callback_url: `${webUrl}/dashboard/orders/${order.id}?verify=1`,
        metadata: { orderId: order.id, orderNumber: order.orderNumber },
      }),
    });
    const data = await response.json().catch(() => null);
    if (!data?.status || !data?.data?.authorization_url) {
      throw new BadRequestException(
        data?.message || 'Could not start the payment. Please try again.',
      );
    }

    await this.createPaymentRecord(
      order.id,
      Math.round(Number(order.totalAmount)),
      'online',
      reference,
    );

    return {
      authorization_url: data.data.authorization_url,
      reference,
      access_code: data.data.access_code,
    };
  }

  /**
   * Paystack signs webhooks with HMAC-SHA512 over the exact raw body.
   */
  isValidWebhookSignature(
    rawBody: string | Buffer | undefined,
    signature?: string,
  ): boolean {
    const secret = this.configService.get<string>('PAYSTACK_SECRET_KEY');
    if (!secret || !rawBody || !signature) return false;
    const expected = createHmac('sha512', secret).update(rawBody).digest('hex');
    const a = Buffer.from(expected, 'utf8');
    const b = Buffer.from(signature, 'utf8');
    return a.length === b.length && timingSafeEqual(a, b);
  }

  /**
   * Verify a Paystack payment by transaction reference
   */
  async verifyPayment(reference: string) {
    const paystackSecret = this.configService.get<string>('PAYSTACK_SECRET_KEY');

    // Verify with Paystack API
    const response = await fetch(
      `https://api.paystack.co/transaction/verify/${encodeURIComponent(reference)}`,
      {
        headers: {
          Authorization: `Bearer ${paystackSecret}`,
          'Content-Type': 'application/json',
        },
      },
    );

    const data = await response.json();

    if (!data.status) {
      throw new BadRequestException('Payment verification failed');
    }

    if (data.data.status !== 'success') {
      throw new BadRequestException('Payment was not successful');
    }

    // Find the payment record
    const payment = await this.prisma.payment.findFirst({
      where: { transactionRef: reference },
      include: { order: true },
    });

    if (!payment) {
      throw new BadRequestException('Payment record not found');
    }

    // Update payment status
    await this.prisma.payment.update({
      where: { id: payment.id },
      data: {
        status: 'success',
        paidAt: new Date(),
        gateway: 'paystack',
        metadata: data.data as any,
      },
    });

    // Update order payment status
    await this.prisma.order.update({
      where: { id: payment.orderId },
      data: {
        paymentStatus: 'paid',
      },
    });

    return {
      message: 'Payment verified successfully',
      reference,
      amount: data.data.amount / 100, // Paystack returns amount in kobo
    };
  }

  /**
   * Handle Paystack webhook events
   */
  async handleWebhook(event: any) {
    const { event: eventType, data } = event;

    if (eventType === 'charge.success') {
      const reference = data.reference;

      const payment = await this.prisma.payment.findFirst({
        where: { transactionRef: reference },
      });

      if (payment && payment.status !== 'success') {
        await this.prisma.payment.update({
          where: { id: payment.id },
          data: {
            status: 'success',
            paidAt: new Date(),
            gateway: 'paystack',
            metadata: data as any,
          },
        });

        await this.prisma.order.update({
          where: { id: payment.orderId },
          data: { paymentStatus: 'paid' },
        });
      }
    }

    return { received: true };
  }

  /**
   * Front-desk / staff confirmation of a payment collected in the field (cash,
   * POS or bank transfer logged by a rider). Flips the newest pending Payment
   * row to success and marks the order paid — the rider app never writes
   * order.paymentStatus itself.
   */
  async confirmPayment(orderId: string, user: any) {
    const order = await this.prisma.order.findUnique({ where: { id: orderId } });
    if (!order) throw new NotFoundException('Order not found');

    if (order.paymentStatus !== 'paid') {
      const pending = await this.prisma.payment.findFirst({
        where: { orderId, status: 'pending' },
        orderBy: { createdAt: 'desc' },
      });
      if (pending) {
        await this.prisma.payment.update({
          where: { id: pending.id },
          data: {
            status: 'success',
            paidAt: new Date(),
            confirmedBy: user?.id,
            gateway: pending.gateway ?? 'manual',
          },
        });
      }
      await this.prisma.order.update({
        where: { id: orderId },
        data: { paymentStatus: 'paid' },
      });
    }

    return {
      message: 'Payment confirmed',
      orderId,
      amount: Number(order.totalAmount),
    };
  }

  /**
   * Create a payment record for an order
   */
  async createPaymentRecord(orderId: string, amount: number, method: string, reference?: string) {
    return this.prisma.payment.create({
      data: {
        orderId,
        amount,
        paymentMethod: method as any,
        transactionRef: reference,
        status: 'pending',
      },
    });
  }
}
