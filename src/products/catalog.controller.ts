import { Controller, Get, Query } from '@nestjs/common';
import { ProductsService } from './products.service';

// Public (no guard, same pattern as ProductsController.findAll) website
// catalog with live branch-resolved prices for the ordering wizard.
@Controller('catalog')
export class CatalogController {
  constructor(private readonly productsService: ProductsService) {}

  @Get()
  catalog(@Query('branchId') branchId?: string) {
    return this.productsService.catalog(branchId);
  }
}
