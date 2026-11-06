import { FieldValue, Timestamp } from 'firebase-admin/firestore';

export type Data = Record<string, any>;

/**
 * Whether a value is the FieldValue.delete() sentinel.
 *
 * @param value - A value passed to update()
 * @returns True for FieldValue.delete()
 * @example
 * isDeleteSentinel(FieldValue.delete()); // true
 */
function isDeleteSentinel(value: unknown): boolean {
    return value instanceof FieldValue && value.isEqual(FieldValue.delete());
}

/**
 * Whether a value is a FieldValue.arrayUnion(...) or FieldValue.arrayRemove(...) sentinel.
 *
 * @param value - A value passed to set() or update()
 * @param kind - 'Union' or 'Remove'
 * @returns True for the matching sentinel
 * @example
 * isArrayTransform(FieldValue.arrayUnion('c1'), 'Union'); // true
 */
function isArrayTransform(value: unknown, kind: 'Union' | 'Remove'): value is { elements: unknown[] } {
    return value instanceof FieldValue && value.constructor.name === `Array${kind}Transform`;
}

/**
 * Whether a value is a FieldValue.increment(n) sentinel.
 *
 * @param value - A value passed to set() or update()
 * @returns True for FieldValue.increment(n)
 * @example
 * isIncrement(FieldValue.increment(1)); // true
 */
function isIncrement(value: unknown): value is { operand: number } {
    return value instanceof FieldValue && value.constructor.name === 'NumericIncrementTransform';
}

/**
 * Applies an arrayUnion, arrayRemove or increment sentinel to the stored value as Firestore does, and returns any other value unchanged.
 *
 * @param stored - The value stored at the field, if any
 * @param value - The value being written
 * @returns The value to store
 * @example
 * resolveWrite(['a'], FieldValue.arrayUnion('a', 'b')); // ['a', 'b']
 * resolveWrite(['a', 'b'], FieldValue.arrayRemove('a')); // ['b']
 * resolveWrite(2, FieldValue.increment(1)); // 3
 */
function resolveWrite(stored: unknown, value: unknown): unknown {
    if (isIncrement(value)) {
        return (typeof stored === 'number' ? stored : 0) + value.operand;
    }
    const current = Array.isArray(stored) ? stored : [];
    if (isArrayTransform(value, 'Union')) {
        return [...current, ...value.elements.filter(element => !current.includes(element))];
    }
    if (isArrayTransform(value, 'Remove')) {
        return current.filter(element => !value.elements.includes(element));
    }
    return value;
}

/**
 * Deep-copies seed data through JSON, keeping Timestamp instances so code under test can call toMillis().
 *
 * @param data - A seed document
 * @returns An independent copy
 * @example
 * copySeed({ expiresAt: Timestamp.now() }).expiresAt instanceof Timestamp; // true
 */
function copySeed(data: Data): Data {
    return JSON.parse(
        JSON.stringify(data, function (this: Data, key: string, value: unknown) {
            const raw = this[key];
            return raw instanceof Timestamp ? { __timestamp: [raw.seconds, raw.nanoseconds] } : value;
        }),
        (_key, value) => (value && Array.isArray(value.__timestamp) ? new Timestamp(value.__timestamp[0], value.__timestamp[1]) : value)
    );
}

/**
 * Reads a dotted field path from a plain object.
 *
 * @param data - The object to read
 * @param dotted - A path such as 'data.memberId'
 * @returns The value at the path, or undefined
 * @example
 * readPath({ a: { b: 1 } }, 'a.b'); // 1
 */
export function readPath(data: Data | undefined, dotted: string): unknown {
    return dotted.split('.').reduce<any>((value, key) => (value == null ? undefined : value[key]), data);
}

/**
 * Writes a value at a dotted field path, creating intermediate objects as Firestore does.
 *
 * @param data - The object to change
 * @param dotted - A path such as 'progressAreas.a.updatedByUsername'
 * @param value - The value to write
 * @example
 * writePath(doc, 'data.memberName', 'New');
 */
