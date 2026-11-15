#!/usr/bin/env python3
"""NISAR L3 SME2: huellas sobre el polígono WDPA y serie de humedad del suelo.

La comprobación de huellas (GPolygon vs polígono, no solo la caja) se mantiene
en comprobar(). La serie se calcula con lecturas por ventana (S3/HTTP Range)
sobre grids/soilMoisture, sin inventar valores. BETA se marca como precalibrado.
"""
from __future__ import annotations

import json
import sys
import time
from collections import Counter
from datetime import datetime, timezone
from pathlib import Path

import numpy as np
from pyproj import Transformer
from rasterio.features import geometry_mask
from rasterio.transform import Affine
from shapely.ops import transform as shp_transform

sys.path.insert(0, str(Path(__file__).resolve().parent))
from cmr_buscar import buscar, filtrar_poligono, inicio, fin, url_principal, coleccion_meta
from h5_remoto import abrir_h5
from poligono import cargar, area_km2, BBOX_BUSQUEDA
from procesar_gcov import leer_identificacion, ventana_indices, _escalar, _texto

# Especificación del producto (JPL D-107677 Rev. C, 8 nov 2024) y guía de usuario.
URL_ESPEC = (
    "https://nisar.asf.earthdatacloud.nasa.gov/NISAR-SAMPLE-DATA/DOCS/"
    "NISAR_D-107677_RevC_NASA_SDS_Product_Specification_L3_SME2_Nov8_2024_w-sigs.pdf"
)
URL_GUIA = "https://nisar-docs.asf.alaska.edu/sme2/"

COLECCIONES = (
    "NISAR_L3_SME2_V1",
    "NISAR_L3_SME2_PROVISIONAL_V1",
    "NISAR_L3_SME2_BETA_V1",
)

# Rutas oficiales de la capa de producto (no de algorithmCandidates).
RUTA_REJILLA = "/science/LSAR/SME2/grids"
VAR_SM = "soilMoisture"
VAR_QF = "retrievalQualityFlag"
VAR_SQ_CANDIDATAS = (
    "surfaceQualityFlag",                 # PROVISIONAL (spec 1.0.2)
    "ancillaryData/surfaceQualityFlag",  # BETA (spec 1.0.1)
)
VAR_INCERT = "soilMoistureUncertainty"
VAR_LC = "ancillaryData/landCover"

# Umbrales documentados (bit 3 de retrievalQualityFlag en Rev. C).
SM_MIN = 0.02
SM_MAX = 0.60
FILL_SM = -9999.0
FILL_FLAG = -9999

# Bits de retrievalQualityFlag según JPL D-107677 Rev. C.
# Polaridad del bit 0: el atributo description de los HDF5 PROVISIONAL y la
# convención SMAP (y la frase «0 means clear») indican 0 = recomendado,
# 1 = no recomendado. Rev. C nombra el bit pero no fija la polaridad.
BIT_RECOMENDADO = 0           # LSB
MASCARA_ANOMALIA_SIGMA = 0xF0  # bits 4–7 (σhh, σhv, σvv, σvh)

# Bits 0–7 de surfaceQualityFlag (Rev. C). El bit 8 (valor 256) aparece en
# los ficheros y no está documentado en Rev. C: se contabiliza, no se usa
# como criterio de exclusión.
MASCARA_SUPERFICIE_DOC = 0xFF
BIT_VEG_DENSA = 7  # valor 128; VWC típico > 5 kg/m²

# Leyenda de landCover en la misma especificación.
LEYENDA_LANDCOVER = {
    1: "Tree cover",
    2: "Shrublands",
    3: "Grassland",
    4: "Cropland",
    5: "Built-up",
    6: "Bare/sparse vegetation",
    7: "Snow & Ice",
    8: "Permanent water bodies",
    9: "Herbaceous wetland",
    10: "Mangroves",
    11: "Moss & lichen",
}

# scripts/radar/ → raíz del repositorio; salida en src/data/radar_real.json
ROOT = Path(__file__).resolve().parents[2]
JSON_SALIDA = ROOT / "src" / "data" / "radar_real.json"
CKPT = ROOT / "tmp" / "sme2_serie_checkpoint.json"


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


