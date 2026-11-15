#!/usr/bin/env python3
"""Orquesta el análisis de radar para la Reserva Biológica Colonso Chalupas.

Uso (desde scripts/radar/, con EARTHDATA_TOKEN o ~/.netrc):

    python run_radar.py

Escribe ../../src/data/radar_real.json y un checkpoint en tmp/ (raíz del repo).
No simula valores: lo que no se pueda calcular queda en null con motivo.
"""
from __future__ import annotations

import json
import sys
import time
from datetime import datetime, timezone
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from earthdata_auth import AuthError, new_session, bearer_token, _netrc_pair
from poligono import cargar, area_km2, BBOX_BUSQUEDA, DEFAULT_GEOJSON
from cmr_buscar import (
    buscar, filtrar_poligono, inicio, fin, url_principal, urls_datos, coleccion_meta,
)
from procesar_gcov import procesar_granulo
from procesar_agua import procesar_dswx, procesar_watermask
from procesar_sme2 import comprobar as comprobar_sme2

# scripts/radar/ → raíz del repositorio
ROOT = Path(__file__).resolve().parents[2]
OUT = ROOT / "src" / "data" / "radar_real.json"
TMP = ROOT / "tmp"
CKPT = TMP / "gcov_checkpoint.json"
DESCARGADO = "2026-11-14"

GCOV_COLS = (
    "NISAR_L2_GCOV_V1",
    "NISAR_L2_GCOV_PROVISIONAL_V1",
    "NISAR_L2_GCOV_BETA_V1",
)


def _log(*a):
    print(*a, flush=True)


def _s3_h5(umm):
    for r in urls_datos(umm, https_only=False):
        typ = (r.get("type") or "").upper()
        url = r.get("url") or ""
        if typ.startswith("GET DATA") and url.startswith("s3://") and url.endswith(".h5") and "browse" not in url:
            return url
    return None


def _https_h5(umm):
    return url_principal(umm, suffix=".h5")


def _round(x, n=4):
    if x is None:
        return None
    try:
        return round(float(x), n)
    except (TypeError, ValueError):
        return x


def _iso_z(val):
    if not val:
        return None
    s = str(val).strip()
    if s.endswith("Z"):
        return s
    # 2026-10-24T23:30:51.000000000
    if "T" in s:
        main = s.split(".")[0]
        return main + "Z"
    return s


def compactar_gcov(rec):
    """Campos estables para la serie (sin volcar attrs enormes)."""
    if rec.get("error"):
        return {
            "granule_id": rec.get("granule_id"),
            "collection": rec.get("collection"),
            "datetime_utc": rec.get("datetime_utc"),
            "error": rec.get("error"),
            "hh_sigma0_db": None,
            "hv_sigma0_db": None,
        }
    t = _iso_z(rec.get("datetime_utc"))
    date = t[:10] if t else None
    hh, hv = rec.get("hh") or {}, rec.get("hv") or {}
    return {
        "date": date,
        "datetime_utc": t,
        "datetime_end_utc": _iso_z(rec.get("datetime_end_utc")),
        "granule_id": rec.get("granule_id"),
        "collection": rec.get("collection"),
        "track": rec.get("track"),
        "frame": rec.get("frame"),
        "direction": rec.get("direction"),
        "polarization": rec.get("polarization"),
        "frequency": rec.get("frequency"),
        "epsg": rec.get("epsg"),
        "pixel_spacing_m": rec.get("pixel_spacing_m"),
        "units_nativas": rec.get("units_nativas"),
        "normalizacion_nativa": rec.get("normalizacion_nativa"),
        "normalizacion_reportada": rec.get("normalizacion_reportada"),
        "convertido_a_sigma0": rec.get("convertido_a_sigma0"),
        "n_pixeles_poligono": rec.get("n_pixeles_poligono"),
        "n_pixeles_validos": rec.get("n_pixeles_validos"),
        "hh_sigma0_mean_db": _round(hh.get("mean_db"), 3),
        "hh_sigma0_median_db": _round(hh.get("median_db"), 3),
        "hh_sigma0_std_db": _round(hh.get("std_db"), 3),
        "hh_sigma0_mean_linear": _round(hh.get("mean_linear"), 6),
        "hv_sigma0_mean_db": _round(hv.get("mean_db"), 3),
        "hv_sigma0_median_db": _round(hv.get("median_db"), 3),
        "hv_sigma0_std_db": _round(hv.get("std_db"), 3),
        "hv_sigma0_mean_linear": _round(hv.get("mean_linear"), 6),
        "hv_hh_ratio_mean_linear": _round(rec.get("hv_hh_ratio_de_medias_lineales"), 5),
        "hv_hh_ratio_mean_db": _round(rec.get("hv_hh_ratio_de_medias_db"), 3),
        "quality_notes": rec.get("quality_notes"),
        "identification": rec.get("identification"),
        "window": rec.get("window"),
        "modo_apertura": rec.get("modo_apertura"),
    }


