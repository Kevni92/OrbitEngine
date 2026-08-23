import { revisionId, type RevisionId } from "./propagation.js";

export const DependencyKind = Object.freeze({
  motion: "motion",
  property: "property",
  source: "source",
  frame: "frame",
  provider: "provider",
  maneuver: "maneuver",
  interactionPolicy: "interactionPolicy",
} as const);

export type DependencyKind = (typeof DependencyKind)[keyof typeof DependencyKind];

export interface DependencyRevision {
  readonly kind: DependencyKind;
  readonly id: string;
  readonly revision: RevisionId;
}

export interface DependencyInvalidationTarget {
  readonly kind: DependencyKind;
  readonly id: string;
  readonly revision: RevisionId;
}

function compareText(left: string, right: string): number {
  return left === right ? 0 : left < right ? -1 : 1;
}

function compareDependency(left: DependencyRevision, right: DependencyRevision): number {
  const kind = compareText(left.kind, right.kind);
  if (kind !== 0) return kind;
  const id = compareText(left.id, right.id);
  if (id !== 0) return id;
  return compareText(left.revision, right.revision);
}

export function dependencyKey(value: Pick<DependencyRevision, "kind" | "id">): string {
  return `${value.kind}:${value.id}`;
}

export function normalizeDependencyRevisions(values: readonly DependencyRevision[] | undefined): readonly DependencyRevision[] {
  if (values === undefined) return Object.freeze([]);
  const result = [...values].map((value) => {
    if (typeof value !== "object" || value === null) throw new TypeError("Dependency revision must be an object");
    if (!Object.prototype.hasOwnProperty.call(DependencyKind, value.kind)) throw new RangeError(`Unknown dependency kind: ${String(value.kind)}`);
    if (typeof value.id !== "string" || value.id.trim().length === 0) throw new TypeError("Dependency id must be non-empty");
    return Object.freeze({ kind: value.kind, id: value.id, revision: revisionId(value.revision) });
  });
  result.sort(compareDependency);
  for (let index = 1; index < result.length; index += 1) {
    const previous = result[index - 1]!;
    const current = result[index]!;
    if (dependencyKey(previous) === dependencyKey(current)) throw new RangeError(`Duplicate dependency identity: ${dependencyKey(current)}`);
  }
  return Object.freeze(result);
}

const FNV_OFFSET = 14_695_981_039_346_656_037n;
const FNV_PRIME = 1_099_511_628_211n;
const UINT64_MODULUS = 18_446_744_073_709_551_616n;

export function dependencyRevisionDigest(values: readonly DependencyRevision[] | undefined): RevisionId | undefined {
  const normalized = normalizeDependencyRevisions(values);
  if (normalized.length === 0) return undefined;
  let hash = FNV_OFFSET;
  const text = normalized.map((value) => `${value.kind}\u0000${value.id}\u0000${value.revision}`).join("\u0001");
  for (const character of text) {
    hash ^= BigInt(character.codePointAt(0)!);
    hash = (hash * FNV_PRIME) % UINT64_MODULUS;
  }
  return revisionId(hash.toString());
}

export function dependencyRevisionIdentity(value: DependencyInvalidationTarget): DependencyRevision {
  if (typeof value !== "object" || value === null) throw new TypeError("Dependency invalidation target must be an object");
  if (!Object.prototype.hasOwnProperty.call(DependencyKind, value.kind)) throw new RangeError(`Unknown dependency kind: ${String(value.kind)}`);
  if (typeof value.id !== "string" || value.id.trim().length === 0) throw new TypeError("Dependency id must be non-empty");
  return Object.freeze({ kind: value.kind, id: value.id, revision: revisionId(value.revision) });
}
