import { Pipe, PipeTransform } from '@angular/core';
import { SharedService } from '../services/shared.service';

@Pipe({
  name: 'brandCurrency',
  standalone: true
})
export class BrandCurrencyPipe implements PipeTransform {

  constructor(private sharedService: SharedService) {}

  transform(value: number | null | undefined, fromCurrency?: string): string {
    if (value === null || value === undefined || isNaN(value)) {
      return '-';
    }

    let convertedValue = value;

    // If a 'fromCurrency' is provided, perform the conversion
    if (fromCurrency) {
      const rate = this.sharedService.getExchangeRate(fromCurrency);
      if (rate !== null) {
        convertedValue = value * rate;
      }
    }

    // Format the (potentially converted) value using the brand's currency settings
    return this.sharedService.formatToBrandCurrency(convertedValue);
  }

}
