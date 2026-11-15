#!/usr/bin/env python3
"""Lectura cuantitativa de NISAR L2 GCOV sobre el polígono WDPA.

No descarga el HDF5 entero (~7 GB). Lo abre por S3 con credenciales temporales
(ASF s3credentials) o, si hace falta, por peticiones HTTP Range, y lee solo la
ventana de la reserva: coordenadas, máscara, factor RTC y los términos HHHH / HVHV.

Los términos diagonales de GCOV son gamma0 (potencia, RTC). Si el archivo trae
rtcGammaToSigmaFactor, se convierte a sigma0: sigma0 = gamma0 * factor.
Las estadísticas se promedian en lineal y luego se pasan a dB.
"""
from __future__ import annotations

import json
import os
import sys
import traceback
from pathlib import Path

import h5py
import numpy as np
from pyproj import CRS, Transformer
from rasterio.features import geometry_mask
from rasterio.transform import Affine
from shapely.ops import transform as shp_transform

# Permitir ejecución directa desde scripts/
sys.path.insert(0, str(Path(__file__).resolve().parent))
from earthdata_auth import new_session, AuthError
from h5_remoto import abrir_h5
from poligono import cargar, area_km2

FREQ_A = "/science/LSAR/GCOV/grids/frequencyA"
# Máscara de muestras válidas (especificación GCOV / Shiroma 2026):
# 0 = inválido o parcialmente enfocado; 1-5 = válido (número de subswath);
# 255 = relleno fuera de la adquisición.
MASK_VALIDOS = set(range(1, 6))
MASK_INVALIDOS = {0, 255}


def _attr_dict(obj):
    out = {}
    for k, v in obj.attrs.items():
        if isinstance(v, bytes):
            try:
                v = v.decode("utf-8", "replace")
            except Exception:
                v = repr(v)
        elif isinstance(v, np.ndarray):
            if v.size <= 8:
                v = v.tolist()
            else:
                v = f"ndarray{list(v.shape)} {v.dtype}"
        elif isinstance(v, (np.generic,)):
            v = v.item()
        out[str(k)] = v
    return out


def _visit_tree(h5, base, max_depth=3):
    """Lista grupos/datasets y atributos (para inspección)."""
    rows = []

    def rec(name, obj):
        depth = name.count("/")
        if depth > max_depth:
            return
        kind = "group" if isinstance(obj, h5py.Group) else "dataset"
        info = {"path": "/" + name if not name.startswith("/") else name, "kind": kind}
        if kind == "dataset":
            info["shape"] = list(obj.shape)
            info["dtype"] = str(obj.dtype)
            info["chunks"] = list(obj.chunks) if obj.chunks else None
            info["compression"] = obj.compression
            info["fillvalue"] = None if obj.fillvalue is None else (
                obj.fillvalue.item() if hasattr(obj.fillvalue, "item") else obj.fillvalue
            )
        info["attrs"] = _attr_dict(obj)
        rows.append(info)

    if base in h5:
        h5[base].visititems(rec)
    return rows


def _crs_de_proyeccion(dset):
    """EPSG / CRS a partir del dataset `projection` de GCOV."""
    attrs = _attr_dict(dset)
    # candidatos habituales
    for key in ("epsg", "EPSG", "epsg_code", "EPSG_code", "spatial_ref", "crs_wkt",
                "crs", "spatialRef"):
        if key in attrs and attrs[key]:
            val = attrs[key]
            try:
                return CRS.from_user_input(val), attrs
            except Exception:
                continue
    # UTM a partir de zona
    zona = attrs.get("utm_zone_number") or attrs.get("utm_zone") or attrs.get("UTM_zone")
    if zona is not None:
        zona = int(zona)
        # hemisferio: latitude_of_projection_origin o false_northing
        south = False
        fn = attrs.get("false_northing")
        if fn is not None and float(fn) >= 1e6:
            south = True
        # o signo de la zona (a veces negativo = sur)
        if zona < 0:
            south = True
            zona = abs(zona)
        epsg = 32700 + zona if south else 32600 + zona
        return CRS.from_epsg(epsg), attrs
    # WKT en el propio valor del dataset
    try:
        val = dset[()]
        if isinstance(val, bytes):
            val = val.decode("utf-8", "replace")
        if isinstance(val, str) and len(val) > 8:
            return CRS.from_user_input(val), attrs
    except Exception:
        pass
    raise RuntimeError(f"No se pudo determinar el CRS de projection: attrs={list(attrs)}")


