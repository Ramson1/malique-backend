import { Module } from '@nestjs/common';
import { ProductsController } from './products.controller';
import { CatalogController } from './catalog.controller';
import { ProductsService } from './products.service';
import { ProductChangesController } from './product-changes.controller';
import { ProductChangesService } from './product-changes.service';

@Module({
  controllers: [ProductsController, CatalogController, ProductChangesController],
  providers: [ProductsService, ProductChangesService],
  exports: [ProductsService],
})
export class ProductsModule {}
