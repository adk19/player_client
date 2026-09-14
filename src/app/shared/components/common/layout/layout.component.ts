import { Component, OnDestroy, OnInit, inject } from '@angular/core';
import { Subscription } from 'rxjs';
import { HeaderComponent } from '../header/header.component';
import { RouterOutlet } from '@angular/router';
import { SocketService } from '../../../services/socket.service';
import { SharedService } from '../../../services/shared.service';

@Component({
  selector: 'app-layout',
  imports: [HeaderComponent, RouterOutlet],
  templateUrl: './layout.component.html',
  styleUrl: './layout.component.scss'
})
export class LayoutComponent implements OnInit, OnDestroy {
  private readonly socketService = inject(SocketService);
  private readonly shared = inject(SharedService);

  private depositSub?: Subscription;
  private withdrawSub?: Subscription;

  ngOnInit(): void {
    this.depositSub = this.socketService.depositReview$.subscribe((data) => {
      if (!data || data == null) {
        return;
      }
      const status = data?.status_name || data?.statusName || '';
      const amount = data?.amount || data?.deposit_amount || '';
      const label = amount ? `₹${amount}` : 'request';
      const msg = status
        ? `Deposit ${label} has been ${status.toLowerCase()}`
        : `Deposit ${label} has been reviewed`;

      if (status.toUpperCase() === 'APPROVED') {
        this.shared.showAlert(1, msg);
      } else if (status.toUpperCase() === 'REJECTED') {
        this.shared.showAlert(3, msg);
      } else {
        this.shared.showAlert(4, msg);
      }
    });

    this.withdrawSub = this.socketService.withdrawReview$.subscribe((data) => {
      const status = data?.status_name || data?.statusName || '';
      const amount = data?.amount || data?.withdraw_amount || '';
      const label = amount ? `₹${amount}` : 'request';
      const msg = status
        ? `Withdrawal ${label} has been ${status.toLowerCase()}`
        : `Withdrawal ${label} has been reviewed`;

      if (status.toUpperCase() === 'APPROVED') {
        this.shared.showAlert(1, msg);
      } else if (status.toUpperCase() === 'REJECTED') {
        this.shared.showAlert(3, msg);
      } else {
        this.shared.showAlert(4, msg);
      }
    });
  }

  ngOnDestroy(): void {
    this.depositSub?.unsubscribe();
    this.withdrawSub?.unsubscribe();
  }
}