export function writePath(data: Data, dotted: string, value: unknown): void {
    const keys = dotted.split('.');
    const last = keys.pop() as string;
    const parent = keys.reduce<Data>((node, key) => (node[key] ??= {}), data);
    if (isDeleteSentinel(value)) {
        delete parent[last];
        return;
    }
    parent[last] = resolveWrite(parent[last], value);
}

/**
 * Merges plain nested objects the way set(data, { merge: true }) does: nested maps are
 * merged key by key, every other value replaces the stored one.
 *
 * @param target - The stored data, changed in place
 * @param source - The data to merge in
 * @example
 * deepMerge(stored, { deletion: { startedAt: now } });
 */
function deepMerge(target: Data, source: Data): void {
    Object.entries(source).forEach(([key, value]) => {
        const isMap = value !== null && typeof value === 'object' && Object.getPrototypeOf(value) === Object.prototype;
        const storedIsMap = target[key] !== null && typeof target[key] === 'object' && Object.getPrototypeOf(target[key]) === Object.prototype;
        if (isDeleteSentinel(value)) {
            delete target[key];
        } else if (isMap && storedIsMap) {
            deepMerge(target[key], value);
        } else {
            target[key] = resolveWrite(target[key], value);
        }
    });
}

/**
 * Builds an in-memory Firestore stand-in for the Admin SDK calls the backend services use:
 * doc(path) with get/set (merge)/update (FieldValue.delete() removes a field, FieldValue.arrayUnion() adds missing elements, FieldValue.arrayRemove() removes elements, FieldValue.increment(n) adds to a number)/delete, getAll(...refs), collection(path) with get/doc and chained
 * where(path, '==' | '>=' | '<', value) on top-level and dotted fields with an optional limit(n) and orderBy(field), select(...fields) that returns only those fields, subcollections through nested
 * paths, batch() with update/set/delete, runTransaction(work) whose get reads live documents and
 * whose writes commit as one batch afterwards, and recursiveDelete(ref) for a document or a
 * collection and everything under it.
 *
 * @param seed - Stored documents keyed by full path
 * @param options.rejectWhereField - A where field whose queries reject
 * @param options.onFirstCommit - Runs against the live documents just before the first batch commit applies
 * @returns The stand-in, the live document map and the size of every committed batch
 * @example
 * const { firestore, docs } = memoryFirestore({ 'users/u1': { username: 'New' } });
 */
