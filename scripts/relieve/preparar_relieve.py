#!/usr/bin/env python3
"""Recorta Copernicus DEM GLO-30 a Colonso Chalupas y calcula pendiente y sombreado.

Lee las teselas públicas (sin clave) del bucket AWS
s3://copernicus-dem-30m / https://copernicus-dem-30m.s3.eu-central-1.amazonaws.com/
Solo descarga la ventana que cubre la reserva, con un margen de 5 km.

No inventa alturas: si una tesela no se puede leer, el script se detiene
y no escribe los archivos de public/relieve/.

Uso (desde la raíz del repositorio):

    python3 scripts/relieve/preparar_relieve.py
"""

from __future__ import annotations

import hashlib
import json
import math
import os
import shutil
import subprocess
import sys
import urllib.request
from datetime import datetime, timezone
from pathlib import Path

# Antes de importar rasterio, para que GDAL no intente listar el bucket entero.
os.environ.setdefault("GDAL_DISABLE_READDIR_ON_OPEN", "EMPTY_DIR")
os.environ.setdefault("CPL_VSIL_CURL_ALLOWED_EXTENSIONS", ".tif")
os.environ.setdefault("GDAL_HTTP_MERGE_CONSECUTIVE_RANGES", "YES")
os.environ.setdefault("GDAL_HTTP_TIMEOUT", "120")
os.environ.setdefault("VSI_CACHE", "TRUE")

import numpy as np
import rasterio
from PIL import Image
from rasterio.transform import from_origin
from rasterio.windows import Window, from_bounds

RAIZ = Path(__file__).resolve().parents[2]
GEOJSON = RAIZ / "public" / "data" / "colonso-chalupas-wdpa-555593903.geojson"
SALIDA = RAIZ / "public" / "relieve"
CACHE = RAIZ / "scripts" / "relieve" / "cache"

WDPA_ID = 555593903
MARGEN_M = 5000.0
# 1 segundo de arco: es el paso de las teselas COG de GLO-30 (3600 x 3600 en 1°).
PASO_GRADOS = 1.0 / 3600.0
BUCKET = "https://copernicus-dem-30m.s3.eu-central-1.amazonaws.com"
README_BUCKET = f"{BUCKET}/readme.html"
COLECCION = "https://spacedata.copernicus.eu/en/web/guest/collections/copernicus-digital-elevation-model/"
LICENCIA_URL = f"{COLECCION}#Licencing"

# Aviso que pide la licencia del Copernicus DEM (DEM Product Handbook / condiciones
# enlazadas desde el README del bucket). Se muestra también en el globo.
ATRIBUCION = (
    "© DLR e.V. 2010-2014 and © Airbus Defence and Space GmbH 2014-2018 "
    "provided under COPERNICUS by the European Union and ESA; all rights reserved."
)

# Clases de visualización pedidas para la leyenda. No son un mapa de riesgo.
# Paleta ColorBrewer YlOrBr (solo para distinguir las clases).
CLASES = [
    {"desde": 0.0, "hasta": 10.0, "incluyeHasta": False, "nombre": "0–10", "hex": "#fff7bc", "rgb": (255, 247, 188)},
    {"desde": 10.0, "hasta": 20.0, "incluyeHasta": False, "nombre": "10–20", "hex": "#fec44f", "rgb": (254, 196, 79)},
    {"desde": 20.0, "hasta": 30.0, "incluyeHasta": False, "nombre": "20–30", "hex": "#fe9929", "rgb": (254, 153, 41)},
    {"desde": 30.0, "hasta": 45.0, "incluyeHasta": True, "nombre": "30–45", "hex": "#d95f0e", "rgb": (217, 95, 14)},
    {"desde": 45.0, "hasta": 90.0, "incluyeHasta": True, "nombre": "más de 45", "hex": "#993404", "rgb": (153, 52, 4)},
]

AZIMUT = 315.0
ALTITUD = 45.0
# WGS84 (el elipsoide del CRS de las teselas, EPSG:4326).
WGS84_A = 6378137.0
WGS84_E2 = 6.69437999014e-3