def _redondear(x, n=4):
    if x is None:
        return None
    if isinstance(x, (float, np.floating)):
        if not np.isfinite(x):
            return None
        return round(float(x), n)
    return x


def _histograma(arr):
    """Cuenta valores enteros (p. ej. banderas) como {valor: n} con claves str."""
    vals, cnts = np.unique(arr, return_counts=True)
    return {str(int(v)): int(c) for v, c in zip(vals, cnts)}


def _stats_sm(valores):
    """Media, mediana y desviación de SM en m³/m³. None si no hay píxeles."""
    v = np.asarray(valores, dtype=np.float64)
    if v.size == 0:
        return {"n": 0, "mean": None, "median": None, "std": None}
    return {
        "n": int(v.size),
        "mean": float(np.mean(v)),
        "median": float(np.median(v)),
        "std": float(np.std(v, ddof=1)) if v.size > 1 else 0.0,
    }


def _buscar_capa(grupo, candidatos):
    for ruta in candidatos:
        if ruta in grupo:
            return ruta, grupo[ruta]
    return None, None


def _proyeccion_epsg(grupo):
    if "projection" not in grupo:
        return 6933, "EASE-Grid 2.0 Global (EPSG:6933, supuesto: falta el dataset projection)"
    dset = grupo["projection"]
    try:
        val = dset[()]
        if isinstance(val, (np.generic,)):
            val = val.item()
        epsg = int(val)
    except Exception:
        epsg = int(dset.attrs.get("epsg_code") or 6933)
    nombre = None
    wkt = dset.attrs.get("spatial_ref")
    if isinstance(wkt, bytes):
        wkt = wkt.decode("utf-8", "replace")
    if isinstance(wkt, str) and "EASE" in wkt:
        nombre = "WGS 84 / NSIDC EASE-Grid 2.0 Global"
    return epsg, nombre or f"EPSG:{epsg}"


