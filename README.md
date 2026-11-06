# @lp-labs/dataset-reconcile

Match JSON datasets using explicit composite identities, inspect field changes and generate merge previews. Zero runtime or peer dependencies. No implicit database writes or sibling-package imports.

## Install

```sh
npm install @lp-labs/dataset-reconcile
```

Node 18+ or ES2022 browsers. Includes ESM, CommonJS and TypeScript declarations.

## Quick start

```js
import { reconcile, mergePreview } from '@lp-labs/dataset-reconcile';

const current = [{ tenant: 'a', id: 1, name: 'Ada' }, { tenant: 'a', id: 2, name: 'Lin' }];
const incoming = [{ tenant: 'a', id: 1, name: 'Ada updated' }, { tenant: 'a', id: 3, name: 'Sam' }];
const report = reconcile(current, incoming, { key: ['tenant', 'id'] });
console.log(report.counts); // { added: 1, removed: 1, changed: 1, unchanged: 0 }
const preview = mergePreview(report, { removeMissing: true });
console.log(preview.length); // 2
```

CommonJS: `const { reconcile, mergePreview } = require('@lp-labs/dataset-reconcile');`.

## Input and identities

Both datasets are in-memory arrays of plain JSON records. Values must be null, booleans, finite numbers, strings, dense arrays or plain objects. No undefined, dates, bigint, functions, symbols, getters, cycles or nonenumerable record fields. Serialize/convert special types explicitly before reconciliation.

`key` is a nonempty array of unique top-level field names. Key fields must exist as own fields and contain finite JSON primitives. String `"1"` differs from number `1`; null is a valid explicit key part. Negative zero and zero are the same JSON identity. JSON-array key encoding avoids delimiter collisions.

Duplicate keys on either side throw `DuplicateKeyError` with `key`, `side` and zero-based `index`. No "last row wins" default is used. Dots in names are literal, not paths.

## API reference

Runtime exports: `reconcile`, `compositeKey`, `mergePreview`, `DuplicateKeyError`.

Type exports: `Json`, `JsonRecord`, `Slot`, `FieldChange`, `Entry`, `ReconcileReport`, `ReconcileOptions`, `MergeOptions`.

### `reconcile(current, incoming, options): ReconcileReport`

| Option | Default | Meaning |
|---|---|---|
| `key` | required | Composite identity field names |
| `fields` | all fields | Compare only selected top-level fields; `[]` compares identity only |
| `normalize(record, side)` | none | Synchronous conversion before indexing/comparison |
| `maxRecords` | 100000 | Per-side row cap, configurable 1-1000000 |
| `maxDepth` | 64 | Per-record nesting limit, configurable 1-128; root depth zero |
| `maxNodes` | 100000 | Per-record value count, configurable 1-1000000 |

Normalization receives a deep copy and side `"current"`/`"incoming"`; its returned record is revalidated and copied. Its exceptions propagate. It may affect identity, so normalized duplicates are also rejected. It is not an implicit dependency on record-normalizer.

```js
const report = reconcile(
  [{ email: ' ADA@EXAMPLE.COM ', name: 'Ada' }],
  [{ email: 'ada@example.com', name: 'Ada' }],
  {
    key: ['email'],
    normalize(record) {
      if (typeof record.email !== 'string') throw new TypeError('email must be text');
      return { ...record, email: record.email.trim().toLowerCase() };
    },
  },
);
console.log(report.counts.unchanged); // 1
```

The report contains `counts` for added/removed/changed/unchanged and ordered `entries`:

- Current rows appear first in their original order, followed by new incoming identities in incoming order.
- Entries contain `key`, `kind`, `changes` and applicable `current`/`incoming` deep snapshots.
- Missing incoming identities are marked removed; reporting does not delete anything.
- Matching rows compare JSON values structurally. Object field order is irrelevant; array order matters. Missing fields differ from explicit null.
- A `FieldChange` contains `field`, escaped JSON Pointer `path`, and `current`/`incoming` slots.
- A `Slot` is `{ present: false }` or `{ present: true, value: Json }`. This explicitly models field deletion.
- Nested changes replace the **whole top-level field**, not an array of nested patch operations.

### `compositeKey(record, fields): string`

Expose the same own-field identity encoding for lookup/integration. It validates selected primitive keys, not every unrelated record value.

### `mergePreview(report, options?): JsonRecord[]`

Produces new deeply copied records; does not write storage.

| Option | Default | Meaning |
|---|---|---|
| `prefer` | `"incoming"` | Default side for changed fields |
| `fields` | `{}` | Per-field overrides: `"incoming"` or `"current"` |
| `removeMissing` | false | Explicitly omit identities absent from incoming |

New incoming identities are always included. Removed identities remain unless `removeMissing` is true. Unchanged/ignored fields retain the current record's value. A chosen absent slot deletes that field. Preview preserves current ordering and appends new rows.

```js
const preview = mergePreview(report, {
  prefer: 'incoming',
  fields: { name: 'current' },
  removeMissing: false,
});
```

Policies do not rename/rekey entities. Reports are intended to be produced by `reconcile`, not assembled from untrusted JSON. Treat them as immutable. Merge preview validates resulting JSON using maximum depth 128 and 1000000 nodes per record.

## Customization and persistence

- Normalize identities and representations before comparison using your domain rules; never guess identity through fuzzy matching.
- Use `fields` for business-managed attributes while preserving local-only metadata.
- Display counts/changes for human approval before applying a preview.
- Persist through your own transaction layer, with server-side authorization and version checks. A preview is not an atomic commit or concurrency guarantee.
- Use arrays sorted externally if a different output order is needed.
- Redact snapshots before logging sensitive data.

## Performance, errors and limits

Indexing uses maps; matching is linear in rows plus field comparisons and JSON traversal. Default field names are sorted per matched record. Reports retain both snapshots, so memory is proportional to input size, not constant. This is not a streaming database join, fuzzy entity resolver or three-way conflict engine.

Malformed input throws TypeError, duplicate identity throws DuplicateKeyError, and configured size/depth/node overflows throw RangeError. Errors are explicit and inputs are not mutated. Limits bound rows/nodes, not string byte size or wall-clock execution; apply external limits to untrusted workloads. The 2000-row regression test checks stable identity/order, not a browser performance guarantee.

This initial release is independently authored and makes no ecosystem/standards parity claim.

## Support

If this library is useful to you, consider supporting its maintenance with a [donation via PayPal](https://www.paypal.me/LibinPrasanth).

## Author

Created by [Libin Prasanth](https://www.linkedin.com/in/libinprasanth/). Connect on LinkedIn for updates and discussion.