def abortar(mensaje: str) -> None:
    print(f"ERROR: {mensaje}", file=sys.stderr)
    print("No se escribieron productos en public/relieve/. No hay elevaciones de relleno.", file=sys.stderr)
    sys.exit(1)


def metros_por_grado(lat_grados: float) -> tuple[float, float]:
    """Metros por grado de longitud y de latitud sobre el elipsoide WGS84."""
    lat = math.radians(lat_grados)
    s2 = math.sin(lat) ** 2
    radio_n = WGS84_A / math.sqrt(1.0 - WGS84_E2 * s2)
    radio_m = WGS84_A * (1.0 - WGS84_E2) / (1.0 - WGS84_E2 * s2) ** 1.5
    return radio_n * math.cos(lat) * math.pi / 180.0, radio_m * math.pi / 180.0


def limites_del_poligono(ruta: Path) -> tuple[float, float, float, float]:
    if not ruta.is_file():
        abortar(f"No está el polígono WDPA: {ruta}")
    with ruta.open(encoding="utf-8") as fh:
        coleccion = json.load(fh)
    puntos: list[tuple[float, float]] = []

    def caminar(nodo: object) -> None:
        if isinstance(nodo, list):
            if len(nodo) >= 2 and isinstance(nodo[0], (int, float)) and isinstance(nodo[1], (int, float)):
                puntos.append((float(nodo[0]), float(nodo[1])))
            else:
                for hijo in nodo:
                    caminar(hijo)

    encontrado = False
    for feature in coleccion.get("features", []):
        props = feature.get("properties") or {}
        try:
            site = int(props.get("site_id"))
        except (TypeError, ValueError):
            continue
        if site != WDPA_ID:
            continue
        encontrado = True
        caminar((feature.get("geometry") or {}).get("coordinates"))
    if not encontrado or not puntos:
        abortar(f"El GeoJSON no trae el polígono con site_id {WDPA_ID}.")
    lons = [p[0] for p in puntos]
    lats = [p[1] for p in puntos]
    return min(lons), min(lats), max(lons), max(lats)


def nombre_tesela(lat_sur: int, lon_oeste: int) -> str:
    """Nombre de la tesela de 1° cuyo esquina suroeste es (lat_sur, lon_oeste)."""
    ns = "N" if lat_sur >= 0 else "S"
    ew = "E" if lon_oeste >= 0 else "W"
    return f"Copernicus_DSM_COG_10_{ns}{abs(lat_sur):02d}_00_{ew}{abs(lon_oeste):03d}_00_DEM"


def teselas_que_cubren(oeste: float, sur: float, este: float, norte: float) -> list[dict]:
    # Los centros de píxel caen en múltiplos de 1". El entero de la tesela es el
    # grado de la esquina suroeste (ver el README del bucket).
    lat0 = math.floor(sur + 1e-12)
    lat1 = math.floor(norte - 1e-12)
    lon0 = math.floor(oeste + 1e-12)
    lon1 = math.floor(este - 1e-12)
    salida = []
    for lat in range(lat0, lat1 + 1):
        for lon in range(lon0, lon1 + 1):
            nombre = nombre_tesela(lat, lon)
            url = f"{BUCKET}/{nombre}/{nombre}.tif"
            salida.append({"nombre": nombre, "url": url, "latSur": lat, "lonOeste": lon})
    if not salida:
        abortar("El rectángulo no cae en ninguna tesela de 1°.")
    return salida


def cabezera(url: str) -> dict[str, str]:
    req = urllib.request.Request(url, method="HEAD")
    try:
        with urllib.request.urlopen(req, timeout=60) as resp:
            if resp.status != 200:
                abortar(f"La tesela respondió HTTP {resp.status}: {url}")
            return {
                "lastModified": resp.headers.get("Last-Modified", ""),
                "contentLength": resp.headers.get("Content-Length", ""),
                "etag": resp.headers.get("ETag", "").strip('"'),
            }
    except Exception as exc:  # noqa: BLE001 — queremos el mensaje de red tal cual
        abortar(f"No se pudo consultar {url} ({exc}). No se inventan alturas.")
        raise


