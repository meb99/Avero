#!/usr/bin/env python3
"""Draws a schematic PDF for the Avero demo board.

Every part becomes a symbol with its pins and net labels, grouped into
sheets by reference number, so the schematic view has something real to
cross-reference. Pure standard library; the PDF uses the built-in Helvetica.

    cargo run -q -p avero-formats --bin avero-inspect -- --demo --json \\
      | python3 scripts/demo_schematic.py public/demo/avero-demo-schematic.pdf
"""

import json
import sys

W, H = 1191, 842  # A3 landscape, points
MARGIN = 36
TITLE_H = 64
ROW = 11
COLUMN_GAP = 34
BLOCK_GAP = 26

SHEETS = [
    ("POWER", lambda n: 3000 <= n < 4000),
    ("SOC", lambda n: 1000 <= n < 2000),
    ("MEMORY", lambda n: 2000 <= n < 3000),
    ("AUDIO", lambda n: 6000 <= n < 7000),
    ("CONNECTORS", lambda n: n >= 4000),
]


def ref_number(name):
    digits = "".join(c for c in name if c.isdigit())
    return int(digits) if digits else 0


def esc(text):
    return text.replace("\\", "\\\\").replace("(", "\\(").replace(")", "\\)")


# Helvetica advance widths (1/1000 em) from the standard AFM metrics.
_WIDTHS = dict(
    zip("ABCDEFGHIJKLMNOPQRSTUVWXYZ", [667, 667, 722, 722, 667, 611, 778, 722, 278, 500, 667, 556, 833,
                                        722, 778, 667, 778, 722, 667, 611, 722, 667, 944, 667, 667, 611])
)
_WIDTHS.update(zip("abcdefghijklmnopqrstuvwxyz", [556, 556, 500, 556, 556, 278, 556, 556, 222, 222, 500, 222, 833,
                                                   556, 556, 556, 556, 333, 500, 278, 556, 500, 722, 500, 500, 500]))
_WIDTHS.update({c: 556 for c in "0123456789_"})
_WIDTHS.update({" ": 278, "-": 333, ".": 278, "+": 584, "/": 278, ":": 278, "(": 333, ")": 333, "%": 889})


def text_width(text, size, bold=False):
    em = sum(_WIDTHS.get(c, 556) for c in text) / 1000
    return em * size * (1.06 if bold else 1.0)


class Page:
    def __init__(self):
        self.ops = []

    def y(self, top):
        return H - top

    def line(self, x0, y0, x1, y1, width=0.8):
        self.ops.append(f"{width} w {x0:.1f} {self.y(y0):.1f} m {x1:.1f} {self.y(y1):.1f} l S")

    def rect(self, x, y, w, h, width=1.0):
        self.ops.append(f"{width} w {x:.1f} {self.y(y + h):.1f} {w:.1f} {h:.1f} re S")

    def text(self, x, y, s, size=7.5, bold=False, color=(0, 0, 0), align="left"):
        if align == "right":
            x -= text_width(s, size, bold)
        elif align == "center":
            x -= text_width(s, size, bold) / 2
        font = "F2" if bold else "F1"
        r, g, b = color
        self.ops.append(
            f"BT {r} {g} {b} rg /{font} {size} Tf {x:.1f} {self.y(y):.1f} Td ({esc(s)}) Tj ET 0 0 0 rg"
        )

    def stream(self):
        return "\n".join(self.ops).encode("latin-1")


NET = (0.05, 0.28, 0.55)
GREY = (0.4, 0.4, 0.4)


def net_label(nets, index):
    name = nets[index]["name"]
    return "NC" if name == "UNCONNECTED" else name


def two_pin_block(part, pins, nets):
    left, right = (net_label(nets, p["net"]) for p in pins)
    lw = text_width(left, 7.5) + 30
    rw = text_width(right, 7.5) + 30
    width = lw + 44 + rw
    height = 40

    def draw(pg, x, y):
        mid = y + 20
        pg.line(x + lw - 26, mid, x + lw, mid)
        pg.rect(x + lw, mid - 6, 44, 12)
        pg.line(x + lw + 44, mid, x + lw + 70, mid)
        pg.text(x + lw - 28, mid + 2.5, left, color=NET, align="right")
        pg.text(x + lw + 72, mid + 2.5, right, color=NET)
        pg.text(x + lw + 22, mid - 9, part["name"], size=8.5, bold=True, align="center")
        if part.get("device"):
            pg.text(x + lw + 22, mid + 16, part["device"], size=6.5, color=GREY, align="center")

    return width, height, draw