export function memoryFirestore(
    seed: Record<string, Data>,
    options: { rejectWhereField?: string; onFirstCommit?: (docs: Map<string, Data>) => void } = {}
) {
    const docs = new Map<string, Data>(Object.entries(seed).map(([path, data]) => [path, copySeed(data)]));
    const commits: number[] = [];

    const inCollection = (collection: string) =>
        [...docs.keys()].filter(
            path => path.startsWith(`${collection}/`) && path.split('/').length === collection.split('/').length + 1
        );

    const docRef = (path: string): any => ({
        path,
        id: path.split('/').pop(),
        get: async () => snapshot(path),
        set: async (data: Data, setOptions?: { merge?: boolean }) => applySet(path, data, setOptions),
        update: async (data: Data) => applyUpdate(path, data),
        delete: async () => {
            docs.delete(path);
        },
        collection: (sub: string) => collectionRef(`${path}/${sub}`)
    });

    const snapshot = (path: string) => ({
        id: path.split('/').pop(),
        ref: docRef(path),
        exists: docs.has(path),
        data: () => docs.get(path)
    });

    const applySet = (path: string, data: Data, setOptions?: { merge?: boolean }) => {
        const copy = { ...data };
        if (setOptions?.merge && docs.has(path)) {
            deepMerge(docs.get(path) as Data, copy);
        } else {
            const fresh: Data = {};
            deepMerge(fresh, copy);
            docs.set(path, fresh);
        }
    };

    const applyUpdate = (path: string, data: Data) => {
        const stored = docs.get(path);
        if (!stored) throw new Error(`no document at ${path}`);
        Object.entries(data).forEach(([field, value]) => writePath(stored, field, value));
    };

    const matches = (stored: any, op: string, value: any): boolean => {
        if (op === '==') return stored === value;
        if (stored === undefined || stored === null) return false;
        return op === '>=' ? stored >= value : stored < value;
    };

    const query = (collection: string, filters: Array<[string, string, unknown]>, max?: number): any => ({
        where: (field: string, op: string, value: unknown) => {
            if (!['==', '>=', '<'].includes(op)) throw new Error(`unsupported operator ${op}`);
            return query(collection, [...filters, [field, op, value]], max);
        },
        limit: (n: number) => query(collection, filters, n),
        orderBy: () => query(collection, filters, max),
        select: (...fields: string[]) => ({
            get: async () => ({
                docs: (await query(collection, filters, max).get()).docs.map((doc: any) => ({
                    ...doc,
                    data: () => Object.fromEntries(fields.filter(field => field in (doc.data() ?? {})).map(field => [field, doc.data()[field]]))
                }))
            })
        }),
        get: async () => {
            const rejected = filters.find(([field]) => field === options.rejectWhereField);
            if (rejected) throw new Error(`query on ${rejected[0]} failed`);
            return {
                docs: inCollection(collection)
                    .filter(path => filters.every(([field, op, value]) => matches(readPath(docs.get(path), field), op, value)))
                    .slice(0, max)
                    .map(snapshot)
            };
        }
    });

    const collectionRef = (collection: string): any => ({
        path: collection,
        doc: (id: string) => docRef(`${collection}/${id}`),
        add: async (data: Data) => {
            const id = `auto${docs.size}_${Math.random().toString(36).slice(2, 8)}`;
            applySet(`${collection}/${id}`, data);
            return docRef(`${collection}/${id}`);
        },
        ...query(collection, [])
    });

    const firestore = {
        doc: (path: string) => docRef(path),
        collection: (collection: string) => collectionRef(collection),
        getAll: async (...refs: Array<{ path: string }>) => refs.map(ref => snapshot(ref.path)),
        recursiveDelete: async (ref: { path: string }) => {
            [...docs.keys()]
                .filter(path => path === ref.path || path.startsWith(`${ref.path}/`))
                .forEach(path => docs.delete(path));
        },
        runTransaction: async <T>(work: (tx: any) => Promise<T>): Promise<T> => {
            const tx = { ...firestore.batch(), get: async (ref: { path: string }) => snapshot(ref.path) };
            const result = await work(tx);
            await tx.commit();
            return result;
        },
        batch: () => {
            const ops: Array<() => void> = [];
            return {
                update: (ref: { path: string }, data: Data) => {
                    ops.push(() => applyUpdate(ref.path, data));
                },
                set: (ref: { path: string }, data: Data, setOptions?: { merge?: boolean }) => {
                    ops.push(() => applySet(ref.path, data, setOptions));
                },
                delete: (ref: { path: string }) => {
                    ops.push(() => docs.delete(ref.path));
                },
                commit: async () => {
                    if (commits.length === 0) options.onFirstCommit?.(docs);
                    commits.push(ops.length);
                    ops.forEach(op => op());
                }
            };
        }
    };
    return { firestore: firestore as any, docs, commits };
}

/**
 * Serialises the live documents in path order, to compare the stored state before and after a call.
 *
 * @param docs - The live document map of a stand-in
 * @returns A stable string of every path and its data
 * @example
 * const before = dump(docs); await run(); expect(dump(docs)).toBe(before);
 */
export function dump(docs: Map<string, Data>): string {
    return JSON.stringify([...docs.entries()].sort(([a], [b]) => a.localeCompare(b)));
}
