import { Injectable, NgZone } from '@angular/core';
import { Observable, Subject } from 'rxjs';

@Injectable({
  providedIn: 'root'
})
export class TopLivePriceService {
  private ws!: WebSocket;
  private subject = new Subject<any>();

  constructor(private zone: NgZone) {}

  connect(symbols: string[]) {
    const streams = symbols.map(s => `${s.toLowerCase()}usdt@ticker`).join('/');
    const url = `wss://stream.binance.com:9443/stream?streams=${streams}`;
    
    this.ws = new WebSocket(url);

    this.ws.onmessage = (msg) => {
      const data = JSON.parse(msg.data);
      this.zone.run(() => {
        this.subject.next(data);
      });
    };
  }

  getMessages(): Observable<any> {
    return this.subject.asObservable();
  }

  close() {
    if (this.ws) {
      this.ws.close();
    }
  }
}
