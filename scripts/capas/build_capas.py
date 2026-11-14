#!/usr/bin/env python3
"""
Capas de la Reserva Biológica Colonso Chalupas (WDPA 555593903).

Este script baja datos abiertos, recorta la reserva y escribe archivos pequeños
para la app. No inventa números: si una descarga falla, esa capa queda como
"dato_no_disponible".

Uso (desde la raíz del repositorio):

    python3 -m pip install -r scripts/capas/requirements.txt
    python3 scripts/capas/build_capas.py

No hace falta usuario ni clave. Los GeoTIFF grandes se quedan en
scripts/capas/cache/ y no se suben a git.
"""

import json
import math
import subprocess
import urllib.request
from pathlib import Path

import numpy as np
import rasterio
from PIL import Image
from rasterio.features import geometry_mask
from rasterio.windows import Window
from rasterio.windows import from_bounds
from shapely.geometry import LineString, Polygon, mapping, shape

RAIZ = Path(__file__).resolve().parents[2]
CACHE = Path(__file__).resolve().parent / "cache"
GEOJSON_RESERVA = RAIZ / "src/data/colonso_wdpa.geojson"
SATELITE = RAIZ / "src/data/satellite_real.json"
SALIDA_JSON = RAIZ / "src/data/capas_reserva.json"
SALIDA_RIOS = RAIZ / "src/data/rios_osm_colonso.geojson"
PNG_BOSQUE = RAIZ / "public/capas/perdida_bosque.png"
PNG_AGUA = RAIZ / "public/capas/agua_jrc.png"
GEOJSON_BOSQUE = RAIZ / "src/data/bosque_perdida.geojson"
GEOJSON_AGUA = RAIZ / "src/data/agua_ocurrencia.geojson"

FECHA = "2026-11-14"
AGENTE = "NISAR-Pulse-estudiante/0.1 (proyecto educativo, Reserva Colonso Chalupas)"

# Tesela 10°×10° que cubre la reserva: de 80°O a 70°O y de 0° a 10°S.
# El nombre 0000320000-0000400000 es el código de esa tesela en el FTP del JRC.
TESELA_JRC = "0000320000-0000400000"
ANIOS_JRC = list(range(1984, 2022))

HANSEN_VER = "GFC-2025-v1.13"
HANSEN_BASE = f"https://storage.googleapis.com/earthenginepartners-hansen/{HANSEN_VER}"

# HydroRIVERS es la fuente que queríamos para los ríos. El sitio pone un
# desafío de Cloudflare y desde este entorno responde 403. El mapa usa
# OpenStreetMap, que sí se pudo volver a descargar. El enlace queda escrito
# para que el equipo lo baje en una computadora donde el sitio sí abra.
HYDRORIVERS_URL = "https://data.hydrosheds.org/file/HydroRIVERS/HydroRIVERS_v10_sa_shp.zip"

OVERPASS = "https://overpass-api.de/api/interpreter"
# Caja un poco más grande que la reserva. Después se recorta al polígono.
CONSULTA_OSM = """
[out:json][timeout:90];
(
  way["waterway"~"^(river|stream|canal)$"](-1.10,-78.28,-0.72,-77.85);
  way["natural"="water"](-1.10,-78.28,-0.72,-77.85);
);
out geom;
""".strip()

# Rutas públicas que probamos para MapBiomas Ecuador. Hoy responden 403
# (el cubo no deja leer el archivo sin cuenta). No hay números de MapBiomas
# en la app hasta que el equipo exporte el GeoTIFF y vuelva a correr el script.
MAPBIOMAS_PRUEBAS = [
    "https://storage.googleapis.com/mapbiomas-public/initiatives/ecuador/collection_3/lclu/coverage/ecuador_coverage_2023.tif",
    "https://storage.googleapis.com/mapbiomas-public/initiatives/ecuador/collection4/lulc/coverage/ecuador_coverage/ecuador_coverage-col4_2023.tif",
]


def correr(cmd):
    print("+", " ".join(cmd[:6]), "..." if len(cmd) > 6 else "")
    subprocess.run(cmd, check=True)


def tamano_remoto(url):
    """Lee Content-Length. Devuelve None si el servidor no lo dice."""
    req = urllib.request.Request(url, method="HEAD", headers={"User-Agent": AGENTE})
    try:
        with urllib.request.urlopen(req, timeout=90) as resp:
            largo = resp.headers.get("Content-Length")
            return int(largo) if largo else None
    except Exception as exc:
        print("  no pude leer el tamaño de", url, "→", exc)
        return None