def _texto(val):
    if val is None:
        return None
    if isinstance(val, bytes):
        return val.decode("utf-8", "replace")
    if isinstance(val, np.ndarray):
        if val.dtype.kind in ("S", "O", "U"):
            if val.shape == ():
                return _texto(val[()])
            return [_texto(x) for x in val]
        if val.size == 1:
            return val.item()
    if isinstance(val, (np.generic,)):
        return val.item()
    return val


def leer_identificacion(h5):
    """Metadatos de órbita / tiempo / polarización."""
    out = {}
    for path in (
        "/science/LSAR/identification",
        "/science/identification",
        "/identification",
        "/science/LSAR/GCOV/metadata/identification",
    ):
        if path not in h5:
            continue
        g = h5[path]
        for k in g.keys():
            try:
                obj = g[k]
                if isinstance(obj, h5py.Dataset) and obj.ndim == 0 or (
                    isinstance(obj, h5py.Dataset) and obj.size <= 32
                ):
                    out[k] = _texto(obj[()])
            except Exception:
                continue
        # también atributos del grupo
        for k, v in _attr_dict(g).items():
            out.setdefault(k, v)
        break
    return out


def _buscar_dataset(h5, nombres):
    """Busca un dataset por nombre en paths habituales."""
    found = []

    def rec(name, obj):
        if isinstance(obj, h5py.Dataset) and name.split("/")[-1] in nombres:
            found.append("/" + name if not name.startswith("/") else name)

    h5.visititems(rec)
    return found


def ventana_indices(x, y, bounds, margen_px=4):
    """Filas/columnas que cubren bounds=(xmin,ymin,xmax,ymax) en coords de proyección."""
    xmin, ymin, xmax, ymax = bounds
    # x creciente, y a menudo decreciente (norte arriba)
    x = np.asarray(x)
    y = np.asarray(y)
    col0 = int(np.searchsorted(x, xmin, side="left") - 1)
    col1 = int(np.searchsorted(x, xmax, side="right"))
    if y[0] > y[-1]:
        # y decreciente
        row0 = int(np.searchsorted(-y, -ymax, side="left") - 1)
        row1 = int(np.searchsorted(-y, -ymin, side="right"))
    else:
        row0 = int(np.searchsorted(y, ymin, side="left") - 1)
        row1 = int(np.searchsorted(y, ymax, side="right"))
    col0 = max(0, col0 - margen_px)
    row0 = max(0, row0 - margen_px)
    col1 = min(x.size - 1, col1 + margen_px)
    row1 = min(y.size - 1, row1 + margen_px)
    if col1 <= col0 or row1 <= row0:
        raise RuntimeError(f"Ventana vacía: rows={row0}:{row1} cols={col0}:{col1}")
    return row0, row1 + 1, col0, col1 + 1  # slice end exclusivo


def _a_db(lin):
    lin = np.asarray(lin, dtype=np.float64)
    out = np.full(lin.shape, np.nan, dtype=np.float64)
    ok = np.isfinite(lin) & (lin > 0)
    out[ok] = 10.0 * np.log10(lin[ok])
    return out


def _escalar(x):
    if x is None or (isinstance(x, float) and not np.isfinite(x)):
        return None
    if isinstance(x, (np.generic,)):
        x = x.item()
    if isinstance(x, (float, np.floating)):
        return float(x)
    if isinstance(x, (int, np.integer)):
        return int(x)
    return x


def stats_lineal(arr, mascara):
    v = np.asarray(arr, dtype=np.float64)[mascara]
    if v.size == 0:
        return {"n": 0, "mean_linear": None, "mean_db": None,
                "median_linear": None, "median_db": None,
                "std_linear": None, "std_db": None}
    mean_l = float(np.mean(v))
    med_l = float(np.median(v))
    std_l = float(np.std(v, ddof=1)) if v.size > 1 else 0.0
    db = _a_db(v)
    db_ok = db[np.isfinite(db)]
    std_db = float(np.std(db_ok, ddof=1)) if db_ok.size > 1 else (0.0 if db_ok.size == 1 else None)
    return {
        "n": int(v.size),
        "mean_linear": mean_l,
        "mean_db": None if mean_l <= 0 else float(10 * np.log10(mean_l)),
        "median_linear": med_l,
        "median_db": None if med_l <= 0 else float(10 * np.log10(med_l)),
        "std_linear": std_l,
        "std_db": std_db,
    }