def indices_que_cubren(oeste: float, sur: float, este: float, norte: float) -> tuple[int, int, int, int]:
    """Índices enteros k=lon*3600, m=lat*3600 de los píxeles que tocan el rectángulo."""
    # El píxel k cubre [(k-0.5)/3600, (k+0.5)/3600].
    k_min = math.floor(oeste * 3600.0 - 0.5 + 1e-9) + 1
    k_max = math.ceil(este * 3600.0 + 0.5 - 1e-9) - 1
    m_min = math.floor(sur * 3600.0 - 0.5 + 1e-9) + 1
    m_max = math.ceil(norte * 3600.0 + 0.5 - 1e-9) - 1
    if k_max < k_min or m_max < m_min:
        abortar("El rectángulo de recorte quedó vacío al alinearlo a 1 segundo de arco.")
    return k_min, k_max, m_min, m_max


def leer_ventana(url: str, oeste: float, sur: float, este: float, norte: float) -> tuple[np.ndarray, object]:
    ruta = "/vsicurl/" + url
    with rasterio.open(ruta) as src:
        if src.crs is None or src.crs.to_epsg() != 4326:
            abortar(f"La tesela no está en EPSG:4326: {url} (crs={src.crs})")
        limites = src.bounds
        cruce_o = max(oeste, limites.left)
        cruce_s = max(sur, limites.bottom)
        cruce_e = min(este, limites.right)
        cruce_n = min(norte, limites.top)
        if cruce_e <= cruce_o or cruce_n <= cruce_s:
            return np.empty((0, 0), np.float32), None
        ventana = from_bounds(cruce_o, cruce_s, cruce_e, cruce_n, src.transform)
        ventana = ventana.intersection(Window(0, 0, src.width, src.height))
        # Redondeo hacia afuera para no dejar el borde del rectángulo sin píxel.
        col_off = math.floor(ventana.col_off + 1e-9)
        row_off = math.floor(ventana.row_off + 1e-9)
        col_fin = math.ceil(ventana.col_off + ventana.width - 1e-9)
        row_fin = math.ceil(ventana.row_off + ventana.height - 1e-9)
        col_off = max(0, col_off)
        row_off = max(0, row_off)
        col_fin = min(src.width, col_fin)
        row_fin = min(src.height, row_fin)
        if col_fin <= col_off or row_fin <= row_off:
            return np.empty((0, 0), np.float32), None
        ventana = Window(col_off, row_off, col_fin - col_off, row_fin - row_off)
        datos = src.read(1, window=ventana).astype(np.float32)
        transform = src.window_transform(ventana)
        return datos, transform


def volcar_en_mosaico(
    mosaico: np.ndarray,
    datos: np.ndarray,
    transform,
    k_min: int,
    m_max: int,
) -> None:
    if datos.size == 0:
        return
    alto, ancho = datos.shape
    columnas = np.arange(ancho, dtype=np.float64)
    filas = np.arange(alto, dtype=np.float64)
    lon = transform.c + (columnas + 0.5) * transform.a
    lat = transform.f + (filas + 0.5) * transform.e
    kk = np.rint(lon * 3600.0).astype(np.int32)
    mm = np.rint(lat * 3600.0).astype(np.int32)
    col_dest = kk - k_min
    row_dest = m_max - mm
    valid_c = (col_dest >= 0) & (col_dest < mosaico.shape[1])
    valid_r = (row_dest >= 0) & (row_dest < mosaico.shape[0])
    if not valid_c.any() or not valid_r.any():
        return
    mosaico[np.ix_(row_dest[valid_r], col_dest[valid_c])] = datos[np.ix_(valid_r, valid_c)]


