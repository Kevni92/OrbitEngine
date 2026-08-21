import assert from "node:assert/strict";
import test from "node:test";
import { simulationInstant, type SimulationInstant } from "orbit-engine";
import {
  StateQueryCoordinator,
  type StateQueryRequest,
} from "../src/simulation/state-query-coordinator.js";

function deferred<T>(): { readonly promise: Promise<T>; resolve(value: T): void } {
  let resolvePromise!: (value: T) => void;
  const promise = new Promise<T>((resolve) => {
    resolvePromise = resolve;
  });
  return { promise, resolve: resolvePromise };
}

async function flush(): Promise<void> {
  await new Promise<void>((resolve) => setImmediate(resolve));
}

test("coordinator keeps one query in flight and replaces pending targets", async () => {
  const first = deferred<string>();
  const second = deferred<string>();
  const requests: StateQueryRequest[] = [];
  const snapshots: string[] = [];
  const coordinator = new StateQueryCoordinator({
    source: {
      query(request) {
        requests.push(request);
        return requests.length === 1 ? first.promise : second.promise;
      },
    },
    onSnapshot(snapshot) {
      snapshots.push(snapshot.value);
    },
  });

  coordinator.request(simulationInstant(1));
  coordinator.request(simulationInstant(2));
  coordinator.request(simulationInstant(3));
  assert.equal(requests.length, 1);
  assert.equal(coordinator.pendingTarget()?.seconds, 3);

  first.resolve("stale");
  await flush();
  assert.equal(requests.length, 2);
  second.resolve("latest");
  await flush();
  assert.deepEqual(snapshots, ["latest"]);
  assert.equal(coordinator.latestSnapshot()?.value, "latest");
  assert.equal(coordinator.latestSnapshot()?.target.seconds, 3);
  assert.equal(coordinator.isPending(), false);
});

test("stale results are discarded and identical paused requests are ignored", async () => {
  const first = deferred<string>();
  const seen: SimulationInstant[] = [];
  const coordinator = new StateQueryCoordinator({
    source: {
      query(request) {
        seen.push(request.target);
        return first.promise;
      },
    },
  });

  coordinator.request(simulationInstant(5));
  coordinator.request(simulationInstant(5));
  assert.equal(seen.length, 1);
  first.resolve("old");
  await flush();
  assert.equal(coordinator.latestSnapshot()?.value, "old");
  coordinator.request(simulationInstant(5));
  assert.equal(seen.length, 1);
});
