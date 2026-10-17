import { Injectable, NotFoundException } from '@nestjs/common';
import type { Response } from 'express';
import * as QRCode from 'qrcode';
import PDFDocument from 'pdfkit';
import { PrismaService } from '../prisma/prisma.service';
import {
  generateStaffCode,
  signBadgeToken,
} from '../attendance/checkin-token';

// CR80 card size in points, PORTRAIT (2.125in x 3.375in = 153pt x 243pt) —
// the standard vertical employee ID badge.
const CARD_W = 153;
const CARD_H = 243;

type Card = InstanceType<typeof PDFDocument>;

// Malique brand palette (matches the admin tailwind tokens: navy-900/800/700,
// amber-600 gold accent).
const NAVY = '#0A1628';
const NAVY_LIGHT = '#192842';
const NAVY_MID = '#263c63';
const GOLD = '#D4A853';
const GOLD_SOFT = '#e6c583';
const SLATE = '#334155';
const MUTED = '#94a3b8';

// Company-wide identity for the card (Rivers State LPG business).
const BRAND = {
  name: 'MALIQUE OIL & GAS LTD',
  tagline: 'LPG · COOKING GAS · ENERGY',
  email: 'maliqueoilandgasltd@gmail.com',
  phones: ['+234 903 162 8721', '+234 915 597 7415', '+234 903 056 8003'],
};