def espaciado_metros(lat_centros: np.ndarray) -> tuple[np.ndarray, np.ndarray]:
    lat = np.deg2rad(lat_centros)
    s2 = np.sin(lat) ** 2
    radio_n = WGS84_A / np.sqrt(1.0 - WGS84_E2 * s2)
    radio_m = WGS84_A * (1.0 - WGS84_E2) / (1.0 - WGS84_E2 * s2) ** 1.5
    dx = radio_n * np.cos(lat) * math.radians(PASO_GRADOS)
    dy = radio_m * math.radians(PASO_GRADOS)
    return dx.astype(np.float64), dy.astype(np.float64)


def derivadas_horn(z: np.ndarray, dx: np.ndarray, dy: np.ndarray) -> tuple[np.ndarray, np.ndarray]:
    """Pendiente de Horn, la misma de gdaldem (ventana 3x3).

    z tiene una fila y una columna de más en cada borde (halo).
    dx, dy son el tamaño del píxel en metros, positivos, uno por fila de z.
    El eje Y de GDAL usa la resolución norte-sur con signo del geotransform
    (negativa si la fila 0 es el norte). Aquí se replica ese signo.
    """
    a = z[:-2, :-2]
    b = z[:-2, 1:-1]
    c = z[:-2, 2:]
    d = z[1:-1, :-2]
    f = z[1:-1, 2:]
    g = z[2:, :-2]
    h = z[2:, 1:-1]
    i = z[2:, 2:]
    dx_c = dx[1:-1][:, None]
    dy_c = dy[1:-1][:, None]
    vecinos = np.stack([a, b, c, d, f, g, h, i])
    invalido = ~np.isfinite(vecinos).all(axis=0) | ~np.isfinite(z[1:-1, 1:-1])
    x = ((a + 2.0 * d + g) - (c + 2.0 * f + i)) / (8.0 * dx_c)
    # nsres negativo: el norte está en la fila anterior.
    y = ((g + 2.0 * h + i) - (a + 2.0 * b + c)) / (8.0 * (-dy_c))
    x = np.where(invalido, np.nan, x)
    y = np.where(invalido, np.nan, y)
    return x, y


def sombreado_de(x: np.ndarray, y: np.ndarray) -> np.ndarray:
    """Hillshade 1–255 como gdaldem hillshade (azimut 315°, altitud 45°, z=1)."""
    alt = math.radians(ALTITUD)
    az = math.radians(AZIMUT)
    pendiente = np.arctan(np.hypot(x, y))
    aspecto = np.arctan2(y, x)
    cang = np.sin(alt) * np.cos(pendiente) + np.cos(alt) * np.sin(pendiente) * np.cos(az - math.pi / 2.0 - aspecto)
    sombra = np.where(cang <= 0.0, 1.0, 1.0 + 254.0 * cang)
    return sombra


def clasificar(pendiente: np.ndarray) -> tuple[np.ndarray, list[dict]]:
    """RGBA. Transparente donde no hay pendiente."""
    alto, ancho = pendiente.shape
    rgba = np.zeros((alto, ancho, 4), dtype=np.uint8)
    resumen = []
    total = int(np.isfinite(pendiente).sum())
    ya = np.zeros(pendiente.shape, dtype=bool)
    for clase in CLASES:
        if clase["incluyeHasta"]:
            if clase["nombre"].startswith("más"):
                mask = np.isfinite(pendiente) & (pendiente > clase["desde"]) & (pendiente <= clase["hasta"])
            else:
                mask = np.isfinite(pendiente) & (pendiente >= clase["desde"]) & (pendiente <= clase["hasta"]) & ~ya
        else:
            mask = np.isfinite(pendiente) & (pendiente >= clase["desde"]) & (pendiente < clase["hasta"]) & ~ya
        rgba[mask, 0] = clase["rgb"][0]
        rgba[mask, 1] = clase["rgb"][1]
        rgba[mask, 2] = clase["rgb"][2]
        rgba[mask, 3] = 255
        ya |= mask
        n = int(mask.sum())
        resumen.append({
            "clase": clase["nombre"],
            "desdeGrados": clase["desde"],
            "hastaGrados": clase["hasta"],
            "incluyeHasta": clase["incluyeHasta"],
            "hex": clase["hex"],
            "pixeles": n,
            "porcentaje": (100.0 * n / total) if total else None,
        })
    if int((np.isfinite(pendiente) & ~ya).sum()) != 0:
        abortar("Quedaron píxeles de pendiente fuera de las clases 0–10, 10–20, 20–30, 30–45 y más de 45.")
    return rgba, resumen


