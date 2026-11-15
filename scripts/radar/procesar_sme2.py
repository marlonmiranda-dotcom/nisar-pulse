#!/usr/bin/env python3
"""Comprueba si las huellas de NISAR L3 SME2 intersectan el polígono WDPA.

No inventa humedad del suelo: solo lista gránulos y el resultado de la
intersección de la huella (GPolygon) con el polígono, no de la caja.
"""
from __future__ import annotations

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from cmr_buscar import buscar, filtrar_poligono, inicio, fin, url_principal, coleccion_meta
from poligono import cargar, BBOX_BUSQUEDA

COLECCIONES = (
    "NISAR_L3_SME2_V1",
    "NISAR_L3_SME2_PROVISIONAL_V1",
    "NISAR_L3_SME2_BETA_V1",
)


def _rec(it):
    umm = it["umm"]
    return {
        "granule_id": umm.get("GranuleUR"),
        "start_utc": inicio(umm),
        "end_utc": fin(umm),
        "huella": it.get("_huella_tipo"),
        "intersecta_poligono": bool(it.get("_intersecta_poligono")),
        "url_h5": url_principal(umm, suffix=".h5"),
    }


def comprobar(geom=None, bbox=BBOX_BUSQUEDA, log=print):
    if geom is None:
        geom, _, _ = cargar()
    out = {"colecciones": {}, "intersectan_poligono": []}
    for sn in COLECCIONES:
        meta = coleccion_meta(sn)
        if not meta.get("encontrada"):
            out["colecciones"][sn] = {
                "encontrada": False,
                "n_caja_busqueda": 0,
                "n_intersectan_poligono": 0,
                "granulos": [],
                "nota": "La colección no aparece en CMR (p. ej. NISAR_L3_SME2_V1 aún no publicada).",
            }
            log(f"  {sn}: colección no encontrada en CMR")
            continue
        items, hits = buscar(sn, bbox=bbox)
        items = filtrar_poligono(items, geom)
        recs = [_rec(it) for it in items]
        yes = [r for r in recs if r["intersecta_poligono"]]
        no = [r for r in recs if not r["intersecta_poligono"]]
        out["colecciones"][sn] = {
            "encontrada": True,
            "concept_id": meta.get("concept_id"),
            "titulo": meta.get("titulo"),
            "doi": meta.get("doi"),
            "doi_url": meta.get("doi_url"),
            "version": meta.get("version"),
            "n_caja_busqueda": len(recs),
            "n_intersectan_poligono": len(yes),
            "n_caja_sin_interseccion_de_huella": len(no),
            "granulos_que_intersectan": yes,
            "granulos_solo_caja": no,
        }
        out["intersectan_poligono"].extend(
            {**r, "collection": sn} for r in yes
        )
        log(f"  {sn}: caja={len(recs)} intersectan_poligono={len(yes)} solo_caja={len(no)}")
    return out
