import { Injectable, signal } from '@angular/core';

/** Which side of the platform the signed-in user is currently working in. */
export type Workspace = 'grossiste' | 'banque';

/**
 * Holds the "Espace" selected in the sidebar. Nothing depends on it yet; it is
 * kept in a root service so the future wholesaler and bank screens can react
 * to it.
 */
@Injectable({ providedIn: 'root' })
export class WorkspaceService {
  private readonly current = signal<Workspace>('grossiste');

  readonly workspace = this.current.asReadonly();

  select(workspace: Workspace): void {
    this.current.set(workspace);
  }
}
