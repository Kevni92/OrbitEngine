#!/usr/bin/env python3
import json
import sys

import spiceypy as spice


def main() -> int:
    if len(sys.argv) != 6:
        print('usage: spice_state.py <kernels-json> <target> <center> <frame> <et>', file=sys.stderr)
        return 2
    kernels = json.loads(sys.argv[1])
    target = int(sys.argv[2])
    center = int(sys.argv[3])
    frame = sys.argv[4]
    et = float(sys.argv[5])
    try:
        spice.kclear()
        for kernel in kernels:
            spice.furnsh(kernel)
        state, _light_time = spice.spkgeo(target, et, frame, center)
        print(json.dumps([float(value) for value in state], separators=(',', ':')))
        return 0
    finally:
        spice.kclear()


if __name__ == '__main__':
    raise SystemExit(main())
