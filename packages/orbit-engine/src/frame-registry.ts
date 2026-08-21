import type { Backend } from "./internal/backends/contract.js";
import {
  encodeFrameRegistryWire,
  frameRegistryDependencyFromWire,
  frameRegistryFrameIdFromWire,
  frameRegistryParentFromWire,
  FrameRegistryOperationCode,
  FrameRegistryProviderCode,
  FrameRegistryResultCode,
  type FrameRegistryWire,
} from "./internal/frame-registry-wire.js";
import { objectId, type ObjectId } from "./objects.js";
import {
  composeRigidStateTransforms,
  identityRigidStateTransform,
  inverseRigidStateTransform,
  referenceFrameId,
  rigidStateTransform,
  transformCartesianState,
  type CartesianState,
  type Quaternion,
  type ReferenceFrameId,
  type RigidStateTransform,
  type Vec3,
} from "./frames.js";
import {
  PropagationModelKind,
  propagationState,
  revisionId,
  type PropagationState,
  type RevisionId,
} from "./propagation.js";
import {
  compareSimulationInstants,
  simulationInstant,
  type SimulationInstant,
} from "./time.js";
import { meters, metersPerSecond, radiansPerSecond, type Meters, type MetersPerSecond, type RadiansPerSecond } from "./units.js";

export const FrameProviderKind = Object.freeze({
  staticRigid: "staticRigid",
  objectCentered: "objectCentered",
  bodyFixed: "bodyFixed",
  staticLocal: "staticLocal",
  objectAttached: "objectAttached",
} as const);

export type FrameProviderKind = (typeof FrameProviderKind)[keyof typeof FrameProviderKind];

export interface OrientationSample {
  readonly epoch: SimulationInstant;
  readonly orientation: Quaternion;
  readonly angularVelocity: Vec3<RadiansPerSecond>;
}

export interface OrientationProvider {
  readonly id: string;
  readonly revision?: RevisionId;
  evaluate(target: SimulationInstant): OrientationSample;
}

export interface ObjectFrameStateSource {
  readonly objectId: ObjectId;
  readonly revision?: RevisionId;
  stateAt(target: SimulationInstant): PropagationState;
}

export interface StaticRigidFrameProvider {
  readonly kind: "staticRigid" | "staticLocal";
  readonly transform: RigidStateTransform;
  readonly revision?: RevisionId;
}

export interface ObjectCenteredFrameProvider {
  readonly kind: "objectCentered";
  readonly source: ObjectFrameStateSource;
  readonly revision?: RevisionId;
}

export interface BodyFixedFrameProvider {
  readonly kind: "bodyFixed";
  readonly source: ObjectFrameStateSource;
  readonly orientation: OrientationProvider;
  readonly revision?: RevisionId;
}

export interface ObjectAttachedFrameProvider {
  readonly kind: "objectAttached";
  readonly source: ObjectFrameStateSource;
  readonly orientation?: OrientationProvider;
  readonly revision?: RevisionId;
}

export type FrameProvider =
  | StaticRigidFrameProvider
  | ObjectCenteredFrameProvider
  | BodyFixedFrameProvider
  | ObjectAttachedFrameProvider;

type DynamicFrameProvider = Exclude<FrameProvider, StaticRigidFrameProvider>;

function isStaticProvider(provider: FrameProvider): provider is StaticRigidFrameProvider {
  return provider.kind === "staticRigid" || provider.kind === "staticLocal";
}

export interface FrameRegistration {
  readonly id: ReferenceFrameId;
  readonly parent: ReferenceFrameId;
  readonly provider: FrameProvider;
}

export interface FrameNode extends FrameRegistration {}

export interface FrameRegistryOptions {
  readonly maxCacheEntries?: number;
}

export interface FrameStateQuerySource {
  readonly objectId: ObjectId;
  stateAt(target: SimulationInstant): PropagationState;
}

export const FrameRegistryErrorCode = Object.freeze({
  invalidInput: "invalidInput",
  duplicateLiveId: "duplicateLiveId",
  retiredId: "retiredId",
  notLive: "notLive",
  blockedRemoval: "blockedRemoval",
  missingParent: "missingParent",
  rootProtected: "rootProtected",
  invalidTransform: "invalidTransform",
  missingDependency: "missingDependency",
  dependencyCycle: "dependencyCycle",
  sourceUnavailable: "sourceUnavailable",
} as const);

