import { Pipe, PipeTransform } from '@angular/core';

const FORMATTER = new Intl.NumberFormat('fr-FR', { maximumFractionDigits: 0 });

/** Formats an amount in CFA francs the French way: `94000` → `94 000 FCFA`. */
export function formatFcfa(amount: number): string {
  return `${FORMATTER.format(amount)} FCFA`;
}

@Pipe({ name: 'fcfa' })
export class FcfaPipe implements PipeTransform {
  transform(amount: number | null | undefined): string {
    return amount === null || amount === undefined || !Number.isFinite(amount)
      ? '—'
      : formatFcfa(amount);
  }
}
