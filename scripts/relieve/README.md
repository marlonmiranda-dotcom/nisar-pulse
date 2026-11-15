# Relieve de Colonso Chalupas

Este script recorta el **Copernicus DEM GLO-30** a la Reserva Biológica
Colonso Chalupas (WDPA 555593903) y calcula la pendiente y el sombreado.
No hace falta cuenta, token ni Cesium ion.

Los archivos que usa el globo **ya están** en `public/relieve/`.
Solo vuelve a correr el script si quieres regenerarlos.

## Qué datos baja

Bucket público, sin credenciales:

`s3://copernicus-dem-30m`

en HTTPS:

<https://copernicus-dem-30m.s3.eu-central-1.amazonaws.com/readme.html>

El README de ese bucket dice que el origen es **COP-DEM_GLO-30-DGED**.
Cada tesela es un GeoTIFF de 1° × 1°, de 1 segundo de arco (~30 m),
con alturas en metros sobre el geoide **EGM2008**. Es un modelo de
superficie (DSM): incluye vegetación.

Para esta reserva el script usa cuatro teselas. La fecha de versión es
el `Last-Modified` que devuelve S3 (no se escribe a mano):

| Tesela | URL |
| --- | --- |
| `Copernicus_DSM_COG_10_S01_00_W078_00_DEM` | <https://copernicus-dem-30m.s3.eu-central-1.amazonaws.com/Copernicus_DSM_COG_10_S01_00_W078_00_DEM/Copernicus_DSM_COG_10_S01_00_W078_00_DEM.tif> |
| `Copernicus_DSM_COG_10_S01_00_W079_00_DEM` | <https://copernicus-dem-30m.s3.eu-central-1.amazonaws.com/Copernicus_DSM_COG_10_S01_00_W079_00_DEM/Copernicus_DSM_COG_10_S01_00_W079_00_DEM.tif> |
| `Copernicus_DSM_COG_10_S02_00_W078_00_DEM` | <https://copernicus-dem-30m.s3.eu-central-1.amazonaws.com/Copernicus_DSM_COG_10_S02_00_W078_00_DEM/Copernicus_DSM_COG_10_S02_00_W078_00_DEM.tif> |
| `Copernicus_DSM_COG_10_S02_00_W079_00_DEM` | <https://copernicus-dem-30m.s3.eu-central-1.amazonaws.com/Copernicus_DSM_COG_10_S02_00_W079_00_DEM/Copernicus_DSM_COG_10_S02_00_W079_00_DEM.tif> |

En la generación del 2026-11-15 las cuatro respondieron
`Last-Modified: Mon, 09 May 2022`. El script vuelve a leer esa fecha
cada vez que corre y la guarda en `public/relieve/meta.json`.

El polígono no se dibuja a ojo: se lee
`public/data/colonso-chalupas-wdpa-555593903.geojson` y se busca
`site_id` 555593903. El margen es de **5 km** hacia afuera del
rectángulo que encierra ese polígono (no es un buffer de cada vértice).
El paso de 5 km a grados usa los radios de curvatura del elipsoide WGS84.

## Qué calcula

1. Mosaico de las ventanas que cubren el margen, en la rejilla original
   de 1″. No rellena huecos: si falta un píxel, el script se detiene.
2. **Pendiente en grados** con el método de Horn (el de `gdaldem slope`).
   El tamaño del píxel en metros cambia con la latitud.
3. **Sombreado** con azimut 315° y altitud 45° (el valor por defecto de
   `gdaldem hillshade`). Sirve para ver el relieve. No es una foto.
4. Clases de la pendiente, solo para la leyenda: 0–10, 10–20, 20–30,
   30–45 (incluye 45) y más de 45 grados. No es un mapa de riesgo.

Si `gdaldem` está instalado, el script compara la fórmula (con una
escala constante, que es lo único que `gdaldem` acepta) contra el DEM
real. En la corrida del 2026-11-15 la diferencia interior fue de
0,0008° en la pendiente. El producto que se publica usa el espaciado
WGS84 de cada fila, que `gdaldem` no puede expresar con un solo `-s`.

No se genera un índice de susceptibilidad. No hay elevaciones sintéticas.
Si la descarga falla, no se escriben archivos en `public/relieve/`.

Otras fuentes abiertas, por si el bucket de Copernicus no responde:
NASADEM HGT (<https://e4ftl01.cr.usgs.gov/MEASURES/NASADEM_HGT.001/>,
pide cuenta Earthdata) o las teselas de terreno de AWS
(<https://registry.opendata.aws/terrain-tiles/>). Hay que cambiar el
script, citar la fuente nueva en `meta.json` y no mezclarla con esta.

## Cómo correrlo

Desde la raíz del repositorio, con Python 3.10 o más nuevo.

Ubuntu / Debian:

```bash
sudo apt install gdal-bin python3-rasterio python3-pil python3-numpy
python3 scripts/relieve/preparar_relieve.py
```

Con pip (hace falta que `pip` pueda instalar rasterio; en algunas
máquinas es más fácil el `apt` de arriba):

```bash
python3 -m pip install -r scripts/relieve/requirements.txt
python3 scripts/relieve/preparar_relieve.py
```

`gdal-bin` es opcional. Sin él el script igual genera los archivos y
en `meta.json` la comparación queda como **dato no disponible**.

Los GeoTIFF intermedios van a `scripts/relieve/cache/` (no se suben a git).

## Archivos que quedan en `public/relieve/`

| Archivo | Qué es |
| --- | --- |
| `altura_u16.bin` | Alturas en metros enteros, uint16 little-endian, fila 0 = norte. 0 = sin dato. |
| `sombreado.png` | Hillshade en escala de grises, mismo rectángulo. |
| `pendiente.png` | Pendiente coloreada por clases, con transparencia si no hay dato. |
| `meta.json` | Extensión geográfica, fuente, fechas, resolución y estadísticas. |

En la corrida del 2026-11-15 el total fue de unos **7,9 MB**.
El recorte mide 1673 × 1549 píxeles. Alturas del DEM (antes de
redondear al metro): 452,5 m a 4460,7 m. En el globo: 452 m a 4461 m.

## Verlo en la aplicación

```bash
npm ci
npm run dev
```

Abre <http://localhost:5173>. En el globo:

1. Pulsa **Ir a la reserva** (vista inclinada).
2. Mueve **Exageración vertical** entre 1× y 3×.
3. En el panel, enciende **Relieve sombreado** y **Pendiente (°)**.

Fuera del rectángulo el globo vuelve al elipsoide. La ficha
«Limitaciones del relieve» explica por qué este DEM no es un mapa de
riesgo y por qué no está la cartografía del MAE/SNAP ni del IGM.

## Licencia del DEM

Uso público gratuito, con esta atribución (la pide el programa Copernicus):

© DLR e.V. 2010-2014 and © Airbus Defence and Space GmbH 2014-2018 provided under COPERNICUS by the European Union and ESA; all rights reserved.

Ficha del producto:
<https://spacedata.copernicus.eu/en/web/guest/collections/copernicus-digital-elevation-model/>
