import { Module } from '@nestjs/common';
import { ProductsController } from './products.controller';
import { CatalogController } from './catalog.controller';
import { ProductsService } from './products.service';

@Module({
  controllers: [ProductsController, CatalogController],
  providers: [ProductsService],
  exports: [ProductsService],
})
export class ProductsModule {}
