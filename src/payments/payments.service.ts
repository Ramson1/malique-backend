import {
  BadRequestException,
  Injectable,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { randomBytes, timingSafeEqual } from 'crypto';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class PaymentsService {
  constructor(
    private prisma: PrismaService,
    private configService: ConfigService,
  ) {}

  /**
   * Start a Flutterwave checkout for an order. Amount always comes from the
   * server-computed order total — never from the request body. The inline JS
   * popup is opened by the client with the returned reference; the pending
   * Payment row written here is what verification reconciles against later.
   */
  async initPayment(orderId: string, user: any) {
    const secret = this.configService.get<string>('FLW_SECRET_KEY');
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

    await this.createPaymentRecord(
      order.id,
      Math.round(Number(order.totalAmount)),
      'online',
      reference,
    );

    return { reference };
  }

  /**
   * Flutterwave authenticates webhooks with a plain `verif-hash` header that
   * must match the Secret Hash configured in the dashboard.
   */
  isValidWebhookSignature(signature?: string): boolean {
    const hash = this.configService.get<string>('FLW_WEBHOOK_HASH');
    if (!hash || !signature) return false;
    const a = Buffer.from(hash, 'utf8');
    const b = Buffer.from(signature, 'utf8');
    return a.length === b.length && timingSafeEqual(a, b);
  }

  /**
   * Verify a Flutterwave payment by transaction reference. The gateway is the
   * source of truth: we only flip to success when Flutterwave reports the
   * charge as settled for the exact amount recorded at initiation.
   */
  async verifyPayment(reference: string) {
    const secret = this.configService.get<string>('FLW_SECRET_KEY');
    if (!secret) {
      throw new ServiceUnavailableException('Payments gateway not configured');
    }

    // Find the payment record first so the settled amount can be reconciled
    // against what we asked for.
    const payment = await this.prisma.payment.findFirst({
      where: { transactionRef: reference },
      include: { order: true },
    });
    if (!payment) {
      throw new BadRequestException('Payment record not found');
    }

    const response = await fetch(
      `https://api.flutterwave.com/v3/transactions/verify_by_reference?tx_ref=${encodeURIComponent(reference)}`,
      {
        headers: {
          Authorization: `Bearer ${secret}`,
        },
      },
    );

    const data = await response.json().catch(() => null);

    if (!data?.status || !data?.data) {
      throw new BadRequestException(
        data?.message || 'Payment verification failed',
      );
    }

    const tx = data.data;

    if (tx.status !== 'successful') {
      throw new BadRequestException('Payment was not successful');
    }

    // Flutterwave reports amounts in naira here (unlike Paystack's kobo).
    if (String(tx.currency).toUpperCase() !== 'NGN') {
      throw new BadRequestException('Payment currency mismatch');
    }
    if (Math.round(Number(tx.amount)) !== Number(payment.amount)) {
      throw new BadRequestException('Payment amount mismatch');
    }

    if (payment.status !== 'success') {
      // Update payment status
      await this.prisma.payment.update({
        where: { id: payment.id },
        data: {
          status: 'success',
          paidAt: new Date(),
          gateway: 'flutterwave',
          metadata: tx as any,
        },
      });

      // Update order payment status
      await this.prisma.order.update({
        where: { id: payment.orderId },
        data: {
          paymentStatus: 'paid',
        },
      });
    }

    return {
      message: 'Payment verified successfully',
      reference,
      amount: Number(tx.amount),
    };
  }

  /**
   * Handle Flutterwave webhook events. Settled charges arrive as
   * `charged.completed` (legacy) or `payment.completed` (v3); anything else is
   * acknowledged and ignored. Idempotent — already-settled payments are left
   * untouched.
   */
  async handleWebhook(event: any) {
    const { event: eventType, data } = event ?? {};

    if (eventType === 'charged.completed' || eventType === 'payment.completed') {
      const reference = data?.tx_ref ?? data?.reference;
      if (reference && (!data?.status || data.status === 'successful')) {
        const payment = await this.prisma.payment.findFirst({
          where: { transactionRef: reference },
        });

        if (payment && payment.status !== 'success') {
          await this.prisma.payment.update({
            where: { id: payment.id },
            data: {
              status: 'success',
              paidAt: new Date(),
              gateway: 'flutterwave',
              metadata: data as any,
            },
          });

          await this.prisma.order.update({
            where: { id: payment.orderId },
            data: { paymentStatus: 'paid' },
          });
        }
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