def ic_block(part, pins, nets):
    # Balls of large packages are grouped by net; small parts list every pin.
    if len(pins) > 60:
        groups = {}
        for p in pins:
            groups.setdefault(p["net"], []).append(p["number"])
        rows = []
        for net, numbers in sorted(groups.items(), key=lambda kv: nets[kv[0]]["name"]):
            label = " ".join(numbers[:3]) + (f" +{len(numbers) - 3}" if len(numbers) > 3 else "")
            rows.append((label, net_label(nets, net)))
    else:
        rows = [(p["number"], net_label(nets, p["net"])) for p in pins]

    half = (len(rows) + 1) // 2
    left, right = rows[:half], rows[half:]
    num_w = max(text_width(n, 6.5) for n, _ in rows) + 10
    body_w = max(110, 2 * num_w + 40, text_width(part["name"], 10, True) + 20)
    lw = max((text_width(net, 7.5) for _, net in left), default=0) + 34
    rw = max((text_width(net, 7.5) for _, net in right), default=0) + 34
    height = 30 + max(len(left), len(right)) * ROW + 10
    width = lw + body_w + rw

    def draw(pg, x, y):
        bx = x + lw
        pg.rect(bx, y + 14, body_w, height - 14, width=1.2)
        pg.text(bx + body_w / 2, y + 10, part["name"], size=10, bold=True, align="center")
        if part.get("device"):
            pg.text(bx + body_w / 2, y + height + 10, part["device"], size=6.5, color=GREY, align="center")
        for i, (num, net) in enumerate(left):
            ry = y + 30 + i * ROW
            pg.line(bx - 26, ry, bx, ry)
            pg.text(bx + 4, ry + 2.3, num, size=6.5, color=GREY)
            pg.text(bx - 28, ry + 2.5, net, color=NET, align="right")
        for i, (num, net) in enumerate(right):
            ry = y + 30 + i * ROW
            pg.line(bx + body_w, ry, bx + body_w + 26, ry)
            pg.text(bx + body_w - 4, ry + 2.3, num, size=6.5, color=GREY, align="right")
            pg.text(bx + body_w + 28, ry + 2.5, net, color=NET)

    return width, height + 14, draw


def frame(pg, title, sheet, total):
    pg.rect(MARGIN / 2, MARGIN / 2, W - MARGIN, H - MARGIN, width=1.4)
    tx, ty = W - MARGIN / 2 - 330, H - MARGIN / 2 - TITLE_H
    pg.rect(tx, ty, 330, TITLE_H, width=1.2)
    pg.line(tx, ty + 24, tx + 330, ty + 24)
    pg.text(tx + 10, ty + 17, "AVERO DEMO BOARD  AV-100", size=11, bold=True)
    pg.text(tx + 10, ty + 40, title, size=14, bold=True)
    pg.text(tx + 320, ty + 40, f"SHEET {sheet} OF {total}", size=8, align="right")
    pg.text(tx + 10, ty + 56, "Synthetic data for trying Avero. Not a real product.", size=6.5, color=GREY)


