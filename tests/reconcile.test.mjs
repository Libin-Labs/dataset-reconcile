import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { reconcile, mergePreview, compositeKey, DuplicateKeyError } from '../dist/esm/index.js';

test('matches composite keys and classifies added removed changed unchanged records', () => {
  const report = reconcile(
    [
      { tenant: 'a', id: 1, name: 'Ada' },
      { tenant: 'a', id: 2 },
      { tenant: 'b', id: 1 },
    ],
    [
      { tenant: 'a', id: 1, name: 'Lin' },
      { tenant: 'b', id: 1 },
      { tenant: 'c', id: 1 },
    ],
    { key: ['tenant', 'id'] },
  );
  assert.deepEqual(report.counts, { added: 1, removed: 1, changed: 1, unchanged: 1 });
  assert.deepEqual(
    report.entries.map((entry) => entry.kind),
    ['changed', 'removed', 'unchanged', 'added'],
  );
  assert.deepEqual(report.entries[0].changes[0], {
    field: 'name',
    path: '/name',
    current: { present: true, value: 'Ada' },
    incoming: { present: true, value: 'Lin' },
  });
});
test('key encoding avoids delimiter and primitive-type collisions', () => {
  assert.notEqual(
    compositeKey({ a: 'x|y', b: 'z' }, ['a', 'b']),
    compositeKey({ a: 'x', b: 'y|z' }, ['a', 'b']),
  );
  assert.notEqual(compositeKey({ id: 1 }, ['id']), compositeKey({ id: '1' }, ['id']));
  assert.throws(() => compositeKey({}, ['id']), /Missing/);
  assert.throws(() => compositeKey({ id: {} }, ['id']), /primitive/);
});
test('duplicate identities on either side are explicit errors', () => {
  for (const [left, right, side] of [
    [[{ id: 1 }, { id: 1 }], [], 'current'],
    [[], [{ id: 1 }, { id: 1 }], 'incoming'],
  ])
    assert.throws(
      () => reconcile(left, right, { key: ['id'] }),
      (error) => error instanceof DuplicateKeyError && error.side === side && error.index === 1,
    );
});
test('nested equality ignores object key order but preserves array order and missingness', () => {
  const report = reconcile(
    [{ id: 1, data: { a: 1, b: [1, 2] }, absent: null }],
    [{ id: 1, data: { b: [1, 2], a: 1 } }],
    { key: ['id'] },
  );
  assert.deepEqual(
    report.entries[0].changes.map((change) => change.field),
    ['absent'],
  );
  assert.equal(report.entries[0].changes[0].incoming.present, false);
  assert.equal(
    reconcile([{ id: 1, a: [1, 2] }], [{ id: 1, a: [2, 1] }], { key: ['id'] }).counts.changed,
    1,
  );
});
test('normalization affects matching and comparisons without mutating input', () => {
  const current = [{ id: ' A ', text: 'HELLO' }],
    incoming = [{ id: 'a', text: 'hello' }];
  const report = reconcile(current, incoming, {
    key: ['id'],
    normalize: (record) => ({
      id: record.id.trim().toLowerCase(),
      text: record.text.toLowerCase(),
    }),
  });
  assert.equal(report.counts.unchanged, 1);
  assert.equal(current[0].id, ' A ');
});
test('field projection only changes selected fields in a merge preview', () => {
  const report = reconcile(
    [{ id: 1, name: 'old', ignored: 'keep' }],
    [{ id: 1, name: 'new', ignored: 'replace' }],
    { key: ['id'], fields: ['name'] },
  );
  assert.deepEqual(mergePreview(report), [{ id: 1, name: 'new', ignored: 'keep' }]);
  assert.deepEqual(mergePreview(report, { prefer: 'current' }), [
    { id: 1, name: 'old', ignored: 'keep' },
  ]);
});
test('merge policy is explicit and deletion is opt-in', () => {
  const report = reconcile([{ id: 1, a: 1, b: 2 }, { id: 2 }], [{ id: 1, a: 3, c: 4 }, { id: 3 }], {
    key: ['id'],
  });
  assert.deepEqual(mergePreview(report), [{ id: 1, a: 3, c: 4 }, { id: 2 }, { id: 3 }]);
  assert.deepEqual(
    mergePreview(report, { fields: { a: 'current', b: 'current' }, removeMissing: true }),
    [{ id: 1, a: 1, b: 2, c: 4 }, { id: 3 }],
  );
  assert.throws(() => mergePreview(report, { prefer: 'invalid' }), TypeError);
});
test('reports and previews are deep snapshots isolated from source mutations', () => {
  const current = [{ id: 1, nested: { n: 1 } }],
    incoming = [{ id: 1, nested: { n: 2 } }];
  const report = reconcile(current, incoming, { key: ['id'] });
  incoming[0].nested.n = 9;
  assert.equal(report.entries[0].incoming.nested.n, 2);
  const output = mergePreview(report);
  output[0].nested.n = 10;
  assert.equal(report.entries[0].incoming.nested.n, 2);
});
test('special property names remain own JSON fields', () => {
  const current = JSON.parse('[{"id":1,"__proto__":{"a":1}}]');
  const incoming = JSON.parse('[{"id":1,"__proto__":{"a":2}}]');
  const output = mergePreview(reconcile(current, incoming, { key: ['id'] }));
  assert.equal(Object.getPrototypeOf(output[0]), Object.prototype);
  assert.equal(Object.hasOwn(output[0], '__proto__'), true);
  assert.equal(output[0].__proto__.a, 2);
});
test('non-JSON values, cycles, sparse arrays, accessors and resource overflows fail', () => {
  const cycle = {};
  cycle.self = cycle;
  for (const value of [undefined, NaN, Infinity, new Date(), 1n, () => {}, cycle, [, 1]]) {
    assert.throws(() => reconcile([{ id: 1, value }], [], { key: ['id'] }));
  }
  const row = { id: 1 };
  Object.defineProperty(row, 'bad', {
    get() {
      throw new Error('must not execute');
    },
    enumerable: true,
  });
  assert.throws(() => reconcile([row], [], { key: ['id'] }), /accessors/);
  assert.throws(
    () => reconcile([{ id: 1 }, { id: 2 }], [], { key: ['id'], maxRecords: 1 }),
    RangeError,
  );
  assert.throws(
    () => reconcile([{ id: 1, a: { b: {} } }], [], { key: ['id'], maxDepth: 1 }),
    RangeError,
  );
  assert.throws(() => reconcile([{ id: 1 }], [], { key: ['id'], maxNodes: 1 }), RangeError);
  assert.throws(() => reconcile([], [], { key: [] }), TypeError);
});
test('reordering identical records creates no changes and preserves current order', () => {
  const records = Array.from({ length: 2000 }, (_, id) => ({ id, data: [id, String(id)] }));
  const report = reconcile(records, [...records].reverse(), { key: ['id'] });
  assert.equal(report.counts.unchanged, 2000);
  assert.deepEqual(mergePreview(report), records);
});
test('CommonJS exposes independently usable reconciliation', () => {
  const cjs = createRequire(import.meta.url)('../dist/cjs/index.js');
  assert.equal(cjs.reconcile([{ id: 1 }], [], { key: ['id'] }).counts.removed, 1);
});
