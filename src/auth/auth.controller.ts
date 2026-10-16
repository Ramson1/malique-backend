import {
  Controller,
  Get,
  Post,
  Patch,
  Body,
  Req,
  Res,
  UseGuards,
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
import { Response, Request, CookieOptions } from 'express';
import { AuthService } from './auth.service';
import { StaffLoginDto, CustomerLoginDto } from './dto/login.dto';
import { RegisterDto } from './dto/register.dto';
import { ForgotPasswordDto, ResetPasswordDto } from './dto/forgot-password.dto';
import { UpdateStaffProfileDto } from './dto/update-staff-profile.dto';
import { ChangePasswordDto } from './dto/change-password.dto';
import { JwtStaffGuard } from '../common/guards/jwt-staff.guard';
import { CurrentUser } from '../common/decorators/current-user.decorator';

// Session cookie options. The deployed frontends (*.vercel.app) and the API
// (malique-backend.vercel.app) are treated as CROSS-SITE because `vercel.app`
// is on the Public Suffix List. A SameSite=Lax cookie is therefore not sent on
// the follow-up authenticated fetch/XHR (e.g. /auth/staff/profile), yielding a
// 401 right after a successful login. In production the cookie must be
// SameSite=None + Secure; local http dev keeps Lax.
const IS_CROSS_SITE =
  process.env.NODE_ENV === 'production' ||
  process.env.VERCEL_ENV === 'production';

function authCookie(maxAge: number): CookieOptions {
  return {
    httpOnly: true,
    secure: IS_CROSS_SITE,
    sameSite: IS_CROSS_SITE ? 'none' : 'lax',
    maxAge,
    path: '/',
  };
}

const clearCookieOpts: CookieOptions = {
  path: '/',
  secure: IS_CROSS_SITE,
  sameSite: IS_CROSS_SITE ? 'none' : 'lax',
};

@Controller('auth')
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  @Post('staff/login')
  @HttpCode(HttpStatus.OK)
  async staffLogin(
    @Body() dto: StaffLoginDto,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ) {
    const result = await this.authService.staffLogin(dto, {
      ip: req.ip,
      userAgent: req.headers['user-agent'],
    });

    res.cookie('access_token', result.access_token, authCookie(7 * 24 * 60 * 60 * 1000)); // 7 days

    return result;
  }

  @Post('customer/login')
  @HttpCode(HttpStatus.OK)
  async customerLogin(
    @Body() dto: CustomerLoginDto,
    @Res({ passthrough: true }) res: Response,
  ) {
    const result = await this.authService.customerLogin(dto);

    res.cookie('access_token', result.access_token, authCookie(30 * 24 * 60 * 60 * 1000)); // 30 days

    return result;
  }

  @Post('customer/register')
  @HttpCode(HttpStatus.CREATED)
  async customerRegister(
    @Body() dto: RegisterDto,
    @Res({ passthrough: true }) res: Response,
  ) {
    const result = await this.authService.customerRegister(dto);

    res.cookie('access_token', result.access_token, authCookie(30 * 24 * 60 * 60 * 1000)); // 30 days

    return result;
  }

  @Post('forgot-password')
  @HttpCode(HttpStatus.OK)
  async forgotPassword(@Body() dto: ForgotPasswordDto) {
    return this.authService.forgotPassword(dto.email);
  }

  @Post('reset-password')
  @HttpCode(HttpStatus.OK)
  async resetPassword(@Body() dto: ResetPasswordDto) {
    // Extract email from the token query or body
    // For simplicity, we accept email in the reset flow
    return this.authService.resetPassword(
      (dto as any).email,
      dto.token,
      dto.newPassword,
    );
  }

  @Post('staff/logout')
  @UseGuards(JwtStaffGuard)
  @HttpCode(HttpStatus.OK)
  async staffLogout(
    @CurrentUser() user: any,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ) {
    res.clearCookie('access_token', clearCookieOpts);
    return this.authService.staffLogout(user, {
      ip: req.ip,
      userAgent: req.headers['user-agent'],
    });
  }

  @Get('staff/profile')
  @UseGuards(JwtStaffGuard)
  getStaffProfile(@CurrentUser() user: any) {
    return this.authService.getStaffProfile(user.id);
  }

  @Get('rider/profile')
  @UseGuards(JwtStaffGuard)
  getRiderProfile(@CurrentUser() user: any) {
    return this.authService.getRiderProfile(user.id);
  }

  @Patch('staff/profile')
  @UseGuards(JwtStaffGuard)
  updateStaffProfile(
    @CurrentUser() user: any,
    @Body() dto: UpdateStaffProfileDto,
  ) {
    return this.authService.updateStaffProfile(user.id, dto);
  }

  @Post('staff/change-password')
  @UseGuards(JwtStaffGuard)
  @HttpCode(HttpStatus.OK)
  async changePassword(
    @CurrentUser() user: any,
    @Body() dto: ChangePasswordDto,
    @Req() req: Request,
  ) {
    return this.authService.changePassword(user.id, dto, {
      ip: req.ip,
      userAgent: req.headers['user-agent'],
    });
  }

  @Post('staff/avatar')
  @UseGuards(JwtStaffGuard)
  setAvatar(@CurrentUser() user: any, @Body() body: { url: string }) {
    return this.authService.setAvatar(user.id, body.url);
  }
}
