import { CommonModule } from '@angular/common';
import { Component } from '@angular/core';
import { TopLivePriceService } from './top-live-prices.service';
import { Subscription } from 'rxjs';

@Component({
  selector: 'app-top-live-prices',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './top-live-prices.component.html',
  styleUrls: ['./top-live-prices.component.scss']
})
export class TopLivePricesComponent {

  coins: any[] = [];
  sub!: Subscription;

  currentActive: string = 'Popular';

  coinOrder = ['BTC', 'ETH', 'BNB', 'XRP', 'SOL', 'SOMI', 'WLFI', 'MITO', 'DOLO', 'PLUME'];

  constructor(private toplivepriceservice: TopLivePriceService) { }

  ngOnInit() {
    const allSymbols = [...this.coinOrder];

    this.toplivepriceservice.connect(allSymbols);

    this.sub = this.toplivepriceservice.getMessages().subscribe((res: any) => {
      if (res?.data) {
        const s = res.data.s;
        const price = parseFloat(res.data.c).toFixed(4);
        const change = parseFloat(res.data.P).toFixed(2);

        const idx = this.coins.findIndex(c => c.key === s);
        if (idx > -1) {
          this.coins[idx] = { key: s, price, change };
        } else {
          this.coins.push({ key: s, price, change });
        }

        this.coins.sort(
          (a, b) => this.coinOrder.indexOf(a.key) - this.coinOrder.indexOf(b.key)
        );
      }
    });
  }

  ngOnDestroy() {
    this.sub.unsubscribe();
    this.toplivepriceservice.close();
  }
}