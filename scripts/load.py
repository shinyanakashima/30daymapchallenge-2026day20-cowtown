"""Read the raw source files and join them into one table per municipality."""
from pathlib import Path
import zipfile

import geopandas as gpd
import pandas as pd

ROOT = Path(__file__).resolve().parent.parent
RAW = ROOT / "data" / "raw"

# Six villages on the islands under the Northern Territories issue.
# They are outside the statistics and are not placed on the hex grid.
NORTHERN_TERRITORIES = {"01695", "01696", "01697", "01698", "01699", "01700"}
SAPPORO = "01100"


def load_cattle() -> pd.DataFrame:
    """2020 Census of Agriculture and Forestry, dairy cattle by municipality.

    '-' means no farms (0 head). 'x' means the value is withheld for
    confidentiality; it is kept as missing, not estimated.
    """
    df = pd.read_excel(RAW / "tikusan-22.xls", sheet_name="R2", header=None, skiprows=7)
    df = df.iloc[:, :4]
    df.columns = ["region", "name", "farms", "cattle"]
    df = df[df["name"].notna() & df["region"].notna()]
    df = df[~df["region"].astype(str).str.contains("センサス")]

    def parse(v):
        s = str(v).strip()
        if s == "-":
            return 0, "zero"
        if s.lower() == "x":
            return None, "withheld"
        return int(float(s)), "value"

    parsed = df["cattle"].map(parse)
    df["cattle_head"] = parsed.map(lambda t: t[0])
    df["cattle_status"] = parsed.map(lambda t: t[1])
    df["farms"] = df["farms"].map(lambda v: None if str(v).strip().lower() == "x" else (0 if str(v).strip() == "-" else int(float(v))))
    df["name"] = df["name"].str.strip()
    return df[["region", "name", "farms", "cattle_head", "cattle_status"]]


def load_population() -> pd.DataFrame:
    """2025 Population Census, preliminary counts (as of 1 Oct 2025)."""
    df = pd.read_excel(RAW / "pop.xlsx", header=None)
    df = df[df[1].astype(str).str.startswith("01_")]
    df = df[df[2].astype(str).str.match(r"^01\d{3}_")]
    out = pd.DataFrame({
        "code": df[2].str.slice(0, 5),
        "name": df[2].str.slice(6),
        "population": df[3].astype(int),
    })
    # Keep Sapporo as a whole city, drop its wards.
    out = out[~out["code"].str.match(r"^0110[1-9]|^0111\d")]
    return out.reset_index(drop=True)


def load_boundaries() -> gpd.GeoDataFrame:
    """N03 administrative areas (2026-01-01), dissolved to one row per municipality."""
    cache = RAW / "boundaries_dissolved.gpkg"
    if cache.exists():
        return gpd.read_file(cache)
    zpath = RAW / "n03_2026.zip"
    with zipfile.ZipFile(zpath) as z:
        shp = [n for n in z.namelist() if n.endswith("N03-20260101_01.shp")][0]
    g = gpd.read_file(f"zip://{zpath}!{shp}")
    g = g[g["N03_007"].notna()].copy()
    g["code"] = g["N03_007"]
    g.loc[g["code"].str.startswith("011") & (g["code"] != SAPPORO), "code"] = SAPPORO
    g["name_n03"] = g["N03_004"].fillna("")
    g.loc[g["code"] == SAPPORO, "name_n03"] = "札幌市"
    g["n03_region"] = g["N03_002"]
    g = g.dissolve(by="code", aggfunc="first", as_index=False)[["code", "name_n03", "n03_region", "geometry"]]
    g.to_file(cache, driver="GPKG")
    return g


def load_names_en() -> pd.DataFrame:
    df = pd.read_csv(RAW / "wd.csv", dtype=str)
    df["code"] = df["code"].str.slice(0, 5)
    return df.rename(columns={"en": "name_en", "ja": "name_wd"})[["code", "name_en", "name_wd"]].drop_duplicates("code")


def load_all():
    g = load_boundaries()
    outside = g[g["code"].isin(NORTHERN_TERRITORIES)]
    g = g[~g["code"].isin(NORTHERN_TERRITORIES)]
    pop = load_population()
    cattle = load_cattle()
    names = load_names_en()

    df = g.merge(pop[["code", "population", "name"]], on="code", how="left", validate="1:1")
    assert df["population"].notna().all(), df[df["population"].isna()]
    assert (df["name"] == df["name_n03"]).all(), df[df["name"] != df["name_n03"]][["name", "name_n03"]]
    df = df.merge(cattle[["name", "region", "farms", "cattle_head", "cattle_status"]], on="name", how="left", validate="1:1")
    assert df["cattle_status"].notna().all(), df[df["cattle_status"].isna()]["name"].tolist()
    df = df.merge(names, on="code", how="left", validate="1:1")
    assert df["name_en"].notna().all(), df[df["name_en"].isna()]["name"].tolist()
    assert len(df) == 179, len(df)
    return gpd.GeoDataFrame(df, geometry="geometry", crs=g.crs), outside


if __name__ == "__main__":
    df, outside = load_all()
    print(len(df), "municipalities;", len(outside), "excluded")
    print(df["cattle_status"].value_counts())
    print(df[["code", "name", "name_en", "population", "cattle_head"]].to_string())
