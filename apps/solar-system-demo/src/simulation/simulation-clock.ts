import {
  addDurationToInstant,
  duration,
  simulationInstant,
  type Duration,
  type SimulationInstant,
} from "orbit-engine";

const NANOSECONDS_PER_SECOND = 1_000_000_000;

export interface SimulationClockState {
  readonly instant: SimulationInstant;
  readonly playing: boolean;
  readonly warpFactor: number;
}

function assertTimestamp(value: number): void {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0) {
    throw new RangeError("wall-clock timestamp must be a finite non-negative number");
  }
}

function assertWarpFactor(value: number): void {
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) {
    throw new RangeError("warp factor must be a finite positive number");
  }
}

function scaledWallDuration(elapsedMilliseconds: number, warpFactor: number): Duration {
  assertTimestamp(elapsedMilliseconds);
  assertWarpFactor(warpFactor);
  const scaledSeconds = (elapsedMilliseconds / 1000) * warpFactor;
  if (!Number.isFinite(scaledSeconds) || scaledSeconds > Number.MAX_SAFE_INTEGER) {
    throw new RangeError("scaled wall duration exceeds the exact time representation");
  }
  const seconds = Math.floor(scaledSeconds);
  const nanoseconds = Math.round((scaledSeconds - seconds) * NANOSECONDS_PER_SECOND);
  return duration(seconds, nanoseconds);
}

export class SimulationClock {
  #instant: SimulationInstant;
  #playing = false;
  #warpFactor: number;
  #wallAnchorMilliseconds?: number;
  #instantAnchor?: SimulationInstant;

  constructor(initialInstant = simulationInstant(0), warpFactor = 1) {
    this.#instant = simulationInstant(initialInstant.seconds, initialInstant.nanoseconds);
    assertWarpFactor(warpFactor);
    this.#warpFactor = warpFactor;
  }

  state(): SimulationClockState {
    return Object.freeze({
      instant: this.#instant,
      playing: this.#playing,
      warpFactor: this.#warpFactor,
    });
  }

  currentInstant(): SimulationInstant {
    return this.#instant;
  }

  isPlaying(): boolean {
    return this.#playing;
  }

  warpFactor(): number {
    return this.#warpFactor;
  }

  play(wallTimestampMilliseconds: number): void {
    assertTimestamp(wallTimestampMilliseconds);
    if (this.#playing) return;
    this.#playing = true;
    this.#wallAnchorMilliseconds = wallTimestampMilliseconds;
    this.#instantAnchor = this.#instant;
  }

  pause(wallTimestampMilliseconds: number): void {
    if (!this.#playing) return;
    this.advanceTo(wallTimestampMilliseconds);
    this.#playing = false;
    this.#wallAnchorMilliseconds = undefined;
    this.#instantAnchor = undefined;
  }

  toggle(wallTimestampMilliseconds: number): void {
    if (this.#playing) {
      this.pause(wallTimestampMilliseconds);
    } else {
      this.play(wallTimestampMilliseconds);
    }
  }

  setWarpFactor(value: number, wallTimestampMilliseconds?: number): void {
    assertWarpFactor(value);
    if (this.#playing) {
      if (wallTimestampMilliseconds === undefined) {
        throw new TypeError("wall-clock timestamp is required when changing warp while playing");
      }
      this.advanceTo(wallTimestampMilliseconds);
      this.#wallAnchorMilliseconds = wallTimestampMilliseconds;
      this.#instantAnchor = this.#instant;
    }
    this.#warpFactor = value;
  }

  jump(target: SimulationInstant, wallTimestampMilliseconds?: number): void {
    const normalized = simulationInstant(target.seconds, target.nanoseconds);
    if (this.#playing) {
      if (wallTimestampMilliseconds === undefined) {
        throw new TypeError("wall-clock timestamp is required when jumping while playing");
      }
      assertTimestamp(wallTimestampMilliseconds);
    }
    this.#instant = normalized;
    if (this.#playing) {
      this.#wallAnchorMilliseconds = wallTimestampMilliseconds;
      this.#instantAnchor = normalized;
    }
  }

  advanceTo(wallTimestampMilliseconds: number): SimulationInstant {
    assertTimestamp(wallTimestampMilliseconds);
    if (!this.#playing) return this.#instant;
    if (this.#wallAnchorMilliseconds === undefined || this.#instantAnchor === undefined) {
      throw new Error("playing clock is missing its wall-time anchor");
    }
    if (wallTimestampMilliseconds < this.#wallAnchorMilliseconds) {
      throw new RangeError("wall-clock timestamps must be monotonic while playing");
    }
    const elapsed = wallTimestampMilliseconds - this.#wallAnchorMilliseconds;
    this.#instant = addDurationToInstant(
      this.#instantAnchor,
      scaledWallDuration(elapsed, this.#warpFactor),
    );
    return this.#instant;
  }
}
