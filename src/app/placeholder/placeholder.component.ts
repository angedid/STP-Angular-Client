import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { ActivatedRoute } from '@angular/router';
import { PageHeaderComponent } from '../page-header/page-header.component';

/** Stand-in for screens that are not designed yet. */
@Component({
  selector: 'app-placeholder',
  imports: [PageHeaderComponent],
  template: `
    <app-page-header [title]="title" />
    <section class="placeholder">
      <p>This screen is not available yet.</p>
    </section>
  `,
  styles: `
    .placeholder {
      padding: 1.5rem 1.75rem;
    }
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class PlaceholderComponent {
  protected readonly title = inject(ActivatedRoute).snapshot.title ?? 'Coming soon';
}
