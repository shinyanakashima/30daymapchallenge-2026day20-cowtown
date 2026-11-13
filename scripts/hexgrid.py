"""Assign each municipality to one cell of a pointy-top hexagon grid.

The grid uses "odd-r" offset coordinates: odd rows are shifted half a cell to
the right. Row 0 is the northernmost row.

Assignment: the grid is laid over the projected map, candidate cells are those
near land, and municipalities are matched to cells so that the sum of squared
distances between each municipality's centroid and its cell centre is minimal
(Hungarian algorithm).
"""
import math

import numpy as np
from scipy.optimize import linear_sum_assignment

# Lambert azimuthal equal-area centred on Hokkaido.
CRS = "+proj=laea +lat_0=43.5 +lon_0=142.8 +x_0=0 +y_0=0 +ellps=GRS80 +units=m +no_defs"
SQ3 = math.sqrt(3)


def cell_center(row, col, r, x0, y0):
    """Centre (x, y) in projected metres of cell (row, col). r = hex circumradius."""
    w = SQ3 * r
    x = x0 + col * w + (w / 2 if row % 2 else 0.0)
    y = y0 - row * 1.5 * r
    return x, y


def candidate_cells(land, r, buffer_cells=0.6, offset=(0.0, 0.0)):
    """All cells whose centre lies on land buffered by buffer_cells * r.

    offset shifts the grid origin, in cell units (x: cell widths, y: row heights).
    """
    minx, miny, maxx, maxy = land.bounds
    pad = 2 * r
    x0 = minx - pad + offset[0] * SQ3 * r
    y0 = maxy + pad - offset[1] * 1.5 * r
    nrows = int((maxy - miny + 2 * pad) / (1.5 * r)) + 2
    ncols = int((maxx - minx + 2 * pad) / (SQ3 * r)) + 2
    zone = land.buffer(buffer_cells * r)
    from shapely import contains_xy
    cells = []
    for row in range(nrows):
        for col in range(ncols):
            x, y = cell_center(row, col, r, x0, y0)
            cells.append((row, col, x, y))
    arr = np.array([(c[2], c[3]) for c in cells])
    inside = contains_xy(zone, arr[:, 0], arr[:, 1])
    cells = [c for c, ok in zip(cells, inside) if ok]
    return cells, (x0, y0)


def assign(points, cells):
    """points: (n, 2) array. cells: list of (row, col, x, y). Returns list of (row, col)."""
    cxy = np.array([(c[2], c[3]) for c in cells])
    d2 = ((points[:, None, :] - cxy[None, :, :]) ** 2).sum(axis=2)
    ri, ci = linear_sum_assignment(d2)
    out = [None] * len(points)
    for i, j in zip(ri, ci):
        out[i] = (cells[j][0], cells[j][1])
    return out


def neighbours(row, col):
    """The six neighbours of an odd-r cell."""
    if row % 2:
        d = [(0, -1), (0, 1), (-1, 0), (-1, 1), (1, 0), (1, 1)]
    else:
        d = [(0, -1), (0, 1), (-1, -1), (-1, 0), (1, -1), (1, 0)]
    return [(row + a, col + b) for a, b in d]


def hex_polygon(cx, cy, r):
    return [(cx + r * math.cos(math.radians(60 * k - 30)), cy + r * math.sin(math.radians(60 * k - 30))) for k in range(6)]


def main_land(geoms, min_area=5e6, tol=500):
    """Union of all polygons larger than min_area (m²), simplified. Drops tiny islets."""
    from shapely.geometry import MultiPolygon
    from shapely.ops import unary_union
    parts = []
    for g in geoms:
        for poly in getattr(g, "geoms", [g]):
            if poly.area >= min_area:
                parts.append(poly.simplify(tol))
    return unary_union(parts)
