export type Json = null | boolean | number | string | Json[] | { [key: string]: Json };
export type JsonRecord = { [key: string]: Json };
export type Slot = { present: false } | { present: true; value: Json };
export interface FieldChange {
  field: string;
  path: string;
  current: Slot;
  incoming: Slot;
}
export interface Entry {
  key: string;
  kind: 'added' | 'removed' | 'changed' | 'unchanged';
  current?: JsonRecord;
  incoming?: JsonRecord;
  changes: FieldChange[];
}
export interface ReconcileReport {
  entries: Entry[];
  counts: { added: number; removed: number; changed: number; unchanged: number };
}
export interface ReconcileOptions {
  key: readonly string[];
  fields?: readonly string[];
  normalize?: (record: Readonly<JsonRecord>, side: 'current' | 'incoming') => JsonRecord;
  maxRecords?: number;
  maxDepth?: number;
  maxNodes?: number;
}
export interface MergeOptions {
  prefer?: 'incoming' | 'current';
  fields?: Readonly<Record<string, 'incoming' | 'current'>>;
  removeMissing?: boolean;
}
export class DuplicateKeyError extends Error {
  constructor(
    readonly key: string,
    readonly side: 'current' | 'incoming',
    readonly index: number,
  ) {
    super(`Duplicate key at ${side} index ${index}: ${key}`);
    this.name = 'DuplicateKeyError';
  }
}
interface Limits {
  maxDepth: number;
  maxNodes: number;
}
function positive(value: number, name: string, maximum: number): number {
  if (!Number.isSafeInteger(value) || value < 1 || value > maximum)
    throw new RangeError(`${name} must be 1..${maximum}.`);
  return value;
}
function isRecord(value: unknown): value is Record<string, unknown> {
  return (
    value !== null &&
    typeof value === 'object' &&
    !Array.isArray(value) &&
    (Object.getPrototypeOf(value) === Object.prototype || Object.getPrototypeOf(value) === null)
  );
}
function put(record: JsonRecord, name: string, value: Json): void {
  Object.defineProperty(record, name, {
    value,
    enumerable: true,
    writable: true,
    configurable: true,
  });
}
function snapshot(value: unknown, limits: Limits): JsonRecord {
  let count = 0;
  const active = new Set<object>();
  const clone = (node: unknown, depth: number): Json => {
    if (++count > limits.maxNodes || depth > limits.maxDepth)
      throw new RangeError('Record resource limit exceeded.');
    if (node === null || typeof node === 'string' || typeof node === 'boolean') return node;
    if (typeof node === 'number' && Number.isFinite(node)) return node;
    if (typeof node !== 'object' || node === null || (!Array.isArray(node) && !isRecord(node)))
      throw new TypeError('Records must contain only finite JSON values.');
    if (active.has(node)) throw new TypeError('Cyclic records are not supported.');
    if (Object.getOwnPropertySymbols(node).length)
      throw new TypeError('Symbol properties are not supported.');
    active.add(node);
    let result: Json;
    if (Array.isArray(node)) {
      if (Object.keys(node).length !== node.length)
        throw new TypeError('Arrays must be dense and have no custom enumerable fields.');
      result = Array.from({ length: node.length }, (_, index) => {
        const descriptor = Object.getOwnPropertyDescriptor(node, String(index));
        if (!descriptor || !('value' in descriptor))
          throw new TypeError('Accessors and sparse arrays are not supported.');
        return clone(descriptor.value, depth + 1);
      });
    } else {
      const object: JsonRecord = {};
      for (const [name, descriptor] of Object.entries(Object.getOwnPropertyDescriptors(node))) {
        if (!descriptor.enumerable)
          throw new TypeError('Nonenumerable record fields are not supported.');
        if (!('value' in descriptor)) throw new TypeError('Record accessors are not supported.');
        put(object, name, clone(descriptor.value, depth + 1));
      }
      result = object;
    }
    active.delete(node);
    return result;
  };
  if (!isRecord(value)) throw new TypeError('Each dataset row must be a plain record.');
  return clone(value, 0) as JsonRecord;
}
function names(value: readonly string[], label: string, allowEmpty: boolean): string[] {
  if (
    !Array.isArray(value) ||
    (!allowEmpty && !value.length) ||
    value.some((name) => typeof name !== 'string') ||
    new Set(value).size !== value.length
  )
    throw new TypeError(`${label} must be a unique array of field names.`);
  return [...value];
}
export function compositeKey(record: Readonly<JsonRecord>, fields: readonly string[]): string {
  const selected = names(fields, 'key', false);
  if (!isRecord(record)) throw new TypeError('Expected a plain record.');
  return JSON.stringify(
    selected.map((field) => {
      if (!Object.hasOwn(record, field)) throw new TypeError(`Missing key field: ${field}.`);
      const value = record[field];
      if (
        value !== null &&
        typeof value !== 'string' &&
        typeof value !== 'boolean' &&
        (typeof value !== 'number' || !Number.isFinite(value))
      )
        throw new TypeError(`Key field ${field} must be a finite JSON primitive.`);
      return value;
    }),
  );
}
function equal(a: Json, b: Json): boolean {
  if (a === b) return true;
  if (a === null || b === null || typeof a !== 'object' || typeof b !== 'object') return false;
  if (Array.isArray(a))
    return (
      Array.isArray(b) &&
      a.length === b.length &&
      a.every((value, index) => equal(value, b[index]!))
    );
  if (Array.isArray(b)) return false;
  const keys = Object.keys(a);
  return (
    keys.length === Object.keys(b).length &&
    keys.every((key) => Object.hasOwn(b, key) && equal(a[key]!, b[key]!))
  );
}
function slot(record: JsonRecord, field: string): Slot {
  return Object.hasOwn(record, field)
    ? { present: true, value: record[field]! }
    : { present: false };
}
export function reconcile(
  current: readonly JsonRecord[],
  incoming: readonly JsonRecord[],
  options: ReconcileOptions,
): ReconcileReport {
  const keyFields = names(options.key, 'key', false);
  const fields = options.fields === undefined ? undefined : names(options.fields, 'fields', true);
  const maxRecords = positive(options.maxRecords ?? 100000, 'maxRecords', 1000000);
  const limits = {
    maxDepth: positive(options.maxDepth ?? 64, 'maxDepth', 128),
    maxNodes: positive(options.maxNodes ?? 100000, 'maxNodes', 1000000),
  };
  if (options.normalize !== undefined && typeof options.normalize !== 'function')
    throw new TypeError('normalize must be a function.');
  const index = (
    rows: readonly JsonRecord[],
    side: 'current' | 'incoming',
  ): Map<string, JsonRecord> => {
    if (!Array.isArray(rows) || rows.length > maxRecords)
      throw new RangeError(`Dataset ${side} must be an array within maxRecords.`);
    const result = new Map<string, JsonRecord>();
    for (const [position, row] of rows.entries()) {
      let copy = snapshot(row, limits);
      if (options.normalize) copy = snapshot(options.normalize(copy, side), limits);
      const key = compositeKey(copy, keyFields);
      if (result.has(key)) throw new DuplicateKeyError(key, side, position);
      result.set(key, copy);
    }
    return result;
  };
  const left = index(current, 'current'),
    right = index(incoming, 'incoming');
  const entries: Entry[] = [],
    counts = { added: 0, removed: 0, changed: 0, unchanged: 0 };
  for (const [key, record] of left) {
    const next = right.get(key);
    if (!next) {
      entries.push({ key, kind: 'removed', current: record, changes: [] });
      counts.removed++;
      continue;
    }
    const differences: FieldChange[] = [];
    for (const field of fields ??
      [...new Set([...Object.keys(record), ...Object.keys(next)])].sort()) {
      const before = slot(record, field),
        after = slot(next, field);
      if (
        before.present !== after.present ||
        (before.present && after.present && !equal(before.value, after.value))
      ) {
        differences.push({
          field,
          path: `/${field.replace(/~/g, '~0').replace(/\//g, '~1')}`,
          current: before,
          incoming: after,
        });
      }
    }
    const kind = differences.length ? 'changed' : 'unchanged';
    entries.push({ key, kind, current: record, incoming: next, changes: differences });
    counts[kind]++;
  }
  for (const [key, record] of right)
    if (!left.has(key)) {
      entries.push({ key, kind: 'added', incoming: record, changes: [] });
      counts.added++;
    }
  return { entries, counts };
}
export function mergePreview(report: ReconcileReport, options: MergeOptions = {}): JsonRecord[] {
  const { prefer = 'incoming', fields = {}, removeMissing = false } = options;
  if (
    !['incoming', 'current'].includes(prefer) ||
    typeof removeMissing !== 'boolean' ||
    !isRecord(fields) ||
    Object.values(fields).some((policy) => policy !== 'incoming' && policy !== 'current')
  )
    throw new TypeError('Invalid merge policy.');
  const limits = { maxDepth: 128, maxNodes: 1000000 };
  const output: JsonRecord[] = [];
  for (const entry of report.entries) {
    if (entry.kind === 'added') {
      output.push(snapshot(entry.incoming, limits));
      continue;
    }
    if (entry.kind === 'removed') {
      if (!removeMissing) output.push(snapshot(entry.current, limits));
      continue;
    }
    const merged = snapshot(entry.current, limits);
    for (const change of entry.changes) {
      const policy = Object.hasOwn(fields, change.field) ? fields[change.field]! : prefer;
      const selected = change[policy];
      if (!selected.present) delete merged[change.field];
      else put(merged, change.field, selected.value);
    }
    output.push(snapshot(merged, limits));
  }
  return output;
}