// Designer / developer attribution shown on the back of every card.
const DESIGNER = {
  name: 'BLACK-BOX TECH',
  role: 'Designed & Developed by',
  email: 'info@blackboxtech.online',
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

  // Draw a photo panel: real image if present, else an initials medallion.
  private drawPhoto(doc: Card, x: number, y: number, w: number, h: number, photo: Buffer | null, name: string) {
    doc.save();
    doc.roundedRect(x, y, w, h, 6).clip();
    doc.rect(x, y, w, h).fill('#eef2f7');
    let drewImage = false;
    if (photo) {
      try {
        doc.image(photo, x, y, { fit: [w, h], align: 'center', valign: 'center' });
        drewImage = true;
      } catch {
        // Corrupt/unembeddable image — fall through to initials.
      }
    }
    if (!drewImage) {
      const cx = x + w / 2;
      const cy = y + h / 2;
      doc.circle(cx, cy, Math.min(w, h) / 2 - 8).fill(NAVY_MID);
      doc.fillColor('#fff').font('Helvetica-Bold').fontSize(22)
        .text(this.initials(name), cx - 30, cy - 11, { width: 60, align: 'center' });
    }
    doc.restore();
    // Gold frame around the photo.
    doc.roundedRect(x, y, w, h, 6).lineWidth(1).stroke(GOLD);
  }

  // Draw a single staff member's front + back pages (portrait) onto an open doc.
  private drawCard(doc: Card, staff: any, badge: { code: string; qr: Buffer }, photo: Buffer | null) {
    const newPage = () => doc.addPage({ size: [CARD_W, CARD_H], margin: 0 });
    const cx = CARD_W / 2;

    // ── FRONT ──
    newPage();
    // Brand header band + gold underline.
    doc.rect(0, 0, CARD_W, 42).fill(NAVY);
    doc.rect(0, 42, CARD_W, 2).fill(GOLD);
    doc.fillColor('#ffffff').font('Helvetica-Bold').fontSize(9)
      .text(BRAND.name, 6, 12, { width: CARD_W - 12, align: 'center', ellipsis: true, lineBreak: false });
    doc.fillColor(GOLD_SOFT).font('Helvetica').fontSize(5)
      .text(BRAND.tagline, 6, 25, { width: CARD_W - 12, align: 'center', characterSpacing: 0.6 });

    // Vector monogram medallion straddling the header seam.
    const ex = cx;
    const ey = 44;
    doc.circle(ex, ey, 12).fill(NAVY_LIGHT);
    doc.circle(ex, ey, 12).lineWidth(1.4).stroke(GOLD);
    // Stylised LPG flame/droplet mark in gold.
    doc.moveTo(ex, ey - 7);
    doc.bezierCurveTo(ex + 6, ey - 1, ex + 5.5, ey + 6, ex, ey + 6);
    doc.bezierCurveTo(ex - 5.5, ey + 6, ex - 6, ey - 1, ex, ey - 7);
    doc.fill(GOLD);

    // Photo panel.
    const pw = 57;
    const ph = 66;
    const px = (CARD_W - pw) / 2;
    const py = 60;
    this.drawPhoto(doc, px, py, pw, ph, photo, staff.fullName);

    // Identity block (centered).
    doc.fillColor(NAVY).font('Helvetica-Bold').fontSize(9)
      .text(staff.fullName, 6, 131, { width: CARD_W - 12, align: 'center', ellipsis: true, lineBreak: false });
    doc.font('Helvetica-Bold').fontSize(6).fillColor(NAVY_MID)
      .text(this.roleLabel(staff.role).toUpperCase(), 6, 143, { width: CARD_W - 12, align: 'center', characterSpacing: 0.4 });
    if (staff.jobTitle) {
      doc.font('Helvetica').fontSize(6.5).fillColor(SLATE)
        .text(staff.jobTitle, 6, 152, { width: CARD_W - 12, align: 'center', ellipsis: true, lineBreak: false });
    }

    doc.moveTo(16, 161).lineTo(CARD_W - 16, 161).lineWidth(0.5).stroke('#dbe3ee');

    // Scannable credential — the signed badge token used for shift check-in/out.
    const qs = 42;
    const qx = (CARD_W - qs) / 2;
    const qy = 166;
    doc.roundedRect(qx - 3, qy - 3, qs + 6, qs + 6, 3).lineWidth(0.8).stroke(NAVY_LIGHT);
    try {
      doc.image(badge.qr, qx, qy, { width: qs });
    } catch { /* ignore */ }
    doc.fillColor(MUTED).font('Helvetica').fontSize(4.2)
      .text('SCAN FOR SHIFT CHECK-IN / CHECK-OUT', 6, qy + qs + 4, { width: CARD_W - 12, align: 'center', characterSpacing: 0.3 });

    // Branch + ID strip.
    const branchName = staff.branch?.name ?? 'Head Office';
    doc.fillColor(NAVY).font('Helvetica-Bold').fontSize(5.5)
      .text(`BRANCH: ${branchName}`, 6, 214, { width: CARD_W - 12, align: 'center', ellipsis: true, lineBreak: false });
    doc.fillColor(SLATE).font('Helvetica').fontSize(5)
      .text(`ID · ${badge.code}`, 6, 221, { width: CARD_W - 12, align: 'center' });

    // Footer band.
    doc.rect(0, 231, CARD_W, CARD_H - 231).fill(NAVY);
    doc.fillColor(GOLD_SOFT).font('Helvetica').fontSize(4)
      .text('STAFF IDENTITY CARD · VALID WHILE EMPLOYED', 6, 236, { width: CARD_W - 12, align: 'center', characterSpacing: 0.5 });

    // ── BACK ──
    newPage();
    doc.rect(0, 0, CARD_W, 30).fill(NAVY_LIGHT);
    doc.rect(0, 30, CARD_W, 1.5).fill(GOLD);
    doc.fillColor('#ffffff').font('Helvetica-Bold').fontSize(7.5)
      .text(BRAND.name, 6, 9, { width: CARD_W - 12, align: 'center' });
    doc.fillColor(GOLD_SOFT).font('Helvetica').fontSize(4.5)
      .text('EMPLOYEE CARD · TERMS & COMPANY DETAILS', 6, 20, { width: CARD_W - 12, align: 'center', characterSpacing: 0.4 });

    let by = 38;
    const bodyW = CARD_W - 16;
    const section = (label: string) => {
      doc.fillColor(GOLD).font('Helvetica-Bold').fontSize(5.5).text(label, 8, by, { characterSpacing: 0.5 });
      by += 8;
    };
    const paragraph = (txt: string, size = 5.2) => {
      doc.fillColor(SLATE).font('Helvetica').fontSize(size).text(txt, 8, by, { width: bodyW, lineGap: 1 });
      by = doc.y + 4;
    };

    section('PROPERTY & CUSTODY');
    paragraph(
      'This card is the property of Malique Oil & Gas Ltd. Use is governed by company policy. It must be surrendered on resignation or termination. If found, please return to the nearest branch or call any hotline below.',
    );

    section('BRANCH');
    const branchAddress = staff.branch?.address ?? 'Rivers State, Nigeria';
    const branchCity = staff.branch?.city ? `, ${staff.branch.city}` : '';
    paragraph(`${branchName}${branchAddress ? ` — ${branchAddress}` : ''}${branchCity}`, 5);

    section('COMPANY CONTACT');
    paragraph(`Hotline: ${BRAND.phones.join('  ·  ')}`, 5);
    paragraph(`Email: ${BRAND.email}`, 5);

    // Designer / developer credit block (brand band at the bottom).
    doc.rect(0, 196, CARD_W, CARD_H - 196).fill(NAVY);
    doc.rect(0, 196, CARD_W, 1.5).fill(GOLD);
    doc.fillColor('#cbd5e1').font('Helvetica').fontSize(4.6)
      .text(DESIGNER.role.toUpperCase(), 6, 206, { width: CARD_W - 12, align: 'center', characterSpacing: 0.6 });
    doc.fillColor(GOLD).font('Helvetica-Bold').fontSize(9)
      .text(DESIGNER.name, 6, 213, { width: CARD_W - 12, align: 'center', characterSpacing: 0.6 });
    doc.fillColor('#ffffff').font('Helvetica').fontSize(5)
      .text(DESIGNER.email, 6, 226, { width: CARD_W - 12, align: 'center' });
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
