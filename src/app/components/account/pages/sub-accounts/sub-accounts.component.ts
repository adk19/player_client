import { Component } from '@angular/core';
import { CommonModule } from '@angular/common';

@Component({
  selector: 'app-sub-accounts',
  standalone: true,
  imports: [CommonModule],
  template: `
    <div class="page-placeholder">
      <i class="fa-light fa-users-gear"></i>
      <h3>Sub Accounts</h3>
      <p>Coming soon</p>
    </div>
  `,
  styles: [`.page-placeholder { display:flex; flex-direction:column; align-items:center; justify-content:center; min-height:300px; gap:10px; color:var(--normal-text); font-size:14px; i { font-size:36px; opacity:.3; } h3 { color:var(--main-text); font-size:16px; font-weight:600; margin:0; } p { margin:0; } }`]
})
export class SubAccountsComponent {}