def descargar(url, destino):
    destino.parent.mkdir(parents=True, exist_ok=True)
    # Si el archivo ya pesa más de 1 MB, se reutiliza. Así una segunda
    # corrida no vuelve a preguntar el tamaño de cada tesela.
    if destino.exists() and destino.stat().st_size > 1_000_000:
        print("  cache", destino.name)
        return destino
    esperado = tamano_remoto(url)
    if destino.exists() and destino.stat().st_size > 0:
        if esperado is None or destino.stat().st_size == esperado:
            print("  cache", destino.name)
            return destino
        print("  el archivo en cache no coincide, lo bajo de nuevo:", destino.name)
        destino.unlink()
    parcial = destino.with_suffix(destino.suffix + ".parcial")
    correr([
        "curl", "-L", "--fail", "--retry", "4", "--retry-delay", "3",
        "-A", AGENTE, "-o", str(parcial), url,
    ])
    parcial.replace(destino)
    return destino


def codigo_http(url):
    """Código HTTP real de curl. Así no confundimos un HTML de Cloudflare con un 200."""
    try:
        out = subprocess.run(
            ["curl", "-sI", "-o", "/dev/null", "-w", "%{http_code}", "-A", AGENTE, "--max-time", "30", "-L", url],
            check=False, capture_output=True, text=True,
        )
        return int((out.stdout or "0").strip() or "0")
    except Exception as exc:
        return str(exc)


def url_jrc(anio):
    # En 2021 el nombre lleva "_" ; en los otros años lleva "-".
    separador = "_" if anio == 2021 else "-"
    nombre = f"yearlyClassification{anio}{separador}{TESELA_JRC}.tif"
    return (
        "https://jeodpp.jrc.ec.europa.eu/ftp/jrc-opendata/GSWE/"
        f"YearlyClassification/LATEST/tiles/yearlyClassification{anio}/{nombre}"
    )


def ventana_de(ds, geom):
    minx, miny, maxx, maxy = geom.bounds
    ventana = from_bounds(minx, miny, maxx, maxy, ds.transform).round_offsets().round_lengths()
    # from_bounds a veces deja una fila de más. La recortamos al raster.
    col = max(0, int(ventana.col_off))
    fila = max(0, int(ventana.row_off))
    ancho = min(int(ventana.width), ds.width - col)
    alto = min(int(ventana.height), ds.height - fila)
    return Window(col, fila, ancho, alto)


def hectarea_de_pixel(geom):
    """Área aproximada de un píxel de 0,00025° en hectáreas.

    Es la misma cuenta que scripts/earthdata/hansen.py, para que los
    números de bosque coincidan con la serie que ya está en la app.
    """
    minx, miny, maxx, maxy = geom.bounds
    lat = (miny + maxy) / 2
    lado_x_m = 0.00025 * 111320 * math.cos(math.radians(lat))
    lado_y_m = 0.00025 * 111320
    return (lado_x_m * lado_y_m) / 1e4


def engordar(mascara, pasos):
    """Agranda una máscara unos pocos píxeles, solo para el dibujo del mapa.

    Las hectáreas se cuentan con el píxel original de 30 m. Sin este
    agrandado, un píxel suelto no se ve en el zoom inicial.
    """
    salida = mascara.copy()
    for _ in range(pasos):
        vecina = salida.copy()
        vecina[1:] |= salida[:-1]
        vecina[:-1] |= salida[1:]
        vecina[:, 1:] |= salida[:, :-1]
        vecina[:, :-1] |= salida[:, 1:]
        salida = vecina
    return salida


def bounds_de_ventana(transform, ventana):
    """[[sur, oeste], [norte, este]] en el orden que pide Leaflet."""
    tr = rasterio.windows.transform(ventana, transform)
    oeste = tr.c
    norte = tr.f
    este = oeste + tr.a * ventana.width
    sur = norte + tr.e * ventana.height
    return [[round(sur, 6), round(oeste, 6)], [round(norte, 6), round(este, 6)]]


def grupo_bosque(anio):
    if anio <= 2010:
        return "2001-2010"
    if anio <= 2018:
        return "2011-2018"
    return "2019-2025"


def puntos_geojson(filas, columnas, transform, propiedades, metadata):
    """Un punto por píxel, en el centro del píxel. El punto se dibuja grande
    en la pantalla para poder verlo; la coordenada sigue siendo la del píxel de 30 m.
    """
    features = []
    for fila, col, props in zip(filas, columnas, propiedades):
        x, y = transform * (float(col) + 0.5, float(fila) + 0.5)
        features.append({
            "type": "Feature",
            "properties": props,
            "geometry": {"type": "Point", "coordinates": [round(float(x), 5), round(float(y), 5)]},
        })
    return {"type": "FeatureCollection", "metadata": metadata, "features": features}


def redondear_coords(obj, decimales=5):
    if isinstance(obj, (list, tuple)):
        if obj and isinstance(obj[0], (int, float)):
            return [round(float(obj[0]), decimales), round(float(obj[1]), decimales)]
        return [redondear_coords(x, decimales) for x in obj]
    return obj


