#!/usr/bin/env python3
"""Agua superficial: OPERA DSWx-S1 (dinámica) y NISAR_WATERMASK (estática).

DSWx-S1 capa WTR (Product Spec D-108761 Rev. A):
  0  no agua (dato válido)
  1  agua abierta
  3  vegetación inundada
  250 HAND enmascarado (se excluye del denominador)
  251 layover/sombra (se excluye)
  255 relleno / sin dato (se excluye)

La fracción y el área se calculan dentro del polígono WDPA. Clases de agua:
1 y 3. No hay clase de nubes (el insumo es Sentinel-1 SAR).
"""
from __future__ import annotations

import json
import sys
from collections import defaultdict
from pathlib import Path

import numpy as np
import rasterio
from rasterio.features import geometry_mask
from rasterio.windows import from_bounds
from shapely.ops import transform as shp_transform
from pyproj import Transformer

sys.path.insert(0, str(Path(__file__).resolve().parent))
from earthdata_auth import resolve_url, new_session, AuthError, download_file
from poligono import cargar, area_km2

# Códigos oficiales WTR (D-108761 Rev. A)
WTR_NO_AGUA = 0
WTR_AGUA_ABIERTA = 1
WTR_VEG_INUNDADA = 3
WTR_HAND = 250
WTR_LAYOVER = 251
WTR_FILL = 255
CLASES_AGUA = {WTR_AGUA_ABIERTA, WTR_VEG_INUNDADA}
CLASES_VALIDAS = {WTR_NO_AGUA, WTR_AGUA_ABIERTA, WTR_VEG_INUNDADA}


def abrir_raster(url: str, session=None):
    """Abre un GeoTIFF (COG) remoto a través de una URL firmada."""
    sess = session or new_session()
    if url.startswith("s3://"):
        # rasterio no usa nuestras STS directamente; resolvemos vía HTTPS equivalente
        # o usamos /vsis3/ si las credenciales están en el entorno. Preferimos HTTPS.
        raise ValueError("Usar URL HTTPS para rasterio; s3 no se abre aquí.")
    signed = resolve_url(url, session=sess)
    ds = rasterio.open(signed)
    return ds, signed


def ventana_poligono(ds, geom_ll):
    """Lee la ventana que cubre el polígono y devuelve (array, transform, inside, px_m2)."""
    to_r = Transformer.from_crs("EPSG:4326", ds.crs, always_xy=True)
    geom = shp_transform(lambda x, y, z=None: to_r.transform(x, y), geom_ll)
    w = from_bounds(*geom.bounds, transform=ds.transform).round_offsets().round_lengths()
    # Si la ventana no intersecta el raster, queda vacía
    if w.width <= 0 or w.height <= 0:
        return None
    # recortar a los límites del dataset
    w = w.intersection(rasterio.windows.Window(0, 0, ds.width, ds.height))
    if w.width <= 0 or w.height <= 0:
        return None
    arr = ds.read(1, window=w)
    tr = ds.window_transform(w)
    inside = geometry_mask([geom], out_shape=arr.shape, transform=tr, invert=True, all_touched=False)
    # área de píxel en m² (en UTM es 30×30; en geográficas se estima por latitud media)
    if ds.crs and ds.crs.is_projected:
        px_m2 = abs(tr.a * tr.e)
    else:
        # grados → m, usando el centro de la ventana
        from rasterio.transform import xy as txy
        r, c = arr.shape[0] // 2, arr.shape[1] // 2
        lon, lat = txy(tr, r, c)
        import math
        m_per_deg_lat = 111_320.0
        m_per_deg_lon = 111_320.0 * math.cos(math.radians(lat))
        px_m2 = abs(tr.a * m_per_deg_lon * tr.e * m_per_deg_lat)
    return arr, tr, inside, float(px_m2), geom


def stats_wtr(arr, inside, px_m2):
    """Fracción y área de agua a partir de una capa WTR recortada."""
    pix = arr[inside]
    if pix.size == 0:
        return None
    # Distribución de clases (para auditoría)
    vals, cnts = np.unique(pix, return_counts=True)
    dist = {int(v): int(c) for v, c in zip(vals, cnts)}
    valid = np.isin(pix, list(CLASES_VALIDAS))
    agua = np.isin(pix, list(CLASES_AGUA))
    n_in = int(inside.sum())
    n_valid = int(valid.sum())
    n_agua = int((valid & agua).sum())
    n_abierta = int((pix == WTR_AGUA_ABIERTA).sum())
    n_veg = int((pix == WTR_VEG_INUNDADA).sum())
    frac = (n_agua / n_valid) if n_valid else None
    area = (n_agua * px_m2 / 1e6) if n_valid is not None else None
    area_valid = n_valid * px_m2 / 1e6
    return {
        "n_pixeles_poligono": n_in,
        "n_pixeles_validos": n_valid,
        "n_pixeles_agua": n_agua,
        "n_agua_abierta": n_abierta,
        "n_veg_inundada": n_veg,
        "fraccion_agua": frac,
        "area_agua_km2": area,
        "area_valida_km2": area_valid,
        "pixel_m2": px_m2,
        "clases_en_poligono": dist,
    }