def procesar_granulo(url: str, geom, collection: str | None = None, granule_id_cmr=None, log=print):
    """Estadísticos de SME2 dentro del polígono para un gránulo (ventana remota)."""
    t0 = time.time()
    h5 = fh = None
    try:
        h5, fh, via = abrir_h5(url)
        if RUTA_REJILLA not in h5:
            raise RuntimeError(f"No existe {RUTA_REJILLA} en el HDF5")
        g = h5[RUTA_REJILLA]
        if VAR_SM not in g or VAR_QF not in g:
            raise RuntimeError("Faltan soilMoisture o retrievalQualityFlag en la rejilla")

        ident = leer_identificacion(h5)
        x = np.asarray(g["xCoordinates"][()], dtype=np.float64)
        y = np.asarray(g["yCoordinates"][()], dtype=np.float64)
        dx = float(g["xCoordinateSpacing"][()]) if "xCoordinateSpacing" in g else float(x[1] - x[0])
        dy = float(g["yCoordinateSpacing"][()]) if "yCoordinateSpacing" in g else float(y[1] - y[0])
        epsg, nombre_crs = _proyeccion_epsg(g)

        to_g = Transformer.from_crs("EPSG:4326", f"EPSG:{epsg}", always_xy=True)
        geom_g = shp_transform(lambda xx, yy, z=None: to_g.transform(xx, yy), geom)
        r0, r1, c0, c1 = ventana_indices(x, y, geom_g.bounds, margen_px=2)

        sm = np.asarray(g[VAR_SM][r0:r1, c0:c1], dtype=np.float64)
        qf = np.asarray(g[VAR_QF][r0:r1, c0:c1])
        fill_sm = float(g[VAR_SM].attrs.get("_FillValue", FILL_SM))
        fill_qf = int(g[VAR_QF].attrs.get("_FillValue", FILL_FLAG))
        unidades = _texto(g[VAR_SM].attrs.get("units"))
        desc_qf = _texto(g[VAR_QF].attrs.get("description"))

        sq_ruta, sq_ds = _buscar_capa(g, VAR_SQ_CANDIDATAS)
        if sq_ds is not None:
            sq = np.asarray(sq_ds[r0:r1, c0:c1])
            fill_sq = int(sq_ds.attrs.get("_FillValue", FILL_FLAG))
        else:
            sq = None
            fill_sq = FILL_FLAG

        inc = None
        if VAR_INCERT in g:
            inc = np.asarray(g[VAR_INCERT][r0:r1, c0:c1], dtype=np.float64)
            fill_inc = float(g[VAR_INCERT].attrs.get("_FillValue", FILL_SM))
        else:
            fill_inc = FILL_SM

        lc = None
        if VAR_LC in g:
            lc = np.asarray(g[VAR_LC][r0:r1, c0:c1])

        # Candidatos de algoritmo presentes (DSG / PMI / TSR).
        algs = []
        if "algorithmCandidates" in g:
            algs = sorted(list(g["algorithmCandidates"].keys()))
        dsg_igual_sm = None
        if "algorithmCandidates/DSG/soilMoisture" in g:
            dsg_sm = np.asarray(g["algorithmCandidates/DSG/soilMoisture"][r0:r1, c0:c1], dtype=np.float64)
            # Comparar solo donde el producto oficial no es fill.
            mask_cmp = np.isfinite(sm) & (sm != fill_sm)
            if int(mask_cmp.sum()) > 0:
                dsg_igual_sm = bool(np.allclose(sm[mask_cmp], dsg_sm[mask_cmp], equal_nan=True))

        # Affine: x,y son centros de píxel; dx>0, dy<0 (norte arriba).
        transform = Affine.translation(x[c0] - dx / 2.0, y[r0] - dy / 2.0) * Affine.scale(dx, dy)
        inside = ~geometry_mask(
            [geom_g], out_shape=sm.shape, transform=transform, invert=False, all_touched=False
        )
        n_dentro = int(inside.sum())

        # Píxeles válidos: SM finito, no fill, en el rango documentado 0.02–0.60,
        # QF no fill, interior del polígono.
        valid = (
            inside
            & np.isfinite(sm)
            & (sm != fill_sm)
            & (sm >= SM_MIN)
            & (sm <= SM_MAX)
            & (qf != fill_qf)
        )
        n_valid = int(valid.sum())

        # Calidad recomendada (dominio de exactitud oficial: zonas sin banderas
        # de superficie documentadas y bit 0 de QF en 0 = recomendado).
        rec_bit0_claro = valid & ((qf.astype(np.int32) & 1) == 0)
        sin_anomalia_sigma = valid & ((qf.astype(np.int32) & MASCARA_ANOMALIA_SIGMA) == 0)
        if sq is not None:
            superficie_clara = valid & (sq != fill_sq) & ((sq.astype(np.int32) & MASCARA_SUPERFICIE_DOC) == 0)
            veg_densa = inside & (sq != fill_sq) & ((sq.astype(np.int32) & (1 << BIT_VEG_DENSA)) != 0)
            bit8 = inside & (sq != fill_sq) & ((sq.astype(np.int32) & 0x100) != 0)
            recomendado = rec_bit0_claro & superficie_clara & sin_anomalia_sigma
            n_superficie_clara = int(superficie_clara.sum())
            n_veg_densa = int((valid & veg_densa).sum())
            n_bit8 = int((valid & bit8).sum())
            hist_sq_valid = _histograma(sq[valid]) if n_valid else {}
            hist_sq_dentro = _histograma(sq[inside])
        else:
            superficie_clara = None
            recomendado = None
            n_superficie_clara = None
            n_veg_densa = None
            n_bit8 = None
            hist_sq_valid = None
            hist_sq_dentro = None

        n_rec_bit0_claro = int(rec_bit0_claro.sum())
        n_rec_bit0_set = int((valid & ((qf.astype(np.int32) & 1) != 0)).sum())
        n_recomendado = int(recomendado.sum()) if recomendado is not None else 0

        st_valid = _stats_sm(sm[valid])
        if recomendado is not None and n_recomendado > 0:
            st_rec = _stats_sm(sm[recomendado])
            razon_rec = None
        else:
            st_rec = {"n": n_recomendado if recomendado is not None else 0,
                      "mean": None, "median": None, "std": None}
            if sq is None:
                razon_rec = (
                    "No hay surfaceQualityFlag en este gránulo; no se puede confirmar "
                    "el dominio sin banderas (VWC < 5 kg/m²) exigido por la guía."
                )
            else:
                partes = []
                if n_valid == 0:
                    partes.append("no hay píxeles de SM válidos dentro del polígono")
                else:
                    if n_rec_bit0_claro == 0:
                        partes.append(
                            "ningún píxel válido tiene el bit 0 de retrievalQualityFlag en 0 "
                            "(recomendado, según el atributo del producto y la frase «0 means clear»)"
                        )
                    if n_superficie_clara == 0:
                        partes.append(
                            "ningún píxel válido está libre de banderas de superficie documentadas "
                            "(bits 0–7); predomina vegetación densa (bit 7, VWC típico > 5 kg/m²)"
                        )
                    elif n_recomendado == 0:
                        partes.append(
                            f"la intersección de bit 0 claro (n={n_rec_bit0_claro}) y "
                            f"superficie sin banderas documentadas (n={n_superficie_clara}) está vacía; "
                            "predomina vegetación densa (bit 7, VWC típico > 5 kg/m²)"
                        )
                if not partes:
                    partes.append("no hay píxeles de calidad recomendada")
                razon_rec = "; ".join(partes) + "."

        # Incertidumbre media (si existe) sobre los mismos conjuntos.
        def _media_inc(mask):
            if inc is None or mask is None or int(mask.sum()) == 0:
                return None
            w = inc[mask]
            w = w[np.isfinite(w) & (w != fill_inc)]
            return float(np.mean(w)) if w.size else None

        # Cobertura del polígono.
        area_px_km2 = abs(dx * dy) / 1.0e6
        area_poly = area_km2(geom)
        fraccion_n = (n_valid / n_dentro) if n_dentro else None
        fraccion_area = (n_valid * area_px_km2 / area_poly) if area_poly else None

        hist_lc = None
        n_tree = None
        if lc is not None and n_dentro:
            hist_lc = _histograma(lc[inside])
            n_tree = int((inside & (lc == 1)).sum())

        t_start = ident.get("zeroDopplerStartTime")
        t_end = ident.get("zeroDopplerEndTime")
        direccion = ident.get("orbitPassDirection")
        track = _escalar(ident.get("trackNumber"))
        frame = _escalar(ident.get("frameNumber"))
        gid = ident.get("granuleId") or granule_id_cmr
        es_beta = bool(collection and "BETA" in collection)

        if not algs:
            texto_alg = "No hay algorithmCandidates en el fichero. La capa oficial es grids/soilMoisture."
        elif algs == ["DSG"]:
            texto_alg = (
                "Solo está presente el candidato DSG (disaggregation). PMI y TSR no aparecen. "
                "La capa oficial es grids/soilMoisture."
            )
        else:
            texto_alg = (
                f"Candidatos presentes: {', '.join(algs)} "
                "(DSG = disaggregation, PMI = physical model inversion, TSR = time series ratio). "
                "La capa oficial es grids/soilMoisture; las estadísticas usan esa capa, no un candidato aislado."
            )
        if dsg_igual_sm is True:
            texto_alg += " Coincide numéricamente con algorithmCandidates/DSG/soilMoisture en píxeles válidos."
        elif dsg_igual_sm is False:
            texto_alg += (
                " No coincide con DSG/soilMoisture en todos los píxeles válidos "
                "(cuando hay PMI/TSR la capa oficial tampoco coincide con un único candidato)."
            )

        rec = {
            "granule_id": gid,
            "collection": collection,
            "precalibrado": es_beta,
            "madurez": (
                "BETA_V1 (precalibrado; no usar como producto validado)"
                if es_beta
                else (
                    "PROVISIONAL_V1 (no está completamente calibrado; no hay colección VALIDATED de SME2 a 2026-11-14)"
                    if collection and "PROVISIONAL" in collection
                    else collection
                )
            ),
            "start_utc": t_start,
            "end_utc": t_end,
            "track": track,
            "frame": frame,
            "direction": direccion,
            "look_direction": ident.get("lookDirection"),
            "product_version": ident.get("productVersion"),
            "product_specification_version": ident.get("productSpecificationVersion"),
            "product_doi": ident.get("productDoi"),
            "composite_release_id": ident.get("compositeReleaseId"),
            "algoritmos_presentes": algs,
            "algoritmo_producto": texto_alg,
            "dsg_igual_a_producto_en_validos": dsg_igual_sm,
            "variable": f"{RUTA_REJILLA}/{VAR_SM}",
            "unidades": "m3/m3",
            "unidades_producto": unidades,
            "fill_value_sm": fill_sm,
            "fill_value_flag": fill_qf,
            "epsg": epsg,
            "crs_nombre": nombre_crs,
            "espaciado_x_m": dx,
            "espaciado_y_m": dy,
            "area_pixel_km2": area_px_km2,
            "ventana": {"row0": r0, "row1": r1, "col0": c0, "col1": c1},
            "lectura": via,
            "n_pixeles_poligono": n_dentro,
            "n_valido": n_valid,
            "n_recomendado": n_recomendado if recomendado is not None else None,
            "n_qf_bit0_claro_recomendado": n_rec_bit0_claro,
            "n_qf_bit0_set_no_recomendado": n_rec_bit0_set,
            "n_superficie_sin_banderas_doc": n_superficie_clara,
            "n_vegetacion_densa_en_validos": n_veg_densa,
            "n_surface_bit8_no_documentado_en_validos": n_bit8,
            "n_tree_cover_en_poligono": n_tree,
            "fraccion_poligono_valida": _redondear(fraccion_n, 6),
            "fraccion_area_valida": _redondear(fraccion_area, 6),
            "mean": _redondear(st_valid["mean"], 4),
            "median": _redondear(st_valid["median"], 4),
            "std": _redondear(st_valid["std"], 4),
            "mean_incertidumbre": _redondear(_media_inc(valid), 4),
            "sm_min_valido": _redondear(float(sm[valid].min()) if n_valid else None, 4),
            "sm_max_valido": _redondear(float(sm[valid].max()) if n_valid else None, 4),
            "recomendado": {
                "definicion": (
                    "SM válido en [0.02, 0.60], retrievalQualityFlag bit 0 = 0 (recomendado), "
                    "sin bits de anomalía σ (4–7) y surfaceQualityFlag bits 0–7 = 0 "
                    "(sin agua, urbano, precipitación, nieve/hielo, suelo congelado, terreno o vegetación densa). "
                    "El bit 8 (256), presente y no documentado en Rev. C, no se usa como exclusión."
                ),
                "n": n_recomendado if recomendado is not None else None,
                "mean": _redondear(st_rec["mean"], 4),
                "median": _redondear(st_rec["median"], 4),
                "std": _redondear(st_rec["std"], 4),
                "mean_incertidumbre": _redondear(_media_inc(recomendado), 4) if recomendado is not None else None,
                "reason": razon_rec,
            },
            "histograma_qf_validos": _histograma(qf[valid]) if n_valid else {},
            "histograma_sq_validos": hist_sq_valid,
            "histograma_sq_poligono": hist_sq_dentro,
            "histograma_landcover_poligono": hist_lc,
            "leyenda_landcover": LEYENDA_LANDCOVER,
            "ruta_surfaceQualityFlag": sq_ruta,
            "descripcion_qf_en_fichero": desc_qf,
            "url_h5": url,
            "segundos": round(time.time() - t0, 1),
            "error": None,
        }
        log(
            f"  {t_start} {direccion or '?'} T{track} F{frame} "
            f"{collection or ''} valid={n_valid} rec={n_recomendado if recomendado is not None else 'n/a'} "
            f"mean={rec['mean']} med={rec['median']} ({rec['segundos']}s, {via})"
        )
        return rec
    except Exception as exc:
        log(f"  ERROR {granule_id_cmr or url}: {type(exc).__name__}: {exc}")
        return {
            "granule_id": granule_id_cmr,
            "collection": collection,
            "url_h5": url,
            "error": f"{type(exc).__name__}: {exc}",
            "segundos": round(time.time() - t0, 1),
        }
    finally:
        try:
            if h5 is not None:
                h5.close()
        except Exception:
            pass
        try:
            if fh is not None:
                fh.close()
        except Exception:
            pass