def partes_de(geom):
    if geom.is_empty:
        return []
    if geom.geom_type == "GeometryCollection":
        salida = []
        for parte in geom.geoms:
            salida.extend(partes_de(parte))
        return salida
    if geom.geom_type in ("LineString", "MultiLineString", "Polygon", "MultiPolygon"):
        return [geom]
    return []


def construir_rios(reserva):
    crudo = CACHE / "osm_agua.json"
    print("OpenStreetMap…")
    if not crudo.exists():
        correr([
            "curl", "-sS", "--fail", "--retry", "3", "-m", "120",
            "-A", AGENTE,
            "--data-urlencode", f"data={CONSULTA_OSM}",
            "-o", str(crudo),
            OVERPASS,
        ])
    datos = json.loads(crudo.read_text())
    elementos = datos["elements"]
    marcas = {
        "river": "río",
        "stream": "quebrada",
        "canal": "canal",
    }
    features = []
    for el in elementos:
        tags = el.get("tags") or {}
        puntos = [(p["lon"], p["lat"]) for p in el.get("geometry") or []]
        if len(puntos) < 2:
            continue
        if tags.get("natural") == "water" and len(puntos) >= 4:
            anillo = puntos if puntos[0] == puntos[-1] else puntos + [puntos[0]]
            geom = Polygon(anillo)
            tipo = "cuerpo de agua"
        else:
            geom = LineString(puntos)
            tipo = marcas.get(tags.get("waterway"), tags.get("waterway") or "vía de agua")
        if not geom.is_valid:
            geom = geom.buffer(0) if geom.geom_type == "Polygon" else geom
        recorte = geom.intersection(reserva)
        for parte in partes_de(recorte):
            if parte.geom_type.startswith("Line") and parte.length < 0.0003:
                continue
            if parte.geom_type.endswith("Polygon") and parte.area < 1e-8:
                continue
            features.append({
                "type": "Feature",
                "properties": {
                    "nombre": tags.get("name") or "Sin nombre",
                    "tipo": tipo,
                    "osm_id": el.get("id"),
                    "fuente": "OpenStreetMap",
                },
                "geometry": json.loads(json.dumps(redondear_coords(mapping(parte)))),
            })
    coleccion = {
        "type": "FeatureCollection",
        "metadata": {
            "fuente": "© OpenStreetMap contributors",
            "licencia": "ODbL 1.0",
            "url": "https://www.openstreetmap.org/copyright",
            "servicio": OVERPASS,
            "consulta": CONSULTA_OSM,
            "descargado": FECHA,
            "recorte": "Polígono WDPA 555593903 (Colonso Chalupas)",
            "nota": "Líneas y cuerpos dibujados por personas. Una quebrada muy chica puede estar en el mapa aunque el satélite de 30 m no vea el agua.",
        },
        "features": features,
    }
    SALIDA_RIOS.write_text(json.dumps(coleccion, ensure_ascii=False))
    conteo = {}
    for f in features:
        conteo[f["properties"]["tipo"]] = conteo.get(f["properties"]["tipo"], 0) + 1
    print("  tramos dentro de la reserva:", conteo)
    codigo_rios = codigo_http(HYDRORIVERS_URL)
    return {
        "estado": "ok",
        "producto": "OpenStreetMap: ríos, quebradas y cuerpos de agua",
        "url": "https://www.openstreetmap.org/copyright",
        "licencia": "ODbL 1.0 © colaboradores de OpenStreetMap",
        "resolucion": "Líneas dibujadas a mano. No es una grilla de 30 m.",
        "unidad": "tramos dentro de la reserva",
        "periodo": "mapa vivo, copia del " + FECHA,
        "descargado": FECHA,
        "consulta": CONSULTA_OSM,
        "en_la_caja": len(elementos),
        "dentro_de_la_reserva": conteo,
        "archivo": "src/data/rios_osm_colonso.geojson",
        "hydrorivers": {
            "estado": "dato_no_disponible",
            "producto": "HydroSHEDS HydroRIVERS v1.0 (Sudamérica)",
            "url": HYDRORIVERS_URL,
            "ficha": "https://www.hydrosheds.org/products/hydrorivers",
            "licencia": "Licencia HydroSHEDS: uso libre con atribución",
            "resolucion": "15 segundos de arco (unos 450 m). Solo ríos con cuenca de al menos 10 km² o caudal de 0,1 m³/s.",
            "codigo_http": codigo_rios,
            "motivo": f"No se guardó el zip de HydroRIVERS. La descarga respondió HTTP {codigo_rios} (el sitio pone un desafío de Cloudflare). Sin ese archivo no dibujamos esos ríos.",
            "que_debe_correr_el_equipo": "Bajar el zip en una computadora donde el sitio abra, descomprimirlo y recortar el shapefile al polígono de la reserva. El enlace está en este bloque.",
        },
    }


