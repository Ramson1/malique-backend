import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class AnalyticsService {
  constructor(private prisma: PrismaService) {}

  async getOverview(branchId?: string) {
    const orderWhere: any = {};
    const customerWhere: any = {};
    const branchWhere: any = {};

    if (branchId) {
      orderWhere.branchId = branchId;
      customerWhere.defaultBranchId = branchId;
      branchWhere.id = branchId;
    }

    // Get start of current month for "this month" stats
    const now = new Date();
    const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);

    const [
      totalOrders,
      monthlyOrders,
      revenueResult,
      monthlyRevenueResult,
      totalCustomers,
      totalBranches,
    ] = await Promise.all([
      // Total orders
      this.prisma.order.count({ where: orderWhere }),
      // Orders this month
      this.prisma.order.count({
        where: { ...orderWhere, createdAt: { gte: startOfMonth } },
      }),
      // Total revenue (sum of delivered/paid orders)
      this.prisma.order.aggregate({
        where: { ...orderWhere, paymentStatus: 'paid' },
        _sum: { totalAmount: true },
      }),
      // Monthly revenue
      this.prisma.order.aggregate({
        where: {
          ...orderWhere,
          paymentStatus: 'paid',
          createdAt: { gte: startOfMonth },
        },
        _sum: { totalAmount: true },
      }),
      // Total customers
      this.prisma.customer.count({ where: customerWhere }),
      // Total branches
      this.prisma.branch.count({ where: branchWhere }),
    ]);

    return {
      totalOrders,
      monthlyOrders,
      totalRevenue: revenueResult._sum.totalAmount?.toNumber() || 0,
      monthlyRevenue: monthlyRevenueResult._sum.totalAmount?.toNumber() || 0,
      totalCustomers,
      totalBranches,
    };
  }

  async getOrderTrends(branchId?: string, days: number = 30) {
    const startDate = new Date();
    startDate.setDate(startDate.getDate() - days);

    const where: any = {
      createdAt: { gte: startDate },
    };
    if (branchId) where.branchId = branchId;

    const orders = await this.prisma.order.findMany({
      where,
      select: {
        status: true,
        paymentStatus: true,
        createdAt: true,
        totalAmount: true,
      },
      orderBy: { createdAt: 'asc' },
    });

    // Group orders by date
    const trends: Record<string, { count: number; revenue: number }> = {};
    for (const order of orders) {
      const date = order.createdAt.toISOString().split('T')[0];
      if (!trends[date]) {
        trends[date] = { count: 0, revenue: 0 };
      }
      trends[date].count += 1;
      if (order.paymentStatus === 'paid') {
        trends[date].revenue += order.totalAmount.toNumber();
      }
    }

    // Convert to array format
    return Object.entries(trends).map(([date, data]) => ({
      date,
      orderCount: data.count,
      revenue: data.revenue,
    }));
  }

  async getRevenueTrends(branchId?: string, days: number = 30) {
    const startDate = new Date();
    startDate.setDate(startDate.getDate() - days);

    const where: any = {
      paymentStatus: 'paid',
      createdAt: { gte: startDate },
    };
    if (branchId) where.branchId = branchId;

    const payments = await this.prisma.order.findMany({
      where,
      select: {
        totalAmount: true,
        paymentMethod: true,
        createdAt: true,
      },
      orderBy: { createdAt: 'asc' },
    });

    // Group by date
    const trends: Record<string, { total: number; byMethod: Record<string, number> }> = {};
    for (const payment of payments) {
      const date = payment.createdAt.toISOString().split('T')[0];
      if (!trends[date]) {
        trends[date] = { total: 0, byMethod: {} };
      }
      const amount = payment.totalAmount.toNumber();
      trends[date].total += amount;
      const method = payment.paymentMethod || 'unknown';
      trends[date].byMethod[method] = (trends[date].byMethod[method] || 0) + amount;
    }

    // Calculate summary
    const totalRevenue = payments.reduce(
      (sum, p) => sum + p.totalAmount.toNumber(),
      0,
    );

    // Group by payment method
    const byMethod: Record<string, number> = {};
    for (const p of payments) {
      const method = p.paymentMethod || 'unknown';
      byMethod[method] = (byMethod[method] || 0) + p.totalAmount.toNumber();
    }

    return {
      totalRevenue,
      dailyTrends: Object.entries(trends).map(([date, data]) => ({
        date,
        total: data.total,
        byMethod: data.byMethod,
      })),
      byMethod,
    };
  }
}
