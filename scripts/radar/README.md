# Radar cuantitativo — Colonso Chalupas (WDPA 555593903)

Estos scripts miden, dentro del polígono de la reserva, el retroceso del radar NISAR
(sigma0), el agua superficial de OPERA y la humedad del suelo SME2. El archivo
ya calculado está en `src/data/radar_real.json` (descargado el 2026-11-14).
No hace falta volver a ejecutarlos para leer esos números. Si los vuelves a
correr, `run_radar.py` sobrescribe ese JSON.

Los números salen de los productos de la NASA. Lo que no se puede calcular queda
en `null`; no se inventan valores.

## 1. Entorno

Desde esta carpeta (`scripts/radar`):

```bash
python -m venv .venv
.venv/bin/pip install h5py s3fs rasterio shapely pyproj numpy requests
```

Esos son los paquetes que los scripts importan. `s3fs` instala a su vez `fsspec`
y `aiohttp` (lectura de HDF5 en S3). Aquí no se usa `earthaccess`; esa librería
está en `scripts/earthdata/`.

En algunos Linux, `rasterio` pide las librerías de GDAL del sistema. Si `pip`
falla en ese paquete, instala GDAL con el gestor de paquetes y repite el `pip install`.

La carpeta `.venv` no se sube a git.

## 2. Acceso a Earthdata

Los scripts leen el token de la variable de entorno `EARTHDATA_TOKEN`. Si no
está, usan usuario y contraseña de `~/.netrc` para la máquina
`urs.earthdata.nasa.gov`. El secreto no se imprime, no se escribe a disco y no
entra en el JSON.

```bash
export EARTHDATA_TOKEN="tu-token"
```

o, en `~/.netrc` (permisos `chmod 600`):

```
machine urs.earthdata.nasa.gov login TU_USUARIO password TU_CLAVE
```

## 3. Ejecutar

El polígono es el mismo del resto del repositorio:
`../../src/data/colonso_wdpa.geojson` (relativo a `scripts/radar`).

```bash
cd scripts/radar
.venv/bin/python run_radar.py
```

Escribe `../../src/data/radar_real.json`. Los avances parciales van a `tmp/`
en la raíz del repositorio (checkpoints y teselas descargadas). Esa carpeta
tampoco se versiona. Cada escena GCOV o SME2 se lee por ventanas (S3 o HTTP Range);
no se descarga el HDF5 completo, pero el proceso igual tarda.

Si el JSON ya tiene el inventario `sme2.intersectan_poligono`, la serie de
humedad se puede recalcular sola:

```bash
.venv/bin/python procesar_sme2.py
```

Eso actualiza la clave de nivel superior `sme2_serie` en
`../../src/data/radar_real.json`.

## Qué hace cada archivo

- `run_radar.py` — busca las escenas en CMR, llama al resto y escribe el JSON.
- `procesar_gcov.py` — NISAR L2 GCOV. HHHH y HVHV vienen en gamma0 RTC; si el
  archivo trae `rtcGammaToSigmaFactor`, se pasa a sigma0
  (`sigma0 = gamma0 * factor`). La media se calcula en lineal y después se
  pasa a dB.
- `procesar_agua.py` — OPERA DSWx-S1 (capa WTR: agua = clases 1 y 3) y
  NISAR_WATERMASK (distancia a la orilla; el área de agua queda en null).
- `procesar_sme2.py` — intersección de huellas SME2 con el polígono (no con la
  caja) y serie de humedad del suelo (`grids/soilMoisture`, m³/m³, EASE-Grid 2.0
  / EPSG:6933), con estadísticas de píxeles válidos y de calidad recomendada.
- `cmr_buscar.py`, `h5_remoto.py`, `earthdata_auth.py`, `poligono.py` —
  búsqueda, lectura remota y polígono.

La serie SME2 queda en la clave de nivel superior `sme2_serie`. BETA se marca
como precalibrado. No hay colección VALIDATED ni `NISAR_L3_SME2_V1` en CMR
a 2026-11-14. La capa oficial no se fusiona con SMAP. Sirve como tendencia
relativa, no como humedad absoluta validada, y no se atribuye a El Niño.