def inspeccionar(url: str, out_json: Path | None = None):
    """Abre un GCOV y describe la malla frequencyA (sin leer las bandas enteras)."""
    h5, fh, modo = abrir_h5(url)
    try:
        report = {
            "claves_raiz": list(h5.keys()),
            "identificacion": leer_identificacion(h5),
            "modo_apertura": modo,
        }
        if FREQ_A not in h5:
            report["error"] = f"No existe {FREQ_A}. grupos={list(h5.keys())}"
            # intentar localizar frequencyA
            found = []

            def rec(name, obj):
                if name.endswith("frequencyA") and isinstance(obj, h5py.Group):
                    found.append("/" + name)
            h5.visititems(rec)
            report["frequencyA_alternativas"] = found
        else:
            g = h5[FREQ_A]
            report["datasets_frequencyA"] = list(g.keys())
            report["arbol_frequencyA"] = _visit_tree(h5, "science/LSAR/GCOV/grids/frequencyA", max_depth=2)
            if "xCoordinates" in g and "yCoordinates" in g:
                x = g["xCoordinates"][()]
                y = g["yCoordinates"][()]
                report["xCoordinates"] = {
                    "n": int(x.size), "min": float(x.min()), "max": float(x.max()),
                    "dx": float(x[1] - x[0]) if x.size > 1 else None,
                    "attrs": _attr_dict(g["xCoordinates"]),
                }
                report["yCoordinates"] = {
                    "n": int(y.size), "min": float(y.min()), "max": float(y.max()),
                    "dy": float(y[1] - y[0]) if y.size > 1 else None,
                    "attrs": _attr_dict(g["yCoordinates"]),
                }
            if "projection" in g:
                crs, attrs = _crs_de_proyeccion(g["projection"])
                report["projection"] = {"crs": crs.to_string(), "epsg": crs.to_epsg(), "attrs": attrs}
            for name in ("HHHH", "HVHV", "mask", "rtcGammaToSigmaFactor", "numberOfLooks",
                         "layoverShadowMask", "validSamplesMask"):
                if name in g:
                    ds = g[name]
                    report[name] = {
                        "shape": list(ds.shape), "dtype": str(ds.dtype),
                        "chunks": list(ds.chunks) if ds.chunks else None,
                        "compression": ds.compression,
                        "attrs": _attr_dict(ds),
                    }
            # buscar máscara de layover/sombra en todo el archivo
            report["datasets_layover"] = _buscar_dataset(
                h5, {"layoverShadowMask", "layover_shadow_mask", "convmin",
                     "shadowLayoverMask", "lsMap", "maskLayoverShadow"}
            )
        report["modo_apertura"] = modo
        if out_json:
            Path(out_json).write_text(json.dumps(report, indent=2, default=str))
        return report
    finally:
        h5.close()
        try:
            fh.close()
        except Exception:
            pass


