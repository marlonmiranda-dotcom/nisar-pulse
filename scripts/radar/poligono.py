#!/usr/bin/env python3
"""Polígono WDPA 555593903 (Reserva Biológica Colonso Chalupas)."""
from __future__ import annotations

import json
from pathlib import Path

from shapely.geometry import shape

# Caja de búsqueda de escenas usada en el repositorio nisar-pulse
BBOX_BUSQUEDA = (-78.42, -1.22, -77.68, -0.60)  # W, S, E, N

# Mismo polígono que scripts/earthdata/*.py: ../../src/data/colonso_wdpa.geojson
# (relativo a esta carpeta, scripts/radar/).
DEFAULT_GEOJSON = (
    Path(__file__).resolve().parent / ".." / ".." / "src" / "data" / "colonso_wdpa.geojson"
).resolve()


def cargar(path: Path | None = None):
    p = Path(path) if path else DEFAULT_GEOJSON
    fc = json.loads(p.read_text())
    feat = fc["features"][0] if "features" in fc else fc
    geom = shape(feat["geometry"])
    props = feat.get("properties") or {}
    return geom, props, p


def area_km2(geom, crs="EPSG:4326"):
    """Área geodésica del polígono en km² (elipsoide WGS84)."""
    from pyproj import Geod
    geod = Geod(ellps="WGS84")
    # shapely 2 / pyproj: geometry_area_perimeter
    area_m2, _ = geod.geometry_area_perimeter(geom)
    return abs(area_m2) / 1e6
