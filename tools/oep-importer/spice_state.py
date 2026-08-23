#!/usr/bin/env python3
import json
import sys
from decimal import Decimal

import spiceypy as spice


def main() -> int:
    if len(sys.argv) not in (6, 7):
        print('usage: spice_state.py <kernels-json> <target> <center> <frame> <et> [nanoseconds]', file=sys.stderr)
        return 2
    kernels = json.loads(sys.argv[1])
    target = int(sys.argv[2])
    center = int(sys.argv[3])
    frame = sys.argv[4]
    if len(sys.argv) == 7:
        requested_et = Decimal(sys.argv[5]) + Decimal(sys.argv[6]) / Decimal(1_000_000_000)
        et = float(requested_et)
    else:
        requested_et = None
        et = float(sys.argv[5])
    try:
        spice.kclear()
        for kernel in kernels:
            spice.furnsh(kernel)
        state, _light_time = spice.spkgeo(target, et, frame, center)
        if requested_et is not None:
            representable_et = Decimal.from_float(et)
            correction = float(requested_et - representable_et)
            state[0:3] = state[0:3] + state[3:6] * correction
        print(json.dumps([float(value) for value in state], separators=(',', ':')))
        return 0
    finally:
        spice.kclear()


if __name__ == '__main__':
    raise SystemExit(main())
