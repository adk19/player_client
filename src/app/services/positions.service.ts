import { Injectable } from '@angular/core';
import { Observable, from } from 'rxjs';
import { TradingSocketService } from './trading-socket.service';

@Injectable({ providedIn: 'root' })
export class PositionsService {
  constructor(private tradingSocket: TradingSocketService) {}

  // SL/TP updates go via socket order_update (as per new API doc)
  updateStopLoss(positionId: number, stopLoss: number): Observable<any> {
    return from(this.tradingSocket.updateOrder({ position_id: positionId, stop_loss: stopLoss }));
  }

  updateTakeProfit(positionId: number, takeProfit: number): Observable<any> {
    return from(this.tradingSocket.updateOrder({ position_id: positionId, take_profit: takeProfit }));
  }
}
