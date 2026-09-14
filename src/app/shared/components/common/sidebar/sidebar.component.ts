import { Component } from '@angular/core';
import { SharedService } from '../../../services/shared.service';
import { NgClass } from '@angular/common';
import { Router, RouterLink } from '@angular/router';

@Component({
  selector: 'app-sidebar',
  standalone: true,
  imports: [NgClass, RouterLink],
  templateUrl: './sidebar.component.html',
  styleUrls: ['./sidebar.component.scss']
})
export class SidebarComponent {

  constructor(
    public sharedservice : SharedService,
    private router: Router
  ){}

  checkMenuActive(menuName: string): boolean {
    if (!menuName) return false;
    const url = (this.router.url || '').toLowerCase();
    return url.includes(menuName.toLowerCase());
  }

}
