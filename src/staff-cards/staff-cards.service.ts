import { Injectable, NotFoundException } from '@nestjs/common';
import type { Response } from 'express';
import * as QRCode from 'qrcode';
import PDFDocument from 'pdfkit';
import { PrismaService } from '../prisma/prisma.service';
import {
  generateStaffCode,
  signBadgeToken,
} from '../attendance/checkin-token';

// CR80 card size in points (3.375in x 2.125in) — prints to a standard ID card.
const CARD_W = 243;
const CARD_H = 153;

type Card = InstanceType<typeof PDFDocument>;

const NAVY = '#0f2942';
const NAVY_LIGHT = '#1e3a5f';
const AMBER = '#f59e0b';
const SLATE = '#475569';
const MUTED = '#94a3b8';

// Company-wide identity for the card (Rivers State LPG business).
const BRAND = {
  name: 'MALIQUE OIL & GAS LTD',
  tagline: 'LPG · COOKING GAS',
  phones: ['+234 903 162 8721', '+234 915 597 7415'],
};

@Injectable()
export class StaffCardsService {
  constructor(private readonly prisma: PrismaService) {}

  // Resolve (and if necessary issue) a staff's code + signed badge QR buffer.
  private async badgeFor(userId: string, staffCode: string | null) {
    let code = staffCode;
    if (!code) {
      code = generateStaffCode();
      await this.prisma.user.update({ where: { id: userId }, data: { staffCode: code } });
    }
    const token = signBadgeToken(userId, code);
    const qr = await QRCode.toBuffer(token, { margin: 1, width: 600 });
    return { code, qr };
  }