def construir_bosque(reserva, px_ha):
    print("Hansen GFC…")
    perdida_tif = descargar(
        f"{HANSEN_BASE}/Hansen_{HANSEN_VER}_lossyear_00N_080W.tif",
        CACHE / "hansen_lossyear.tif",
    )
    cobertura_tif = descargar(
        f"{HANSEN_BASE}/Hansen_{HANSEN_VER}_treecover2000_00N_080W.tif",
        CACHE / "hansen_treecover2000.tif",
    )
    with rasterio.open(perdida_tif) as ds_p, rasterio.open(cobertura_tif) as ds_c:
        ventana = ventana_de(ds_p, reserva)
        perdida = ds_p.read(1, window=ventana)
        cobertura = ds_c.read(1, window=ventana)
        transform = ds_p.window_transform(ventana)
        bounds = bounds_de_ventana(ds_p.transform, ventana)
    dentro = geometry_mask([mapping(reserva)], out_shape=perdida.shape, transform=transform, invert=True)
    bosque = dentro & (cobertura >= 30)
    serie = []
    for codigo in range(1, 26):
        ha = float((bosque & (perdida == codigo)).sum() * px_ha)
        serie.append({"anio": 2000 + codigo, "ha": round(ha, 2)})
    total = round(sum(f["ha"] for f in serie), 2)
    bosque_ha = round(float(bosque.sum() * px_ha), 2)

    # Comprobación: la app ya tenía esta serie, hecha con el mismo método.
    anterior = json.loads(SATELITE.read_text())["hansen"]
    diferencia = abs(total - anterior["total_loss_ha"])
    print(f"  pérdida {total} ha (archivo anterior {anterior['total_loss_ha']} ha, diferencia {diferencia:.2f})")
    if diferencia > 1:
        raise SystemExit("La nueva cuenta de Hansen no coincide con satellite_real.json. No escribo números.")

    imagen = np.zeros((perdida.shape[0], perdida.shape[1], 4), dtype=np.uint8)
    # Tres colores. Se agrandan 3 píxeles (~90 m) solo en el dibujo.
    imagen[engordar((bosque) & (perdida >= 1) & (perdida <= 10), 3)] = (250, 204, 21, 220)
    imagen[engordar((bosque) & (perdida >= 11) & (perdida <= 18), 3)] = (249, 115, 22, 230)
    imagen[engordar((bosque) & (perdida >= 19), 3)] = (239, 68, 68, 240)
    PNG_BOSQUE.parent.mkdir(parents=True, exist_ok=True)
    Image.fromarray(imagen, "RGBA").save(PNG_BOSQUE)

    # Puntos para el mapa interactivo: un punto = un píxel perdido.
    mascara = bosque & (perdida >= 1)
    filas, columnas = np.where(mascara)
    anios = 2000 + perdida[filas, columnas].astype(int)
    props = [{"anio": int(a), "grupo": grupo_bosque(int(a))} for a in anios]
    coleccion = puntos_geojson(filas, columnas, transform, props, {
        "fuente": "Hansen GFC v1.13 lossyear, píxeles de bosque (cobertura ≥ 30 % en 2000) dentro de WDPA 555593903",
        "resolucion": "30 m",
        "nota": "Cada punto es el centro de un píxel de 30 m. En la pantalla el círculo se dibuja más grande para poder verlo.",
        "descargado": FECHA,
    })
    GEOJSON_BOSQUE.write_text(json.dumps(coleccion, ensure_ascii=False))
    print("  puntos de bosque perdido:", len(coleccion["features"]))

    return {
        "estado": "ok",
        "producto": "Hansen/UMD/Google/USGS/NASA Global Forest Change v1.13",
        "cita": "Hansen, M. C. et al. (2013), Science 342: 850–853. Datos GFC-2025-v1.13.",
        "url": f"{HANSEN_BASE}/download.html",
        "licencia": "Uso libre citando a Hansen et al. 2013 y la versión del dato.",
        "resolucion": "30 m (Landsat)",
        "unidad": "ha/año",
        "periodo": "Pérdida 2001–2025. El bosque de partida es el año 2000, cobertura ≥ 30 %.",
        "descargado": FECHA,
        "version": HANSEN_VER,
        "bosque_2000_ha": bosque_ha,
        "total_perdida_ha": total,
        "pixel_ha": px_ha,
        "serie": serie,
        "png": "capas/perdida_bosque.png",
        "bounds": bounds,
        "colores": {
            "2001-2010": "amarillo",
            "2011-2018": "naranja",
            "2019-2025": "rojo",
        },
        "pasos": [
            "Se leyeron lossyear y treecover2000 de la tesela 00N_080W.",
            "Se recortó la ventana del polígono WDPA 555593903.",
            "Bosque en 2000 = píxel dentro de la reserva y cobertura ≥ 30 %.",
            "Pérdida de un año = ese bosque y lossyear igual al año (1 = 2001 … 25 = 2025).",
            "Hectáreas = número de píxeles × área del píxel a la latitud de la reserva.",
            "El mapa pinta esos píxeles: amarillo 2001–2010, naranja 2011–2018, rojo 2019–2025. Cada mancha se agranda 3 píxeles (~90 m) para poder verla. Las hectáreas no usan ese agrandado.",
        ],
    }


