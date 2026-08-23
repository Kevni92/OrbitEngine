#!/usr/bin/env python3
from pathlib import Path
import sys

import spiceypy as spice


def type2(handle, body, center, segid, first, last, coeffs):
    degree = len(coeffs[0]) - 1
    flat = [value for component in coeffs for value in component]
    spice.spkw02(handle, body, center, 'J2000', first, last, segid, last - first, 1, degree, flat, first)


def type3(handle, body, center, segid, first, last, coeffs):
    degree = len(coeffs[0]) - 1
    flat = [value for component in coeffs for value in component]
    spice.spkw03(handle, body, center, 'J2000', first, last, segid, last - first, 1, degree, flat, first)


def main() -> int:
    if len(sys.argv) != 2:
        print('usage: generate_spice_fixtures.py <output-dir>', file=sys.stderr)
        return 2
    out = Path(sys.argv[1])
    out.mkdir(parents=True, exist_ok=True)

    de441 = out / 'de441-fixture.bsp'
    handle = spice.spkopn(str(de441), 'ORBITENGINE DE441 DIRECT TEST', 0)
    try:
        type2(handle, 5, 0, 'DE441 TEST JUP BARY', -10.0, 10.0, [[0.1, 0.02], [0.0, 0.0], [0.0, 0.0]])
        type2(handle, 9, 0, 'DE441 TEST PLU BARY', -10.0, 10.0, [[0.2, -0.01], [0.1, 0.0], [0.0, 0.0]])
    finally:
        spice.spkcls(handle)

    jup365 = out / 'jup365-fixture.bsp'
    handle = spice.spkopn(str(jup365), 'ORBITENGINE JUP365 DIRECT TEST', 0)
    try:
        type3(handle, 501, 5, 'JUP365 TEST IO', -5.0, 5.0, [
            [0.01, 0.005], [0.02, 0.0], [0.03, 0.0],
            [0.001, 0.0005], [0.002, 0.0], [0.003, 0.0],
        ])
    finally:
        spice.spkcls(handle)

    plu060 = out / 'plu060-fixture.bsp'
    handle = spice.spkopn(str(plu060), 'ORBITENGINE PLU060 DIRECT TEST', 0)
    try:
        type2(handle, 999, 9, 'PLU060 TEST PLUTO', -4.0, 4.0, [[0.004, 0.001], [-0.002, 0.0], [0.001, 0.0]])
    finally:
        spice.spkcls(handle)

    return 0


if __name__ == '__main__':
    raise SystemExit(main())
