"""Build the hexagon layout and the data files used by the web page.

Outputs
  data/hex_layout.csv                 code, names, row, col (CC0)
  data/hex_layout.geojson             the same cells as hexagon polygons (CC0)
  data/dairy_cattle_per_person.csv    the joined statistics
  web/data/towns.json                 statistics + layout for the page
  web/data/municipalities.geojson     simplified boundaries for the map view
"""
import json
import unicodedata
from pathlib import Path

import geopandas as gpd
import numpy as np
import pandas as pd
from pyproj import Transformer
from shapely.geometry import Polygon, mapping

from hexgrid import CRS, assign, candidate_cells, cell_center, hex_polygon, main_land, neighbours
from load import load_all

ROOT = Path(__file__).resolve().parent.parent
DATA = ROOT / "data"
WEB = ROOT / "web" / "data"

# Grid parameters: circumradius 14.5 km, cells within 0.7 cell of land,
# origin shifted by (0.75 cell widths, 0.67 row heights). These were chosen by
# a small search that keeps the most pairs of neighbouring municipalities
# next to each other and leaves no holes inside the shape.
HEX_R = 14_500
BUFFER = 0.7
OFFSET = (0.75, 0.67)

# Manual adjustments after the automatic assignment: (row, col) in the raw
# grid. Each of these towns had been left without any neighbour.
MANUAL = {
    "01331": (21, 1),   # Matsumae: next to Fukushima
    "01483": (6, 8),    # Tomamae: on the coast between Shosanbetsu, Obira and Rumoi
    "01223": (12, 20),  # Nemuro: east of Betsukai, north-east of Hamanaka
    "01694": (9, 19),   # Rausu: between Shari and Shibetsu (Nemuro)
}

REGION_EN = {
    "石狩": "Ishikari", "渡島": "Oshima", "檜山": "Hiyama", "後志": "Shiribeshi",
    "空知": "Sorachi", "上川": "Kamikawa", "留萌": "Rumoi", "宗谷": "Soya",
    "オホーツク": "Okhotsk", "胆振": "Iburi", "日高": "Hidaka", "十勝": "Tokachi",
    "釧路": "Kushiro", "根室": "Nemuro",
}
TYPE_EN = {"市": "City", "町": "Town", "村": "Village"}
SHORT_EN_OVERRIDE = {"01661": "Kushiro-cho"}
SHORT_JA_OVERRIDE = {"01206": "釧路市", "01661": "釧路町"}


def clean_en(s: str) -> str:
    s = s.replace("-chō", "").replace("-machi", "").replace("-mura", "").replace("-son", "")
    s = unicodedata.normalize("NFKD", s)
    return "".join(c for c in s if not unicodedata.combining(c))


