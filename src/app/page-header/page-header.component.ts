import { ChangeDetectionStrategy, Component, input } from '@angular/core';

/** Title band at the top of every signed-in page. */
@Component({
  selector: 'app-page-header',
  template: `
    <header class="page-header">
      <h1 class="page-title">{{ title() }}</h1>
      @if (subtitle(); as subtitle) {
        <p class="page-subtitle">{{ subtitle }}</p>
      }
    </header>
  `,
  styles: `
    .page-header {
      padding: 1.25rem 1.75rem;
      border-bottom: 1px solid var(--mat-sys-outline-variant);
      background-color: var(--mat-sys-surface);
    }
    .page-title {
      margin: 0;
      color: #d3045d;
      font: var(--mat-sys-headline-small);
      font-weight: 700;
    }
    .page-subtitle {
      margin: 0.25rem 0 0;
      color: var(--mat-sys-on-surface-variant);
      font: var(--mat-sys-body-medium);
    }
    @media (max-width: 600px) {
      .page-header {
        padding: 1rem;
      }
    }
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class PageHeaderComponent {
  readonly title = input.required<string>();
  readonly subtitle = input<string | null>(null);
}