  // Best-effort avatar fetch; returns null so the caller draws an initials badge.
  private async fetchPhoto(url?: string | null): Promise<Buffer | null> {
    if (!url) return null;
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(4000) });
      if (!res.ok) return null;
      const ab = await res.arrayBuffer();
      return Buffer.from(ab);
    } catch {
      return null;
    }
  }

  private initials(name: string): string {
    return name
      .split(/\s+/)
      .filter(Boolean)
      .slice(0, 2)
      .map((p) => p[0]?.toUpperCase() ?? '')
      .join('');
  }

  private roleLabel(role: string): string {
    return role === 'branch_manager'
      ? 'Branch Manager'
      : role === 'admin'
        ? 'Administrator'
        : role === 'super_admin'
          ? 'Super Administrator'
          : 'Staff';
  }

  // Draw a photo panel: real image if present, else an initials circle.
  private drawPhoto(doc: Card, x: number, y: number, w: number, h: number, photo: Buffer | null, name: string) {
    doc.save();
    doc.rect(x, y, w, h).fill('#e2e8f0');
    if (photo) {
      try {
        doc.image(photo, x, y, { fit: [w, h], align: 'center', valign: 'center' });
      } catch {
        // Corrupt/unembeddable image — fall through to initials.
        const cx = x + w / 2;
        const cy = y + h / 2;
        doc.circle(cx, cy, Math.min(w, h) / 2 - 6).fill(NAVY_LIGHT);
        doc.fillColor('#fff').fontSize(20).text(this.initials(name), cx - 20, cy - 10, { width: 40, align: 'center' });
      }
    } else {
      const cx = x + w / 2;
      const cy = y + h / 2;
      doc.circle(cx, cy, Math.min(w, h) / 2 - 6).fill(NAVY_LIGHT);
      doc.fillColor('#fff').fontSize(20).text(this.initials(name), cx - 20, cy - 10, { width: 40, align: 'center' });
    }
    doc.restore();
  }

  // Draw a single staff member's front + back pages onto an open doc.
  private drawCard(doc: Card, staff: any, badge: { code: string; qr: Buffer }, photo: Buffer | null) {
    const newPage = () => doc.addPage({ size: [CARD_W, CARD_H], margin: 0 });

    // ── FRONT ──
    newPage();
    doc.rect(0, 0, CARD_W, 30).fill(NAVY);
    doc.rect(0, 30, CARD_W, 2).fill(AMBER);
    doc.fillColor('#ffffff').fontSize(11).font('Helvetica-Bold')
      .text(BRAND.name, 8, 7, { width: CARD_W - 16, ellipsis: true });
    doc.fillColor(AMBER).fontSize(6).font('Helvetica')
      .text(BRAND.tagline, 8, 19);

    const photoW = 46;
    const photoH = 58;
    this.drawPhoto(doc, 10, 42, photoW, photoH, photo, staff.fullName);

    const tx = 10 + photoW + 8;
    const tw = CARD_W - tx - 44; // leave room for the QR
    doc.fillColor(NAVY).fontSize(9.5).font('Helvetica-Bold')
      .text(staff.fullName, tx, 42, { width: tw, ellipsis: true });
    doc.font('Helvetica').fontSize(7).fillColor(SLATE)
      .text(staff.jobTitle || this.roleLabel(staff.role), tx, 56, { width: tw, ellipsis: true });
    doc.fontSize(6.5).fillColor(MUTED)
      .text(`ID: ${badge.code}`, tx, 69, { width: tw });
    doc.fillColor(NAVY_LIGHT).fontSize(6.5)
      .text(this.roleLabel(staff.role), tx, 80, { width: tw });

    // front QR (small)
    try {
      doc.image(badge.qr, CARD_W - 40, 40, { width: 32 });
    } catch { /* ignore */ }

    doc.rect(0, CARD_H - 16, CARD_W, 16).fill('#f1f5f9');
    doc.fillColor(SLATE).fontSize(5.5).font('Helvetica')
      .text('Digital Identity Card · Valid while employed', 8, CARD_H - 11, { width: CARD_W - 16 });

    // ── BACK ──
    newPage();
    doc.rect(0, 0, CARD_W, 22).fill(NAVY_LIGHT);
    doc.fillColor('#ffffff').fontSize(8).font('Helvetica-Bold')
      .text('Branch & Contact Details', 8, 7, { width: CARD_W - 16 });

    const branchName = staff.branch?.name ?? 'Head Office';
    const branchAddress = staff.branch?.address ?? 'Rivers State, Nigeria';
    const branchCity = staff.branch?.city ? `, ${staff.branch.city}` : '';

    doc.fontSize(6.5).font('Helvetica-Bold').fillColor(NAVY).text('BRANCH', 8, 30);
    doc.font('Helvetica').fillColor(SLATE).fontSize(6.5)
      .text(branchName, 8, 40, { width: CARD_W - 60, ellipsis: true })
      .text(`${branchAddress}${branchCity}`, 8, doc.y, { width: CARD_W - 60 });

    doc.moveDown(0.4);
    doc.font('Helvetica-Bold').fillColor(NAVY).fontSize(6.5).text('HOTLINE', 8, doc.y + 2);
    doc.font('Helvetica').fillColor(SLATE).fontSize(6.5)
      .text(BRAND.phones.join('   ·   '), 8, doc.y + 1, { width: CARD_W - 60 });

    doc.font('Helvetica-Bold').fillColor(NAVY).fontSize(6.5).text('IF FOUND, RETURN TO', 8, 100);
    doc.font('Helvetica').fillColor(SLATE).fontSize(6)
      .text('This card is the property of Malique Oil & Gas Ltd. Use of this card is governed by company policy. Lost cards must be reported immediately.',
        8, 110, { width: CARD_W - 24, lineGap: 1 });

    // back QR (larger, the scannable credential)
    try {
      doc.image(badge.qr, CARD_W - 48, 34, { width: 40 });
    } catch { /* ignore */ }
    doc.fillColor(MUTED).fontSize(5).font('Helvetica')
      .text('Scan at check-in', CARD_W - 48, 76, { width: 40, align: 'center' });
  }

  async idCardPdf(id: string, res: Response) {
    const staff = await this.prisma.user.findUnique({
      where: { id },
      include: { branch: { select: { name: true, address: true, city: true } } },
    });
    if (!staff) throw new NotFoundException('Staff member not found');

    const badge = await this.badgeFor(staff.id, staff.staffCode);
    const photo = await this.fetchPhoto(staff.avatarUrl);

    const doc = new PDFDocument({ size: [CARD_W, CARD_H], margin: 0, autoFirstPage: false });
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="id-card-${this.slug(staff.fullName)}.pdf"`);
    doc.pipe(res);
    this.drawCard(doc, staff, badge, photo);
    doc.end();
  }

  async batchPdf(res: Response, branchId?: string) {
    const where: any = { role: { in: ['admin', 'branch_manager', 'staff'] } };
    if (branchId) where.branchId = branchId;
    const rows = await this.prisma.user.findMany({
      where,
      orderBy: { fullName: 'asc' },
      include: { branch: { select: { name: true, address: true, city: true } } },
    });

    const doc = new PDFDocument({ size: [CARD_W, CARD_H], margin: 0, autoFirstPage: false });
    res.setHeader('Content-Type', 'application/pdf');
    const stamp = new Date().toISOString().slice(0, 10);
    res.setHeader('Content-Disposition', `attachment; filename="malique-id-cards-${stamp}.pdf"`);
    doc.pipe(res);

    for (const staff of rows) {
      const badge = await this.badgeFor(staff.id, staff.staffCode);
      const photo = await this.fetchPhoto(staff.avatarUrl);
      this.drawCard(doc, staff, badge, photo);
    }
    if (rows.length === 0) {
      // Ensure at least one page so the download is never an invalid PDF.
      doc.addPage({ size: [CARD_W, CARD_H], margin: 0 });
      doc.fillColor(MUTED).fontSize(8).text('No staff members found.', 12, CARD_H / 2);
    }
    doc.end();
  }

  private slug(name: string): string {
    return name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '') || 'staff';
  }
}