def main():
    t_all = time.time()
    if not bearer_token() and not _netrc_pair():
        raise SystemExit("Falta EARTHDATA_TOKEN o ~/.netrc para urs.earthdata.nasa.gov")
    geom, props, gpath = cargar()
    poly_area = area_km2(geom)
    _log(f"Polígono {props.get('name')} WDPA {props.get('site_id')} área={poly_area:.3f} km² bounds={geom.bounds}")

    # --- GCOV: catálogo ---
    gcov_meta = {}
    pendientes = []
    no_inter = []
    for sn in GCOV_COLS:
        meta = coleccion_meta(sn)
        gcov_meta[sn] = meta
        items, hits = buscar(sn)
        items = filtrar_poligono(items, geom)
        yes = [it for it in items if it["_intersecta_poligono"]]
        no = [it for it in items if not it["_intersecta_poligono"]]
        _log(f"{sn}: CMR caja={hits} intersectan={len(yes)} no={len(no)}")
        for it in yes:
            umm = it["umm"]
            pendientes.append({
                "collection": sn,
                "granule_id": umm.get("GranuleUR"),
                "start": inicio(umm),
                "s3": _s3_h5(umm),
                "https": _https_h5(umm),
            })
        for it in no:
            umm = it["umm"]
            no_inter.append({
                "collection": sn,
                "granule_id": umm.get("GranuleUR"),
                "start": inicio(umm),
                "motivo": "La huella (GPolygon) no intersecta el polígono WDPA; solo cae en la caja de búsqueda.",
            })

    # Prioridad: V1, luego provisional, luego beta
    orden = {n: i for i, n in enumerate(GCOV_COLS)}
    pendientes.sort(key=lambda r: (orden.get(r["collection"], 9), r["start"] or ""))

    ckpt = {"procesados": []}
    if CKPT.exists():
        try:
            ckpt = json.loads(CKPT.read_text())
        except Exception:
            ckpt = {"procesados": []}
    done = {p.get("granule_id") for p in ckpt.get("procesados") if not p.get("error")}
    gcov_raw = list(ckpt.get("procesados") or [])
    TMP.mkdir(parents=True, exist_ok=True)
    _log(f"GCOV a procesar: {len(pendientes)} (ya hechos: {len(done)})")

    for i, g in enumerate(pendientes, 1):
        if g["granule_id"] in done:
            _log(f"  [{i}/{len(pendientes)}] skip {g['start']} {g['granule_id']}")
            continue
        url = g["s3"] or g["https"]
        _log(f"  [{i}/{len(pendientes)}] {g['collection']} {g['start']} ...")
        t0 = time.time()
        try:
            rec = procesar_granulo(url, g["granule_id"], g["collection"], geom=geom)
        except AuthError as e:
            _log("AUTH FAIL", e)
            raise
        rec["elapsed_s"] = round(time.time() - t0, 1)
        _log(f"    {rec['elapsed_s']}s valid={rec.get('n_pixeles_validos')} HH={((rec.get('hh') or {}).get('mean_db'))} HV={((rec.get('hv') or {}).get('mean_db'))} err={rec.get('error')}")
        # quitar traceback largo del checkpoint si hay error, conservarlo en tmp
        gcov_raw = [p for p in gcov_raw if p.get("granule_id") != g["granule_id"]]
        gcov_raw.append(rec)
        CKPT.write_text(json.dumps({"procesados": gcov_raw}, default=str))
        if rec.get("error"):
            (TMP / f"gcov_err_{g['granule_id'][-40:]}.json").write_text(
                json.dumps(rec, indent=2, default=str)
            )

    gcov_series = [compactar_gcov(r) for r in sorted(gcov_raw, key=lambda x: x.get("datetime_utc") or "")]

    # --- DSWx ---
    _log("DSWx-S1: buscando gránulos jun–nov 2026")
    dswx_meta = coleccion_meta("OPERA_L3_DSWX-S1_V1")
    items, hits = buscar("OPERA_L3_DSWX-S1_V1", temporal="2026-06-01T00:00:00Z,2026-11-14T23:59:59Z")
    items = filtrar_poligono(items, geom)
    dswx_yes = [it for it in items if it["_intersecta_poligono"]]
    # teselas presentes
    def tile(ur):
        for p in (ur or "").split("_"):
            if p.startswith("T") and len(p) == 6:
                return p
        return None
    teselas = sorted({tile(it["umm"].get("GranuleUR")) for it in dswx_yes} - {None})
    _log(f"  CMR caja={hits} bbox/huella∩poligono={len(dswx_yes)} teselas={teselas}")
    dswx_series = procesar_dswx(dswx_yes, geom=geom, log=_log, ckpt_path=TMP / "dswx_checkpoint.json")

    # --- WATERMASK ---
    _log("NISAR_WATERMASK")
    wm_meta = coleccion_meta("NISAR_WATERMASK")
    items, hits = buscar("NISAR_WATERMASK")
    tifs = []
    for it in items:
        url = url_principal(it["umm"], suffix=".tif")
        if url:
            tifs.append(url)
    _log(f"  teselas tif en la caja: {len(tifs)}")
    watermask = procesar_watermask(tifs, geom=geom, log=_log)

    # --- SME2 ---
    _log("SME2 intersección de huellas")
    sme2 = comprobar_sme2(geom=geom, log=_log)

    # --- JSON final ---
    doc = {
        "metadata": {
            "descargado": DESCARGADO,
            "poligono": {
                "wdpa_id": props.get("site_id"),
                "nombre": props.get("name"),
                "desig": props.get("desig"),
                "fuente": "WDPA (src/data/colonso_wdpa.geojson)",
                "bounds_wgs84": list(geom.bounds),
                "area_gis_km2_wdpa": props.get("gis_area"),
                "area_geodesica_km2": _round(poly_area, 4),
                "bbox_busqueda_escenas": list(BBOX_BUSQUEDA),
            },
            "fuentes": {
                "gcov": {
                    "producto": "NISAR L2 Geocoded Polarimetric Covariance (GCOV)",
                    "colecciones": gcov_meta,
                    "especificacion": "https://cumulus.asf.earthdatacloud.nasa.gov/PUBLIC/DATA/NISAR/NISAR_D-102274_RevF_NASA_SDS_Product_Specification_L2_GCOV_w-esigs.pdf",
                    "guia": "https://nisar-docs.asf.alaska.edu/gcov/",
                    "normalizacion": (
                        "Los términos diagonales HHHH y HVHV son gamma0 (potencia, RTC, units=1). "
                        "Se convierten a sigma0 con sigma0 = gamma0 * rtcGammaToSigmaFactor cuando la capa existe. "
                        "La media se calcula en lineal y luego se pasa a dB (10 log10)."
                    ),
                    "resolucion": "10 m (frequency A, observado en las escenas de Colonso; xCoordinateSpacing=10 m)",
                    "via": "ASF DAAC, lectura por ventanas (S3 / HTTP Range), sin descargar el HDF5 completo",
                    "n_procesados": sum(1 for r in gcov_series if not r.get("error")),
                    "n_con_error": sum(1 for r in gcov_series if r.get("error")),
                    "n_caja_sin_interseccion_de_huella": len(no_inter),
                },
                "dswx": {
                    "producto": "OPERA Dynamic Surface Water Extent from Sentinel-1 (DSWx-S1) Version 1",
                    "short_name": "OPERA_L3_DSWX-S1_V1",
                    "doi": dswx_meta.get("doi"),
                    "doi_url": dswx_meta.get("doi_url"),
                    "concept_id": dswx_meta.get("concept_id"),
                    "especificacion": "https://archive.podaac.earthdata.nasa.gov/podaac-ops-cumulus-docs/web-misc/opera/D-108761_OPERA_DSWx_S1AB_ProductSpec_Rev_A.pdf",
                    "capa": "B01_WTR",
                    "clases_wtr": {
                        "0": "no agua (válido)",
                        "1": "agua abierta (agua)",
                        "3": "vegetación inundada (agua)",
                        "250": "HAND enmascarado (excluido)",
                        "251": "layover/sombra (excluido)",
                        "255": "fill / sin dato (excluido)",
                    },
                    "clases_agua_usadas": [1, 3],
                    "clases_validas_denominador": [0, 1, 3],
                    "resolucion": "30 m",
                    "teselas_mgrs_en_caja_que_intersectan": teselas,
                    "periodo": "2026-06-01 a 2026-11-14",
                    "n_fechas": len(dswx_series),
                },
                "watermask": {
                    "producto": "Derived Water Mask Tiles used by the NISAR Mission (NISAR_WATERMASK)",
                    "short_name": "NISAR_WATERMASK",
                    "doi": wm_meta.get("doi"),
                    "concept_id": wm_meta.get("concept_id"),
                    "url_catalogo": "https://search.earthdata.nasa.gov/search/granules?p=C3807638962-ASF",
                    "readme": "https://nisar.asf.earthdatacloud.nasa.gov/NISAR/WATER_MASK/v0.5/EPSG4326/README.txt",
                    "version_teselas": "v0.5.0",
                    "resolucion": "30 m",
                    "crs": "EPSG:4326",
                    "nota_doi": "La colección no declara DOI en CMR (DOI.MissingReason=Unknown).",
                },
                "sme2": {
                    "producto": "NISAR L3 Soil Moisture (SME2)",
                    "nota": (
                        "No hay colección NISAR_L3_SME2_V1 en CMR a 2026-11-14. "
                        "Se listan las huellas de PROVISIONAL_V1 y BETA_V1 que sí intersectan el polígono. "
                        "No se calcula una serie de humedad (fuera del alcance de esta entrega)."
                    ),
                    "colecciones": {k: {
                        "encontrada": v.get("encontrada"),
                        "doi": v.get("doi"),
                        "doi_url": v.get("doi_url"),
                        "n_caja_busqueda": v.get("n_caja_busqueda"),
                        "n_intersectan_poligono": v.get("n_intersectan_poligono"),
                    } for k, v in sme2.get("colecciones", {}).items()},
                },
            },
            "generado": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
        },
        "gcov": gcov_series,
        "gcov_sin_interseccion": no_inter,
        "dswx": [
            {
                "date": r["date"],
                "area_agua_km2": _round(r.get("area_agua_km2"), 4),
                "fraccion_agua": _round(r.get("fraccion_agua"), 6),
                "n_pixeles_agua": r.get("n_pixeles_agua"),
                "n_pixeles_validos": r.get("n_pixeles_validos"),
                "n_agua_abierta": r.get("n_agua_abierta"),
                "n_veg_inundada": r.get("n_veg_inundada"),
                "tiles": r.get("tiles"),
                "granulos": r.get("granulos"),
                "clases_en_poligono": r.get("clases_en_poligono"),
                "reason": r.get("reason"),
                "errores": r.get("errores"),
            }
            for r in dswx_series
        ],
        "watermask": watermask,
        "sme2": sme2,
    }
    OUT.parent.mkdir(parents=True, exist_ok=True)
    OUT.write_text(json.dumps(doc, indent=2, ensure_ascii=False, default=str))
    _log(f"Escrito {OUT} ({OUT.stat().st_size} bytes) en {time.time()-t_all:.0f}s")


if __name__ == "__main__":
    main()
