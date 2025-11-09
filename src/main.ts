import 'zone.js';
import { bootstrapApplication } from '@angular/platform-browser';
import { provideHttpClient, withInterceptors } from '@angular/common/http';
import { provideRouter, Routes } from '@angular/router';
import { AppComponent } from './app/app.component';
import { authTokenInterceptor } from './app/auth-token.interceptor';
import { HomePageComponent } from './app/pages/home/home.component';
import { authGuard } from './app/auth.guard';
import { CORE_AUTH_API_BASE } from '@berjis/angular-auth';
import { environment } from './environments/environment';

const routes: Routes = [
  { path: '', component: HomePageComponent },
  { path: 'note/:id', loadComponent: () => import('./app/pages/note/note.component').then(m => m.NotePageComponent), canActivate: [authGuard] },
  { path: '**', redirectTo: '' }
];

bootstrapApplication(AppComponent, {
  providers: [
    provideHttpClient(withInterceptors([authTokenInterceptor])),
    provideRouter(routes),
    { provide: CORE_AUTH_API_BASE, useValue: environment.apiBase }
  ]
}).catch(err => console.error(err));
