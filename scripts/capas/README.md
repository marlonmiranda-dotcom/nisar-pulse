# Capas de bosque y agua — Reserva Colonso Chalupas

Script para volver a bajar y recortar los datos de las capas nuevas.
No hace falta usuario ni clave. No guarda contraseñas.

```bash
python3 -m pip install -r scripts/capas/requirements.txt
python3 scripts/capas/build_capas.py
```

Los GeoTIFF grandes quedan en `scripts/capas/cache/` (no se suben a git).
Lo que sí se sube:

| Archivo | Qué es |
| --- | --- |
| `src/data/capas_reserva.json` | Series y metadatos (pocos KB) |
| `src/data/rios_osm_colonso.geojson` | Ríos recortados a la reserva |
| `public/capas/perdida_bosque.png` | Mapa de bosque perdido (dibujo) |
| `public/capas/agua_jrc.png` | Mapa de ocurrencia de agua (dibujo) |
| `src/data/bosque_perdida.geojson` | Un punto por píxel de bosque perdido (2382) |
| `src/data/agua_ocurrencia.geojson` | Un punto por píxel con agua alguna vez (576) |

La recta de la predicción no se guarda en el JSON. Se calcula en el navegador, en `src/prediccion.js`, para que se pueda leer la fórmula.

## Datos que sí se bajaron (2026-11-14)

| Dato | Dirección | Licencia | Resolución | Pasos |
| --- | --- | --- | --- | --- |
| Hansen GFC v1.13, `lossyear` y `treecover2000`, tesela `00N_080W` | <https://storage.googleapis.com/earthenginepartners-hansen/GFC-2025-v1.13/download.html> | Uso libre citando a Hansen et al. 2013, *Science* 342:850–853 | 30 m | Recorte al polígono WDPA. Bosque en 2000 = cobertura ≥ 30 %. Pérdida = ese bosque y el año del píxel. Hectáreas = píxeles × área del píxel. |
| JRC Global Surface Water, clasificación anual 1984–2021, tesela `0000320000-0000400000` | <https://jeodpp.jrc.ec.europa.eu/ftp/jrc-opendata/GSWE/YearlyClassification/LATEST/tiles/> | Copernicus / JRC, uso libre con cita (Pekel et al. 2016, *Nature* 540:418–422) | 30 m | Clase 2 = agua estacional, clase 3 = permanente, clase 0 = sin observación (no se cuenta como tierra seca). |
| JRC Occurrence y Occurrence change intensity v1.4, tesela `80W_0N` | <https://storage.googleapis.com/global-surface-water/downloads2021/occurrence/occurrence_80W_0Nv1_4_2021.tif> y `.../change/change_80W_0Nv1_4_2021.tif` | La misma cita | 30 m | Occurrence 0–100 = % de observaciones con agua. En el change, bytes 1–200: cambio = byte − 100. Épocas: 1984–1999 y 2000–2021. |
| NDVI anual | Sale de `src/data/satellite_real.json` (MODIS MOD13C2 v061, ya descargado). DOI: <https://doi.org/10.5067/MODIS/MOD13C2.061> | NASA LP DAAC, citar el DOI | 0,05° | Promedio de los meses con dato. 2026 no tiene 12 meses: se dibuja y no entra en la recta. |
| Ríos y quebradas | OpenStreetMap vía <https://overpass-api.de/api/interpreter> | ODbL © colaboradores de OpenStreetMap. <https://www.openstreetmap.org/copyright> | Líneas dibujadas por personas | Consulta en la caja de la reserva y recorte al polígono. |

## Datos que no se pudieron bajar (en la app dicen «dato no disponible»)

| Dato | Por qué | Qué tiene que correr el equipo |
| --- | --- | --- |
| HydroRIVERS v1.0 (Sudamérica) | <https://data.hydrosheds.org/file/HydroRIVERS/HydroRIVERS_v10_sa_shp.zip> respondió HTTP 403 (Cloudflare). | Bajar el zip en una computadora donde el sitio abra, descomprimir y recortar al polígono. Licencia HydroSHEDS, 15 segundos de arco. |
| MapBiomas Ecuador | Las rutas públicas del GeoTIFF respondieron 403. | Exportar la cobertura desde <https://ecuador.mapbiomas.org/> o el toolkit de Google Earth Engine (hace falta una cuenta gratuita) y contar las hectáreas por clase. CC BY 4.0, 30 m. |
| NO2 Sentinel-5P TROPOMI | No se bajó una grilla verificada. | Producto OFFL L3 de Copernicus o Google Earth Engine. Resolución cerca de 5,5 km × 3,5 km. |
| NDWI Sentinel-2 | No se bajó una escena sin nubes. | Una escena L2A y la cuenta (verde − infrarrojo) / (verde + infrarrojo). 10 m. <https://planetarycomputer.microsoft.com/dataset/sentinel-2-l2a> |
| Contaminación del agua (minería o petróleo) | Estos satélites no miden químicos en el agua. No es un archivo pendiente: no hay un número que inventar. | Hace falta una muestra de agua en el terreno, no una capa de estos satélites. |