def construir_agua(reserva, px_ha, area_ha):
    print("JRC Global Surface Water…")
    dentro = None
    transform = None
    bounds = None
    forma = None
    anios_con_agua = None
    serie = []
    for anio in ANIOS_JRC:
        url = url_jrc(anio)
        tif = CACHE / f"jrc_{anio}.tif"
        descargar(url, tif)
        with rasterio.open(tif) as ds:
            if dentro is None:
                ventana = ventana_de(ds, reserva)
                transform = ds.window_transform(ventana)
                bounds = bounds_de_ventana(ds.transform, ventana)
                dentro = geometry_mask([mapping(reserva)], out_shape=(ventana.height, ventana.width), transform=transform, invert=True)
                forma = dentro.shape
                anios_con_agua = np.zeros(forma, dtype=np.uint8)
            valores = ds.read(1, window=ventana)
        if valores.shape != forma:
            raise SystemExit(f"La ventana de {anio} cambió de tamaño. Me detengo para no mezclar grillas.")
        observados = dentro & (valores > 0)
        estacional = dentro & (valores == 2)
        permanente = dentro & (valores == 3)
        anios_con_agua += (estacional | permanente).astype(np.uint8)
        ha_e = float(estacional.sum() * px_ha)
        ha_p = float(permanente.sum() * px_ha)
        pct_obs = 100.0 * float(observados.sum()) / float(dentro.sum())
        serie.append({
            "anio": anio,
            "ha_estacional": round(ha_e, 2),
            "ha_permanente": round(ha_p, 2),
            "ha_total": round(ha_e + ha_p, 2),
            "pct_reserva": round(100.0 * (ha_e + ha_p) / area_ha, 4),
            "pct_observado": round(pct_obs, 2),
            # Un año entra en la recta solo si Landsat miró casi toda la reserva.
            "entra_en_recta": pct_obs >= 80,
        })
        print(f"  {anio}: {ha_e + ha_p:.1f} ha de agua, observado {pct_obs:.0f} %")

    # El mapa usa la ocurrencia oficial (0–100 %), no la suma de años.
    # La suma anual queda solo para el gráfico, con un aviso: casi todo el
    # píxel de cada año es "sin observación".
    ocurrencia, cambio = resumen_oficial(reserva, px_ha, forma, transform, bounds)
    imagen = np.zeros(forma + (4,), dtype=np.uint8)
    occ = ocurrencia.pop("_raster")
    # Solo se pinta el interior del polígono. Las esquinas de la caja no entran.
    occ = occ.copy()
    occ[~dentro] = 0
    hay = (occ > 0) & (occ <= 100)
    parte = np.zeros(forma, dtype=np.float32)
    parte[hay] = occ[hay] / 100.0
    # El dibujo PNG se agranda. Los puntos del GeoJSON usan la máscara original.
    mascara_agua = hay
    hay = engordar(hay, 2)
    imagen[hay, 0] = 30
    imagen[hay, 1] = np.clip(150 + 90 * parte[hay], 0, 255).astype(np.uint8)
    imagen[hay, 2] = 245
    imagen[hay, 3] = np.clip(140 + 100 * np.maximum(parte[hay], 0.35), 0, 255).astype(np.uint8)
    Image.fromarray(imagen, "RGBA").save(PNG_AGUA)
    filas_agua, columnas_agua = np.where(mascara_agua)
    props_agua = [{"ocurrencia": int(occ[r, c])} for r, c in zip(filas_agua, columnas_agua)]
    coleccion_agua = puntos_geojson(filas_agua, columnas_agua, transform, props_agua, {
        "fuente": "JRC Global Surface Water Occurrence v1.4, píxeles con agua alguna vez (ocurrencia ≥ 1) dentro de la reserva",
        "resolucion": "30 m",
        "unidad": "% de observaciones con agua",
        "periodo": "1984–2021",
        "nota": "Cada punto es el centro de un píxel de 30 m. El círculo en pantalla es más grande que el píxel.",
        "descargado": FECHA,
    })
    GEOJSON_AGUA.write_text(json.dumps(coleccion_agua, ensure_ascii=False))
    print("  puntos de agua:", len(coleccion_agua["features"]))

    return {
        "estado": "ok",
        "producto": "JRC Global Surface Water, clasificación anual (colección hasta 2021)",
        "cita": "Pekel, J.-F., Cottam, A., Gorelick, N. y Belward, A. S. (2016), Nature 540: 418–422. doi:10.1038/nature20584",
        "url": "https://global-surface-water.appspot.com/download",
        "ftp": "https://jeodpp.jrc.ec.europa.eu/ftp/jrc-opendata/GSWE/YearlyClassification/LATEST/tiles/",
        "licencia": "Copernicus / Comisión Europea (JRC). Uso libre con atribución.",
        "resolucion": "30 m (Landsat)",
        "unidad": "ha de agua en el año (estacional + permanente)",
        "periodo": "1984–2021",
        "descargado": FECHA,
        "tesela": TESELA_JRC,
        "clases": {"0": "sin observación", "1": "no es agua", "2": "agua estacional", "3": "agua permanente"},
        "serie": serie,
        "png": "capas/agua_jrc.png",
        "bounds": bounds,
        "permite_recta": False,
        "motivo_sin_recta": (
            "No proyectamos estas hectáreas. Casi todos los píxeles de cada año están en 'sin observación' "
            "(nubes). El número es solo el agua que sí se pudo marcar. Una recta hacia el futuro parecería "
            "que hay más agua, pero puede ser que haya más fotos. El cambio entre dos épocas sí está medido "
            "en el producto oficial y se muestra aparte, sin alargarlo al futuro."
        ),
        "nota_30m": "Un estanque o una quebrada más angostos que unos 30 m pueden no aparecer en esta mancha azul.",
        "ocurrencia": ocurrencia,
        "cambio_epocas": cambio,
        "pasos": [
            "Se bajó la clasificación anual de la tesela 0000320000-0000400000 (80°O–70°O, 0°–10°S), años 1984 a 2021.",
            "Se recortó la misma ventana del polígono de la reserva.",
            "Clase 2 = agua estacional. Clase 3 = agua permanente. Clase 0 = sin observación: no se cuenta como tierra seca.",
            "Hectáreas = píxeles de clase 2 o 3 dentro de la reserva × área del píxel.",
            "El mapa azul sale del producto Occurrence (porcentaje de meses con agua, 1984–2021). El azul es más fuerte si el agua estuvo presente más a menudo.",
            "No se traza una recta con las hectáreas anuales: la observación de cada año es casi nula.",
        ],
    }