def _nota_smap_cualitativa():
    return (
        "Comparación cualitativa (no se fusionan conjuntos): en src/data/satellite_real.json "
        "ningún píxel SMAP SPL3SMP_E tuvo calidad recomendada sobre la reserva (bosque denso, "
        "VWC > 5 kg/m²). En SME2 la mayor parte del polígono es landCover=1 (Tree cover) y/o "
        "lleva surfaceQualityFlag bit 7 (vegetación densa). Las estadísticas de calidad recomendada "
        "quedan restringidas a los claros sin esas banderas; no se atribuyen diferencias a un "
        "fenómeno climático ni se combinan ambas series."
    )


def metadatos_serie():
    return {
        "producto": "NISAR L3 Soil Moisture (SME2)",
        "variable": f"{RUTA_REJILLA}/{VAR_SM}",
        "algoritmo": (
            "La capa oficial reportada es grids/soilMoisture (unidades meter^3/meter^3). "
            "La especificación contempla tres algoritmos candidatos: DSG (disaggregation), "
            "PMI (physical model inversion) y TSR (time series ratio). El conjunto de candidatos "
            "varía por gránulo (solo DSG; DSG+TSR; o DSG+PMI+TSR). Cuando solo está DSG, la capa "
            "oficial coincide con ese candidato en los píxeles válidos. Cuando hay PMI y/o TSR, "
            "la capa oficial no coincide numéricamente con un único candidato; no se infiere aquí "
            "la regla de fusión. Las estadísticas usan siempre la capa oficial."
        ),
        "unidades": "m3/m3",
        "unidades_producto": "meter^3/meter^3",
        "epsg": 6933,
        "rejilla": "WGS 84 / NSIDC EASE-Grid 2.0 Global",
        "espaciado_nominal_m": 200.179,
        "fill_value": -9999,
        "rango_sm_documentado": [SM_MIN, SM_MAX],
        "especificacion": URL_ESPEC,
        "guia": URL_GUIA,
        "doi_provisional": "10.5067/NIL3SME2-P1",
        "doi_beta": "10.5067/NIL3SME2-B1",
        "definicion_valido": (
            "Píxel interior al polígono WDPA, soilMoisture finito y distinto de _FillValue (-9999), "
            "en el intervalo documentado [0.02, 0.60] m³/m³, y retrievalQualityFlag distinto de fill."
        ),
        "definicion_calidad_recomendada": (
            "Píxel válido con retrievalQualityFlag bit 0 = 0 (recomendado: atributo description de los "
            "HDF5 PROVISIONAL y frase «0 means clear» de JPL D-107677 Rev. C; Rev. C nombra el bit "
            "sin fijar polaridad), sin bits 4–7 de anomalía de sigma, y surfaceQualityFlag bits 0–7 "
            "en 0 (sin agua estática, urbano, precipitación, nieve/hielo, suelo congelado, terreno ni "
            "vegetación densa). El bit 8 (valor 256) aparece en los ficheros y no está en Rev. C: "
            "se reporta su conteo y no se usa como exclusión. Si no hay píxeles, mean/median/std de "
            "este subconjunto quedan en null con reason."
        ),
        "banderas_retrievalQualityFlag": {
            "fuente": "JPL D-107677 Rev. C, más el atributo HDF5 description de los gránulos",
            "fill": -9999,
            "bits_rev_c": {
                "0": "Retrieval recommended flag (polaridad usada: 0 = recomendado, 1 = no recomendado)",
                "1": "Retrieval attempted flag",
                "2": "Retrieval success flag",
                "3": "Soil moisture thresholds between 0.02 and 0.60 (bit de estado, no de anomalía)",
                "4": "NISAR sigma_hh anomaly flag",
                "5": "NISAR sigma_hv anomaly flag",
                "6": "NISAR sigma_vv anomaly flag",
                "7": "NISAR sigma_vh anomaly flag",
            },
            "nota_atributo_provisional": (
                "En PROVISIONAL (productSpecificationVersion 1.0.2) el atributo description del "
                "dataset dice: LSB 0 = recommended, 1 = not recommended; bit 1 = PMI applied; "
                "bit 2 = TSR applied; MSB = DSG applied. Esa disposición de bits 1+ no coincide "
                "con Rev. C. En BETA (spec 1.0.1) el atributo solo reproduce «0 means clear and "
                "non-zero means anomaly». El cruce empírico en PROVISIONAL (QF=8 solo con "
                "surfaceQualityFlag=0; QF=9 solo con banderas de superficie) respalda la polaridad "
                "0 = recomendado. Interpretar el bit 0 en 1 como «recomendado» clasificaría como "
                "recomendados los píxeles de vegetación densa y dejaría fuera los de superficie clara."
            ),
        },
        "banderas_surfaceQualityFlag": {
            "fuente": "JPL D-107677 Rev. C (grids/ancillaryData/surfaceQualityFlag)",
            "ruta_provisional": "grids/surfaceQualityFlag",
            "ruta_beta": "grids/ancillaryData/surfaceQualityFlag",
            "fill": -9999,
            "bits": {
                "0": "Static water body flag",
                "1": "Urban area flag",
                "2": "Precipitation flag",
                "3": "Snow or ice flag",
                "4": "Permanent snow or ice flag",
                "5": "Frozen ground flag based on soil surface temperature",
                "6": "Terrain flag",
                "7": "Dense vegetation flag (VWC típico > 5 kg/m²)",
            },
            "bit_8_no_documentado": (
                "El valor 256 (bit 8) aparece en ambos conjuntos y no figura en Rev. C. "
                "No se usa como criterio de exclusión."
            ),
        },
        "landcover": {
            "ruta": VAR_LC,
            "fill": -127,
            "leyenda": LEYENDA_LANDCOVER,
        },
        "meta_exactitud": (
            "Objetivo de exactitud 0.06 m³/m³ sobre zonas sin banderas con VWC < 5 kg/m² "
            "(guía ASF). A 2026-11-14 no hay colección VALIDATED de SME2. PROVISIONAL no está "
            "completamente calibrado. BETA se trata como precalibrado."
        ),
        "comparacion_smap": _nota_smap_cualitativa(),
        "fecha_procesado": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
    }


