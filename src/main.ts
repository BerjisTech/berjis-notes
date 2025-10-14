import 'zone.js';
import { bootstrapApplication } from '@angular/platform-browser';
import { provideHttpClient } from '@angular/common/http';
import { provideRouter, Routes } from '@angular/router';
import { AppComponent } from './app/app.component';
import { HomePageComponent } from './app/pages/home/home.component';
import { authGuard } from './app/auth.guard';

const routes: Routes = [
  { path: '', component: HomePageComponent },
  { path: 'note/:id', loadComponent: () => import('./app/pages/note/note.component').then(m => m.NotePageComponent), canActivate: [authGuard] },
  { path: '**', redirectTo: '' }
];

bootstrapApplication(AppComponent, {
  providers: [provideHttpClient(), provideRouter(routes)]
}).catch(err => console.error(err));
