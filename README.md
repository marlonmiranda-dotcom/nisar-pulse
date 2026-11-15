# 🛰️ NISAR Pulse — Visualizador Accesible de Ritmos de la Tierra

### El Niño en la Reserva Colonso Chalupas

Aplicación web Open Source (hackathon) que traduce datos satelitales de la NASA (radar NISAR Banda L, GPM IMERG,
MODIS, SMAP, Landsat/Hansen) y el índice ENSO de NOAA en una herramienta comprensible para ciudadanía, docentes,
gestores y científicos, centrada en la **Reserva Biológica Colonso Chalupas** (Napo, Ecuador, WDPA 555593903).

> **100 % datos reales, sin simulación.** Todas las series y capas provienen de satélites (NASA Earthdata,
> Landsat) más el índice ONI de NOAA CPC, descargados el **2026-11-14**. Cualquier variable sin dato satelital
> suficiente se oculta automáticamente; nunca se rellena con valores simulados.

## ✨ Funcionalidades

- **Mapa interactivo** (Leaflet) con imagen óptica Esri y el límite oficial WDPA de la reserva.
- **Comparador de radar NISAR real** (cortina o doble opacidad): 21 adquisiciones NISAR L2 GCOV (Banda L, doble
  polarización HH/HV) entre el 19-jun-2026 y el 29-oct-2026, en dos geometrías (ascendente track 76 y
  descendente track 11, revisita de 12 días). Son las vistas previas oficiales del ASF DAAC recortadas a la reserva.
- **Capa NASA GIBS que sigue la línea de tiempo**: NDVI mensual MODIS, LST mensual MODIS o color verdadero MODIS.
- **Línea de tiempo de 12 meses** (Oct 2025 → Sep 2026) con Play/Pausa: actualiza semáforos, capa GIBS y gráficos.
- **Panel El Niño** con fases *Histórico 2016–2026*, *Actual* y *Predicción (5 años, Oct 2026 → Dic 2031)*:
  ONI vs lluvia (IMERG), verdor (NDVI), calor de la superficie (LST) y humedad del suelo (SMAP); correlación de Pearson con
  desfase óptimo (0–6 meses), valor p, regresión `anomalía(t) = a + b·ONI(t − lag)` y escenarios ENSO
  (meses 1–5 = perspectiva NOAA CPC con El Niño fuerte hasta EFM 2027; después El Niño recurrente / Neutral / La Niña)
  con banda de incertidumbre del 95 % que se ensancha con el tiempo.
- **Pérdida de bosque anual 2001–2025** (Hansen GFC v1.13) y **calendario de adquisiciones NISAR**.
- **Selector de perfil**:
  - *Ciudadano / Educativo*: semáforos, lenguaje sencillo y escenarios explicados como posibilidades, no certezas.
  - *Científico / Gestor*: productos, resolución, r, p, lag, RMSE, metadatos de gránulos NISAR (enlaces a HDF5,
    vista previa y reporte QA) y exportación **CSV** (series, gránulos, escenarios) y **GeoJSON**.
- Cada gráfico e indicador muestra su **fuente y fecha de descarga**.
- Enlace profundo: `?modo=cientifico&comparar=opacidad&fase=prediccion&escenario=lanina&variable=precip&a=2026-06-26_D011&b=2026-10-24_D011&gibs=ndvi`

## 🧰 Stack

Vite 5 · React 18 · TypeScript (solo el globo; el resto sigue en JavaScript) · Tailwind CSS 3 · lucide-react · CesiumJS 1.147 · Leaflet 1.9 + react-leaflet 4 · Recharts 2.
La vista 2D sigue en `src/App.jsx`. El globo 3D está en `src/globe/`. Los datos reales están en `src/data/` y `public/nisar/`.

## Globo 3D

El botón **Globo 3D / Mapa 2D (detalle)** cambia entre Cesium y el mapa Leaflet.
`?vista=2d` abre directo el mapa.

```bash
cp .env.example .env          # opcional: pega ahí VITE_CESIUM_ION_TOKEN
npm run dev                   # http://localhost:5173
```

- **Sin token** el globo usa imágenes Esri (las mismas del mapa 2D) y NASA GIBS.
  El relieve dice **dato no disponible** y se queda en el elipsoide. No se inventan alturas.
