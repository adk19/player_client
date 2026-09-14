import { CommonModule } from '@angular/common';
import { Component, EventEmitter, OnDestroy, OnInit, Output, inject } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Subscription } from 'rxjs';
import {
  PaymentService,
  type DepositRequestItem
} from '../../../../../services/payment.service';
import { urlConstant } from '../../../../../shared/constant/urlConstant';
import { SharedService } from '../../../../../shared/services/shared.service';
import { SocketService } from '../../../../../shared/services/socket.service';

@Component({
  selector: 'app-deposit-requests',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './deposit-requests.component.html',
  styleUrls: ['./deposit-requests.component.scss']
})
export class DepositRequestsComponent implements OnInit, OnDestroy {
  @Output() makeDepositClick = new EventEmitter<void>();

  private readonly paymentService = inject(PaymentService);
  private readonly socketService = inject(SocketService);
  readonly shared = inject(SharedService);
  private listSub?: Subscription;
  private cancelSub?: Subscription;
  private depositReviewSub?: Subscription;

  loading = true;
  error: string | null = null;
  requests: DepositRequestItem[] = [];
  total = 0;
  page = 1;
  limit = 10;
  totalPages = 1;
  statusId: number | null = null;
  expandedRequestId: number | null = null;
  cancelConfirmRequestId: number | null = null;
  cancellingRequestId: number | null = null;

  ngOnInit(): void {
    this.load();
    this.depositReviewSub = this.socketService.depositReview$.subscribe(() => {
      this.load();
    });
  }

  ngOnDestroy(): void {
    this.listSub?.unsubscribe();
    this.cancelSub?.unsubscribe();
    this.depositReviewSub?.unsubscribe();
  }

  load(): void {
    this.loading = true;
    this.error = null;
    this.listSub?.unsubscribe();

    this.listSub = this.paymentService.getDepositList({
      status_id: this.statusId,
      page: this.page,
      limit: this.limit
    }).subscribe({
      next: (response) => {
        this.loading = false;
        if (response.code !== 0) {
          this.error = response.message || 'Could not load deposit requests';
          this.requests = [];
          return;
        }
        this.requests = response.items;
        this.total = response.total;
        this.page = response.page;
        this.limit = response.limit;
        this.totalPages = response.totalPages;
      },
      error: () => {
        this.loading = false;
        this.error = 'Could not load deposit requests';
      }
    });
  }

  onStatusChange(): void {
    this.page = 1;
    this.expandedRequestId = null;
    this.load();
  }

  refresh(): void {
    this.page = 1;
    this.expandedRequestId = null;
    this.load();
  }

  prevPage(): void {
    if (this.page <= 1) {
      return;
    }
    this.page -= 1;
    this.expandedRequestId = null;
    this.load();
  }

  nextPage(): void {
    if (this.page >= this.totalPages) {
      return;
    }
    this.page += 1;
    this.expandedRequestId = null;
    this.load();
  }

  toggleDetails(requestId: number): void {
    if (this.expandedRequestId === requestId) {
      this.expandedRequestId = null;
      if (this.cancelConfirmRequestId === requestId) {
        this.cancelConfirmRequestId = null;
      }
      return;
    }
    this.expandedRequestId = requestId;
  }

  requestUtr(request: DepositRequestItem): string {
    return request.paymentDetails?.utr?.trim() || '—';
  }

  statusClass(request: DepositRequestItem): string {
    const status = request.statusName.toUpperCase();
    if (status === 'APPROVED') {
      return 'dr-status--approved';
    }
    if (status === 'REJECTED') {
      return 'dr-status--rejected';
    }
    if (status === 'CANCELLED') {
      return 'dr-status--cancelled';
    }
    return 'dr-status--pending';
  }

  isPendingRequest(request: DepositRequestItem): boolean {
    if (request.statusId === 1) {
      return true;
    }
    return request.statusName.trim().toUpperCase() === 'PENDING';
  }

  startCancel(request: DepositRequestItem, event: Event): void {
    event.stopPropagation();
    this.expandedRequestId = request.requestId;
    this.cancelConfirmRequestId = request.requestId;
  }

  dismissCancel(event: Event): void {
    event.stopPropagation();
    this.cancelConfirmRequestId = null;
  }

  confirmCancel(request: DepositRequestItem, event: Event): void {
    event.stopPropagation();
    if (this.cancellingRequestId != null) {
      return;
    }

    this.cancellingRequestId = request.requestId;
    this.cancelSub?.unsubscribe();
    this.cancelSub = this.paymentService.cancelDeposit(request.requestId).subscribe({
      next: (response) => {
        this.cancellingRequestId = null;
        this.cancelConfirmRequestId = null;
        if (response.code !== 0) {
          this.shared.showAlert(3, response.message || 'Could not cancel deposit request');
          return;
        }
        this.shared.showAlert(1, response.message || 'Deposit request cancelled');
        this.load();
      },
      error: () => {
        this.cancellingRequestId = null;
        this.shared.showAlert(3, 'Could not cancel deposit request');
      }
    });
  }

  formatDate(value: string | null): string {
    if (!value) {
      return '—';
    }
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) {
      return value;
    }
    return date.toLocaleString();
  }

  mediaUrl(path: string | null): string | null {
    if (!path) {
      return null;
    }
    if (/^https?:\/\//i.test(path)) {
      return path;
    }
    const apiBase = urlConstant.APIBase;
    const origin = apiBase.replace(/\/api\/?$/i, '');
    return `${origin}${path.startsWith('/') ? path : `/${path}`}`;
  }

  isProofPdf(url: string): boolean {
    return /\.pdf($|\?)/i.test(url);
  }

  copyText(value: string): void {
    void navigator.clipboard?.writeText(value);
  }

  onMakeDeposit(): void {
    this.makeDepositClick.emit();
  }
}
