import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import webpush from 'web-push';
import { PrismaService } from '../prisma/prisma.service';

export interface PushPayload {
  title: string;
  body: string;
  url: string;
}

export interface ClientSubscription {
  endpoint: string;
  keys: { p256dh: string; auth: string };
}

// VAPID-based web push. Riders are staff-table users, so subscriptions key off
// the user id and any device a rider has signed in on gets the alert.
@Injectable()
export class PushService {
  private readonly logger = new Logger(PushService.name);
  private configured = false;

  constructor(
    private readonly prisma: PrismaService,
    private readonly configService: ConfigService,
  ) {
    const publicKey = this.configService.get<string>('VAPID_PUBLIC_KEY');
    const privateKey = this.configService.get<string>('VAPID_PRIVATE_KEY');
    if (publicKey && privateKey) {
      webpush.setVapidDetails(
        this.configService.get<string>('VAPID_SUBJECT') ||
          'mailto:maliqueoilandgasltd@gmail.com',
        publicKey,
        privateKey,
      );
      this.configured = true;
    } else {
      this.logger.warn(
        'VAPID keys not configured — rider push alerts are disabled.',
      );
    }
  }

  get publicKey(): string {
    return this.configService.get<string>('VAPID_PUBLIC_KEY') || '';
  }

  get enabled(): boolean {
    return this.configured;
  }

  async subscribe(userId: string, sub: ClientSubscription) {
    if (!sub?.endpoint || !sub?.keys?.p256dh || !sub?.keys?.auth) {
      throw new BadRequestException('Incomplete push subscription');
    }
    return this.prisma.pushSubscription.upsert({
      where: { endpoint: sub.endpoint },
      create: { userId, endpoint: sub.endpoint, keys: sub.keys as any },
      update: { userId, keys: sub.keys as any },
    });
  }

  async unsubscribe(endpoint: string) {
    if (!endpoint) return { removed: 0 };
    const res = await this.prisma.pushSubscription.deleteMany({
      where: { endpoint },
    });
    return { removed: res.count };
  }

  // Fire-and-forget: a push failure must never break the dispatch request.
  async notifyUser(userId: string, payload: PushPayload) {
    if (!this.configured || !userId) return { sent: 0 };
    const subs = await this.prisma.pushSubscription.findMany({
      where: { userId },
    });
    const results = await Promise.allSettled(
      subs.map((s: any) => this.send(s, payload)),
    );
    return { sent: results.filter((r) => r.status === 'fulfilled').length };
  }

  notifyRidersAssigned(
    riderId: string,
    job: { orderNumber?: string; address?: string },
  ) {
    const title = 'New delivery assigned';
    const body = [job.orderNumber, job.address].filter(Boolean).join(' · ');
    return this.notifyUser(riderId, {
      title,
      body: body || 'Open the rider app to start the job.',
      url: '/dashboard/active',
    }).catch((err) => this.logger.debug(`Push skipped: ${err?.message}`));
  }

  private async send(sub: any, payload: PushPayload) {
    const timeout = new Promise((_, reject) =>
      setTimeout(() => reject(new Error('push send timed out')), 3000),
    );
    try {
      await Promise.race([
        webpush.sendNotification(
          { endpoint: sub.endpoint, keys: sub.keys as any },
          JSON.stringify(payload),
        ),
        timeout,
      ]);
    } catch (err: any) {
      // 404/410 means the subscription is gone — drop it so we stop retrying.
      if (err?.statusCode === 404 || err?.statusCode === 410) {
        await this.prisma.pushSubscription
          .delete({ where: { id: sub.id } })
          .catch(() => undefined);
      } else {
        this.logger.debug(`Push failed for ${sub.id}: ${err?.message}`);
      }
      throw err;
    }
  }
}