export type FrameRegistryErrorCode = (typeof FrameRegistryErrorCode)[keyof typeof FrameRegistryErrorCode];

const RESULT_TO_ERROR: Readonly<Record<number, FrameRegistryErrorCode>> = Object.freeze({
  [FrameRegistryResultCode.invalidInput]: FrameRegistryErrorCode.invalidInput,
  [FrameRegistryResultCode.duplicateLiveId]: FrameRegistryErrorCode.duplicateLiveId,
  [FrameRegistryResultCode.retiredId]: FrameRegistryErrorCode.retiredId,
  [FrameRegistryResultCode.notLive]: FrameRegistryErrorCode.notLive,
  [FrameRegistryResultCode.blockedRemoval]: FrameRegistryErrorCode.blockedRemoval,
  [FrameRegistryResultCode.missingParent]: FrameRegistryErrorCode.missingParent,
  [FrameRegistryResultCode.rootProtected]: FrameRegistryErrorCode.rootProtected,
});

export class FrameRegistryError extends Error {
  readonly code: FrameRegistryErrorCode;
  readonly resultCode?: number;

  constructor(code: FrameRegistryErrorCode, message: string, resultCode?: number) {
    super(message);
    this.name = "FrameRegistryError";
    this.code = code;
    this.resultCode = resultCode;
  }
}

function failForResult(wire: FrameRegistryWire, operation: string): never {
  const code = RESULT_TO_ERROR[wire.resultCode] ?? FrameRegistryErrorCode.invalidInput;
  throw new FrameRegistryError(code, `Frame registry ${operation} failed: ${code}`, wire.resultCode);
}

function normalizeEpoch(value: SimulationInstant): SimulationInstant {
  return simulationInstant(value.seconds, value.nanoseconds);
}

function normalizedRevision(value: RevisionId | undefined): RevisionId {
  return revisionId(value ?? "0");
}

function assertExactEpoch(actual: SimulationInstant, expected: SimulationInstant, name: string): void {
  if (compareSimulationInstants(actual, expected) !== 0) {
    throw new FrameRegistryError(FrameRegistryErrorCode.sourceUnavailable, `${name} returned a different exact epoch`);
  }
}

function vectorDifference(left: Vec3<number>, right: Vec3<number>): Vec3<number> {
  return { x: left.x - right.x, y: left.y - right.y, z: left.z - right.z };
}

function providerCode(provider: FrameProvider): number {
  switch (provider.kind) {
    case FrameProviderKind.staticRigid: return FrameRegistryProviderCode.staticRigid;
    case FrameProviderKind.objectCentered: return FrameRegistryProviderCode.objectCentered;
    case FrameProviderKind.bodyFixed: return FrameRegistryProviderCode.bodyFixed;
    case FrameProviderKind.staticLocal: return FrameRegistryProviderCode.staticLocal;
    case FrameProviderKind.objectAttached: return FrameRegistryProviderCode.objectAttached;
  }
}

function providerDependency(provider: FrameProvider): ObjectId | undefined {
  return isStaticProvider(provider) ? undefined : provider.source.objectId;
}

function validateProvider(provider: FrameProvider): FrameProvider {
  if (typeof provider !== "object" || provider === null) throw new TypeError("Frame provider must be an object");
  if (isStaticProvider(provider)) {
    return Object.freeze({
      ...provider,
      transform: rigidStateTransform(provider.transform),
      revision: normalizedRevision(provider.revision),
    });
  }
  const dynamicProvider = provider as DynamicFrameProvider;
  objectId(dynamicProvider.source.objectId);
  if (typeof dynamicProvider.source.stateAt !== "function") throw new TypeError("Frame provider state source must implement stateAt");
  if (dynamicProvider.kind === "bodyFixed" && typeof dynamicProvider.orientation.evaluate !== "function") {
    throw new TypeError("Body-fixed frame provider requires an orientation source");
  }
  if (dynamicProvider.kind === "objectAttached" && dynamicProvider.orientation !== undefined
      && typeof dynamicProvider.orientation.evaluate !== "function") {
    throw new TypeError("Object-attached orientation source must implement evaluate");
  }
  return Object.freeze({
    ...provider,
    revision: normalizedRevision(dynamicProvider.revision),
    source: Object.freeze({ ...dynamicProvider.source, revision: normalizedRevision(dynamicProvider.source.revision) }),
    ...(dynamicProvider.kind === "bodyFixed" || dynamicProvider.kind === "objectAttached"
      ? { orientation: dynamicProvider.orientation === undefined ? undefined : Object.freeze({
        ...dynamicProvider.orientation,
        revision: normalizedRevision(dynamicProvider.orientation.revision),
      }) } : {}),
  }) as FrameProvider;
}