def recortar(path, reserva):
    with rasterio.open(path) as ds:
        ventana = ventana_de(ds, reserva)
        valores = ds.read(1, window=ventana)
        transform = ds.window_transform(ventana)
        bounds = bounds_de_ventana(ds.transform, ventana)
    dentro = geometry_mask([mapping(reserva)], out_shape=valores.shape, transform=transform, invert=True)
    return valores, dentro, bounds


def resumen_oficial(reserva, px_ha, forma, transform, bounds):
    """Occurrence y change de JRC GSW v1.4 (1984–2021), tesela 80W_0N.

    Occurrence: 0–100 = % de observaciones con agua. 255 = sin dato.
    Change (byte):
      253 = nunca hubo agua
      0 y 254 = no se pudo calcular
      1–200 = cambio entre épocas, en puntos porcentuales: valor − 100
              (negativo = menos agua, positivo = más agua)
    Épocas del producto v1.4: 1984–1999 y 2000–2021.
    """
    print("JRC occurrence y change…")
    base = "https://storage.googleapis.com/global-surface-water/downloads2021"
    occ_path = descargar(f"{base}/occurrence/occurrence_80W_0Nv1_4_2021.tif", CACHE / "occurrence_80W_0N.tif")
    chg_path = descargar(f"{base}/change/change_80W_0Nv1_4_2021.tif", CACHE / "change_80W_0N.tif")
    occ, dentro, _ = recortar(occ_path, reserva)
    chg, dentro2, _ = recortar(chg_path, reserva)
    if occ.shape != forma or not np.array_equal(dentro, geometry_mask([mapping(reserva)], out_shape=forma, transform=transform, invert=True)):
        # La máscara se rehace igual. Si la grilla no coincide, paramos.
        if occ.shape != forma:
            raise SystemExit("La grilla de occurrence no coincide con la clasificación anual.")
    v = occ[dentro]
    agua = (v > 0) & (v <= 100)
    ha = lambda n: round(float(n) * px_ha, 2)
    ocurrencia = {
        "producto": "JRC Global Surface Water, Occurrence v1.4 (1984–2021)",
        "url": "https://global-surface-water.appspot.com/download",
        "archivo": "occurrence_80W_0Nv1_4_2021.tif",
        "resolucion": "30 m",
        "unidad": "% de observaciones en las que el píxel fue agua",
        "periodo": "1984–2021",
        "ha_alguna_vez": ha(agua.sum()),
        "ha_al_menos_50": ha(((v >= 50) & (v <= 100)).sum()),
        "ocurrencia_media_en_pixeles_con_agua": round(float(v[agua].mean()), 1) if agua.any() else None,
        "ocurrencia_maxima": int(v[v <= 100].max()) if np.any(v <= 100) else None,
        "pasos": [
            "Se leyó occurrence_80W_0Nv1_4_2021.tif (de 80°O a 70°O y de 0° a 10°S).",
            "0–100 = porcentaje. No hubo píxeles 255 (sin dato) dentro de la reserva.",
            "Hectáreas = píxeles con ocurrencia ≥ 1 × área del píxel.",
        ],
    }
    c = chg[dentro2]
    medible = (c >= 1) & (c <= 200)
    firmado = c[medible].astype(np.int16) - 100
    cambio = {
        "producto": "JRC Global Surface Water, Occurrence change intensity v1.4",
        "url": "https://global-surface-water.appspot.com/download",
        "archivo": "change_80W_0Nv1_4_2021.tif",
        "resolucion": "30 m",
        "unidad": "puntos porcentuales de ocurrencia (valor del archivo − 100)",
        "epocas": "1984–1999 comparado con 2000–2021",
        "ha_mas_agua": ha((firmado > 0).sum()),
        "ha_menos_agua": ha((firmado < 0).sum()),
        "ha_igual": ha((firmado == 0).sum()),
        "ha_no_calculable": ha(((c == 0) | (c == 254)).sum()),
        "cambio_medio_puntos": round(float(firmado.mean()), 1) if firmado.size else None,
        "nota": "253 = nunca hubo agua (casi toda la reserva). 0 y 254 = no se pudo calcular. Solo se promedian los píxeles 1–200.",
        "pasos": [
            "Se leyó change_80W_0Nv1_4_2021.tif, misma ventana de la reserva.",
            "En los bytes 1 a 200, el cambio es el byte menos 100.",
            "No se alarga este cambio hacia el futuro: es la diferencia entre dos épocas ya cerradas.",
        ],
    }
    # El raster se usa para pintar y no se guarda en el JSON.
    ocurrencia["_raster"] = occ
    return ocurrencia, cambio


