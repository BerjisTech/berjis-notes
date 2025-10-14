import { Component } from '@angular/core';
import { CommonModule } from '@angular/common';

@Component({
  standalone: true,
  selector: 'app-note',
  imports: [CommonModule],
  template: `<div class="border rounded p-4">Notes editor placeholder (DIY collab slot)</div>`
})
export class NotePageComponent {}