function providerAt(provider: FrameProvider, parent: ReferenceFrameId, target: SimulationInstant): RigidStateTransform {
  if (isStaticProvider(provider)) {
    const staticTransform = provider.transform;
    return rigidStateTransform({ ...staticTransform, epoch: target });
  }
  const dynamicProvider = provider as DynamicFrameProvider;
  const state = propagationState(dynamicProvider.source.stateAt(target));
  assertExactEpoch(state.epoch, target, "Object frame state source");
  if (state.referenceFrame !== parent) {
    throw new FrameRegistryError(FrameRegistryErrorCode.missingDependency, "Object frame state must be expressed in the frame parent");
  }
  const orientation = dynamicProvider.kind === "bodyFixed"
    ? dynamicProvider.orientation.evaluate(target)
    : dynamicProvider.kind === "objectAttached"
      ? dynamicProvider.orientation?.evaluate(target)
      : undefined;
  if (orientation === undefined) {
    return rigidStateTransform({
      translation: state.position,
      originVelocity: state.velocity,
      rotation: { w: 1, x: 0, y: 0, z: 0 },
      angularVelocity: { x: radiansPerSecond(0), y: radiansPerSecond(0), z: radiansPerSecond(0) },
      epoch: target,
    });
  }
  const orientationEpoch = normalizeEpoch(orientation.epoch);
  assertExactEpoch(orientationEpoch, target, "Orientation source");
  return rigidStateTransform({
    translation: state.position,
    originVelocity: state.velocity,
    rotation: orientation.orientation,
    angularVelocity: orientation.angularVelocity,
    epoch: target,
  });
}

function edgeRevision(provider: FrameProvider): string {
  if (isStaticProvider(provider)) {
    return provider.revision ?? "0";
  }
  const dynamicProvider = provider as DynamicFrameProvider;
  const sourceRevision = dynamicProvider.source.revision ?? "0";
  const orientationRevision = dynamicProvider.kind === "objectCentered"
    ? "0" : dynamicProvider.orientation?.revision ?? "0";
  return `${provider.revision ?? "0"}:${sourceRevision}:${orientationRevision}`;
}

function edgeDependency(provider: FrameProvider): ObjectId | undefined {
  return providerDependency(provider);
}

interface CacheEntry {
  readonly from: ReferenceFrameId;
  readonly to: ReferenceFrameId;
  readonly epoch: SimulationInstant;
  readonly frameDependencies: readonly ReferenceFrameId[];
  readonly objectDependencies: readonly ObjectId[];
  readonly key: string;
  readonly transform: RigidStateTransform;
}

export class FrameRegistry {
  readonly #backend: Backend;
  readonly #maxCacheEntries: number;
  readonly #frames = new Map<ReferenceFrameId, FrameNode>();
  readonly #retired = new Set<ReferenceFrameId>();
  readonly #objectPropagationFrames = new Map<ObjectId, ReferenceFrameId>();
  readonly #cache = new Map<string, CacheEntry>();

