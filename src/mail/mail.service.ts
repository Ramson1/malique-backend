import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Resend } from 'resend';

// Official company inbox (per company.ts / docs) — internal alerts from every
// portal land here. Override with OFFICE_NOTIFY_EMAIL in apps/api/.env.
const DEFAULT_OFFICE_EMAIL = 'maliqueoilandgasltd@gmail.com';

@Injectable()
export class MailService {
  private resend: Resend;
  private fromEmail: string;
  private officeEmail: string;
  private readonly logger = new Logger(MailService.name);

  constructor(private configService: ConfigService) {
    this.resend = new Resend(this.configService.get<string>('RESEND_API_KEY'));
    this.fromEmail = 'Malique Oil & Gas <noreply@malique-oilgas.com>';
    this.officeEmail =
      this.configService.get<string>('OFFICE_NOTIFY_EMAIL') || DEFAULT_OFFICE_EMAIL;
  }

  /**
   * Fire-and-forget internal alert to the official company inbox. Called from
   * every portal's server flow (web orders/enquiries, POS sales, rider status,
   * admin actions). Never throws and never blocks the business operation —
   * delivery trouble is logged, the transaction stands.
   */
  notifyOffice(event: string, details: Record<string, string | number | undefined>) {
    const rows = Object.entries(details).filter(
      ([, v]) => v !== undefined && String(v).trim() !== '',
    );
    void this.resend.emails
      .send({
        from: this.fromEmail,
        to: this.officeEmail,
        subject: `${event} — Malique Oil & Gas`,
        html: this.officeTemplate(event, rows),
      })
      .catch((err: any) =>
        this.logger.warn(`Office notification failed (${event}): ${err?.message ?? err}`),
      );
  }

  // Shared branded layout for office alerts: header band, event title and a
  // label/value table of the details passed to notifyOffice().
  private officeTemplate(
    event: string,
    rows: [string, string | number | undefined][],
  ): string {
    const esc = (v: unknown) =>
      String(v)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');
    const rowsHtml = rows
      .map(
        ([label, value]) => `
            <tr>
              <td style="padding:10px 16px;color:#6b7280;font-size:13px;white-space:nowrap;vertical-align:top;border-bottom:1px solid #f3f4f6;">${esc(label)}</td>
              <td style="padding:10px 16px;color:#111827;font-size:14px;font-weight:600;text-align:right;word-break:break-word;white-space:pre-wrap;">${esc(value)}</td>
            </tr>`,
      )
      .join('');
    return `
      <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
        <div style="background: #1a56db; padding: 20px; text-align: center; border-radius: 8px 8px 0 0;">
          <h1 style="color: white; margin: 0;">Malique Oil & Gas</h1>
          <p style="color: #dbeafe; margin: 6px 0 0; font-size: 13px;">Internal notification — official inbox</p>
        </div>
        <div style="padding: 30px; background: #f9fafb;">
          <h2 style="color: #111827; margin-top: 0;">${event}</h2>
          <table style="width: 100%; border-collapse: collapse; background: white; border-radius: 8px; overflow: hidden; border: 1px solid #e5e7eb;">
            ${rowsHtml}
          </table>
          <p style="color: #9ca3af; font-size: 12px; margin-top: 20px;">
            Sent automatically at ${new Date().toLocaleString('en-NG', { timeZone: 'Africa/Lagos' })} (WAT).
          </p>
        </div>
        <div style="padding: 20px; text-align: center; background: #f3f4f6; border-radius: 0 0 8px 8px;">
          <p style="color: #9ca3af; font-size: 12px; margin: 0;">
            &copy; ${new Date().getFullYear()} Malique Oil & Gas. All rights reserved.
          </p>
        </div>
      </div>
    `;
  }

  async sendOrderConfirmation(
    to: string,
    customerName: string,
    orderNumber: string,
    totalAmount: number | string,
  ) {
    await this.resend.emails.send({
      from: this.fromEmail,
      to,
      subject: `Order Confirmation - ${orderNumber}`,
      html: `
        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
          <div style="background: #1a56db; padding: 20px; text-align: center; border-radius: 8px 8px 0 0;">
            <h1 style="color: white; margin: 0;">Malique Oil & Gas</h1>
          </div>
          <div style="padding: 30px; background: #f9fafb;">
            <h2 style="color: #111827;">Order Confirmed!</h2>
            <p style="color: #374151;">Hi ${customerName},</p>
            <p style="color: #374151;">
              Thank you for your order. Your order <strong>${orderNumber}</strong> has been received and is being processed.
            </p>
            <div style="background: white; padding: 20px; border-radius: 8px; margin: 20px 0;">
              <p style="color: #6b7280; margin: 0;">Order Number</p>
              <p style="color: #111827; font-size: 18px; font-weight: bold; margin: 4px 0;">${orderNumber}</p>
              <p style="color: #6b7280; margin: 12px 0 0;">Total Amount</p>
              <p style="color: #1a56db; font-size: 24px; font-weight: bold; margin: 4px 0;">
                &#8358; ${Number(totalAmount).toLocaleString('en-NG', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
              </p>
            </div>
            <p style="color: #374151;">
              We'll notify you when your order is on its way.
            </p>
          </div>
          <div style="padding: 20px; text-align: center; background: #f3f4f6; border-radius: 0 0 8px 8px;">
            <p style="color: #9ca3af; font-size: 12px; margin: 0;">
              &copy; ${new Date().getFullYear()} Malique Oil & Gas. All rights reserved.
            </p>
          </div>
        </div>
      `,
    });
  }

  // Generic sender used for inbox replies and any ad-hoc templated email.
  async send(to: string, subject: string, html: string) {
    return this.resend.emails.send({ from: this.fromEmail, to, subject, html });
  }

  async sendPasswordReset(to: string, resetUrl: string) {
    await this.resend.emails.send({
      from: this.fromEmail,
      to,
      subject: 'Password Reset Request',
      html: `
        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
          <div style="background: #1a56db; padding: 20px; text-align: center; border-radius: 8px 8px 0 0;">
            <h1 style="color: white; margin: 0;">Malique Oil & Gas</h1>
          </div>
          <div style="padding: 30px; background: #f9fafb;">
            <h2 style="color: #111827;">Password Reset</h2>
            <p style="color: #374151;">Hi there,</p>
            <p style="color: #374151;">
              We received a request to reset your password. Click the button below to set a new password:
            </p>
            <div style="text-align: center; margin: 30px 0;">
              <a href="${resetUrl}" style="background: #1a56db; color: white; padding: 12px 30px; text-decoration: none; border-radius: 6px; font-weight: bold;">
                Reset Password
              </a>
            </div>
            <p style="color: #6b7280; font-size: 14px;">
              This link will expire in 1 hour. If you didn't request a password reset, you can safely ignore this email.
            </p>
          </div>
          <div style="padding: 20px; text-align: center; background: #f3f4f6; border-radius: 0 0 8px 8px;">
            <p style="color: #9ca3af; font-size: 12px; margin: 0;">
              &copy; ${new Date().getFullYear()} Malique Oil & Gas. All rights reserved.
            </p>
          </div>
        </div>
      `,
    });
  }
}
