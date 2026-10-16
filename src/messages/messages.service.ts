import { BadRequestException, Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { MailService } from '../mail/mail.service';
import {
  CreateMessageDto,
  ReplyMessageDto,
  UpdateMessageStatusDto,
} from './dto/messages.dto';

// A tiny, dependency-free throttle for the public contact endpoint so a single
// client cannot flood the inbox. Not distributed — adequate for the MVP surface.
const WINDOW_MS = 5000;
const hits = new Map<string, number>();

function throttle(key: string) {
  const now = Date.now();
  const last = hits.get(key) ?? 0;
  if (now - last < WINDOW_MS) {
    return false;
  }
  hits.set(key, now);
  // Opportunistic cleanup so the map cannot grow unbounded.
  if (hits.size > 5000) {
    for (const [k, t] of hits) if (now - t > WINDOW_MS * 20) hits.delete(k);
  }
  return true;
}

@Injectable()
export class MessagesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly mail: MailService,
  ) {}

  async create(dto: CreateMessageDto, ip: string) {
    if (!throttle(ip)) {
      throw new BadRequestException('Please wait a few seconds before sending again.');
    }
    const created = await this.prisma.contactMessage.create({
      data: {
        name: dto.name ?? null,
        email: dto.email ?? null,
        phone: dto.phone ?? null,
        subject: dto.subject ?? null,
        message: dto.message,
        source: 'website',
        relatedOrderId: dto.relatedOrderId ?? null,
      },
    });
    return { id: created.id, ok: true };
  }

  private map(m: any) {
    return {
      id: m.id,
      name: m.name ?? undefined,
      email: m.email ?? undefined,
      phone: m.phone ?? undefined,
      subject: m.subject ?? undefined,
      message: m.message,
      source: m.source,
      status: m.status,
      relatedOrderId: m.relatedOrderId ?? undefined,
      repliedById: m.repliedById ?? undefined,
      repliedAt: m.repliedAt ? new Date(m.repliedAt).toISOString() : undefined,
      response: m.response ?? undefined,
      createdAt: new Date(m.createdAt).toISOString(),
    };
  }

  async list(status?: string) {
    const where: any = {};
    if (status) where.status = status;
    const rows = await this.prisma.contactMessage.findMany({
      where,
      orderBy: { createdAt: 'desc' },
    });
    return { messages: rows.map((m: any) => this.map(m)) };
  }

  async one(id: string) {
    const m = await this.prisma.contactMessage.findUnique({ where: { id } });
    if (!m) throw new BadRequestException('Message not found');
    // Opening a new message marks it read (without clobbering replied status).
    if (m.status === 'new') {
      await this.prisma.contactMessage.update({ where: { id }, data: { status: 'read' } });
      m.status = 'read';
    }
    return this.map(m);
  }

  async unreadCount() {
    const count = await this.prisma.contactMessage.count({ where: { status: 'new' } });
    return { count };
  }

  async setStatus(id: string, dto: UpdateMessageStatusDto) {
    const updated = await this.prisma.contactMessage.update({
      where: { id },
      data: { status: dto.status },
    });
    return this.map(updated);
  }

  async reply(id: string, dto: ReplyMessageDto, actorId?: string) {
    const m = await this.prisma.contactMessage.findUnique({ where: { id } });
    if (!m) throw new BadRequestException('Message not found');

    const email = m.email;
    const emailSent = !!email;
    if (email) {
      const subject = dto.emailSubject ?? (m.subject ? `Re: ${m.subject}` : 'Reply from Malique Oil & Gas');
      const html = `
        <div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto">
          <div style="background:#0f2942;padding:20px;text-align:center;border-radius:8px 8px 0 0">
            <h1 style="color:#fff;margin:0">Malique Oil &amp; Gas</h1>
          </div>
          <div style="padding:30px;background:#f9fafb">
            <p style="color:#374151">Hello${m.name ? ` ${m.name}` : ''},</p>
            <p style="color:#374151;white-space:pre-wrap">${dto.response.replace(/</g, '&lt;')}</p>
            <p style="color:#9ca3af;font-size:12px;margin-top:24px">This is a reply to your enquiry${m.subject ? ` "${m.subject}"` : ''}.</p>
          </div>
        </div>`;
      // Email failure should not lose the recorded reply — swallow it.
      try {
        await this.mail.send(email, subject, html);
      } catch {
        /* recorded regardless */
      }
    }

    const updated = await this.prisma.contactMessage.update({
      where: { id },
      data: {
        status: 'replied',
        response: dto.response,
        repliedById: actorId ?? null,
        repliedAt: new Date(),
      },
    });
    return { ...this.map(updated), emailSent };
  }
}