def _tile_de_ur(ur: str):
    for p in ur.split("_"):
        if p.startswith("T") and len(p) == 6 and p[1:].isalnum():
            return p
    return None


def _proc_de_ur(ur: str):
    """Segundo timestamp (procesamiento) del nombre OPERA, o None."""
    parts = ur.split("_")
    ts = [p for p in parts if len(p) >= 16 and p[0:8].isdigit() and "T" in p]
    return ts[1] if len(ts) >= 2 else (ts[0] if ts else "")


def elegir_versiones(granulos):
    """Un gránulo por (tesela, fecha de observación): el de procesamiento más reciente."""
    best = {}
    for g in granulos:
        ur = g["umm"].get("GranuleUR") if "umm" in g else g.get("granule_ur")
        umm = g.get("umm") or g
        start = None
        if "umm" in g:
            from cmr_buscar import inicio
            start = inicio(g["umm"])
        else:
            start = g.get("start")
        fecha = (start or "")[:10]
        tile = _tile_de_ur(ur or "")
        proc = _proc_de_ur(ur or "")
        key = (tile, fecha)
        prev = best.get(key)
        if prev is None or proc > prev["proc"]:
            best[key] = {"g": g, "proc": proc, "tile": tile, "fecha": fecha, "ur": ur}
    return list(best.values())


def wtr_url(g):
    urls = []
    if "umm" in g:
        from cmr_buscar import urls_datos
        recs = urls_datos(g["umm"])
    else:
        recs = g.get("urls") or []
        recs = [{"type": u.get("type"), "url": u.get("url")} for u in recs]
    for r in recs:
        typ = (r.get("type") or "").upper()
        url = r.get("url") or ""
        if typ.startswith("GET DATA") and "DIRECT ACCESS" not in typ and url.endswith("B01_WTR.tif"):
            urls.append(url)
    return urls[0] if urls else None


def procesar_dswx(granulos, geom=None, session=None, teselas_ok=None, log=print, ckpt_path=None):
    """Serie temporal diaria de fracción/área de agua (teselas que intersectan el polígono)."""
    if geom is None:
        geom, _, _ = cargar()
    sess = session or new_session()
    elegidos = elegir_versiones(granulos)
    if teselas_ok:
        elegidos = [e for e in elegidos if e["tile"] in teselas_ok]
    # Agrupar por fecha
    por_fecha = defaultdict(list)
    for e in elegidos:
        por_fecha[e["fecha"]].append(e)
    series = []
    if ckpt_path and Path(ckpt_path).exists():
        try:
            series = json.loads(Path(ckpt_path).read_text())
            log(f"  reanudando DSWx, {len(series)} fechas ya calculadas")
        except Exception:
            series = []
    hechas = {r.get("date") for r in series}
    for fecha in sorted(por_fecha):
        if fecha in hechas:
            continue
        acc = []  # stats por tesela
        errores = []
        for e in por_fecha[fecha]:
            url = wtr_url(e["g"] if "umm" in e["g"] else e["g"])
            if not url:
                # inventario simplificado
                url = wtr_url(e["g"])
            if not url:
                errores.append({"tile": e["tile"], "error": "sin URL B01_WTR.tif"})
                continue
            try:
                ds, signed = abrir_raster(url, session=sess)
                try:
                    got = ventana_poligono(ds, geom)
                    if got is None:
                        acc.append({"tile": e["tile"], "n_pixeles_poligono": 0, "omitida": True})
                        continue
                    arr, tr, inside, px_m2, _ = got
                    if not inside.any():
                        acc.append({"tile": e["tile"], "n_pixeles_poligono": 0, "omitida": True})
                        continue
                    st = stats_wtr(arr, inside, px_m2)
                    st["tile"] = e["tile"]
                    st["granule_ur"] = e["ur"]
                    st["crs"] = str(ds.crs)
                    acc.append(st)
                finally:
                    ds.close()
            except AuthError as ex:
                raise
            except Exception as ex:
                errores.append({"tile": e["tile"], "url": url, "error": f"{type(ex).__name__}: {ex}"})
        # Combinar teselas (suma de píxeles; no deberían solaparse)
        usados = [s for s in acc if not s.get("omitida") and s.get("n_pixeles_validos", 0) is not None]
        if not usados:
            series.append({
                "date": fecha,
                "area_agua_km2": None,
                "fraccion_agua": None,
                "reason": "ninguna tesela con píxeles válidos en el polígono",
                "tiles": acc,
                "errores": errores or None,
            })
            log(f"  DSWx {fecha}: sin cobertura")
            continue
        n_agua = sum(s["n_pixeles_agua"] for s in usados)
        n_valid = sum(s["n_pixeles_validos"] for s in usados)
        area = sum(s["area_agua_km2"] for s in usados)
        rec = {
            "date": fecha,
            "area_agua_km2": area,
            "fraccion_agua": (n_agua / n_valid) if n_valid else None,
            "n_pixeles_agua": n_agua,
            "n_pixeles_validos": n_valid,
            "n_agua_abierta": sum(s["n_agua_abierta"] for s in usados),
            "n_veg_inundada": sum(s["n_veg_inundada"] for s in usados),
            "tiles": [s["tile"] for s in usados],
            "granulos": [s.get("granule_ur") for s in usados],
            "clases_en_poligono": _merge_dist(usados),
            "errores": errores or None,
        }
        series.append(rec)
        frac = rec["fraccion_agua"]
        area_s = "null" if area is None else f"{float(area):.4f}"
        frac_s = "null" if frac is None else f"{float(frac):.5f}"
        log(f"  DSWx {fecha}: {area_s} km2  frac={frac_s} tiles={rec['tiles']}")
        if ckpt_path is not None:
            Path(ckpt_path).write_text(json.dumps(series, default=str))
    return series


