import {
  decodeTwoBodyState,
  encodeTwoBodyWire,
  TwoBodyResultCode,
  type TwoBodyWire,
} from "./internal/two-body-wire.js";
import { objectId, type ObjectId } from "./objects.js";
import { gravitationalParameter, type GravitationalParameter } from "./properties.js";
import {
  containsPropagationTime,
  FrameDynamicsAssumption,
  PropagationError,
  PropagationErrorCode,
  PropagationModelKind,
  propagationModelDeclaration,
  propagationState,
  type PropagationErrorContract,
  type PropagationModel,
  type PropagationState,
  type PropagationTimeInterval,
  type ReadOnlyPropagationEvaluationContext,
  type RevisionId,
} from "./propagation.js";
import { referenceFrameId, type ReferenceFrameId } from "./frames.js";
import { compareSimulationInstants, simulationInstant, type SimulationInstant } from "./time.js";

export const TWO_BODY_DEFAULT_ERROR_CONTRACT: PropagationErrorContract = Object.freeze({
  positionAbsoluteMeters: 1e-8,
  velocityAbsoluteMetersPerSecond: 1e-11,
  notes: "Universal-variable Kepler propagation; validated finite-SI domain only.",
});

export interface TwoBodyAnalyticalModelConfiguration {
  readonly anchor: PropagationState;
  readonly centralBody: ObjectId;
  readonly centralBodyRevision: RevisionId;
  readonly mu: GravitationalParameter;
  readonly muRevision: RevisionId;
  readonly propagationFrame: ReferenceFrameId;
  readonly frameRevision: RevisionId;
  readonly validity: PropagationTimeInterval;
  readonly configurationRevision: RevisionId;
  readonly errorContract?: PropagationErrorContract;
}

export interface TwoBodyEvaluator {
  evaluate(value: TwoBodyWire): TwoBodyWire;
}

function fail(code: PropagationErrorCode, message: string, details: Record<string, unknown> = {}): never {
  throw new PropagationError(code, message, details);
}

function validateConfiguration(configuration: TwoBodyAnalyticalModelConfiguration): {
  readonly anchor: PropagationState;
  readonly centralBody: ObjectId;
  readonly mu: GravitationalParameter;
  readonly propagationFrame: ReferenceFrameId;
  readonly validity: PropagationTimeInterval;
} {
  const anchor = propagationState(configuration.anchor);
  const centralBody = objectId(configuration.centralBody);
  const propagationFrame = referenceFrameId(configuration.propagationFrame);
  const validity = {
    start: simulationInstant(configuration.validity.start.seconds, configuration.validity.start.nanoseconds),
    ...(configuration.validity.end === undefined
      ? {}
      : { end: simulationInstant(configuration.validity.end.seconds, configuration.validity.end.nanoseconds) }),
  };
  if (anchor.referenceFrame !== propagationFrame) {
    fail(PropagationErrorCode.invalidCanonicalState, "Two-body anchor frame must equal its propagation frame");
  }
  if (!containsPropagationTime(validity, anchor.epoch)) {
    fail(PropagationErrorCode.invalidConfiguration, "Two-body anchor must lie inside its validity interval");
  }
  const mu = gravitationalParameter(configuration.mu);
  if (mu <= 0) {
    fail(PropagationErrorCode.missingPhysicalProperty, "Two-body propagation requires a positive gravitational parameter");
  }
  return { anchor, centralBody, mu, propagationFrame, validity };
}

function outcomeError(code: number): PropagationError {
  if (code === TwoBodyResultCode.invalidMu) {
    return new PropagationError(
      PropagationErrorCode.missingPhysicalProperty,
      "Two-body propagation requires a positive gravitational parameter",
    );
  }
  if (code === TwoBodyResultCode.numericalFailure) {
    return new PropagationError(PropagationErrorCode.numericalFailure, "Two-body universal-variable solver did not converge");
  }
  return new PropagationError(PropagationErrorCode.invalidCanonicalState, "Two-body propagation rejected its canonical state");
}

function assertDependencyState(
  state: PropagationState,
  target: SimulationInstant,
  frame: ReferenceFrameId,
): void {
  if (compareSimulationInstants(state.epoch, target) !== 0) {
    fail(PropagationErrorCode.invalidCanonicalState, "Central-body dependency did not resolve at the exact target epoch");
  }
  if (state.referenceFrame !== frame) {
    fail(PropagationErrorCode.unsupportedFrameDynamics, "Central-body dependency is not expressed in the propagation frame");
  }
}

export function createTwoBodyAnalyticalModel(
  configuration: TwoBodyAnalyticalModelConfiguration,
  evaluator: TwoBodyEvaluator,
): PropagationModel {
  const normalized = validateConfiguration(configuration);
  const declaration = propagationModelDeclaration({
    kind: PropagationModelKind.twoBodyAnalytical,
    validity: normalized.validity,
    direction: "bidirectional",
    propagationFrame: normalized.propagationFrame,
    supportedFrameDynamics: [FrameDynamicsAssumption.inertial],
    dependencies: [
      { kind: "object", id: normalized.centralBody, revision: configuration.centralBodyRevision },
      { kind: "property", id: `${normalized.centralBody}:mu`, revision: configuration.muRevision },
      { kind: "frame", id: normalized.propagationFrame, revision: configuration.frameRevision },
    ],
    requiredPhysicalProperties: [],
    configurationRevision: configuration.configurationRevision,
    errorContract: configuration.errorContract ?? TWO_BODY_DEFAULT_ERROR_CONTRACT,
  });

  return Object.freeze({
    declaration,
    evaluate: (target: SimulationInstant, context: ReadOnlyPropagationEvaluationContext): PropagationState => {
      if (context.objectId === normalized.centralBody) {
        fail(PropagationErrorCode.dependencyCycle, "Two-body propagation cannot depend on its own active object state");
      }
      if (context.resolveDependencyState === undefined) {
        fail(PropagationErrorCode.missingDependency, "Two-body propagation requires a central-body state resolver");
      }
      const centralDependency = {
        kind: "object" as const,
        id: normalized.centralBody,
        revision: configuration.centralBodyRevision,
      };
      const centralState = context.resolveDependencyState(centralDependency, target);
      assertDependencyState(centralState, target, normalized.propagationFrame);
      const result = evaluator.evaluate(encodeTwoBodyWire({
        centralObject: normalized.centralBody,
        mu: normalized.mu,
        anchor: normalized.anchor,
        target,
      }));
      if (result.resultCode !== TwoBodyResultCode.success) {
        throw outcomeError(result.resultCode);
      }
      return decodeTwoBodyState(result);
    },
  });
}