def sha256(ruta: Path) -> str:
    digest = hashlib.sha256()
    with ruta.open("rb") as fh:
        for bloque in iter(lambda: fh.read(1 << 20), b""):
            digest.update(bloque)
    return digest.hexdigest()


def comparar_con_gdaldem(
    dem_tif: Path,
    x_const: np.ndarray,
    y_const: np.ndarray,
    sombra_const: np.ndarray,
) -> dict:
    """Comprueba la fórmula contra gdaldem en el DEM real, con una escala constante.

    gdaldem solo acepta una escala para grados→metros. Esa comparación valida
    el método de Horn. El producto que se publica usa el espaciado WGS84 por fila,
    que gdaldem no puede expresar con un solo -s.
    """
    if shutil.which("gdaldem") is None:
        return {"disponible": False, "detalle": "dato no disponible. gdaldem no está instalado; no se comparó la fórmula."}

    cache = dem_tif.parent
    pendiente_tif = cache / "pendiente_gdaldem.tif"
    sombra_tif = cache / "sombreado_gdaldem.tif"
    # Escala única: metros por grado usados para construir x_const/y_const.
    # Se pasa por el nombre del archivo temporal de escala, leído abajo.
    escala = float(np.load(cache / "escala_constante.npy"))
    subprocess.run(
        ["gdaldem", "slope", str(dem_tif), str(pendiente_tif), "-s", f"{escala:.6f}", "-compute_edges", "-q"],
        check=True,
    )
    subprocess.run(
        [
            "gdaldem", "hillshade", str(dem_tif), str(sombra_tif),
            "-s", f"{escala:.6f}", "-az", str(AZIMUT), "-alt", str(ALTITUD), "-z", "1",
            "-compute_edges", "-q",
        ],
        check=True,
    )
    with rasterio.open(pendiente_tif) as src:
        oficial = src.read(1).astype(np.float64)
    with rasterio.open(sombra_tif) as src:
        sombra_oficial = src.read(1).astype(np.float64)

    nuestra = np.degrees(np.arctan(np.hypot(x_const, y_const)))
    if nuestra.shape != oficial.shape:
        abortar(f"gdaldem devolvió {oficial.shape} y el cálculo local es {nuestra.shape}.")
    # El borde de gdaldem -compute_edges no ve los píxeles reales de afuera del
    # recorte (el halo). Se comparan solo los píxeles interiores, donde los dos
    # métodos usan la misma ventana 3x3. El producto publicado sí usa el halo.
    diff = np.abs(nuestra[1:-1, 1:-1] - oficial[1:-1, 1:-1])
    diff_s = np.abs(sombra_const[1:-1, 1:-1] - sombra_oficial[1:-1, 1:-1])
    max_p = float(np.nanmax(diff))
    max_s = float(np.nanmax(diff_s))
    rmse = float(np.sqrt(np.nanmean(diff ** 2)))
    print(f"Comparación gdaldem, interior (escala constante {escala:.3f} m/°): pendiente máx {max_p:.4f}°, RMSE {rmse:.4f}°, sombreado máx {max_s:.2f}")
    if max_p > 0.01:
        abortar(f"La pendiente no coincide con gdaldem (diferencia máxima {max_p:.4f}°). No se publican archivos.")
    if max_s > 1.0:
        abortar(f"El sombreado no coincide con gdaldem (diferencia máxima {max_s:.2f}). No se publican archivos.")
    return {
        "disponible": True,
        "ambito": "píxeles interiores (sin el borde). El borde publicado usa el halo real de 1 píxel, que gdaldem no ve.",
        "escalaMetrosPorGrado": escala,
        "pendienteMaxAbsGrados": max_p,
        "pendienteRmseGrados": rmse,
        "sombreadoMaxAbs": max_s,
        "comandoPendiente": f"gdaldem slope dem.tif pendiente.tif -s {escala:.6f} -compute_edges",
        "comandoSombreado": f"gdaldem hillshade dem.tif sombreado.tif -s {escala:.6f} -az {AZIMUT} -alt {ALTITUD} -z 1 -compute_edges",
    }