def construir_ndvi():
    """El NDVI mensual ya está en satellite_real.json (MODIS, descarga real).

    Aquí solo se promedia por año. No se crean meses que falten.
    """
    print("NDVI anual a partir de MODIS ya descargado…")
    sat = json.loads(SATELITE.read_text())
    por_anio = {}
    for ym, fila in sat["monthly"].items():
        if fila.get("ndvi") is None:
            continue
        por_anio.setdefault(ym[:4], []).append(fila["ndvi"])
    serie = []
    for anio in sorted(por_anio):
        valores = por_anio[anio]
        serie.append({
            "anio": int(anio),
            "ndvi": round(sum(valores) / len(valores), 4),
            "meses": len(valores),
            # Un año incompleto se dibuja, pero no entra en la recta.
            "entra_en_recta": len(valores) == 12,
        })
    meta = sat["metadata"]["fuentes"]["ndvi"]
    return {
        "estado": "ok",
        "producto": meta["producto"],
        "url": meta["url"],
        "via": meta["via"],
        "licencia": "Datos NASA LP DAAC. Uso libre citando el DOI.",
        "resolucion": meta["res"],
        "unidad": "NDVI medio del año (sin unidad, de −1 a 1)",
        "periodo": f"{serie[0]['anio']}–{serie[-1]['anio']}",
        "descargado": sat["metadata"]["descargado"],
        "serie": serie,
        "pasos": [
            "Se partió de los promedios mensuales ya guardados en src/data/satellite_real.json.",
            "Esos promedios son de MODIS MOD13C2 v061, píxeles de 0,05° cuyo centro cae en la reserva (script scripts/earthdata/).",
            "El NDVI del año es el promedio de los meses que sí tienen número.",
            "2026 no tiene los 12 meses, así que se muestra en el gráfico y no se usa para la recta.",
        ],
    }


