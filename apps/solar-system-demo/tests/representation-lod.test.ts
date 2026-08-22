import assert from "node:assert/strict";
import test from "node:test";
import {
  Representation,
  transitionRepresentation,
} from "../src/rendering/representation-lod.js";

test("representation LOD uses separate hysteresis thresholds", () => {
  assert.equal(transitionRepresentation(undefined, {
    physicalDiameterPixels: 1.4, hierarchyEligible: true, selected: false, focused: false,
  }), Representation.hidden);
  assert.equal(transitionRepresentation(undefined, {
    physicalDiameterPixels: 1.5, hierarchyEligible: true, selected: false, focused: false,
  }), Representation.marker);
  assert.equal(transitionRepresentation(Representation.marker, {
    physicalDiameterPixels: 5.9, hierarchyEligible: true, selected: false, focused: false,
  }), Representation.marker);
  assert.equal(transitionRepresentation(Representation.marker, {
    physicalDiameterPixels: 6, hierarchyEligible: true, selected: false, focused: false,
  }), Representation.sphere);
  assert.equal(transitionRepresentation(Representation.sphere, {
    physicalDiameterPixels: 4, hierarchyEligible: true, selected: false, focused: false,
  }), Representation.sphere);
  assert.equal(transitionRepresentation(Representation.sphere, {
    physicalDiameterPixels: 3.9, hierarchyEligible: true, selected: false, focused: false,
  }), Representation.marker);
  assert.equal(transitionRepresentation(Representation.marker, {
    physicalDiameterPixels: 0.9, hierarchyEligible: true, selected: false, focused: false,
  }), Representation.hidden);
});

test("hierarchy and focus overrides keep navigation targets represented", () => {
  assert.equal(transitionRepresentation(Representation.marker, {
    physicalDiameterPixels: 20, hierarchyEligible: false, selected: false, focused: false,
  }), Representation.hidden);
  assert.equal(transitionRepresentation(Representation.hidden, {
    physicalDiameterPixels: 0.2, hierarchyEligible: false, selected: true, focused: false,
  }), Representation.marker);
  assert.equal(transitionRepresentation(Representation.hidden, {
    physicalDiameterPixels: 0.2, hierarchyEligible: false, selected: false, focused: true,
  }), Representation.marker);
});

test("presentation-role minimum keeps contextual bodies represented without forcing spheres", () => {
  assert.equal(transitionRepresentation(Representation.marker, {
    physicalDiameterPixels: 0.01,
    hierarchyEligible: true,
    selected: false,
    focused: false,
    minimumRepresentation: Representation.marker,
  }), Representation.marker);
  assert.equal(transitionRepresentation(Representation.hidden, {
    physicalDiameterPixels: 0.01,
    hierarchyEligible: false,
    selected: false,
    focused: false,
    minimumRepresentation: Representation.marker,
  }), Representation.marker);
  assert.equal(transitionRepresentation(Representation.marker, {
    physicalDiameterPixels: 8,
    hierarchyEligible: true,
    selected: false,
    focused: false,
    minimumRepresentation: Representation.marker,
  }), Representation.sphere);
});
