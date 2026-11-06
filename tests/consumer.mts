import {
  reconcile,
  compositeKey,
  mergePreview,
  DuplicateKeyError,
} from '@lp-labs/dataset-reconcile';
import type { JsonRecord, ReconcileReport, FieldChange, Slot } from '@lp-labs/dataset-reconcile';
const current: JsonRecord[] = [{ id: 1, name: 'Ada' }];
const report: ReconcileReport = reconcile(current, [{ id: 1, name: 'Lin' }], { key: ['id'] });
const rows: JsonRecord[] = mergePreview(report, {
  fields: { name: 'current' },
  removeMissing: true,
});
const key: string = compositeKey(rows[0]!, ['id']);
const change: FieldChange | undefined = report.entries[0]?.changes[0];
const slot: Slot | undefined = change?.incoming;
if (slot?.present) {
  const value: unknown = slot.value;
  void value;
}
void key;
void DuplicateKeyError;
// @ts-expect-error JSON values exclude functions
reconcile([{ id: () => 1 }], [], { key: ['id'] });
// @ts-expect-error invalid policy
mergePreview(report, { prefer: 'last' });
