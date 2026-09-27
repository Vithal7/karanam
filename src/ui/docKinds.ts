import type { DocKind } from '../domain/types';

export const DOC_KIND_LABEL: Record<DocKind, string> = {
  offer: 'Offer / appointment letter',
  appraisal: 'Appraisal / revision letter',
  payslip: 'Payslip',
  taxsheet: 'Tax computation sheet',
  resignation: 'Resignation / relieving',
  fnf: 'Full & final (F&F) settlement',
  other: 'Other (ignore)',
};

export const DOC_KIND_SHORT: Record<DocKind, string> = {
  offer: 'Offer',
  appraisal: 'Appraisal',
  payslip: 'Payslip',
  taxsheet: 'Tax sheet',
  resignation: 'Resignation',
  fnf: 'F&F',
  other: 'Ignored',
};
