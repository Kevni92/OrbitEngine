import { objectId, type ObjectId } from "orbit-engine";

export const RUNTIME_OBJECT_ID_START = 9_000_000_000_000_000_000n;
const UINT64_MAX = 18_446_744_073_709_551_615n;

function compareObjectIds(left: ObjectId, right: ObjectId): number {
  const difference = BigInt(left) - BigInt(right);
  return difference < 0n ? -1 : difference > 0n ? 1 : 0;
}

/** Monotonic demo-only allocator. Issued IDs remain retired even after removal. */
export class RuntimeObjectIdAllocator {
  #next: bigint;
  readonly #issued = new Set<ObjectId>();

  constructor(existingIds: readonly ObjectId[], start: bigint = RUNTIME_OBJECT_ID_START) {
    if (start < 1n || start > UINT64_MAX) throw new RangeError("Runtime ObjectId start is outside uint64");
    for (const id of existingIds) this.#issued.add(objectId(id));
    const highestExisting = [...this.#issued].sort(compareObjectIds).at(-1);
    const existingNext = highestExisting === undefined ? start : BigInt(highestExisting) + 1n;
    this.#next = existingNext > start ? existingNext : start;
  }

  allocate(): ObjectId {
    if (this.#next > UINT64_MAX) throw new RangeError("Runtime ObjectId range exhausted");
    const id = objectId(this.#next.toString());
    this.#next += 1n;
    this.#issued.add(id);
    return id;
  }

  allocateMany(count: number): readonly ObjectId[] {
    if (!Number.isSafeInteger(count) || count < 0) throw new RangeError("Runtime allocation count must be a non-negative safe integer");
    return Object.freeze(Array.from({ length: count }, () => this.allocate()));
  }

  hasBeenIssued(id: ObjectId): boolean {
    return this.#issued.has(id);
  }
}