def _clave_ckpt(rec_cat):
    return rec_cat.get("granule_id") or rec_cat.get("url_h5")


def procesar_catalogo(catalogo, geom=None, log=print, checkpoint=CKPT, rehacer=False):
    """Procesa la lista intersectan_poligono (p. ej. la ya guardada en radar_real.json)."""
    if geom is None:
        geom, _, _ = cargar()
    prev = {}
    if checkpoint and Path(checkpoint).is_file() and not rehacer:
        try:
            prev = { _clave_ckpt(r): r for r in json.loads(Path(checkpoint).read_text()).get("serie", [])
                     if r.get("error") is None and r.get("mean") is not None or r.get("n_valido") == 0 }
        except Exception:
            prev = {}
    serie = []
    n_ok = n_err = 0
    for i, cat in enumerate(catalogo, 1):
        key = _clave_ckpt(cat)
        if key in prev:
            rec = prev[key]
            log(f"[{i}/{len(catalogo)}] reutilizado {key}")
            serie.append(rec)
            n_ok += 1
            continue
        log(f"[{i}/{len(catalogo)}] {cat.get('collection')} {cat.get('start_utc')} {key}")
        rec = procesar_granulo(
            cat["url_h5"], geom,
            collection=cat.get("collection"),
            granule_id_cmr=cat.get("granule_id"),
            log=log,
        )
        # Conservar start/end de CMR si el HDF5 no trajo zeroDoppler*.
        rec.setdefault("start_utc", cat.get("start_utc"))
        rec.setdefault("end_utc", cat.get("end_utc"))
        if rec.get("start_utc") is None:
            rec["start_utc"] = cat.get("start_utc")
        if rec.get("end_utc") is None:
            rec["end_utc"] = cat.get("end_utc")
        serie.append(rec)
        if rec.get("error"):
            n_err += 1
        else:
            n_ok += 1
        if checkpoint:
            Path(checkpoint).parent.mkdir(parents=True, exist_ok=True)
            Path(checkpoint).write_text(json.dumps({"serie": serie}, indent=2, ensure_ascii=False, default=str))
    # Orden temporal.
    def _k(r):
        return (r.get("start_utc") or "", r.get("collection") or "", r.get("granule_id") or "")
    serie.sort(key=_k)
    log(f"SME2 serie: ok={n_ok} errores={n_err} total={len(serie)}")
    return serie


