#!/usr/bin/env python3
"""Writes a synthetic GenCAD board in the style of Avero's XZZ converter
(one pad and padstack per pin, one shape per component, one TRACK per trace),
for timing only. No vendor data: every name and position is made up.

Usage: gen-board.py <parts> <out.cad>
"""
import random
import sys

parts_wanted = int(sys.argv[1])
out_path = sys.argv[2]
rnd = random.Random(20261110)

LAYERS = ["TOP"] + [f"LAYER_{i}" for i in range(2, 11)] + ["BOTTOM"]


def fmt(v):
    s = f"{v:.4f}".rstrip("0").rstrip(".")
    return "0" if s in ("-0", "") else s


class Part:
    __slots__ = ("name", "value", "foot", "x", "y", "w", "h", "side", "pins")


def make(kind, n):
    """Pins as (name, dx, dy, pad w, pad h, round) around the part's origin, and its size."""
    pins = []
    if kind == "passive":
        pins = [("1", -20, 0, 18, 22, False), ("2", 20, 0, 18, 22, False)]
        return pins, 70, 34
    if kind == "ic":
        per = n // 2
        pitch = 20
        for i in range(per):
            pins.append((str(i + 1), (i - (per - 1) / 2) * pitch, -60, 10, 30, False))
        for i in range(per):
            pins.append((str(per + i + 1), ((per - 1) / 2 - i) * pitch, 60, 10, 30, False))
        return pins, per * pitch + 20, 150
    if kind == "bga":
        pitch = 20
        for r in range(n):
            for c in range(n):
                name = f"{'ABCDEFGHJKLMNPRTUVWY'[r % 20]}{'' if r < 20 else 'A'}{c + 1}"
                pins.append((name, (c - (n - 1) / 2) * pitch, ((n - 1) / 2 - r) * pitch, 10, 10, True))
        return pins, n * pitch + 20, n * pitch + 20
    # connector: one row
    pitch = 16
    for i in range(n):
        pins.append((str(i + 1), (i - (n - 1) / 2) * pitch, 0, 8, 40, False))
    return pins, n * pitch + 30, 70


parts = []
counts = {}
x = y = 100.0
row_h = 0.0
BOARD_W = max(6000.0, (parts_wanted ** 0.5) * 190)
for i in range(parts_wanted):
    r = rnd.random()
    if r < 0.80:
        kind, n, prefix = "passive", 2, rnd.choice("RRRCCCCL")
    elif r < 0.955:
        kind, n, prefix = "ic", rnd.choice([8, 8, 16, 24, 32, 48, 64]), "U"
    elif r < 0.965:
        kind, n, prefix = "bga", rnd.choice([10, 14, 20, 24, 32]), "U"
    else:
        kind, n, prefix = "conn", rnd.choice([10, 20, 30, 40, 60]), "J"
    pins, w, h = make(kind, n)
    if x + w + 20 > BOARD_W:
        x = 100.0
        y += row_h + 30
        row_h = 0.0
    p = Part()
    counts[prefix] = counts.get(prefix, 0) + 1
    p.name = f"{prefix}{1000 + counts[prefix]}"
    p.value = {"R": rnd.choice(["10K", "0R", "4R7", "100K", "0.005_1%"]), "C": rnd.choice(["100nF", "10uF", "1uF"]), "L": "1uH"}.get(prefix, f"IC-{n}")
    p.foot = f"{kind.upper()}{n}"
    p.x, p.y, p.w, p.h = x + w / 2, y + h / 2, w, h
    p.side = "BOTTOM" if rnd.random() < 0.4 else "TOP"
    p.pins = pins
    parts.append(p)
    x += w + 20
    row_h = max(row_h, h)
BOARD_H = y + row_h + 100

# Nets: ground takes about a third of the pins, a few rails are large, the rest are signals.
all_pins = [(c, i) for c, p in enumerate(parts) for i in range(len(p.pins))]
rnd.shuffle(all_pins)
nets = {"GND": []}
rails = [f"PP{v}" for v in ("3V3", "5V", "1V8", "1V1", "VBAT", "VCORE", "0V9", "12V")]
for r_ in rails:
    nets[r_] = []
k = 0
sig = 0
while k < len(all_pins):
    r = rnd.random()
    if r < 0.32:
        nets["GND"].append(all_pins[k])
        k += 1
    elif r < 0.40:
        nets[rnd.choice(rails)].append(all_pins[k])
        k += 1
    else:
        size = rnd.choice([2, 2, 2, 3, 3, 4, 5, 8])
        sig += 1
        nets[f"SIG_{sig}"] = all_pins[k : k + size]
        k += size


def pin_xy(c, i):
    p = parts[c]
    _, dx, dy, _, _, _ = p.pins[i]
    return p.x + dx, p.y + dy


# Copper: each net's pins chained in x order with two segments per hop, a via at the bend.
traces = []  # (net, layer, x1, y1, x2, y2, width)
vias = []  # (net, x, y)
for name, members in nets.items():
    if name == "GND" or len(members) < 2:
        continue
    pts = sorted(pin_xy(c, i) for c, i in members)
    if len(pts) > 400:
        pts = pts[:400]
    for (x1, y1), (x2, y2) in zip(pts, pts[1:]):
        a, b = rnd.choice(LAYERS), rnd.choice(LAYERS)
        w = rnd.choice([4, 4, 5, 6, 10])
        traces.append((name, a, x1, y1, x2, y1, w))
        traces.append((name, b, x2, y1, x2, y2, w))
        if a != b:
            vias.append((name, x2, y1))

