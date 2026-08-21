import { FrameRegistry, type ObjectFrameStateSource } from "./frame-registry.js";
import { referenceFrameId, type ReferenceFrameId } from "./frames.js";
import { objectId, type ObjectId } from "./objects.js";
import {
  PropagationError,
  PropagationErrorCode,
  evaluatePropagationModel,
  propagationEvaluationContext,
  revisionId,
  type PropagationDependency,
  type PropagationModel,
  type PropagationState,
  type RevisionId,
} from "./propagation.js";
import { ObjectRegistry, type ObjectRecord } from "./registry.js";
import {
  compareSimulationInstants,
  simulationInstant,
  type SimulationInstant,
} from "./time.js";

export const StateQueryErrorCode = Object.freeze({
  missingModelBinding: "missingModelBinding",
  modelBindingMismatch: "modelBindingMismatch",
  dependencyRevisionMismatch: "dependencyRevisionMismatch",
  dependencyCycle: "dependencyCycle",
  unsupportedDependency: "unsupportedDependency",
} as const);

export type StateQueryErrorCode = (typeof StateQueryErrorCode)[keyof typeof StateQueryErrorCode];

export class StateQueryError extends Error {
  readonly code: StateQueryErrorCode;
  readonly details: Readonly<Record<string, unknown>>;

  constructor(code: StateQueryErrorCode, message: string, details: Record<string, unknown> = {}) {
    super(message);
    this.name = "StateQueryError";
    this.code = code;
    this.details = Object.freeze({ ...details });
  }
}

interface MotionBinding {
  readonly model: PropagationModel;
  readonly motionRevision: RevisionId;
}

interface QueryRequestContext {
  readonly rawStates: Map<string, PropagationState>;
  readonly transformedStates: Map<string, PropagationState>;
  readonly activeObjects: Set<string>;
}

function normalizedTarget(target: SimulationInstant): SimulationInstant {
  return simulationInstant(target.seconds, target.nanoseconds);
}

function rawKey(id: ObjectId, target: SimulationInstant): string {
  return `${id}|${target.seconds}|${target.nanoseconds}`;
}

function transformedKey(id: ObjectId, target: SimulationInstant, frame: ReferenceFrameId): string {
  return `${rawKey(id, target)}|${frame}`;
}

function requestContext(): QueryRequestContext {
  return {
    rawStates: new Map(),
    transformedStates: new Map(),
    activeObjects: new Set(),
  };
}

function assertModelMatchesRecord(record: ObjectRecord, model: PropagationModel): void {
  const declaration = model.declaration;
  const mismatch = (reason: string): never => {
    throw new StateQueryError(
      StateQueryErrorCode.modelBindingMismatch,
      `Motion model binding does not match registered motion metadata: ${reason}`,
      { objectId: record.id, reason },
    );
  };

  if (record.motion.modelKind !== declaration.kind) mismatch("model kind");
  if (record.motion.direction !== declaration.direction) mismatch("propagation direction");
  if (record.motion.propagationFrame !== declaration.propagationFrame) mismatch("propagation frame");
  if (record.motion.configurationRevision !== declaration.configurationRevision) mismatch("configuration revision");

  if (compareSimulationInstants(record.motion.segmentStart, declaration.validity.start) < 0) {
    mismatch("segment begins before model validity");
  }
  if (declaration.validity.end !== undefined
      && compareSimulationInstants(record.motion.segmentStart, declaration.validity.end) >= 0) {
    mismatch("segment begins outside model validity");
  }
  if (record.motion.segmentEnd === undefined && declaration.validity.end !== undefined) {
    mismatch("open-ended segment exceeds finite model validity");
  }
  if (record.motion.segmentEnd !== undefined && declaration.validity.end !== undefined
      && compareSimulationInstants(record.motion.segmentEnd, declaration.validity.end) > 0) {
    mismatch("segment ends after model validity");
  }
}

function assertTargetInActiveSegment(record: ObjectRecord, target: SimulationInstant): void {
  if (compareSimulationInstants(target, record.motion.segmentStart) < 0
      || (record.motion.segmentEnd !== undefined
        && compareSimulationInstants(target, record.motion.segmentEnd) >= 0)) {
    throw new PropagationError(
      PropagationErrorCode.noActiveSegment,
      "Registered motion segment does not cover the requested instant",
      { objectId: record.id, target },
    );
  }
}