def main():
    df, outside = load_all()
    p = df.to_crs(CRS)
    land = main_land(p.geometry)
    pts = np.array([(g.centroid.x, g.centroid.y) for g in p.geometry])

    cells, (x0, y0) = candidate_cells(land, HEX_R, BUFFER, OFFSET)
    cells_rc = assign(pts, cells)
    for i, code in enumerate(df["code"]):
        if code in MANUAL:
            cells_rc[i] = MANUAL[code]
    assert len(set(cells_rc)) == len(cells_rc), "two towns share a cell"

    # Every town must touch at least one other.
    occ = set(cells_rc)
    lonely = [df["name_en"].iloc[i] for i, rc in enumerate(cells_rc) if not any(n in occ for n in neighbours(*rc))]
    print("towns without a neighbour:", lonely)

    # Normalise so that the top row is 0 and the leftmost column is 0.
    # Keep row parity (odd-r offset) by shifting rows by an even number.
    rmin = min(r for r, _ in cells_rc)
    rshift = rmin - (rmin % 2)
    cmin = min(c for _, c in cells_rc)
    df["row"] = [r - rshift for r, _ in cells_rc]
    df["col"] = [c - cmin for _, c in cells_rc]

    df["type"] = df["name"].str[-1].map(TYPE_EN)
    df["name_en"] = df["name_en"].map(clean_en)
    df["short_ja"] = [SHORT_JA_OVERRIDE.get(c, n[:-1]) for c, n in zip(df["code"], df["name"])]
    df["short_en"] = [SHORT_EN_OVERRIDE.get(c, n) for c, n in zip(df["code"], df["name_en"])]
    df["region_en"] = df["region"].map(REGION_EN)
    df["cattle_per_person"] = df["cattle_head"] / df["population"]

    # ---- layout files (CC0) ----
    DATA.mkdir(exist_ok=True)
    layout = df[["code", "name", "name_en", "row", "col"]].rename(columns={"name": "name_ja"})
    layout = layout.sort_values("code")
    layout.to_csv(DATA / "hex_layout.csv", index=False)

    to_ll = Transformer.from_crs(CRS, "EPSG:4326", always_xy=True)
    feats = []
    for (_, t), (r_raw, c_raw) in zip(df.iterrows(), cells_rc):
        cx, cy = cell_center(r_raw, c_raw, HEX_R, x0, y0)
        ring = [to_ll.transform(x, y) for x, y in hex_polygon(cx, cy, HEX_R)]
        ring = [(round(x, 5), round(y, 5)) for x, y in ring]
        ring.append(ring[0])
        feats.append({
            "type": "Feature",
            "properties": {"code": t["code"], "name_ja": t["name"], "name_en": t["name_en"], "row": int(t["row"]), "col": int(t["col"])},
            "geometry": {"type": "Polygon", "coordinates": [ring]},
        })
    feats.sort(key=lambda f: f["properties"]["code"])
    with open(DATA / "hex_layout.geojson", "w", encoding="utf-8") as f:
        json.dump({"type": "FeatureCollection", "features": feats}, f, ensure_ascii=False)

    # ---- statistics ----
    stats = df[["code", "name", "name_en", "region", "population", "farms", "cattle_head", "cattle_status", "cattle_per_person"]].copy()
    stats = stats.rename(columns={"name": "name_ja", "region": "subprefecture"})
    stats["farms"] = stats["farms"].astype("Int64")
    stats["cattle_head"] = stats["cattle_head"].astype("Int64")
    stats["cattle_per_person"] = stats["cattle_per_person"].round(4)
    stats.sort_values("code").to_csv(DATA / "dairy_cattle_per_person.csv", index=False)

    # ---- web data ----
    WEB.mkdir(parents=True, exist_ok=True)
    towns = []
    for _, t in df.sort_values("code").iterrows():
        towns.append({
            "code": t["code"], "ja": t["name"], "en": t["name_en"], "type": t["type"],
            "sja": t["short_ja"], "sen": t["short_en"],
            "rja": t["region"], "ren": t["region_en"],
            "row": int(t["row"]), "col": int(t["col"]),
            "pop": int(t["population"]),
            "cattle": None if pd.isna(t["cattle_head"]) else int(t["cattle_head"]),
            "status": t["cattle_status"],
        })
    with open(WEB / "towns.json", "w", encoding="utf-8") as f:
        json.dump(towns, f, ensure_ascii=False, separators=(",", ":"))

    # Simplified boundaries; the six excluded villages are kept, flagged.
    both = pd.concat([df[["code", "geometry"]].assign(excluded=False), outside[["code", "geometry"]].assign(excluded=True)])
    both = gpd.GeoDataFrame(both, geometry="geometry", crs=df.crs).to_crs(CRS)

    def tidy(g):
        parts = [q for q in getattr(g, "geoms", [g]) if q.area > 1.5e6]
        if not parts:
            parts = [max(getattr(g, "geoms", [g]), key=lambda q: q.area)]
        from shapely.geometry import MultiPolygon
        return MultiPolygon(parts).simplify(350, preserve_topology=True)

    both["geometry"] = both.geometry.map(tidy)
    both = both.to_crs("EPSG:4326")
    out = {"type": "FeatureCollection", "features": []}
    for _, t in both.iterrows():
        geom = json.loads(json.dumps(mapping(t.geometry)), parse_float=lambda v: round(float(v), 4))
        out["features"].append({"type": "Feature", "properties": {"code": t["code"], "excluded": bool(t["excluded"])}, "geometry": geom})
    with open(WEB / "municipalities.geojson", "w", encoding="utf-8") as f:
        json.dump(out, f, separators=(",", ":"))

    n_more = int((df["cattle_per_person"] > 1).sum())
    print("towns where cattle outnumber people:", n_more)
    top = df.sort_values("cattle_per_person", ascending=False).head(10)
    print(top[["name", "name_en", "population", "cattle_head", "cattle_per_person"]].to_string())


if __name__ == "__main__":
    main()