def main() -> None:
    oeste_p, sur_p, este_p, norte_p = limites_del_poligono(GEOJSON)
    # El margen longitudinal se calcula en el borde con menos metros por grado
    # (el más alejado del ecuador) para que ningún lado quede por debajo de 5 km.
    lat_margen = sur_p if abs(sur_p) >= abs(norte_p) else norte_p
    m_lon, m_lat = metros_por_grado(lat_margen)
    dlon = MARGEN_M / m_lon
    dlat = MARGEN_M / m_lat
    oeste = oeste_p - dlon
    este = este_p + dlon
    sur = sur_p - dlat
    norte = norte_p + dlat
    print(f"Polígono WDPA {WDPA_ID}: lon {oeste_p:.5f}..{este_p:.5f}, lat {sur_p:.5f}..{norte_p:.5f}")
    print(f"Margen {MARGEN_M/1000:.0f} km → lon {oeste:.5f}..{este:.5f}, lat {sur:.5f}..{norte:.5f}")

    k_min, k_max, m_min, m_max = indices_que_cubren(oeste, sur, este, norte)
    # Halo de 1 píxel para que Horn tenga vecinos reales en el borde del margen.
    k0, k1 = k_min - 1, k_max + 1
    m0, m1 = m_min - 1, m_max + 1
    ancho_h = k1 - k0 + 1
    alto_h = m1 - m0 + 1
    print(f"Rejilla con halo: {ancho_h} x {alto_h} píxeles de 1\"")

    halo_oeste = (k0 - 0.5) / 3600.0
    halo_este = (k1 + 0.5) / 3600.0
    halo_sur = (m0 - 0.5) / 3600.0
    halo_norte = (m1 + 0.5) / 3600.0

    teselas = teselas_que_cubren(halo_oeste, halo_sur, halo_este, halo_norte)
    for tesela in teselas:
        info = cabezera(tesela["url"])
        tesela.update(info)
        print(f"  {tesela['nombre']}  {info['lastModified']}  {info['contentLength']} bytes")

    mosaico = np.full((alto_h, ancho_h), np.nan, dtype=np.float32)
    for tesela in teselas:
        print(f"Leyendo ventana de {tesela['nombre']} …")
        datos, transform = leer_ventana(tesela["url"], halo_oeste, halo_sur, halo_este, halo_norte)
        if datos.size == 0:
            abortar(f"La tesela {tesela['nombre']} no aportó píxeles al recorte.")
        finitos = np.isfinite(datos)
        if not finitos.any():
            abortar(f"La tesela {tesela['nombre']} no trae alturas finitas.")
        print(f"  ventana {datos.shape[1]}x{datos.shape[0]}  altura {float(datos[finitos].min()):.1f}–{float(datos[finitos].max()):.1f} m")
        volcar_en_mosaico(mosaico, datos, transform, k0, m1)

    if not np.isfinite(mosaico).all():
        vacios = int((~np.isfinite(mosaico)).sum())
        abortar(f"El mosaico tiene {vacios} píxeles sin altura. No se rellenan con valores inventados.")

    # Recorte publicado: sin el halo. La pendiente de esos píxeles ya usó vecinos reales.
    altura = mosaico[1:-1, 1:-1].astype(np.float64)
    alto, ancho = altura.shape
    lat_centros_halo = (np.arange(m1, m0 - 1, -1) / 3600.0).astype(np.float64)
    if lat_centros_halo.shape[0] != alto_h:
        abortar("Los índices de latitud no coinciden con el mosaico.")
    dx, dy = espaciado_metros(lat_centros_halo)
    x, y = derivadas_horn(mosaico.astype(np.float64), dx, dy)
    if x.shape != altura.shape:
        abortar("La pendiente no tiene el mismo tamaño que el recorte.")
    pendiente = np.degrees(np.arctan(np.hypot(x, y)))
    sombra = sombreado_de(x, y)

    if not np.isfinite(pendiente).all() or not np.isfinite(sombra).all():
        abortar("La pendiente o el sombreado tienen píxeles vacíos dentro del margen. No se rellenan.")

    h_min = float(altura.min())
    h_max = float(altura.max())
    if not (0.0 < h_min < 4500.0 and 200.0 < h_max < 6500.0 and (h_max - h_min) > 100.0):
        abortar(f"Las alturas {h_min:.1f}–{h_max:.1f} m no parecen un DEM de esta zona. No se publican.")
    if float(pendiente.max()) <= 1.0:
        abortar("La pendiente máxima es casi cero. El recorte no muestra relieve; no se publica.")

    redondeada = np.rint(altura)
    if redondeada.min() < 1 or redondeada.max() > 65534:
        abortar("Hay alturas que no caben en un entero de 16 bits (1–65534 m). No se recortan en silencio.")
    altura_u16 = redondeada.astype(np.uint16)

    # Comprobación contra gdaldem con escala constante (el producto usa dx/dy por fila).
    CACHE.mkdir(parents=True, exist_ok=True)
    lat_media = float((m_min + m_max) / 2.0 / 3600.0)
    m_por_lon, m_por_lat = metros_por_grado(lat_media)
    escala = (m_por_lon + m_por_lat) / 2.0
    dx_c = np.full(alto_h, PASO_GRADOS * escala)
    dy_c = np.full(alto_h, PASO_GRADOS * escala)
    x_c, y_c = derivadas_horn(mosaico.astype(np.float64), dx_c, dy_c)
    sombra_c = sombreado_de(x_c, y_c)
    oeste_out = (k_min - 0.5) / 3600.0
    norte_out = (m_max + 0.5) / 3600.0
    sur_out = (m_min - 0.5) / 3600.0
    este_out = (k_max + 0.5) / 3600.0
    dem_tif = CACHE / "dem_recorte.tif"
    transform = from_origin(oeste_out, norte_out, PASO_GRADOS, PASO_GRADOS)
    with rasterio.open(
        dem_tif, "w", driver="GTiff", height=alto, width=ancho, count=1,
        dtype="float32", crs="EPSG:4326", transform=transform, compress="deflate",
    ) as dst:
        dst.write(altura.astype(np.float32), 1)
    np.save(CACHE / "escala_constante.npy", np.array(escala))
    comparacion = comparar_con_gdaldem(dem_tif, x_c, y_c, sombra_c)

    rgba, resumen = clasificar(pendiente)
    sombra_u8 = np.clip(np.rint(sombra), 0, 255).astype(np.uint8)

    SALIDA.mkdir(parents=True, exist_ok=True)
    ruta_altura = SALIDA / "altura_u16.bin"
    ruta_sombra = SALIDA / "sombreado.png"
    ruta_pendiente = SALIDA / "pendiente.png"
    # Little-endian explícito: el navegador lee los bytes con DataView little-endian.
    ruta_altura.write_bytes(np.ascontiguousarray(altura_u16, dtype="<u2").tobytes())
    Image.fromarray(sombra_u8, mode="L").save(ruta_sombra, optimize=True, compress_level=9)
    Image.fromarray(rgba, mode="RGBA").save(ruta_pendiente, optimize=True, compress_level=9)

    dx_out, dy_out = espaciado_metros((np.arange(m_max, m_min - 1, -1) / 3600.0).astype(np.float64))
    fechas = sorted({t["lastModified"] for t in teselas})
    meta = {
        "wdpaId": WDPA_ID,
        "producto": "Copernicus DEM GLO-30 Public",
        "datasetOrigen": "COP-DEM_GLO-30-DGED",
        "fuenteUrl": README_BUCKET,
        "coleccionUrl": COLECCION,
        "licenciaUrl": LICENCIA_URL,
        "licencia": "Copernicus DEM: uso público gratuito, con la atribución obligatoria. Ver licenciaUrl.",
        "atribucion": ATRIBUCION,
        "referenciaVertical": "EGM2008 (alturas ortométricas del producto DGED). No es altura elipsoidal WGS84.",
        "crs": "EPSG:4326",
        "resolucionGrados": PASO_GRADOS,
        "resolucionMetrosLonMedia": float(dx_out.mean()),
        "resolucionMetrosLatMedia": float(dy_out.mean()),
        "unidadesAltura": "m",
        "unidadesPendiente": "grados",
        "fechaObjetosS3": fechas,
        "fechaProcesoUtc": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
        "margenKm": MARGEN_M / 1000.0,
        "margenNota": "5 km hacia afuera del rectángulo que encierra el polígono WDPA, no un buffer de cada vértice.",
        "bboxPoligono": {"oeste": oeste_p, "sur": sur_p, "este": este_p, "norte": norte_p},
        "bbox": {"oeste": oeste_out, "sur": sur_out, "este": este_out, "norte": norte_out},
        "ancho": int(ancho),
        "alto": int(alto),
        "alturaMinM": h_min,
        "alturaMaxM": h_max,
        "alturaMediaM": float(altura.mean()),
        "alturaEnteraMinM": int(altura_u16.min()),
        "alturaEnteraMaxM": int(altura_u16.max()),
        "alturaCodificacion": "uint16 little-endian, metros redondeados al entero más cercano (numpy rint). 0 = sin dato. Este recorte no usa el 0.",
        "pendienteMinGrados": float(pendiente.min()),
        "pendienteMaxGrados": float(pendiente.max()),
        "pendienteMediaGrados": float(pendiente.mean()),
        "clasesPendiente": resumen,
        "sombreado": {
            "azimutGrados": AZIMUT,
            "altitudGrados": ALTITUD,
            "metodo": "Horn, misma iluminación por defecto que gdaldem hillshade (z=1). El valor 1 es sombra y 255 es ladera iluminada.",
        },
        "pendienteMetodo": "Horn (como gdaldem slope). El tamaño del píxel en metros usa los radios de curvatura WGS84 de cada fila.",
        "comparacionGdaldem": comparacion,
        "archivos": {
            "altura": "altura_u16.bin",
            "sombreado": "sombreado.png",
            "pendiente": "pendiente.png",
        },
        "sha256": {
            "altura_u16.bin": sha256(ruta_altura),
            "sombreado.png": sha256(ruta_sombra),
            "pendiente.png": sha256(ruta_pendiente),
        },
        "bytes": {
            "altura_u16.bin": ruta_altura.stat().st_size,
            "sombreado.png": ruta_sombra.stat().st_size,
            "pendiente.png": ruta_pendiente.stat().st_size,
        },
        "teselas": [
            {
                "nombre": t["nombre"],
                "url": t["url"],
                "lastModified": t["lastModified"],
                "contentLength": int(t["contentLength"]) if str(t["contentLength"]).isdigit() else t["contentLength"],
                "etag": t["etag"],
            }
            for t in teselas
        ],
    }
    (SALIDA / "meta.json").write_text(json.dumps(meta, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    total = sum(meta["bytes"].values()) + (SALIDA / "meta.json").stat().st_size
    print(f"Altura {h_min:.0f}–{h_max:.0f} m (media {altura.mean():.0f})")
    print(f"Pendiente {pendiente.min():.2f}–{pendiente.max():.2f}° (media {pendiente.mean():.2f})")
    for clase in resumen:
        print(f"  {clase['clase']:>10}  {clase['pixeles']:8d} px  {clase['porcentaje']:.1f} %")
    print(f"Archivos en {SALIDA}  total {total/1e6:.2f} MB")
    for nombre, n in meta["bytes"].items():
        print(f"  {nombre:20} {n/1e6:.2f} MB")


if __name__ == "__main__":
    main()
