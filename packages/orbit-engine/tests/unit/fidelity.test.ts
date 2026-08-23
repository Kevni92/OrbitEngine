import assert from "node:assert/strict";
import test from "node:test";

import {
  FidelityManager,
  FidelitySelectionError,
  combineFidelityRequirements,
  objectId,
  revisionId,
  selectFidelityCandidate,
} from "../../src/index.js";

test("fidelity requirements combine monotonically and normalize reason/source sets", () => {
  const result = combineFidelityRequirements([
    { maxPositionErrorMeters: 50, requiresPerturbations: true, requiredGravitySources: [objectId("20")], reasons: ["b"] },
    { maxPositionErrorMeters: 5, requiresMutualCoupling: true, requiredGravitySources: [objectId("2")], reasons: ["a", "b"] },
  ]);

  assert.equal(result.maxPositionErrorMeters, 5);
  assert.equal(result.requiresPerturbations, true);
  assert.equal(result.requiresMutualCoupling, true);
  assert.deepEqual(result.requiredGravitySources, [objectId("2"), objectId("20")]);
  assert.deepEqual(result.reasons, ["a", "b"]);
});

test("fidelity selection preserves a satisfying authority and otherwise uses stable tie-breaks", () => {
  const candidates = [
    {
      id: "z",
      authorityKind: "numerical",
      configurationRevision: revisionId("2"),
      cost: 2,
      capabilities: { supportsNumericalIntegration: true },
    },
    {
      id: "a",
      authorityKind: "numerical",
      configurationRevision: revisionId("2"),
      cost: 2,
      capabilities: { supportsNumericalIntegration: true },
    },
  ] as const;
  const selected = selectFidelityCandidate({ requiresNumericalIntegration: true }, candidates);
  assert.equal(selected.candidate.id, "a");
  const preserved = selectFidelityCandidate(
    { requiresNumericalIntegration: true },
    candidates,
    selected.candidate,
  );
  assert.equal(preserved.candidate.id, "a");
  assert.equal(preserved.preservedCurrentAuthority, true);
});

test("fidelity manager retains failed requirements without silently downgrading", () => {
  const manager = new FidelityManager();
  const id = objectId("7");
  manager.configureCandidates(id, [{
    id: "analytical",
    authorityKind: "twoBodyAnalytical",
    configurationRevision: revisionId("1"),
    cost: 1,
    capabilities: {},
  }]);

  assert.throws(
    () => manager.setMinimumRequirement(id, { requiresNumericalIntegration: true }),
    (error: unknown) => error instanceof FidelitySelectionError && error.code === "noCandidate",
  );
  assert.equal(manager.getStatus(id).effectiveRequirement.requiresNumericalIntegration, true);
  assert.equal(manager.getStatus(id).lastTransitionResult?.code, "noCandidate");
});