  constructor(backend: Backend, options: FrameRegistryOptions = {}) {
    this.#backend = backend;
    this.#maxCacheEntries = options.maxCacheEntries ?? 512;
    if (!Number.isSafeInteger(this.#maxCacheEntries) || this.#maxCacheEntries <= 0) {
      throw new RangeError("Frame cache capacity must be a positive safe integer");
    }
    const root = referenceFrameId("1");
    const reset = encodeFrameRegistryWire({
      operationCode: FrameRegistryOperationCode.reset,
      frameId: root,
      providerCode: FrameRegistryProviderCode.root,
      transform: identityRigidStateTransform(simulationInstant(0)),
    });
    const result = this.#backend.roundTripFrameRegistry(reset);
    if (result.resultCode !== FrameRegistryResultCode.success) failForResult(result, "reset");
    this.#frames.set(root, Object.freeze({
      id: root,
      parent: root,
      provider: Object.freeze({
        kind: FrameProviderKind.staticRigid,
        transform: identityRigidStateTransform(simulationInstant(0)),
        revision: revisionId("0"),
      }),
    }));
  }

  root(): ReferenceFrameId {
    return referenceFrameId("1");
  }

  get(id: ReferenceFrameId): FrameNode {
    const normalized = referenceFrameId(id);
    const node = this.#frames.get(normalized);
    if (node === undefined) {
      throw new FrameRegistryError(this.#retired.has(normalized) ? FrameRegistryErrorCode.retiredId : FrameRegistryErrorCode.notLive, "Frame is not live");
    }
    return node;
  }

  register(input: FrameRegistration): FrameNode {
    if (typeof input !== "object" || input === null) throw new TypeError("Frame registration must be an object");
    const id = referenceFrameId(input.id);
    const parent = referenceFrameId(input.parent);
    if (id === this.root()) throw new FrameRegistryError(FrameRegistryErrorCode.duplicateLiveId, "The root frame is immutable");
    if (this.#frames.has(id)) throw new FrameRegistryError(FrameRegistryErrorCode.duplicateLiveId, "Frame ID is already live");
    if (this.#retired.has(id)) throw new FrameRegistryError(FrameRegistryErrorCode.retiredId, "Frame ID has been retired");
    if (!this.#frames.has(parent)) throw new FrameRegistryError(FrameRegistryErrorCode.missingParent, "Frame parent is not live");
    const provider = validateProvider(input.provider);
    const candidate = Object.freeze({ id, parent, provider });
    this.#assertCombinedAcyclic(candidate);
    const wire = encodeFrameRegistryWire({
      operationCode: FrameRegistryOperationCode.register,
      frameId: id,
      parent,
      providerCode: providerCode(provider),
      dependency: providerDependency(provider),
      transform: provider.kind === FrameProviderKind.staticRigid || provider.kind === FrameProviderKind.staticLocal
        ? provider.transform : identityRigidStateTransform(simulationInstant(0)),
    });
    const result = this.#backend.roundTripFrameRegistry(wire);
    if (result.resultCode !== FrameRegistryResultCode.success) failForResult(result, "register");
    this.#frames.set(id, candidate);
    this.#cache.clear();
    return candidate;
  }

  remove(id: ReferenceFrameId): void {
    const normalized = referenceFrameId(id);
    if (normalized === this.root()) throw new FrameRegistryError(FrameRegistryErrorCode.rootProtected, "The root frame cannot be removed");
    this.get(normalized);
    for (const node of this.#frames.values()) {
      if (node.id !== normalized && node.parent === normalized) {
        throw new FrameRegistryError(FrameRegistryErrorCode.blockedRemoval, "Frame has a live child frame");
      }
    }
    for (const frame of this.#objectPropagationFrames.values()) {
      if (frame === normalized) throw new FrameRegistryError(FrameRegistryErrorCode.blockedRemoval, "Frame is an object's propagation frame");
    }
    const wire = encodeFrameRegistryWire({
      operationCode: FrameRegistryOperationCode.remove,
      frameId: normalized,
      providerCode: FrameRegistryProviderCode.staticRigid,
      transform: identityRigidStateTransform(simulationInstant(0)),
    });
    const result = this.#backend.roundTripFrameRegistry(wire);
    if (result.resultCode !== FrameRegistryResultCode.success) failForResult(result, "remove");
    this.#frames.delete(normalized);
    this.#retired.add(normalized);
    this.#clearFrameCache(normalized);
  }

  setObjectPropagationFrame(object: ObjectId, frame: ReferenceFrameId): void {
    const objectIdValue = objectId(object);
    const frameIdValue = referenceFrameId(frame);
    this.get(frameIdValue);
    const previous = this.#objectPropagationFrames.get(objectIdValue);
    this.#objectPropagationFrames.set(objectIdValue, frameIdValue);
    try {
      this.#assertCombinedAcyclic();
    } catch (error) {
      if (previous === undefined) this.#objectPropagationFrames.delete(objectIdValue);
      else this.#objectPropagationFrames.set(objectIdValue, previous);
      throw error;
    }
    this.invalidateFrom(objectIdValue, simulationInstant(Number.MIN_SAFE_INTEGER));
  }

  transform(from: ReferenceFrameId, to: ReferenceFrameId, epoch: SimulationInstant): RigidStateTransform {
    const source = referenceFrameId(from);
    const target = referenceFrameId(to);
    const exactEpoch = normalizeEpoch(epoch);
    this.get(source);
    this.get(target);
    if (source === target) return identityRigidStateTransform(exactEpoch);
    const sourcePath = this.#pathToRoot(source);
    const targetPath = this.#pathToRoot(target);
    const targetIndex = new Map(targetPath.map((value, index) => [value, index]));
    const lca = sourcePath.find((value) => targetIndex.has(value));
    if (lca === undefined) throw new FrameRegistryError(FrameRegistryErrorCode.dependencyCycle, "Frame paths have no common root");
    const frameDependencies = [...new Set([...sourcePath, ...targetPath])];
    const objectDependencies = frameDependencies.flatMap((frame) => {
      const provider = this.#frames.get(frame)?.provider;
      const dependency = provider === undefined ? undefined : edgeDependency(provider);
      return dependency === undefined ? [] : [dependency];
    });
    const key = `${source}|${target}|${exactEpoch.seconds}|${exactEpoch.nanoseconds}|${frameDependencies.map((id) => `${id}:${edgeRevision(this.#frames.get(id)!.provider)}`).join(",")}`;
    const cached = this.#cache.get(key);
    if (cached !== undefined) return cached.transform;
    let lcaFromSource = identityRigidStateTransform(exactEpoch);
    let current = source;
    while (current !== lca) {
      const node = this.#frames.get(current)!;
      lcaFromSource = composeRigidStateTransforms(providerAt(node.provider, node.parent, exactEpoch), lcaFromSource);
      current = node.parent;
    }
    let lcaFromTarget = identityRigidStateTransform(exactEpoch);
    current = target;
    while (current !== lca) {
      const node = this.#frames.get(current)!;
      lcaFromTarget = composeRigidStateTransforms(providerAt(node.provider, node.parent, exactEpoch), lcaFromTarget);
      current = node.parent;
    }
    const result = composeRigidStateTransforms(inverseRigidStateTransform(lcaFromTarget), lcaFromSource);
    this.#cache.set(key, Object.freeze({
      from: source,
      to: target,
      epoch: exactEpoch,
      frameDependencies,
      objectDependencies,
      key,
      transform: result,
    }));
    while (this.#cache.size > this.#maxCacheEntries) this.#cache.delete(this.#cache.keys().next().value!);
    return result;
  }

  transformState(state: PropagationState, outputFrame: ReferenceFrameId): PropagationState {
    const normalized = propagationState(state);
    const target = referenceFrameId(outputFrame);
    const transform = this.transform(normalized.referenceFrame, target, normalized.epoch);
    const result = transformCartesianState(transform, normalized as CartesianState);
    return propagationState({ ...result, referenceFrame: target });
  }

  queryObjectState(source: FrameStateQuerySource, target: SimulationInstant, outputFrame?: ReferenceFrameId): PropagationState {
    objectId(source.objectId);
    if (typeof source.stateAt !== "function") throw new TypeError("Frame state query source must implement stateAt");
    const exactTarget = normalizeEpoch(target);
    const state = propagationState(source.stateAt(exactTarget));
    assertExactEpoch(state.epoch, exactTarget, "Object state authority");
    return outputFrame === undefined ? state : this.transformState(state, outputFrame);
  }

  relativeState(target: PropagationState, observer: PropagationState, outputFrame?: ReferenceFrameId): PropagationState {
    const targetState = propagationState(target);
    const observerState = propagationState(observer);
    assertExactEpoch(observerState.epoch, targetState.epoch, "Relative-state observer");
    const common = outputFrame === undefined
      ? this.#lowestCommonAncestor(targetState.referenceFrame, observerState.referenceFrame)
      : referenceFrameId(outputFrame);
    const targetLocal = this.transformState(targetState, common);
    const observerLocal = this.transformState(observerState, common);
    const relative = propagationState({
      position: vectorDifference(targetLocal.position, observerLocal.position) as Vec3<Meters>,
      velocity: vectorDifference(targetLocal.velocity, observerLocal.velocity) as Vec3<MetersPerSecond>,
      epoch: targetState.epoch,
      referenceFrame: common,
    });
    return outputFrame === undefined ? relative : this.transformState(relative, outputFrame);
  }

  transformBatch(requests: readonly { readonly from: ReferenceFrameId; readonly to: ReferenceFrameId; readonly epoch: SimulationInstant }[]): readonly RigidStateTransform[] {
    return Object.freeze(requests.map((request) => this.transform(request.from, request.to, request.epoch)));
  }

  invalidateFrom(object: ObjectId, epoch: SimulationInstant): void {
    const objectIdValue = objectId(object);
    const exactEpoch = normalizeEpoch(epoch);
    for (const [key, entry] of this.#cache) {
      if (entry.objectDependencies.includes(objectIdValue) && compareSimulationInstants(entry.epoch, exactEpoch) >= 0) this.#cache.delete(key);
    }
  }

  invalidateFrameFrom(frame: ReferenceFrameId, epoch: SimulationInstant): void {
    const frameIdValue = referenceFrameId(frame);
    const exactEpoch = normalizeEpoch(epoch);
    for (const [key, entry] of this.#cache) {
      if (entry.frameDependencies.includes(frameIdValue) && compareSimulationInstants(entry.epoch, exactEpoch) >= 0) this.#cache.delete(key);
    }
  }

  cacheSize(): number {
    return this.#cache.size;
  }

  #pathToRoot(start: ReferenceFrameId): ReferenceFrameId[] {
    const path: ReferenceFrameId[] = [];
    const visited = new Set<ReferenceFrameId>();
    let current = start;
    while (true) {
      if (visited.has(current)) throw new FrameRegistryError(FrameRegistryErrorCode.dependencyCycle, "Frame parent cycle detected");
      visited.add(current);
      path.push(current);
      const node = this.#frames.get(current);
      if (node === undefined) throw new FrameRegistryError(FrameRegistryErrorCode.notLive, "Frame is not live");
      if (current === this.root()) return path;
      current = node.parent;
    }
  }

  #lowestCommonAncestor(left: ReferenceFrameId, right: ReferenceFrameId): ReferenceFrameId {
    const rightPath = new Set(this.#pathToRoot(right));
    const common = this.#pathToRoot(left).find((value) => rightPath.has(value));
    if (common === undefined) throw new FrameRegistryError(FrameRegistryErrorCode.dependencyCycle, "Frame paths have no common root");
    return common;
  }

  #clearFrameCache(frame: ReferenceFrameId): void {
    for (const [key, entry] of this.#cache) {
      if (entry.frameDependencies.includes(frame)) this.#cache.delete(key);
    }
  }

  #assertCombinedAcyclic(candidate?: FrameNode): void {
    const frameNodes = new Map(this.#frames);
    if (candidate !== undefined) frameNodes.set(candidate.id, candidate);
    const edges = new Map<string, string[]>();
    for (const node of frameNodes.values()) {
      const frameKey = `f:${node.id}`;
      const frameEdges = edges.get(frameKey) ?? [];
      if (node.id !== this.root()) frameEdges.push(`f:${node.parent}`);
      const dependency = edgeDependency(node.provider);
      if (dependency !== undefined) frameEdges.push(`o:${dependency}`);
      edges.set(frameKey, frameEdges);
    }
    for (const [object, frame] of this.#objectPropagationFrames) edges.set(`o:${object}`, [`f:${frame}`]);
    const visiting = new Set<string>();
    const visited = new Set<string>();
    const visit = (node: string): void => {
      if (visiting.has(node)) throw new FrameRegistryError(FrameRegistryErrorCode.dependencyCycle, "Combined frame/motion dependency cycle detected");
      if (visited.has(node)) return;
      visiting.add(node);
      for (const edge of edges.get(node) ?? []) visit(edge);
      visiting.delete(node);
      visited.add(node);
    };
    for (const node of edges.keys()) visit(node);
  }
}

export const createFrameRegistry = (backend: Backend, options?: FrameRegistryOptions): FrameRegistry => new FrameRegistry(backend, options);