def procesar_granulo(url: str, granule_id: str, collection: str, session=None, geom=None):
    """Calcula estadísticas HH/HV (sigma0 si hay factor RTC) dentro del polígono."""
    if geom is None:
        geom, _, _ = cargar()
    notas = []
    h5, fh, modo = abrir_h5(url, session=session)
    try:
        ident = leer_identificacion(h5)
        if FREQ_A not in h5:
            alts = _buscar_dataset(h5, {"HHHH"})
            return {
                "granule_id": granule_id, "collection": collection,
                "error": f"No se encontró {FREQ_A}",
                "hhhh_paths": alts,
                "modo_apertura": modo,
            }
        g = h5[FREQ_A]
        # CRS y coordenadas
        crs, proj_attrs = _crs_de_proyeccion(g["projection"])
        x = g["xCoordinates"][()]
        y = g["yCoordinates"][()]
        dx = float(x[1] - x[0]) if x.size > 1 else None
        dy = float(y[1] - y[0]) if y.size > 1 else None
        spacing_m = float(abs(dx)) if dx else None
        # atributos de normalización en HHHH
        hh_attrs = _attr_dict(g["HHHH"]) if "HHHH" in g else {}
        hv_attrs = _attr_dict(g["HVHV"]) if "HVHV" in g else {}
        units = hh_attrs.get("units") or hh_attrs.get("Units")
        long_name = hh_attrs.get("long_name") or hh_attrs.get("description")
        # Polígono a CRS de la malla
        to_grid = Transformer.from_crs("EPSG:4326", crs, always_xy=True)
        geom_grid = shp_transform(lambda xx, yy, z=None: to_grid.transform(xx, yy), geom)
        row0, row1, col0, col1 = ventana_indices(x, y, geom_grid.bounds)
        xw, yw = x[col0:col1], y[row0:row1]
        transform = Affine(dx, 0, float(xw[0]) - dx / 2.0, 0, dy, float(yw[0]) - dy / 2.0)
        inside = geometry_mask(
            [geom_grid], out_shape=(row1 - row0, col1 - col0),
            transform=transform, invert=True, all_touched=False,
        )
        # Lecturas de la ventana
        def win(name):
            if name not in g:
                return None
            return g[name][row0:row1, col0:col1]

        if "HHHH" not in g or "HVHV" not in g:
            return {
                "granule_id": granule_id, "collection": collection,
                "error": f"Faltan HHHH/HVHV en frequencyA: {list(g.keys())}",
                "modo_apertura": modo,
            }
        hh = np.asarray(win("HHHH"), dtype=np.float64)
        hv = np.asarray(win("HVHV"), dtype=np.float64)
        mask = win("mask")
        if mask is None:
            notas.append("El archivo no trae dataset mask; no se pudo filtrar layover/sombra ni inválidos de subswath.")
            valid_mask = np.ones(hh.shape, dtype=bool)
        else:
            mask = np.asarray(mask)
            valid_mask = np.isin(mask, list(MASK_VALIDOS))
            notas.append(
                "Máscara de muestras válidas GCOV (frequencyA/mask): "
                "válido = 1-5 (subswath); excluido 0 (inválido/parcialmente enfocado) y 255 (fill)."
            )
        # Excepciones / validez por polarización (inputDataExceptionMask)
        exc = win("inputDataExceptionMask")
        if exc is not None:
            exc = np.asarray(exc)
            # Operar en uint32: en productos provisionales la máscara puede ser
            # uint8 y NumPy 2 rechaza el AND con 256/512.
            exc_i = exc.astype(np.uint32, copy=False)
            BIT_SLIP, BIT_HH, BIT_HV, FILL16 = 2, 256, 512, 65535
            fill = 255 if np.nanmax(exc_i) <= 255 else FILL16
            ok_exc = (exc_i != fill) & ((exc_i & BIT_SLIP) == 0)
            if np.nanmax(exc_i) >= BIT_HH:
                ok_exc &= ((exc_i & BIT_HH) != 0) & ((exc_i & BIT_HV) != 0)
                notas.append(
                    f"Se aplicó inputDataExceptionMask (dtype={exc.dtype}): se exigen bits HH (256) y HV (512) "
                    "de muestra completamente enfocada, y se excluye el bit 2 (qFSP-H1 sample slip) y el fill."
                )
            else:
                notas.append(
                    f"inputDataExceptionMask es {exc.dtype} (máx={int(np.nanmax(exc_i))}); "
                    "no caben los bits 256/512 de validez HH/HV. Se excluyen fill y bit 2 (sample slip) si aparecen."
                )
            valid_mask &= ok_exc
        # Indicador de máscara de sombra en el procesamiento
        try:
            sm = h5["/science/LSAR/GCOV/metadata/processingInformation/parameters/shadowMaskingApplied"][()]
            if isinstance(sm, (bytes, np.bytes_)):
                sm = sm.decode("utf-8", "replace")
            notas.append(f"shadowMaskingApplied={sm} (el producto no trae capa layover/sombra; no se aplicó máscara de sombra en el procesamiento).")
        except Exception:
            pass
        # Layover/sombra independiente (solo en frequencyA; no se recorre todo el HDF5)
        lay_paths = [n for n in ("layoverShadowMask", "layover_shadow_mask", "shadowLayoverMask", "lsMap") if n in g]
        layover = None
        if "layoverShadowMask" in g:
            layover = np.asarray(win("layoverShadowMask"))
        if layover is not None:
            # Convención típica ISCE3: 0=no layover/shadow, valores >0 indican layover y/o sombra.
            # Se documenta la distribución encontrada.
            vals, cnts = np.unique(layover[inside], return_counts=True)
            notas.append(
                "Se aplicó layoverShadowMask; valores dentro del polígono: "
                + ", ".join(f"{int(v) if np.isfinite(v) else v}:{int(c)}" for v, c in zip(vals, cnts))
            )
            # Conservador: solo 0 se considera libre de layover/sombra si 0 está presente
            if 0 in vals or (np.asarray(vals) == 0).any():
                valid_mask &= (layover == 0)
            else:
                notas.append("layoverShadowMask no contiene 0 en la ventana; no se filtró por ella para no vaciar la muestra.")
        elif lay_paths:
            notas.append(f"Hay dataset de layover/sombra en {lay_paths} pero no se leyó en la malla frequencyA.")
        else:
            notas.append(
                "No hay capa independiente de layover/sombra en este producto; "
                "solo se usó la máscara de muestras válidas (mask)."
            )

        tiene_factor = "rtcGammaToSigmaFactor" in g
        factor = None
        if tiene_factor:
            factor = np.asarray(win("rtcGammaToSigmaFactor"), dtype=np.float64)
            fac_attrs = _attr_dict(g["rtcGammaToSigmaFactor"])
            notas.append(
                "Normalización nativa: gamma0 RTC (potencia). Convertido a sigma0 con "
                "sigma0 = gamma0 * rtcGammaToSigmaFactor (Shiroma 2026, JPL D-102274 Rev. F)."
            )
        else:
            fac_attrs = {}
            notas.append(
                "Normalización nativa: gamma0 RTC (potencia). El archivo NO trae "
                "rtcGammaToSigmaFactor; las estadísticas se reportan como gamma0, no sigma0."
            )

        # Validación radiométrica
        finito = np.isfinite(hh) & np.isfinite(hv) & (hh > 0) & (hv > 0)
        if factor is not None:
            finito &= np.isfinite(factor) & (factor > 0)
            hh_s = hh * factor
            hv_s = hv * factor
            normalizacion = "sigma0 (convertido desde gamma0 RTC con rtcGammaToSigmaFactor)"
            nativa = "gamma0_RTC"
        else:
            hh_s, hv_s = hh, hv
            normalizacion = "gamma0 RTC (sin factor gamma→sigma en el archivo)"
            nativa = "gamma0_RTC"

        valid = inside & valid_mask & finito
        n_poly = int(inside.sum())
        n_valid = int(valid.sum())
        hh_st = stats_lineal(hh_s, valid)
        hv_st = stats_lineal(hv_s, valid)
        # Razón HV/HH: media lineal de la razón por píxel y razón de medias
        ratio_px = np.full(hh_s.shape, np.nan, dtype=np.float64)
        ratio_px[valid] = hv_s[valid] / hh_s[valid]
        ratio_st = stats_lineal(ratio_px, valid)
        ratio_means = None
        if hh_st["mean_linear"] and hh_st["mean_linear"] > 0 and hv_st["mean_linear"] is not None:
            ratio_means = hv_st["mean_linear"] / hh_st["mean_linear"]

        # Metadatos de órbita
        def pick(*keys, default=None):
            for k in keys:
                if ident.get(k) not in (None, "", "None"):
                    return ident.get(k)
            return default

        t0 = pick("zeroDopplerStartTime", "startTime", "zeroDopplerStartTimeUTC")
        t1 = pick("zeroDopplerEndTime", "endTime", "zeroDopplerEndTimeUTC")
        dire = pick("orbitPassDirection", "passDirection", "orbitPass")
        track = pick("trackNumber", "relativeOrbitNumber", "relativeOrbit")
        frame = pick("frameNumber", "frame")
        pol = pick("listOfPolarizations", "listOfFrequenciesAPolarizations", "polarization")
        # a menudo listOfPolarizations está en frequencyA attrs o identification
        if pol is None and "listOfPolarizations" in g:
            try:
                pol = _texto(g["listOfPolarizations"][()])
            except Exception:
                pass
        for k in ("listOfPolarizations",):
            if k in g.attrs:
                pol = pol or _texto(g.attrs[k])

        rec = {
            "granule_id": granule_id,
            "collection": collection,
            "datetime_utc": _texto(t0),
            "datetime_end_utc": _texto(t1),
            "track": _escalar(track) if not isinstance(track, (list, str)) else track,
            "frame": _escalar(frame) if not isinstance(frame, (list, str)) else frame,
            "direction": _texto(dire),
            "polarization": pol,
            "frequency": "A",
            "crs": crs.to_string(),
            "epsg": crs.to_epsg(),
            "pixel_spacing_m": spacing_m,
            "units_nativas": units,
            "long_name_HHHH": long_name,
            "normalizacion_nativa": nativa,
            "normalizacion_reportada": normalizacion,
            "convertido_a_sigma0": bool(tiene_factor),
            "hhhh_attrs": {k: hh_attrs[k] for k in hh_attrs if k in (
                "units", "long_name", "description", "grid_mapping", "standard_name",
                "valid_min", "valid_max", "min_value", "max_value", "mean_value",
            )},
            "rtc_factor_attrs": {k: fac_attrs[k] for k in fac_attrs if k in (
                "units", "long_name", "description",
            )} if tiene_factor else None,
            "window": {"row0": row0, "row1": row1, "col0": col0, "col1": col1,
                       "ny": row1 - row0, "nx": col1 - col0},
            "n_pixeles_poligono": n_poly,
            "n_pixeles_validos": n_valid,
            "hh": hh_st,
            "hv": hv_st,
            "hv_hh_ratio_pixel": ratio_st,
            "hv_hh_ratio_de_medias_lineales": _escalar(ratio_means),
            "hv_hh_ratio_de_medias_db": (
                None if not ratio_means or ratio_means <= 0 else float(10 * np.log10(ratio_means))
            ),
            "quality_notes": notas,
            "modo_apertura": modo,
            "identification": {k: ident[k] for k in ident if k in (
                "zeroDopplerStartTime", "zeroDopplerEndTime", "orbitPassDirection",
                "trackNumber", "relativeOrbitNumber", "frameNumber", "absoluteOrbitNumber",
                "cycleNumber", "listOfPolarizations", "productType", "processingType",
                "isUrgentResponse", "lookDirection", "missionId", "compositeReleaseId",
                "productVersion", "diagnosticModeFlag", "isGeocoded",
            )},
                    }
        return rec
    except AuthError:
        raise
    except Exception as e:
        return {
            "granule_id": granule_id,
            "collection": collection,
            "error": f"{type(e).__name__}: {e}",
            "traceback": traceback.format_exc(),
            "modo_apertura": modo if "modo" in locals() else None,
        }
    finally:
        try:
            h5.close()
        except Exception:
            pass
        try:
            fh.close()
        except Exception:
            pass


def main(argv=None):
    import argparse
    p = argparse.ArgumentParser(description="Inspecciona o procesa un GCOV NISAR por rangos HTTP")
    p.add_argument("url")
    p.add_argument("--granule-id", default="")
    p.add_argument("--collection", default="")
    p.add_argument("--inspeccionar", action="store_true")
    p.add_argument("-o", "--out", default="")
    args = p.parse_args(argv)
    if args.inspeccionar:
        rep = inspeccionar(args.url, Path(args.out) if args.out else None)
        print(json.dumps({k: rep[k] for k in rep if k != "arbol_frequencyA"}, indent=2, default=str)[:8000])
        if "arbol_frequencyA" in rep:
            print("datasets:", [r["path"] for r in rep["arbol_frequencyA"] if r["kind"] == "dataset"])
    else:
        rec = procesar_granulo(args.url, args.granule_id, args.collection)
        text = json.dumps(rec, indent=2, default=str)
        print(text[:8000])
        if args.out:
            Path(args.out).write_text(text)


if __name__ == "__main__":
    main()
