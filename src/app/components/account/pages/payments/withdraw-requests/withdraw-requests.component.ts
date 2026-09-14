import { CommonModule } from '@angular/common';
import { Component, EventEmitter, OnDestroy, OnInit, Output, inject } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Subscription } from 'rxjs';
import {
  PaymentService,
  type WithdrawRequestItem
} from '../../../../../services/payment.service';
import { urlConstant } from '../../../../../shared/constant/urlConstant';
import { SharedService } from '../../../../../shared/services/shared.service';
import { SocketService } from '../../../../../shared/services/socket.service';
import { buildPayoutDetailRows } from '../shared/payment.helpers';

@Component({
  selector: 'app-withdraw-requests',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './withdraw-requests.component.html',
  styleUrls: ['./withdraw-requests.component.scss']
})
export class WithdrawRequestsComponent implements OnInit, OnDestroy {
  @Output() makeWithdrawClick = new EventEmitter<void>();

  private readonly paymentService = inject(PaymentService);
  private readonly socketService = inject(SocketService);
  readonly shared = inject(SharedService);
  private listSub?: Subscription;
  private cancelSub?: Subscription;
  private withdrawReviewSub?: Subscription;

  loading = true;
  error: string | null = null;
  requests: WithdrawRequestItem[] = [];
  total = 0;
  page = 1;
  limit = 10;
  totalPages = 1;
  statusId: number | null = null;
  search = '';
  expandedRequestId: number | null = null;
  cancelConfirmRequestId: number | null = null;
  cancellingRequestId: number | null = null;

  ngOnInit(): void {
    this.load();
    this.withdrawReviewSub = this.socketService.withdrawReview$.subscribe(() => {
      this.load();
    });
  }

  ngOnDestroy(): void {
    this.listSub?.unsubscribe();
    this.cancelSub?.unsubscribe();
    this.withdrawReviewSub?.unsubscribe();
  }

  load(): void {
    this.loading = true;
    this.error = null;
    this.listSub?.unsubscribe();

    this.listSub = this.paymentService.getWithdrawList({
      status_id: this.statusId,
      search: this.search.trim() || null,
      page: this.page,
      limit: this.limit
    }).subscribe({
      next: (response) => {
        this.loading = false;
        if (response.code !== 0) {
          this.error = response.message || 'Could not load withdrawal requests';
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
        this.error = 'Could not load withdrawal requests';
      }
    });
  }

  onStatusChange(): void {
    this.page = 1;
    this.expandedRequestId = null;
    this.load();
  }

  onSearch(): void {
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

  detailRows(request: WithdrawRequestItem) {
    return request.paymentDetails ? buildPayoutDetailRows(request.paymentDetails) : [];
  }

  statusClass(request: WithdrawRequestItem): string {
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

  isPendingRequest(request: WithdrawRequestItem): boolean {
    if (request.statusId === 1) {
      return true;
    }
    return request.statusName.trim().toUpperCase() === 'PENDING';
  }

  startCancel(request: WithdrawRequestItem, event: Event): void {
    event.stopPropagation();
    this.expandedRequestId = request.requestId;
    this.cancelConfirmRequestId = request.requestId;
  }

  dismissCancel(event: Event): void {
    event.stopPropagation();
    this.cancelConfirmRequestId = null;
  }

  confirmCancel(request: WithdrawRequestItem, event: Event): void {
    event.stopPropagation();
    if (this.cancellingRequestId != null) {
      return;
    }

    this.cancellingRequestId = request.requestId;
    this.cancelSub?.unsubscribe();
    this.cancelSub = this.paymentService.cancelWithdraw(request.requestId).subscribe({
      next: (response) => {
        this.cancellingRequestId = null;
        this.cancelConfirmRequestId = null;
        if (response.code !== 0) {
          this.shared.showAlert(3, response.message || 'Could not cancel withdrawal request');
          return;
        }
        this.shared.showAlert(1, response.message || 'Withdrawal request cancelled');
        this.load();
      },
      error: () => {
        this.cancellingRequestId = null;
        this.shared.showAlert(3, 'Could not cancel withdrawal request');
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

  onMakeWithdraw(): void {
    this.makeWithdrawClick.emit();
  }
}
