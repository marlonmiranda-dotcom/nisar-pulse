# Scripts de descarga de datos satelitales reales (NASA Earthdata)

Requisitos: `python -m venv .venv && .venv/bin/pip install earthaccess netCDF4 numpy shapely pyproj rasterio pillow`
y un `~/.netrc` con `machine urs.earthdata.nasa.gov login <usuario> password <clave>` (chmod 600).
Para IMERG hay que autorizar la app **NASA GESDISC DATA ARCHIVE** en el perfil Earthdata.

Ejecutar desde esta carpeta:

```bash
python fetch_ea.py GPM_3IMERGM  2016-01-01 2026-11-14 8      # lluvia mensual Final V07 (mm/h → mm/mes)
python fetch_ea.py GPM_3IMERGDL 2025-10-01 2026-11-13 12     # lluvia diaria Late V07 (meses sin Final)
python fetch_ea.py MOD13C2      2016-01-01 2026-11-14 8      # NDVI mensual 0,05°
python fetch_ea.py MOD11C3      2016-01-01 2026-11-14 8      # LST mensual 0,05°
python fetch_ea.py SPL3SMP_E    2016-01-01 2026-11-14 16 5   # SMAP 9 km, 1 de cada 5 días
python hansen.py                                             # Hansen GFC v1.13 (sin login, lectura por ventanas)
python crop.py                                               # recorta vistas previas NISAR GCOV (requiere nisar_all.json + PNG/KML de ASF)
python build_data.py                                         # genera ../../src/data/satellite_real.json
```

Todas las consultas usan subconjuntos OPeNDAP (Hyrax, Earthdata Cloud) sobre la caja de la reserva y
promedian los píxeles cuyo centro cae dentro del polígono WDPA 555593903. Los scripts reanudan si se cortan
(`part_<producto>.json`).
