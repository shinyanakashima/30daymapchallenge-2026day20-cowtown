#!/usr/bin/env bash
# Download the source data into data/raw/.
set -euo pipefail
cd "$(dirname "$0")/.."
mkdir -p data/raw
cd data/raw

# MAFF Hokkaido Regional Agricultural Administration Office, table 18-01 (by municipality)
curl -fsSL -o tikusan-22.xls \
  https://www.maff.go.jp/hokkaido/toukei/kikaku/database/tikusan/attach/xls/tikusan-22.xls

# Statistics Bureau, 2025 Population Census, preliminary counts, table 1
curl -fsSL -o pop.xlsx \
  'https://www.e-stat.go.jp/stat-search/file-download?statInfId=000040454825&fileKind=0'

# MLIT National Land Numerical Information N03 (administrative areas), Hokkaido, 2026-01-01
curl -fsSL -o n03_2026.zip \
  https://nlftp.mlit.go.jp/ksj/gml/data/N03/N03-2026/N03-20260101_01_GML.zip

# Wikidata: English labels of Hokkaido municipalities (CC0)
curl -fsSL -G https://query.wikidata.org/sparql -H 'Accept: text/csv' -A 'hexmap-build/0.1' \
  --data-urlencode 'query=SELECT ?code ?en ?ja WHERE { ?item wdt:P429 ?code . FILTER(STRSTARTS(?code,"01")) ?item rdfs:label ?en FILTER(LANG(?en)="en") ?item rdfs:label ?ja FILTER(LANG(?ja)="ja") FILTER NOT EXISTS {?item wdt:P576 ?d} }' \
  -o wd.csv