def _merge_dist(usados):
    d = defaultdict(int)
    for s in usados:
        for k, v in (s.get("clases_en_poligono") or {}).items():
            d[int(k)] += v
    return dict(d)


def procesar_watermask(urls_tif, geom=None, session=None, dest_dir: Path | None = None, log=print):
    """Área / leyenda de NISAR_WATERMASK (teselas 0.00025°, EPSG:4326) en el polígono.

    La leyenda oficial v0.5 (README) es una clasificación de *distancia a la orilla*,
    no un mapa binario de agua. Por eso area_agua_km2 queda en null.
    Las teselas se fusionan para no contar dos veces los bordes de 1°.
    """
    if geom is None:
        geom, _, _ = cargar()
    sess = session or new_session()
    # tmp/ en la raíz del repo (scripts/radar/../../tmp/watermask); no se versiona
    dest_dir = Path(dest_dir or (Path(__file__).resolve().parents[2] / "tmp" / "watermask"))
    dest_dir.mkdir(parents=True, exist_ok=True)
    paths = []
    for url in urls_tif:
        name = url.rstrip("/").split("/")[-1]
        dest = dest_dir / name
        if not dest.exists():
            download_file(url, dest, session=sess)
        paths.append(dest)
        log(f"  watermask tesela {name}")
    if not paths:
        return {"producto": "NISAR_WATERMASK", "area_agua_km2": None, "reason": "no hay teselas .tif"}

    from rasterio.merge import merge
    import math
    from rasterio.transform import xy as txy

    srcs = [rasterio.open(p) for p in paths]
    try:
        mosaic, tr = merge(srcs, nodata=255)
        crs = srcs[0].crs
    finally:
        for s in srcs:
            s.close()
    arr = mosaic[0]
    to_r = Transformer.from_crs("EPSG:4326", crs, always_xy=True)
    geom_r = shp_transform(lambda x, y, z=None: to_r.transform(x, y), geom)
    inside = geometry_mask([geom_r], out_shape=arr.shape, transform=tr, invert=True, all_touched=False)
    pix = arr[inside]
    vals, cnts = np.unique(pix, return_counts=True) if pix.size else (np.array([]), np.array([]))
    dist = {int(v): int(c) for v, c in zip(vals, cnts)}
    r, c = arr.shape[0] // 2, arr.shape[1] // 2
    lon, lat = txy(tr, r, c)
    px_m2 = abs(tr.a * 111320.0 * math.cos(math.radians(lat)) * tr.e * 111320.0)
    n_in = int(inside.sum())
    n_101 = int((pix == 101).sum()) if pix.size else 0
    reason = (
        "NISAR_WATERMASK v0.5 no es un mapa binario de superficie de agua: es una clasificación "
        "de distancia a la orilla (README v0.5). La clase 101 significa '0-1 km de la orilla de "
        "lago o río', no el pixel de agua propiamente dicho. Por eso el área de agua estática "
        "queda en null; se reporta el recuento de píxeles 101 como indicador de proximidad, "
        "no como superficie inundada."
    )
    log(f"  mosaico n_in={n_in} dist={dist} n_101={n_101}")
    return {
        "producto": "NISAR_WATERMASK",
        "version_teselas": "v0.5.0",
        "crs": "EPSG:4326",
        "resolucion": "0.00025° (~30 m)",
        "leyenda_oficial": {
            "0": "no agua / fondo",
            "1-100": "distancia a costa oceánica en bins de 1 km",
            "101-200": "distancia a orilla de agua interior (lago/río) en bins de 1 km (101 = 0-1 km)",
            "255": "NoData",
        },
        "fuente_leyenda": "https://nisar.asf.earthdatacloud.nasa.gov/NISAR/WATER_MASK/v0.5/EPSG4326/README.txt",
        "valores_encontrados_en_poligono": dist,
        "n_pixeles_poligono": n_in,
        "n_fondo_0": int((pix == 0).sum()) if pix.size else 0,
        "n_cerca_agua_interior_101": n_101,
        "n_nodata_255": int((pix == 255).sum()) if pix.size else 0,
        "area_pixeles_101_km2": n_101 * px_m2 / 1e6,
        "area_agua_km2": None,
        "fraccion_agua": None,
        "reason": reason,
        "pixel_m2": px_m2,
        "teselas": [p.name for p in paths],
        "mosaico": "fusión de teselas, sin doble conteo en los bordes",
    }