def layout(board):
    nets = board["nets"]
    pins = board["pins"]
    sheets = []
    for title, match in SHEETS:
        blocks = []
        for part in sorted(board["parts"], key=lambda p: ref_number(p["name"])):
            if not match(ref_number(part["name"])):
                continue
            own = pins[part["firstPin"] : part["firstPin"] + part["pinCount"]]
            if not own:
                continue
            blocks.append((two_pin_block if len(own) == 2 else ic_block)(part, own, nets))
        # Big symbols first, small passives fill the gaps after them.
        blocks.sort(key=lambda b: -b[1])
        sheets.append((title, blocks))

    pages = []
    for title, blocks in sheets:
        x, y, col_w = MARGIN, MARGIN + 20, 0
        page = []
        for w, h, draw in blocks:
            bottom_limit = H - MARGIN - (TITLE_H + 10 if x + w > W - MARGIN - 340 else 0)
            if y + h > bottom_limit and y > MARGIN + 20:
                x += col_w + COLUMN_GAP
                y, col_w = MARGIN + 20, 0
            if x + w > W - MARGIN and page:
                pages.append((title, page))
                page, x, y, col_w = [], MARGIN, MARGIN + 20, 0
            page.append((x, y, draw))
            y += h + BLOCK_GAP
            col_w = max(col_w, w)
        if page:
            pages.append((title, page))
    return pages


def write_pdf(pages, path):
    objects = []

    def add(body):
        objects.append(body)
        return len(objects)

    font = add(b"<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>")
    bold = add(b"<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>")

    content_ids, page_ids = [], []
    for i, (title, blocks) in enumerate(pages):
        pg = Page()
        frame(pg, title, i + 1, len(pages))
        for x, y, draw in blocks:
            draw(pg, x, y)
        data = pg.stream()
        content_ids.append(add(b"<< /Length %d >>\nstream\n" % len(data) + data + b"\nendstream"))
        page_ids.append(add(b""))  # filled once the Pages id is known

    pages_id = add(b"")
    outline_id = add(b"")
    item_ids = [add(b"") for _ in pages]
    catalog = add(b"<< /Type /Catalog /Pages %d 0 R /Outlines %d 0 R /PageMode /UseOutlines >>" % (pages_id, outline_id))

    for pid, cid in zip(page_ids, content_ids):
        objects[pid - 1] = (
            b"<< /Type /Page /Parent %d 0 R /MediaBox [0 0 %d %d] /Contents %d 0 R "
            b"/Resources << /Font << /F1 %d 0 R /F2 %d 0 R >> >> >>" % (pages_id, W, H, cid, font, bold)
        )
    kids = b" ".join(b"%d 0 R" % p for p in page_ids)
    objects[pages_id - 1] = b"<< /Type /Pages /Kids [%s] /Count %d >>" % (kids, len(page_ids))
    objects[outline_id - 1] = b"<< /Type /Outlines /First %d 0 R /Last %d 0 R /Count %d >>" % (
        item_ids[0],
        item_ids[-1],
        len(item_ids),
    )
    for i, (item, (title, _)) in enumerate(zip(item_ids, pages)):
        links = b""
        if i > 0:
            links += b" /Prev %d 0 R" % item_ids[i - 1]
        if i + 1 < len(item_ids):
            links += b" /Next %d 0 R" % item_ids[i + 1]
        label = f"{i + 1}  {title}".encode("latin-1")
        objects[item - 1] = b"<< /Title (%s) /Parent %d 0 R /Dest [%d 0 R /Fit]%s >>" % (
            label,
            outline_id,
            page_ids[i],
            links,
        )

    out = bytearray(b"%PDF-1.4\n%\xe2\xe3\xcf\xd3\n")
    offsets = []
    for i, body in enumerate(objects, start=1):
        offsets.append(len(out))
        out += b"%d 0 obj\n" % i + body + b"\nendobj\n"
    xref = len(out)
    out += b"xref\n0 %d\n0000000000 65535 f \n" % (len(objects) + 1)
    for off in offsets:
        out += b"%010d 00000 n \n" % off
    out += b"trailer\n<< /Size %d /Root %d 0 R /Info << /Title (Avero demo schematic) /Producer (Avero) >> >>\n" % (
        len(objects) + 1,
        catalog,
    )
    out += b"startxref\n%d\n%%%%EOF\n" % xref
    with open(path, "wb") as f:
        f.write(out)


def main():
    if len(sys.argv) != 2:
        sys.exit(__doc__)
    board = json.load(sys.stdin)
    pages = layout(board)
    write_pdf(pages, sys.argv[1])
    print(f"{sys.argv[1]}: {len(pages)} pages", file=sys.stderr)


if __name__ == "__main__":
    main()
