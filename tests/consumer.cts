import { reconcile, mergePreview } from '@lp-labs/dataset-reconcile';
const report = reconcile([{ id: 1 }], [{ id: 2 }], { key: ['id'] });
const count: number = mergePreview(report).length;
void count;
