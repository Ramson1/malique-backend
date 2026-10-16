import {
  Injectable,
  UnauthorizedException,
  ConflictException,
  BadRequestException,
  NotFoundException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import * as bcrypt from 'bcrypt';
import * as crypto from 'crypto';
import { PrismaService } from '../prisma/prisma.service';
import { MailService } from '../mail/mail.service';
import { AuditService } from '../audit/audit.service';
import { StaffLoginDto, CustomerLoginDto } from './dto/login.dto';
import { RegisterDto } from './dto/register.dto';
import { UpdateStaffProfileDto } from './dto/update-staff-profile.dto';
import { ChangePasswordDto } from './dto/change-password.dto';

export interface RequestMeta {
  ip?: string;
  userAgent?: string;
}

@Injectable()
export class AuthService {
  constructor(
    private prisma: PrismaService,
    private jwtService: JwtService,
    private configService: ConfigService,
    private mailService: MailService,
    private auditService: AuditService,
  ) {}

  // ─── Staff Login ─────────────────────────────────────────
  async staffLogin(dto: StaffLoginDto, meta?: RequestMeta) {
    const user = await this.prisma.user.findUnique({
      where: { email: dto.email },
    });

    if (!user) {
      throw new UnauthorizedException('Invalid credentials');
    }

    // super_admin (dev) activity is never recorded on the audit trail.
    const trackable = user.role !== 'super_admin';

    if (user.status !== 'active') {
      if (trackable) {
        void this.auditService.log({
          actorId: user.id,
          actorEmail: user.email,
          actorName: user.fullName,
          actorRole: user.role,
          actionType: 'login',
          action: 'login (account inactive)',
          resource: 'auth',
          ip: meta?.ip,
          userAgent: meta?.userAgent,
          success: false,
        });
      }
      throw new UnauthorizedException('Account is not active');
    }

    const isPasswordValid = await bcrypt.compare(dto.password, user.password);
    if (!isPasswordValid) {
      if (trackable) {
        void this.auditService.log({
          actorId: user.id,
          actorEmail: user.email,
          actorName: user.fullName,
          actorRole: user.role,
          actionType: 'login',
          action: 'login (failed)',
          resource: 'auth',
          ip: meta?.ip,
          userAgent: meta?.userAgent,
          success: false,
        });
      }
      throw new UnauthorizedException('Invalid credentials');
    }

    // Update last login
    await this.prisma.user.update({
      where: { id: user.id },
      data: { lastLogin: new Date() },
    });

    if (trackable) {
      void this.auditService.log({
        actorId: user.id,
        actorEmail: user.email,
        actorName: user.fullName,
        actorRole: user.role,
        actionType: 'login',
        action: 'login',
        resource: 'auth',
        ip: meta?.ip,
        userAgent: meta?.userAgent,
        success: true,
      });
    }

    const payload = {
      sub: user.id,
      email: user.email,
      role: user.role,
      branchId: user.branchId,
    };

    const token = this.jwtService.sign(payload, {
      secret: this.configService.get<string>('JWT_SECRET'),
      expiresIn: '7d',
    });

    return {
      access_token: token,
      user: {
        id: user.id,
        email: user.email,
        fullName: user.fullName,
        role: user.role,
        branchId: user.branchId,
        avatarUrl: user.avatarUrl,
      },
    };
  }

  // ─── Customer Login ──────────────────────────────────────
  async customerLogin(dto: CustomerLoginDto) {
    const customer = await this.prisma.customer.findUnique({
      where: { email: dto.email },
    });

    if (!customer) {
      throw new UnauthorizedException('Invalid credentials');
    }

    const isPasswordValid = await bcrypt.compare(dto.password, customer.password);
    if (!isPasswordValid) {
      throw new UnauthorizedException('Invalid credentials');
    }

    const payload = {
      sub: customer.id,
      email: customer.email,
      role: 'customer',
    };

    const token = this.jwtService.sign(payload, {
      secret: this.configService.get<string>('JWT_CUSTOMER_SECRET'),
      expiresIn: '30d',
    });

    return {
      access_token: token,
      customer: {
        id: customer.id,
        email: customer.email,
        fullName: customer.fullName,
        phone: customer.phone,
        address: customer.address,
        defaultBranchId: customer.defaultBranchId,
      },
    };
  }

  // ─── Customer Register ───────────────────────────────────
  async customerRegister(dto: RegisterDto) {
    const existingCustomer = await this.prisma.customer.findUnique({
      where: { email: dto.email },
    });

    if (existingCustomer) {
      throw new ConflictException('Email already registered');
    }

    const existingUser = await this.prisma.user.findUnique({
      where: { email: dto.email },
    });

    if (existingUser) {
      throw new ConflictException('Email already in use');
    }

    const hashedPassword = await bcrypt.hash(dto.password, 12);

    const customer = await this.prisma.customer.create({
      data: {
        email: dto.email,
        password: hashedPassword,
        fullName: dto.fullName,
        phone: dto.phone,
        address: dto.address,
        defaultBranchId: dto.defaultBranchId,
      },
    });

    const payload = {
      sub: customer.id,
      email: customer.email,
      role: 'customer',
    };

    const token = this.jwtService.sign(payload, {
      secret: this.configService.get<string>('JWT_CUSTOMER_SECRET'),
      expiresIn: '30d',
    });

    return {
      access_token: token,
      customer: {
        id: customer.id,
        email: customer.email,
        fullName: customer.fullName,
        phone: customer.phone,
      },
    };
  }

  // ─── Forgot Password ─────────────────────────────────────
  async forgotPassword(email: string) {
    // Check both customers and users
    const user = await this.prisma.user.findUnique({ where: { email } });
    const customer = await this.prisma.customer.findUnique({ where: { email } });

    if (!user && !customer) {
      // Don't reveal whether the email exists
      return { message: 'If the email exists, a reset link has been sent' };
    }

    const resetToken = crypto.randomBytes(32).toString('hex');
    const tokenHash = crypto.createHash('sha256').update(resetToken).digest('hex');

    // Persist the hashed token in a dedicated table (single-use, 1h expiry).
    await this.prisma.passwordResetToken.create({
      data: {
        email,
        tokenHash,
        expiresAt: new Date(Date.now() + 3600000),
      },
    });

    const apiUrl = this.configService.get<string>('API_URL');
    const resetUrl = `${apiUrl}/auth/reset-password?token=${resetToken}&email=${email}`;

    await this.mailService.sendPasswordReset(email, resetUrl);

    return { message: 'If the email exists, a reset link has been sent' };
  }

  // ─── Reset Password ──────────────────────────────────────
  async resetPassword(email: string, token: string, newPassword: string) {
    const tokenHash = crypto.createHash('sha256').update(token).digest('hex');

    const resetToken = await this.prisma.passwordResetToken.findFirst({
      where: { email, tokenHash, usedAt: null, expiresAt: { gt: new Date() } },
      orderBy: { createdAt: 'desc' },
    });

    if (!resetToken) {
      throw new BadRequestException('Invalid or expired reset token');
    }

    const hashedPassword = await bcrypt.hash(newPassword, 12);

    const user = await this.prisma.user.findUnique({ where: { email } });
    if (user) {
      await this.prisma.user.update({
        where: { id: user.id },
        data: { password: hashedPassword },
      });
    } else {
      const customer = await this.prisma.customer.findUnique({ where: { email } });
      if (!customer) {
        throw new BadRequestException('Invalid or expired reset token');
      }
      await this.prisma.customer.update({
        where: { id: customer.id },
        data: { password: hashedPassword },
      });
    }

    // Mark the token as consumed so it can't be replayed.
    await this.prisma.passwordResetToken.update({
      where: { id: resetToken.id },
      data: { usedAt: new Date() },
    });

    return { message: 'Password reset successful' };
  }

  // ─── Change Password (authenticated staff) ───────────────
  async changePassword(
    userId: string,
    dto: ChangePasswordDto,
    meta?: RequestMeta,
  ) {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user) {
      throw new NotFoundException('User not found');
    }

    const isValid = await bcrypt.compare(dto.currentPassword, user.password);
    if (!isValid) {
      throw new UnauthorizedException('Current password is incorrect');
    }

    const hashedPassword = await bcrypt.hash(dto.newPassword, 12);
    await this.prisma.user.update({
      where: { id: userId },
      data: { password: hashedPassword },
    });

    // super_admin writes are never recorded (guarded inside AuditService.log).
    void this.auditService.log({
      actorId: user.id,
      actorEmail: user.email,
      actorName: user.fullName,
      actorRole: user.role,
      actionType: 'update',
      action: 'change password',
      resource: 'auth',
      ip: meta?.ip,
      userAgent: meta?.userAgent,
      success: true,
    });

    return { message: 'Password updated successfully' };
  }

  // ─── Set Avatar (from upload) ────────────────────────────
  async setAvatar(userId: string, url: string) {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user) {
      throw new NotFoundException('User not found');
    }

    return this.prisma.user.update({
      where: { id: userId },
      data: { avatarUrl: url },
      select: {
        id: true,
        email: true,
        fullName: true,
        avatarUrl: true,
        role: true,
        branchId: true,
        status: true,
      },
    });
  }

  // ─── Staff Profile ─────────────────────────────────────────
  async getStaffProfile(userId: string) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: {
        id: true,
        email: true,
        fullName: true,
        phone: true,
        role: true,
        branchId: true,
        avatarUrl: true,
        status: true,
        lastLogin: true,
        createdAt: true,
        branch: { select: { id: true, name: true, address: true } },
      },
    });

    if (!user) {
      throw new NotFoundException('User not found');
    }

    return user;
  }

  async getRiderProfile(userId: string) {
    const user = await this.prisma.user.findFirst({
      where: { id: userId, role: 'rider' },
      select: {
        id: true,
        email: true,
        fullName: true,
        phone: true,
        role: true,
        branchId: true,
        avatarUrl: true,
        status: true,
        lastLogin: true,
        createdAt: true,
        branch: { select: { id: true, name: true, address: true } },
      },
    });

    if (!user) {
      throw new NotFoundException('Rider not found');
    }

    return user;
  }

  async updateStaffProfile(userId: string, dto: UpdateStaffProfileDto) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
    });

    if (!user) {
      throw new NotFoundException('User not found');
    }

    return this.prisma.user.update({
      where: { id: userId },
      data: { ...dto },
      select: {
        id: true,
        email: true,
        fullName: true,
        phone: true,
        role: true,
        branchId: true,
        avatarUrl: true,
        status: true,
      },
    });
  }

  // ─── Staff Logout ────────────────────────────────────────
  async staffLogout(
    user: { id: string; email: string; role: string } | undefined,
    meta?: RequestMeta,
  ) {
    if (user && user.role !== 'super_admin') {
      void this.auditService.log({
        actorId: user.id,
        actorEmail: user.email,
        actorRole: user.role,
        actionType: 'logout',
        action: 'logout',
        resource: 'auth',
        ip: meta?.ip,
        userAgent: meta?.userAgent,
        success: true,
      });
    }
    return { message: 'Logged out successfully' };
  }
}
