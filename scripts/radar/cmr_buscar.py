#!/usr/bin/env python3
"""Búsqueda de gránulos en NASA CMR e intersección con el polígono WDPA."""
from __future__ import annotations

import json
from typing import Iterable

import requests
from shapely.geometry import Polygon, box
from shapely.ops import unary_union

from poligono import BBOX_BUSQUEDA, cargar

CMR_GRANULES = "https://cmr.earthdata.nasa.gov/search/granules.umm_json"
CMR_COLLECTIONS = "https://cmr.earthdata.nasa.gov/search/collections.umm_json"


def _gpolygons(umm) -> list:
    spat = (umm.get("SpatialExtent") or {}).get("HorizontalSpatialDomain") or {}
    geom = spat.get("Geometry") or {}
    out = []
    for poly in geom.get("GPolygons") or []:
        pts = ((poly.get("Boundary") or {}).get("Points")) or []
        if len(pts) >= 3:
            try:
                out.append(Polygon([(p["Longitude"], p["Latitude"]) for p in pts]))
            except Exception:
                continue
    return out


def _bboxes(umm) -> list:
    spat = (umm.get("SpatialExtent") or {}).get("HorizontalSpatialDomain") or {}
    geom = spat.get("Geometry") or {}
    out = []
    for br in geom.get("BoundingRectangles") or []:
        try:
            out.append(box(
                br["WestBoundingCoordinate"], br["SouthBoundingCoordinate"],
                br["EastBoundingCoordinate"], br["NorthBoundingCoordinate"],
            ))
        except Exception:
            continue
    return out


def huella(umm):
    """Huella preferida: GPolygon si existe; si no, caja."""
    gps = [g for g in _gpolygons(umm) if g is not None and not g.is_empty]
    if gps:
        try:
            return unary_union(gps), "gpolygon"
        except Exception:
            return gps[0], "gpolygon"
    bbs = [g for g in _bboxes(umm) if g is not None and not g.is_empty]
    if bbs:
        try:
            return unary_union(bbs), "bbox"
        except Exception:
            return bbs[0], "bbox"
    return None, None


def urls_datos(umm, https_only=True):
    recs = []
    for u in umm.get("RelatedUrls") or []:
        url = u.get("URL") or ""
        typ = u.get("Type") or ""
        recs.append({
            "type": typ,
            "subtype": u.get("Subtype"),
            "url": url,
            "mime": u.get("MimeType"),
        })
    if https_only:
        recs = [r for r in recs if (r["url"] or "").startswith("http")]
    return recs


def url_principal(umm, suffix=None):
    """Primera URL HTTP de tipo GET DATA, opcionalmente filtrada por sufijo (.h5, B01_WTR.tif)."""
    cands = []
    for r in urls_datos(umm):
        typ = (r["type"] or "").upper()
        if typ.startswith("GET DATA") and "DIRECT ACCESS" not in typ and "BROWSE" not in typ:
            if "s3credentials" in (r["url"] or ""):
                continue
            if suffix and not r["url"].endswith(suffix) and suffix not in r["url"]:
                continue
            cands.append(r["url"])
    return cands[0] if cands else None


def buscar(short_name: str, bbox=BBOX_BUSQUEDA, temporal=None, page_size=2000):
    """Todos los gránulos de una colección que cruzan la caja de búsqueda."""
    params = {
        "short_name": short_name,
        "bounding_box": f"{bbox[0]},{bbox[1]},{bbox[2]},{bbox[3]}",
        "page_size": page_size,
        "sort_key": "start_date",
    }
    if temporal:
        params["temporal"] = temporal
    items, page, hits = [], 1, None
    while True:
        params["page_num"] = page
        r = requests.get(CMR_GRANULES, params=params, timeout=180)
        r.raise_for_status()
        hits = int(r.headers.get("CMR-Hits", "0"))
        chunk = r.json().get("items") or []
        items.extend(chunk)
        if len(items) >= hits or not chunk:
            break
        page += 1
    return items, hits


def filtrar_poligono(items, geom=None):
    """Añade intersecta_poligono / tipo_huella a cada item UMM y filtra."""
    if geom is None:
        geom, _, _ = cargar()
    out = []
    for it in items:
        umm = it.get("umm") or {}
        fp, tipo = huella(umm)
        inter = False
        if fp is not None:
            try:
                inter = bool(fp.intersects(geom))
            except Exception:
                inter = False
        it = dict(it)
        it["_huella_tipo"] = tipo
        it["_intersecta_poligono"] = inter
        out.append(it)
    return out


def inicio(umm):
    t = umm.get("TemporalExtent") or {}
    rng = t.get("RangeDateTime") or {}
    return rng.get("BeginningDateTime") or t.get("SingleDateTime")


def fin(umm):
    t = umm.get("TemporalExtent") or {}
    rng = t.get("RangeDateTime") or {}
    return rng.get("EndingDateTime")


def coleccion_meta(short_name: str) -> dict:
    r = requests.get(CMR_COLLECTIONS, params={"short_name": short_name, "page_size": 1}, timeout=60)
    r.raise_for_status()
    items = r.json().get("items") or []
    if not items:
        return {"short_name": short_name, "encontrada": False}
    umm, meta = items[0]["umm"], items[0]["meta"]
    doi = (umm.get("DOI") or {}).get("DOI")
    urls = {((u.get("Type") or "") + ":" + (u.get("Subtype") or "")).strip(":"): u.get("URL")
            for u in (umm.get("RelatedUrls") or [])}
    return {
        "short_name": short_name,
        "encontrada": True,
        "concept_id": meta.get("concept-id"),
        "titulo": umm.get("EntryTitle"),
        "version": umm.get("Version") or umm.get("VersionId"),
        "doi": doi,
        "doi_url": f"https://doi.org/{doi}" if doi else None,
        "urls": urls,
    }