def actualizar_json(path=JSON_SALIDA, serie=None, log=print):
    """Inserta sme2_serie y actualiza solo metadata.fuentes.sme2.nota (el resto no se toca)."""
    path = Path(path)
    doc = json.loads(path.read_text())
    meta = metadatos_serie()
    n_prov = sum(1 for r in serie if r.get("collection") and "PROVISIONAL" in r["collection"] and not r.get("error"))
    n_beta = sum(1 for r in serie if r.get("collection") and "BETA" in r["collection"] and not r.get("error"))
    n_err = sum(1 for r in serie if r.get("error"))
    doc["sme2_serie"] = {
        **meta,
        "n_gránulos": len(serie),
        "n_provisional_ok": n_prov,
        "n_beta_ok": n_beta,
        "n_errores": n_err,
        "serie": serie,
    }
    # Actualizar la nota de fuentes.sme2 (antes decía que la serie estaba fuera de alcance).
    # No se modifican los conteos de colecciones ni sme2.intersectan_poligono.
    fuentes = doc.setdefault("metadata", {}).setdefault("fuentes", {})
    sme2_f = fuentes.setdefault("sme2", {})
    sme2_f["nota"] = (
        "No hay colección NISAR_L3_SME2_V1 en CMR a 2026-11-14. "
        f"Serie de humedad del suelo (grids/soilMoisture, unidades m³/m³) calculada sobre el polígono "
        f"para {n_prov} gránulos PROVISIONAL_V1 y {n_beta} BETA_V1 cuyas huellas intersectan el polígono "
        f"(ver clave de nivel superior sme2_serie). BETA está precalibrado. "
        "PROVISIONAL no está completamente calibrado; no hay colección VALIDATED de SME2."
    )
    sme2_f["especificacion"] = URL_ESPEC
    sme2_f["guia"] = URL_GUIA
    sme2_f["clave_serie"] = "sme2_serie"
    path.write_text(json.dumps(doc, indent=2, ensure_ascii=False, default=str))
    log(f"Actualizado {path} ({path.stat().st_size} bytes)")
    return path


def main(argv=None):
    import argparse
    p = argparse.ArgumentParser(description="Serie SME2 sobre el polígono Colonso Chalupas")
    p.add_argument("--json", default=str(JSON_SALIDA), help="radar_real.json de entrada/salida")
    p.add_argument("--rehacer", action="store_true")
    args = p.parse_args(argv)
    geom, props, _ = cargar()
    doc = json.loads(Path(args.json).read_text())
    catalogo = doc.get("sme2", {}).get("intersectan_poligono") or []
    if not catalogo:
        raise SystemExit("No hay sme2.intersectan_poligono en el JSON; ejecute primero comprobar().")
    print(f"Polígono {props.get('name')} area_geodesica={area_km2(geom):.3f} km²; gránulos={len(catalogo)}")
    serie = procesar_catalogo(catalogo, geom=geom, rehacer=args.rehacer)
    actualizar_json(args.json, serie=serie)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