export class ObjectStateQueries {
  readonly #registry: ObjectRegistry;
  readonly #frames: FrameRegistry;
  readonly #bindings = new Map<ObjectId, MotionBinding>();

  constructor(registry: ObjectRegistry, frames: FrameRegistry) {
    this.#registry = registry;
    this.#frames = frames;
  }

  bindMotionModel(id: ObjectId, model: PropagationModel): void {
    const normalizedId = objectId(id);
    if (typeof model !== "object" || model === null || typeof model.evaluate !== "function") {
      throw new TypeError("Motion model binding requires a PropagationModel");
    }
    const record = this.#registry.get(normalizedId);
    assertModelMatchesRecord(record, model);
    this.#assertDependenciesCurrent(model);
    this.#frames.setObjectPropagationFrame(normalizedId, record.motion.propagationFrame);
    this.#bindings.set(normalizedId, Object.freeze({
      model,
      motionRevision: record.motion.motionRevision,
    }));
  }

  stateAt(id: ObjectId, target: SimulationInstant, outputFrame?: ReferenceFrameId): PropagationState {
    const exactTarget = normalizedTarget(target);
    return this.#stateAt(objectId(id), exactTarget, outputFrame, requestContext());
  }

  statesAt(
    ids: readonly ObjectId[],
    target: SimulationInstant,
    outputFrame?: ReferenceFrameId,
  ): readonly PropagationState[] {
    const exactTarget = normalizedTarget(target);
    const normalizedFrame = outputFrame === undefined ? undefined : referenceFrameId(outputFrame);
    const context = requestContext();
    return Object.freeze(ids.map((id) => this.#stateAt(objectId(id), exactTarget, normalizedFrame, context)));
  }

  relativeStateAt(
    targetObject: ObjectId,
    observerObject: ObjectId,
    target: SimulationInstant,
    outputFrame?: ReferenceFrameId,
  ): PropagationState {
    const exactTarget = normalizedTarget(target);
    const context = requestContext();
    const targetState = this.#rawStateAt(objectId(targetObject), exactTarget, context);
    const observerState = this.#rawStateAt(objectId(observerObject), exactTarget, context);
    return this.#frames.relativeState(
      targetState,
      observerState,
      outputFrame === undefined ? undefined : referenceFrameId(outputFrame),
    );
  }

  objectStateSource(id: ObjectId, outputFrame: ReferenceFrameId): ObjectFrameStateSource {
    const normalizedId = objectId(id);
    const frame = referenceFrameId(outputFrame);
    const record = this.#registry.get(normalizedId);
    this.#bindingFor(record);
    return Object.freeze({
      objectId: normalizedId,
      revision: record.motion.motionRevision,
      stateAt: (target: SimulationInstant) => this.stateAt(normalizedId, target, frame),
    });
  }

  #bindingFor(record: ObjectRecord): MotionBinding {
    const binding = this.#bindings.get(record.id);
    if (binding === undefined) {
      throw new StateQueryError(
        StateQueryErrorCode.missingModelBinding,
        `No motion model is bound for registered object ${record.id}`,
        { objectId: record.id },
      );
    }
    if (binding.motionRevision !== record.motion.motionRevision) {
      throw new StateQueryError(
        StateQueryErrorCode.modelBindingMismatch,
        `Motion model binding for object ${record.id} is stale after a motion revision change`,
        {
          objectId: record.id,
          boundMotionRevision: binding.motionRevision,
          currentMotionRevision: record.motion.motionRevision,
        },
      );
    }
    assertModelMatchesRecord(record, binding.model);
    this.#assertDependenciesCurrent(binding.model);
    return binding;
  }

  #stateAt(
    id: ObjectId,
    target: SimulationInstant,
    outputFrame: ReferenceFrameId | undefined,
    context: QueryRequestContext,
  ): PropagationState {
    const raw = this.#rawStateAt(id, target, context);
    if (outputFrame === undefined || raw.referenceFrame === outputFrame) return raw;

    const frame = referenceFrameId(outputFrame);
    const key = transformedKey(id, target, frame);
    const cached = context.transformedStates.get(key);
    if (cached !== undefined) return cached;

    const transformed = this.#frames.transformState(raw, frame);
    context.transformedStates.set(key, transformed);
    return transformed;
  }

  #rawStateAt(id: ObjectId, target: SimulationInstant, context: QueryRequestContext): PropagationState {
    const key = rawKey(id, target);
    const cached = context.rawStates.get(key);
    if (cached !== undefined) return cached;
    if (context.activeObjects.has(key)) {
      throw new PropagationError(
        PropagationErrorCode.dependencyCycle,
        `Object motion dependency cycle detected while evaluating ${id}`,
        { objectId: id, target },
      );
    }

    context.activeObjects.add(key);
    try {
      const record = this.#registry.get(id);
      const binding = this.#bindingFor(record);
      assertTargetInActiveSegment(record, target);
      const model = binding.model;
      const evaluationContext = propagationEvaluationContext({
        objectId: id,
        currentTime: this.#registry.currentTime(),
        physicalProperties: record.properties,
        resolveDependencyState: (dependency, dependencyTarget) =>
          this.#resolveDependencyState(model, dependency, normalizedTarget(dependencyTarget), context),
      });
      const state = evaluatePropagationModel(model, target, evaluationContext);
      context.rawStates.set(key, state);
      return state;
    } finally {
      context.activeObjects.delete(key);
    }
  }

  #resolveDependencyState(
    model: PropagationModel,
    dependency: PropagationDependency,
    target: SimulationInstant,
    context: QueryRequestContext,
  ): PropagationState {
    if (dependency.kind !== "object") {
      throw new StateQueryError(
        StateQueryErrorCode.unsupportedDependency,
        `Propagation model requested a non-object state dependency: ${dependency.kind}:${dependency.id}`,
        { dependency },
      );
    }

    let dependencyId: ObjectId;
    try {
      dependencyId = objectId(dependency.id);
    } catch (error) {
      throw new PropagationError(
        PropagationErrorCode.missingDependency,
        `Propagation object dependency is not a valid ObjectId: ${dependency.id}`,
        { dependency, cause: error },
      );
    }

    const dependencyRecord = this.#registry.get(dependencyId);
    if (dependencyRecord.motion.motionRevision !== dependency.revision) {
      this.#dependencyMismatch(dependency, dependencyRecord.motion.motionRevision);
    }
    return this.#stateAt(dependencyId, target, model.declaration.propagationFrame, context);
  }

  #assertDependenciesCurrent(model: PropagationModel): void {
    for (const dependency of model.declaration.dependencies) {
      switch (dependency.kind) {
        case "object": {
          const record = this.#registry.get(objectId(dependency.id));
          if (record.motion.motionRevision !== dependency.revision) {
            this.#dependencyMismatch(dependency, record.motion.motionRevision);
          }
          break;
        }
        case "property": {
          const separator = dependency.id.lastIndexOf(":");
          const dependencyObject = separator <= 0 ? "" : dependency.id.slice(0, separator);
          const propertyName = separator <= 0 ? "" : dependency.id.slice(separator + 1);
          if (propertyName !== "mu") {
            throw new StateQueryError(
              StateQueryErrorCode.unsupportedDependency,
              `Unsupported registered physical-property dependency: ${dependency.id}`,
              { dependency },
            );
          }
          const record = this.#registry.get(objectId(dependencyObject));
          if (record.propertyRevision !== dependency.revision) {
            this.#dependencyMismatch(dependency, record.propertyRevision);
          }
          if (record.properties.mu === undefined) {
            throw new PropagationError(
              PropagationErrorCode.missingPhysicalProperty,
              `Registered object ${record.id} is missing required gravitational parameter`,
              { dependency },
            );
          }
          break;
        }
        case "frame": {
          const frame = this.#frames.get(referenceFrameId(dependency.id));
          const currentRevision = frame.provider.revision ?? revisionId("0");
          if (currentRevision !== dependency.revision) {
            this.#dependencyMismatch(dependency, currentRevision);
          }
          break;
        }
        case "source":
        case "attitude":
        case "mass":
          break;
      }
    }
  }

  #dependencyMismatch(dependency: PropagationDependency, actualRevision: RevisionId): never {
    throw new StateQueryError(
      StateQueryErrorCode.dependencyRevisionMismatch,
      `Propagation dependency revision is stale for ${dependency.kind}:${dependency.id}`,
      {
        dependency,
        expectedRevision: dependency.revision,
        actualRevision,
      },
    );
  }
}