out = []
w = out.append
w('$HEADER\nGENCAD 1.4\nUSER "Avero perf generator"\nDRAWING "synthetic"\nREVISION "1"\nUNITS THOU\nORIGIN 0 0\nINTERTRACK 0\n$ENDHEADER\n\n$BOARD')
for a, b in [((0, 0), (BOARD_W, 0)), ((BOARD_W, 0), (BOARD_W, BOARD_H)), ((BOARD_W, BOARD_H), (0, BOARD_H)), ((0, BOARD_H), (0, 0))]:
    w(f"LINE {fmt(a[0])} {fmt(a[1])} {fmt(b[0])} {fmt(b[1])}")
w("$ENDBOARD\n\n$ARTWORKS\n$ENDARTWORKS\n\n$PADS")
for c, p in enumerate(parts):
    for i, (_, _, _, pw, ph, rnd_) in enumerate(p.pins):
        if rnd_:
            w(f"PAD PINPAD_{c + 1}_{i + 1} ROUND 0\nCIRCLE 0 0 {fmt(pw / 2)}")
        else:
            w(f"PAD PINPAD_{c + 1}_{i + 1} RECTANGULAR 0\nRECTANGLE {fmt(-pw / 2)} {fmt(-ph / 2)} {fmt(pw)} {fmt(ph)}")
for v in range(len(vias)):
    w(f"PAD VIAPAD_{v + 1} ROUND 4\nCIRCLE 0 0 5")
w("$ENDPADS\n\n$PADSTACKS")
for c, p in enumerate(parts):
    for i in range(len(p.pins)):
        w(f"PADSTACK PINPAD_{c + 1}_{i + 1} 0\nPAD PINPAD_{c + 1}_{i + 1} {p.side} 0 0")
for v in range(len(vias)):
    w(f"PADSTACK VIASTACK_{v + 1} 4")
    for layer in LAYERS:
        w(f"PAD VIAPAD_{v + 1} {layer} 0 0")
w("$ENDPADSTACKS\n\n$SHAPES")
for c, p in enumerate(parts):
    w(f"SHAPE SHAPE_{c + 1}")
    hw, hh = p.w / 2 - 6, p.h / 2 - 6
    for a, b in [((-hw, -hh), (hw, -hh)), ((hw, -hh), (hw, hh)), ((hw, hh), (-hw, hh)), ((-hw, hh), (-hw, -hh))]:
        w(f"LINE {fmt(a[0])} {fmt(a[1])} {fmt(b[0])} {fmt(b[1])}")
    for i, (name, dx, dy, _, _, _) in enumerate(p.pins):
        w(f'PIN "{name}" PINPAD_{c + 1}_{i + 1} {fmt(dx)} {fmt(dy)} {p.side} 0 0')
w("$ENDSHAPES\n\n$DEVICES")
for c, p in enumerate(parts):
    w(f'DEVICE DEV_{c + 1}\nPART "{p.foot}"\nVALUE "{p.value}"')
w("$ENDDEVICES\n\n$COMPONENTS")
for c, p in enumerate(parts):
    w(f'COMPONENT "{p.name}"\nDEVICE DEV_{c + 1}\nPLACE {fmt(p.x)} {fmt(p.y)}\nLAYER {p.side}\nROTATION 0\nSHAPE SHAPE_{c + 1} 0 0\nVALUE "{p.value}"')
w("$ENDCOMPONENTS\n\n$SIGNALS")
for name, members in nets.items():
    w(f'SIGNAL "{name}"')
    for c, i in members:
        w(f'NODE "{parts[c].name}" "{parts[c].pins[i][0]}"')
w("$ENDSIGNALS\n\n$LAYERS")
for i, layer in enumerate(LAYERS):
    w(f'DEFINE {layer} "layer {i + 1}"')
w("$ENDLAYERS\n\n$TRACKS")
for t, tr in enumerate(traces):
    w(f"TRACK TRACE_{t + 1} {fmt(tr[6])}")
w("$ENDTRACKS\n\n$ROUTES")
for t, (name, layer, x1, y1, x2, y2, _) in enumerate(traces):
    w(f'ROUTE "{name}"\nTRACK TRACE_{t + 1}\nLAYER {layer}\nLINE {fmt(x1)} {fmt(y1)} {fmt(x2)} {fmt(y2)}')
for v, (name, vx, vy) in enumerate(vias):
    w(f'ROUTE "{name}"\nVIA VIASTACK_{v + 1} {fmt(vx)} {fmt(vy)} ALL 4 VIA_{v + 1}')
w("$ENDROUTES")
with open(out_path, "w") as f:
    f.write("\n".join(out) + "\n")
print(f"{len(parts)} parts, {len(all_pins)} pins, {len(nets)} nets, {len(traces)} traces, {len(vias)} vias, board {BOARD_W:.0f} x {BOARD_H:.0f} mil")
