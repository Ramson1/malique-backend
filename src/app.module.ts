import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { AppController } from './app.controller';
import { PrismaModule } from './prisma/prisma.module';
import { AuthModule } from './auth/auth.module';
import { BranchesModule } from './branches/branches.module';
import { ProductsModule } from './products/products.module';
import { OrdersModule } from './orders/orders.module';
import { DeliveriesModule } from './deliveries/deliveries.module';
import { CustomersModule } from './customers/customers.module';
import { PaymentsModule } from './payments/payments.module';
import { UploadModule } from './upload/upload.module';
import { MailModule } from './mail/mail.module';
import { StaffModule } from './staff/staff.module';
import { AttendanceModule } from './attendance/attendance.module';
import { AnalyticsModule } from './analytics/analytics.module';
import { InventoryModule } from './inventory/inventory.module';
import { AuditModule } from './audit/audit.module';
import { AdminModule } from './admin/admin.module';
import { GasModule } from './gas/gas.module';
import { ShiftsModule } from './shifts/shifts.module';
import { PayrollModule } from './payroll/payroll.module';
import { ReportsModule } from './reports/reports.module';
import { DispatchModule } from './dispatch/dispatch.module';
import { MessagesModule } from './messages/messages.module';
import { StaffCardsModule } from './staff-cards/staff-cards.module';
import { AnnouncementsModule } from './announcements/announcements.module';
import { PosModule } from './pos/pos.module';
import { PushModule } from './push/push.module';

@Module({
  controllers: [AppController],
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    PrismaModule,
    AuthModule,
    BranchesModule,
    ProductsModule,
    OrdersModule,
    DeliveriesModule,
    CustomersModule,
    PaymentsModule,
    UploadModule,
    MailModule,
    StaffModule,
    AttendanceModule,
    AnalyticsModule,
    InventoryModule,
    AuditModule,
    AdminModule,
    GasModule,
    ShiftsModule,
    PayrollModule,
    ReportsModule,
    DispatchModule,
    MessagesModule,
    StaffCardsModule,
    AnnouncementsModule,
    PosModule,
    PushModule,
  ],
})
export class AppModule {}
