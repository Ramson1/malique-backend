import { IsString } from 'class-validator';

export class AssignRiderDto {
  @IsString()
  riderId: string;
}
