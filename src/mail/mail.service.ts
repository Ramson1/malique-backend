import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Resend } from 'resend';

@Injectable()
export class MailService {
  private resend: Resend;
  private fromEmail: string;

  constructor(private configService: ConfigService) {
    this.resend = new Resend(this.configService.get<string>('RESEND_API_KEY'));
    this.fromEmail = 'Malique Oil & Gas <noreply@malique-oilgas.com>';
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
                RM ${Number(totalAmount).toFixed(2)}
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