- **Con token** de [Cesium ion](https://cesium.com/ion/tokens) se activa Cesium World Terrain,
  marcado como **Capa de visualización (fuente externa)**. La exageración vertical solo estira ese modelo.
- El límite es el GeoJSON WDPA 555593903 en `public/data/`. Si no carga, dice **dato no disponible**
  y no dibuja otra forma. Cómo obtenerlo: `public/data/README.md`.
- Las capas (IMERG, LST, NDVI, nubes, SMAP) son teselas públicas de NASA GIBS comprobadas
  el 2026-11-14 contra el GetCapabilities. No son un análisis del equipo.
  Estaciones y NISAR en el globo quedan en **dato no disponible** hasta que haya un archivo o un WMTS real.
- Para sumar una capa: `src/globe/COMO-AGREGAR-CAPAS.md`.

### Por qué TypeScript no reemplazó `App.jsx`

`App.jsx` concentra el mapa Leaflet, los gráficos y las series ya probadas.
Pasarlo entero a TypeScript de un golpe podía romper esa vista. `tsconfig.json`
tiene `allowJs` y `checkJs: false`: el JavaScript sigue compilando, y el globo
nuevo está en `.ts` / `.tsx`. `npm run typecheck` revisa solo esa parte.

## 🚀 Instalación

Requisitos: Node.js ≥ 18 (probado con Node 24 y npm 11).

```bash
git clone https://github.com/<tu-usuario>/nisar-pulse.git
cd nisar-pulse
npm install
npm run dev        # http://localhost:5173
npm run build      # genera dist/
npm run preview    # sirve dist/ en http://localhost:4173
```

Crear el proyecto desde cero (equivalente):

```bash
npm create vite@5 nisar-pulse -- --template react
cd nisar-pulse
npm install react@18 react-dom@18 leaflet@^1.9.4 react-leaflet@4 recharts@2 lucide-react
npm install -D vite@5 @vitejs/plugin-react@4 tailwindcss@3 postcss autoprefixer
npx tailwindcss init -p
```

## 📊 Datos reales y fuentes

Todos los valores son medias sobre el polígono WDPA 555593903, tomando los píxeles cuyo centro cae dentro de la reserva.

| Variable | Producto (satélite) | Acceso | Resolución | Periodo en la app |
| --- | --- | --- | --- | --- |
| Radar | **NISAR L2 GCOV** (PROVISIONAL_V1 y V1), Banda L, HH/HV | ASF DAAC, NASA CMR (vistas previas públicas) | ~170 m (vista previa) | 19-jun → 29-oct-2026 (21 escenas) |
| Lluvia | **GPM IMERG V07**: Final mensual `GPM_3IMERGM` (Ene 2016 → Sep 2025) + Late diario `GPM_3IMERGDL` sumado por mes (Oct 2025 → Oct 2026) | NASA GES DISC, Earthdata Cloud OPeNDAP | 0,1° | Ene 2016 → Oct 2026 |
| Verdor | **MODIS/Terra MOD13C2 v061**, NDVI mensual (fiabilidad 0–1) | NASA LP DAAC, OPeNDAP | 0,05° | Ene 2016 → Oct 2026 |
| Calor de la superficie | **MODIS/Terra MOD11C3 v061**, LST diurna mensual | NASA LP DAAC, OPeNDAP | 0,05° | Ene 2016 → Oct 2026 |
| Humedad del suelo | **SMAP SPL3SMP_E v006**, pasadas AM y PM, 1 de cada 5 días | NASA NSIDC DAAC, OPeNDAP | 9 km | Ene 2016 → Nov 2026 |
| Pérdida de bosque | **Hansen/UMD GFC 2025 v1.13** (Landsat), cobertura ≥ 30 % | Google Cloud Storage público | 30 m | 2001 → 2025 |
| El Niño | **NOAA CPC ONI** (ERSSTv5) y Niño 1+2 (OISST) | cpc.ncep.noaa.gov | índice | Ene 2016 → ASO 2026 |
| Comparación (solo modo científico) | CHIRPS v2.0, satélite + estaciones | NASA SERVIR ClimateSERV | 0,05° | Ene 2016 → Sep 2026 |

Archivos: `src/data/satellite_real.json` (IMERG, MODIS, SMAP, Hansen, catálogo NISAR), `src/data/enso_real.json`
(ONI, Niño 1+2, CHIRPS), `src/data/colonso_wdpa.geojson`, `public/nisar/*.webp`. Para regenerarlos se usan
`scripts/earthdata/` (earthaccess + Earthdata Login).

### Hallazgos con los datos reales (2016–2026)

- **Calor de la superficie (MODIS LST)**: es la única señal ENSO significativa, r = +0,25 con 5 meses de desfase (p ≈ 0,004).
- **Lluvia (IMERG)**: relación débil con el ONI, r = −0,17 con 4 meses de desfase (p ≈ 0,05, b ≈ −14 mm/mes por °C).
  En El Niño 2023-24 la anomalía fue de −24 mm/mes; en el El Niño 2026 (May–Sep) IMERG Late marca +53 mm/mes,
  mientras CHIRPS marca −93 mm/mes. **Los sensores no coinciden.**
- **NDVI**: estable, alrededor de 0,80 (el bosque denso satura el índice); sin señal ENSO significativa.
- **SMAP**: r = −0,15 (p ≈ 0,09); −2,5 puntos de humedad en May–Sep 2026.
- **Bosque**: 87.031 ha de bosque en 2000 y 184,5 ha perdidas entre 2001 y 2025 (0,21 %).
- **Área**: el polígono calculado mide 93.535 ha (oficial: 93.246 ha).

### Advertencias

- IMERG desde Oct 2025 es la versión *Late* (sin ajuste con pluviómetros); la Final llega con ~3,5 meses de
  retraso. En los Andes orientales, IMERG suele subestimar la lluvia frente a CHIRPS (media anual 2.463 vs 3.097 mm).
- SMAP: ningún píxel de la reserva tiene la marca de calidad "recomendada" (bosque denso, contenido de agua
  en la vegetación > 5 kg/m²). Úsese solo como indicador relativo.
- MODIS a 0,05° cubre unos 30 píxeles en la reserva; LST y NDVI usan solo píxeles de cielo despejado o de buena fiabilidad.
- NISAR: las imágenes del comparador son vistas previas RGB (cualitativas). No es σ⁰ calibrado: para eso hay que
  descargar el HDF5 GCOV y usar `loadGeoTIFF()`. Los productos GUNW (InSAR) y L3 SME2 (humedad NISAR) aún no tienen
  gránulos sobre la reserva en CMR (2026-11-14), por eso no se muestran desplazamiento ni humedad NISAR. Comparar
  fechas de un mismo track da cambios reales; comparar tracks distintos muestra diferencias de geometría.
- Escenarios a 5 años: son trayectorias plausibles del ONI combinadas con la regresión observada, **no pronósticos**.
  Como la relación ONI–lluvia es débil, sus bandas son anchas.

## 🔌 Cómo conectar más URLs de NISAR / Sentinel-1

Todo se configura en el bloque **`CONFIG`** al inicio de `src/App.jsx` (los números de línea se verifican con `rg -n`):

| Línea | Clave / función | Uso |
| --- | --- | --- |
| 93 | `NASA_GIBS_WMTS_TEMPLATE` | Plantilla WMTS de NASA GIBS |
| 94 | `NASA_GIBS_LAYER` (+ `TILEMATRIXSET`, `FORMAT`) | Capa GIBS por defecto |
| 102 | `NISAR_GEOTIFF_URLS.colonso.before / .after` | GeoTIFF/COG NISAR propios (p. ej. σ⁰ HV extraído del HDF5) → panes A/B del comparador |
| 106 | `SENTINEL1_WMS_URL`, `SENTINEL1_WMS_LAYER` | WMS de Sentinel-1/NISAR (parámetro `time` = mes de la línea de tiempo) |
| 110 | `NISAR_WMTS_TEMPLATE` | Teselas XYZ propias (titiler, etc.) |
| 113 | `ASF_SEARCH_API`, `CMR_GRANULES_API` | Búsqueda de escenas (`searchNISARGranules()`) |
| 117 | `CLIMATE_SOURCES` | Endpoints OPeNDAP de IMERG, MODIS, SMAP, Hansen y NOAA ONI |
| 159 | `fetchNASAGibsLayer()` | Constructor de capas GIBS |
| 194 | `loadGeoTIFF()` | Carga de GeoTIFF (descomentar el bloque georaster) |
| 778 | `GIBS_LAYERS` | Capas GIBS que siguen a la línea de tiempo |

### Renderizar GeoTIFF en el navegador

```bash
npm install georaster georaster-layer-for-leaflet
# HDF5 GCOV → GeoTIFF (GDAL):
gdal_translate HDF5:"NISAR_L2_..._001.h5"://science/LSAR/GCOV/grids/frequencyA/HVHV colonso_hv.tif
```

Descomenta el bloque marcado en `loadGeoTIFF()` y pon las URLs en `NISAR_GEOTIFF_URLS`.

## 🗂️ Estructura

```
nisar-pulse/
├── index.html
├── package.json · vite.config.js · tailwind.config.js · postcss.config.js
├── public/
│   ├── favicon.svg
│   └── nisar/gcov_<fecha>_<A076|D011>.webp   ← 21 vistas previas NISAR GCOV (ASF DAAC)
├── scripts/earthdata/                        ← descarga reproducible (earthaccess + OPeNDAP)
├── src/
│   ├── data/satellite_real.json   ← IMERG, MODIS, SMAP, Hansen, catálogo NISAR
│   ├── data/enso_real.json        ← ONI + Niño 1+2 (NOAA) + CHIRPS (comparación)
│   ├── data/colonso_wdpa.geojson  ← límite oficial WDPA 555593903
│   ├── main.jsx · index.css
│   └── App.jsx                    ← toda la app (CONFIG, conectores, mapa, gráficos, UI)
├── README.md · LICENSE · .gitignore
```

## 📚 Citas

- NISAR L2 GCOV: NASA/JPL & ISRO, distribuido por ASF DAAC. <https://nisar-docs.asf.alaska.edu/gcov/>
- Huffman, G. J. et al. (2023), GPM IMERG Final Precipitation L3 1 month 0.1° V07, GES DISC. doi:10.5067/GPM/IMERG/3B-MONTH/07 · Late Run diario V07 (GPM_3IMERGDL).
- Didan, K. (2021), MOD13C2 MODIS/Terra Vegetation Indices Monthly L3 Global 0.05Deg CMG V061, LP DAAC. doi:10.5067/MODIS/MOD13C2.061
- Wan, Z., Hook, S., Hulley, G. (2021), MOD11C3 MODIS/Terra LST/E Monthly L3 Global 0.05Deg CMG V061, LP DAAC. doi:10.5067/MODIS/MOD11C3.061
- O'Neill, P. E. et al. (2023), SMAP Enhanced L3 Radiometer Global Daily 9 km EASE-Grid Soil Moisture, V6, NSIDC DAAC. doi:10.5067/M20OXIZHY3RJ
- Hansen, M. C. et al. (2013), High-Resolution Global Maps of 21st-Century Forest Cover Change, *Science* 342: 850–853. Datos GFC-2025-v1.13.
- NOAA CPC, Oceanic Niño Index (ERSSTv5). <https://www.cpc.ncep.noaa.gov/data/indices/oni.ascii.txt>
- Funk, C. et al. (2015), CHIRPS, *Scientific Data* 2: 150066 (solo comparación).

### Atribución WDPA

UNEP-WCMC and IUCN (2026), *Protected Planet: The World Database on Protected Areas (WDPA)*, noviembre 2026,
Cambridge, UK: UNEP-WCMC and IUCN. Disponible en <https://www.protectedplanet.net/555593903>.
Uso sujeto a los [Términos de uso de la WDPA](https://www.protectedplanet.net/en/legal): **solo uso no
comercial, con atribución**; no se permite redistribuir los datos con fines comerciales. El código de este
repositorio es MIT, pero el archivo `src/data/colonso_wdpa.geojson` conserva la licencia WDPA.

## 📄 Licencia

[MIT](LICENSE) © 2026 Equipo NISAR Pulse. NISAR es una misión conjunta NASA–ISRO; este proyecto no está
afiliado a ninguna de las dos agencias.
