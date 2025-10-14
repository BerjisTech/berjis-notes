import { Component } from '@angular/core';
import { CommonModule } from '@angular/common';

@Component({
  standalone: true,
  selector: 'app-home',
  imports: [CommonModule],
  template: `<p class="text-gray-700">Notes home. Open a demo note from the nav.</p>`
})
export class HomePageComponent {}