def no_disponibles(rios):
    pruebas = [{"url": url, "codigo_http": codigo_http(url)} for url in MAPBIOMAS_PRUEBAS]
    return [
        {
            "id": "contaminacion_agua",
            "titulo": "Contaminación del agua (minería o petróleo)",
            "estado": "dato_no_disponible",
            "motivo": "Los satélites de esta app (Landsat, MODIS, NISAR) no miden químicos en el agua. No hay un número que mostrar y no lo inventamos.",
        },
        {
            "id": "mapbiomas",
            "titulo": "Cobertura del suelo MapBiomas Ecuador",
            "estado": "dato_no_disponible",
            "motivo": "Las direcciones públicas del GeoTIFF respondieron 403. Sin el archivo no hay hectáreas por clase.",
            "url": "https://ecuador.mapbiomas.org/",
            "licencia": "CC BY 4.0 cuando se descarga desde MapBiomas",
            "resolucion": "30 m",
            "pruebas": pruebas,
            "que_debe_correr_el_equipo": "Entrar a https://ecuador.mapbiomas.org/ (o al toolkit de Google Earth Engine, hace falta una cuenta gratuita), exportar la cobertura anual recortada a la reserva y volver a calcular las hectáreas por clase. No rellenar a mano.",
        },
        {
            "id": "no2",
            "titulo": "Dióxido de nitrógeno (Sentinel-5P TROPOMI)",
            "estado": "dato_no_disponible",
            "motivo": "No descargamos una grilla verificada de NO2 sobre la reserva. El producto existe, pero es muy grueso (unos 5,5 km × 3,5 km) y aquí no hay un número real.",
            "url": "https://developers.google.com/earth-engine/datasets/catalog/COPERNICUS_S5P_OFFL_L3_NO2",
            "resolucion": "cerca de 5,5 km × 3,5 km",
            "que_debe_correr_el_equipo": "Bajar el NO2 troposférico de Sentinel-5P (Copernicus, producto OFFL L3) para la caja de la reserva y promediar los píxeles. Hace falta una cuenta de Copernicus o de Google Earth Engine.",
        },
        {
            "id": "ndwi",
            "titulo": "Agua por NDWI (Sentinel-2)",
            "estado": "dato_no_disponible",
            "motivo": "No bajamos una escena Sentinel-2 sin nubes de la reserva, así que no hay un NDWI calculado.",
            "url": "https://planetarycomputer.microsoft.com/dataset/sentinel-2-l2a",
            "resolucion": "10 m",
            "que_debe_correr_el_equipo": "Elegir una escena Sentinel-2 L2A con pocas nubes, calcular NDWI = (verde − infrarrojo cercano) / (verde + infrarrojo cercano) y promediar dentro del polígono.",
        },
        {
            "id": "hydrorivers",
            "titulo": "Ríos HydroRIVERS",
            "estado": "dato_no_disponible",
            "motivo": rios["hydrorivers"]["motivo"],
            "url": HYDRORIVERS_URL,
            "que_debe_correr_el_equipo": rios["hydrorivers"]["que_debe_correr_el_equipo"],
        },
    ]


def main():
    CACHE.mkdir(parents=True, exist_ok=True)
    reserva = shape(json.loads(GEOJSON_RESERVA.read_text())["features"][0]["geometry"])
    px_ha = hectarea_de_pixel(reserva)
    # Área con la misma grilla, para el porcentaje de agua.
    with rasterio.open(descargar(
        f"{HANSEN_BASE}/Hansen_{HANSEN_VER}_lossyear_00N_080W.tif",
        CACHE / "hansen_lossyear.tif",
    )) as ds:
        ventana = ventana_de(ds, reserva)
        transform = ds.window_transform(ventana)
        dentro = geometry_mask([mapping(reserva)], out_shape=(ventana.height, ventana.width), transform=transform, invert=True)
    area_ha = float(dentro.sum() * px_ha)

    bosque = construir_bosque(reserva, px_ha)
    agua = construir_agua(reserva, px_ha, area_ha)
    ndvi = construir_ndvi()
    rios = construir_rios(reserva)

    salida = {
        "generado": FECHA,
        "reserva": {
            "nombre": "Reserva Biológica Colonso Chalupas",
            "wdpa": 555593903,
            "area_ha": round(area_ha, 1),
            "bbox": [round(v, 5) for v in reserva.bounds],
        },
        "bosque": bosque,
        "ndvi": ndvi,
        "agua_superficial": agua,
        "rios": rios,
        "no_disponibles": no_disponibles(rios),
        "prediccion": {
            "metodo": "Recta de mínimos cuadrados sobre los años históricos, más una banda del 95 %.",
            "anios_hacia_adelante": 5,
            "donde_esta_la_cuenta": "src/prediccion.js",
            "aviso": "Es una predicción del equipo a partir de la serie citada. Puede cambiar cuando lleguen años nuevos. No dice cuál es la causa del cambio.",
        },
    }
    SALIDA_JSON.write_text(json.dumps(salida, ensure_ascii=False, indent=1))
    print("Listo:", SALIDA_JSON)


if __name__ == "__main__":
    main()
