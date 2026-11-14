/**
 * ============================================================================
 *  NISAR Pulse — Visualizador Accesible de Ritmos de la Tierra
 *  El Niño en la Reserva Biológica Colonso Chalupas (Napo, Ecuador)
 *  MVP Open Source (MIT) · Hackathon · NASA-ISRO NISAR (Banda L)
 * ----------------------------------------------------------------------------
 *  Stack: React 18 + Tailwind CSS 3 + lucide-react + Leaflet / react-leaflet 4
 *         + Recharts. Toda la lógica de la aplicación vive en este archivo.
 *
 *  DATOS OBSERVADOS REALES (sin simulación). Descarga: 2026-11-14.
 *  EXCEPCIÓN: la fase «Predicción (5 años)» usa una trayectoria de ONI escrita
 *  por el equipo (ENSO_COMMON / ENSO_SCENARIOS). Esos °C no los publicó NOAA CPC.
 *  En esa fase no se muestra la insignia «100 % datos satelitales reales».
 *    · Radar  → NISAR L2 GCOV (ASF DAAC, CMR): 21 adquisiciones reales Jun–Oct 2026
 *               (vistas previas oficiales recortadas a la reserva, public/nisar/).
 *    · Lluvia → GPM IMERG (NASA) · Verdor → MODIS MOD13C2 · Calor → MODIS MOD11C3
 *    · Humedad del suelo → SMAP SPL3SMP_E · Bosque → Hansen GFC v1.13 (Landsat)
 *    · El Niño → NOAA CPC ONI / Niño 1+2 · Límite → WDPA 555593903
 *  Series en src/data/satellite_real.json y src/data/enso_real.json
 *  (regenerables con scripts/earthdata/*.py usando earthaccess + Earthdata Login).
 *
 *  >>> Para conectar más capas edita el bloque CONFIG (abajo) y las
 *      funciones fetchNASAGibsLayer() y loadGeoTIFF(). <<<
 * ============================================================================
 */
import React, { useEffect, useMemo, useRef, useState, useCallback } from "react";
import { MapContainer, TileLayer, WMSTileLayer, Pane, Polygon, ImageOverlay, Rectangle, useMap } from "react-leaflet";
import L from "leaflet";
import ENSO_REAL from "./data/enso_real.json"; // NOAA CPC ONI + Niño 1+2 (+ CHIRPS solo como comparación)
import SAT from "./data/satellite_real.json"; // IMERG · MODIS · SMAP · Hansen GFC · catálogo NISAR GCOV (reales)
import COLONSO_WDPA_RAW from "./data/colonso_wdpa.geojson?raw"; // límite oficial WDPA 555593903 (simplificado)
import markerIcon2x from "leaflet/dist/images/marker-icon-2x.png";
import markerIcon from "leaflet/dist/images/marker-icon.png";
import markerShadow from "leaflet/dist/images/marker-shadow.png";
import {
  ResponsiveContainer,
  LineChart,
  Line,
  BarChart,
  Bar,
  Cell,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ReferenceLine,
  Legend,
  ComposedChart,
  Area,
  ReferenceArea,
} from "recharts";
import {
  Satellite,
  Play,
  Pause,
  Layers,
  Trees,
  Droplets,
  Columns2,
  Info,
  TriangleAlert,
  Gauge,
  GraduationCap,
  Microscope,
  FileJson,
  FileSpreadsheet,
  Waves,
  ChevronsLeftRight,
  Globe,
  Calendar,
  SlidersHorizontal,
  SkipBack,
  SkipForward,
  Database,
  Eye,
  ExternalLink,
  Radar,
  Sprout,
  CloudRain,
  Thermometer,
  Leaf,
  TrendingUp,
  History,
  Clock,
} from "lucide-react";

/* ============================================================================
 *  CONFIG — PUNTO ÚNICO PARA INSERTAR TUS URLS DE NISAR / SENTINEL-1 / GIBS
 * ========================================================================== */
const CONFIG = {
  // false = usa solo los datos reales estáticos (src/data). true = intenta además consultas en vivo (ONI).
  USE_LIVE_FETCH: false,

  // --- NASA GIBS (WMTS, EPSG:3857). Plantilla oficial REST de GIBS. ---
  // Docs: https://nasa-gibs.github.io/gibs-api-docs/access-basics/
  NASA_GIBS_WMTS_TEMPLATE: "https://gibs.earthdata.nasa.gov/wmts/epsg3857/best/{layer}/default/{time}/{tileMatrixSet}/{z}/{y}/{x}.{format}",
  NASA_GIBS_LAYER: "MODIS_Terra_CorrectedReflectance_TrueColor",
  NASA_GIBS_TILEMATRIXSET: "GoogleMapsCompatible_Level9",
  NASA_GIBS_FORMAT: "jpg",
  NASA_GIBS_MAX_NATIVE_ZOOM: 9,

  // --- NISAR GeoTIFF / COG propios (p. ej. σ⁰ HH/HV extraído del HDF5 GCOV con GDAL). ---
  // Si los llenas, se dibujan en los mismos panes del comparador (A = antes, B = después).
  NISAR_GEOTIFF_URLS: {
    colonso: { before: "", after: "" }, //  p. ej. "https://tu-bucket/nisar/colonso_GCOV_L_HV_2026-10-24.tif"
  },

  // --- Sentinel-1 / NISAR vía WMS (GeoServer, Sentinel Hub, etc.). ---
  SENTINEL1_WMS_URL: "", // p. ej. "https://services.sentinel-hub.com/ogc/wms/<TU_INSTANCE_ID>"
  SENTINEL1_WMS_LAYER: "", // p. ej. "IW_VV_DB"

  // --- Servicio de teselas WMTS/XYZ propio (p. ej. titiler sobre COG). ---
  NISAR_WMTS_TEMPLATE: "", // p. ej. "https://tu-titiler/cog/tiles/{z}/{x}/{y}.png?url=..."

  // --- Catálogos de búsqueda de escenas (públicos, sin autenticación). ---
  ASF_SEARCH_API: "https://api.daac.asf.alaska.edu/services/search/param",
  CMR_GRANULES_API: "https://cmr.earthdata.nasa.gov/search/granules.json",

  // --- Fuentes satelitales del caso Colonso Chalupas (todas NASA Earthdata, salvo ONI de NOAA) ---
  CLIMATE_SOURCES: {
    GPM_IMERG_MONTHLY: "https://opendap.earthdata.nasa.gov/collections/C2723754851-GES_DISC/granules/", // GPM_3IMERGM v07
    GPM_IMERG_DAILY_LATE: "https://opendap.earthdata.nasa.gov/collections/C2723754859-GES_DISC/granules/", // GPM_3IMERGDL v07
    MODIS_NDVI_MOD13C2: "https://opendap.earthdata.nasa.gov/collections/C2565788914-LPCLOUD/granules/",
    MODIS_LST_MOD11C3: "https://opendap.earthdata.nasa.gov/collections/C2565788897-LPCLOUD/granules/",
    SMAP_SPL3SMP_E: "https://opendap.earthdata.nasa.gov/collections/C2938664763-NSIDC_CPRD/granules/",
    HANSEN_GFC: "https://storage.googleapis.com/earthenginepartners-hansen/GFC-2025-v1.13/",
    NOAA_ONI: "https://www.cpc.ncep.noaa.gov/data/indices/oni.ascii.txt",
  },

  // --- Mapas base ópticos ---
  BASEMAP_URL: "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}",
  LABELS_URL: "https://server.arcgisonline.com/ArcGIS/rest/services/Reference/World_Boundaries_and_Places/MapServer/tile/{z}/{y}/{x}",
};

/* ============================================================================
 *  FIX: íconos por defecto de Leaflet con bundlers (Vite / Webpack)
 * ========================================================================== */
delete L.Icon.Default.prototype._getIconUrl;
L.Icon.Default.mergeOptions({
  iconRetinaUrl: markerIcon2x,
  iconUrl: markerIcon,
  shadowUrl: markerShadow,
});

/* ============================================================================
 *  CONECTORES DE DATOS REALES
 * ========================================================================== */

/**
 * fetchNASAGibsLayer()
 * Devuelve la configuración de una capa WMTS de NASA GIBS para Leaflet.
 * FUNCIONA en vivo: la línea de tiempo cambia la fecha de la capa GIBS elegida
 * (NDVI MODIS mensual, LST MODIS mensual o color verdadero MODIS).
 *
 * Equivalente en Leaflet "puro":
 *   L.tileLayer(url, { maxNativeZoom: 7, maxZoom: 18, attribution: "NASA GIBS" }).addTo(map);
 *
 * Para un WMS (Sentinel-1 / GeoServer):
 *   L.tileLayer.wms(CONFIG.SENTINEL1_WMS_URL, { layers: CONFIG.SENTINEL1_WMS_LAYER,
 *     format: "image/png", transparent: true, time: "2026-01-15" }).addTo(map);
 */
function fetchNASAGibsLayer({
  layer = CONFIG.NASA_GIBS_LAYER,
  date = "2026-01-15",
  tileMatrixSet = CONFIG.NASA_GIBS_TILEMATRIXSET,
  format = CONFIG.NASA_GIBS_FORMAT,
  maxNativeZoom = CONFIG.NASA_GIBS_MAX_NATIVE_ZOOM,
  opacity = 0.8,
} = {}) {
  const url = CONFIG.NASA_GIBS_WMTS_TEMPLATE.replace("{layer}", layer)
    .replace("{time}", date)
    .replace("{tileMatrixSet}", tileMatrixSet)
    .replace("{format}", format);
  return {
    url,
    options: {
      maxNativeZoom,
      maxZoom: 18,
      opacity,
      attribution: 'Imágenes: <a href="https://earthdata.nasa.gov/gibs">NASA GIBS</a>',
    },
  };
}

/**
 * loadGeoTIFF(url)
 * Carga un GeoTIFF / COG de NISAR (p. ej. σ⁰ HV del HDF5 GCOV convertido con
 *   gdal_translate HDF5:"<granulo>.h5"://science/LSAR/GCOV/grids/frequencyA/HVHV hv.tif)
 * y lo devuelve como capa Leaflet.
 *
 * Pasos para activarlo:
 *   1) npm install georaster georaster-layer-for-leaflet
 *   2) Descomenta los imports dinámicos y el bloque marcado abajo.
 *   3) Coloca tus URLs en CONFIG.NISAR_GEOTIFF_URLS.
 * Mientras tanto devuelve null y el comparador usa las vistas previas oficiales NISAR GCOV.
 */
async function loadGeoTIFF(url, { pane = "afterPane", opacity = 0.7 } = {}) {
  if (!url) return null;
  try {
    const response = await fetch(url);
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const arrayBuffer = await response.arrayBuffer();
    // ---- DESCOMENTAR TRAS INSTALAR georaster + georaster-layer-for-leaflet ----
    // const { default: parseGeoraster } = await import("georaster");
    // const { default: GeoRasterLayer } = await import("georaster-layer-for-leaflet");
    // const georaster = await parseGeoraster(arrayBuffer);
    // return new GeoRasterLayer({
    //   georaster, pane, opacity, resolution: 256,
    //   pixelValuesToColorFn: (v) => (v[0] == null || isNaN(v[0]) ? null : `rgba(255,255,255,${Math.min(1, v[0] * 10)})`),
    // });
    // -------------------------------------------------------------------------
    console.info(`[NISAR Pulse] GeoTIFF descargado (${arrayBuffer.byteLength} bytes) para ${pane}, opacidad ${opacity}. Activa georaster.`);
    return null;
  } catch (err) {
    console.warn("[NISAR Pulse] No se pudo cargar el GeoTIFF:", err);
    return null;
  }
}

/**
 * searchNISARGranules() — busca en vivo nuevas adquisiciones NISAR GCOV sobre la reserva
 * (CMR público, sin autenticación). La app trae embebido el catálogo descargado el 2026-11-14.
 */
async function searchNISARGranules({ shortName = "NISAR_L2_GCOV_V1", bbox = "-78.25,-1.08,-77.85,-0.74" } = {}) {
  const url = `${CONFIG.CMR_GRANULES_API}?short_name=${shortName}&bounding_box=${bbox}&page_size=100&sort_key=-start_date`;
  const json = await (await fetch(url)).json();
  return json.feed.entry.map((e) => ({ id: e.title, start: e.time_start, links: e.links.map((l) => l.href) }));
}

/** NOAA CPC Oceanic Niño Index (texto plano: SEAS YR TOTAL ANOM). */
async function fetchNOAA_ONI() {
  if (!CONFIG.USE_LIVE_FETCH) return null;
  try {
    const txt = await (await fetch(CONFIG.CLIMATE_SOURCES.NOAA_ONI)).text();
    const SEAS = ["DJF", "JFM", "FMA", "MAM", "AMJ", "MJJ", "JJA", "JAS", "ASO", "SON", "OND", "NDJ"];
    return txt
      .trim()
      .split("\n")
      .slice(1)
      .map((l) => l.trim().split(/\s+/))
      .map(([s, y, , anom]) => ({ date: `${y}-${String(SEAS.indexOf(s) + 1).padStart(2, "0")}`, oni: Number(anom) }))
      .filter((r) => r.date >= "2016-01");
  } catch (err) {
    console.warn("[NISAR Pulse] ONI en vivo no disponible (¿CORS?), se usa la copia estática NOAA:", err);
    return null;
  }
}

/** Polígono oficial de la Reserva Biológica Colonso Chalupas (WDPA, uso no comercial con atribución). */
const COLONSO_WDPA = JSON.parse(COLONSO_WDPA_RAW);

const ZONE = {
  id: "colonso",
  name: "Reserva Biológica Colonso Chalupas · Napo (Ecuador)",
  // Centroide y extensión del polígono oficial WDPA 555593903 (UNEP-WCMC & IUCN, Protected Planet, descargado 2026-11-14).
  center: [-0.9, -78.04],
  zoom: 11,
  bbox: [-1.08, -78.25, -0.738, -77.875],
  polygon: COLONSO_WDPA.features[0].geometry.coordinates[0].map(([lon, lat]) => [lat, lon]),
  citizenTitle: "El bosque que da agua a Tena y Archidona frente a El Niño",
  techTitle: "NISAR GCOV Banda L (HH/HV) + IMERG / MODIS / SMAP / Hansen vs ONI (2016–2026)",
};
const D_DESCARGA = SAT.metadata.descargado;
const SRC = SAT.metadata.fuentes;
const HANSEN = SAT.hansen;
const NISAR = SAT.nisar;

/* ============================================================================
 *  TIEMPO: 12 meses (Oct 2025 → Sep 2026, último mes con ONI publicado: ASO 2026)
 * ========================================================================== */
const MONTH_ABBR = ["Ene", "Feb", "Mar", "Abr", "May", "Jun", "Jul", "Ago", "Sep", "Oct", "Nov", "Dic"];
const MONTH_FULL = ["enero", "febrero", "marzo", "abril", "mayo", "junio", "julio", "agosto", "septiembre", "octubre", "noviembre", "diciembre"];
const MONTHS = Array.from({ length: 12 }, (_, k) => {
  const mi = (9 + k) % 12;
  const year = 2025 + Math.floor((9 + k) / 12);
  return {
    k,
    mi,
    year,
    label: `${MONTH_ABBR[mi]} ${String(year).slice(2)}`,
    long: `${MONTH_FULL[mi]} de ${year}`,
    ym: `${year}-${String(mi + 1).padStart(2, "0")}`,
  };
});

const clamp = (x, a = 0, b = 1) => Math.min(b, Math.max(a, x));
const lerp = (a, b, t) => a + (b - a) * t;
const round = (x, d = 2) => (x == null ? null : Math.round(x * 10 ** d) / 10 ** d);
const mean = (xs) => {
  const v = xs.filter((x) => x != null && !Number.isNaN(x));
  return v.length ? v.reduce((a, b) => a + b, 0) / v.length : null;
};
const fmtDate = (iso) => {
  const [y, m, d] = iso.split("-").map(Number);
  return `${d} ${MONTH_ABBR[m - 1]} ${y}`;
};

/* ============================================================================
 *  SERIES MENSUALES REALES 2016–2026 (polígono WDPA 555593903)
 *    oni    → NOAA CPC ONI (°C), Ene 2016 → ASO 2026 (= +2.46)
 *    precip → GPM IMERG (mm/mes)          ndvi → MODIS MOD13C2 (adim.)
 *    lst    → MODIS MOD11C3 diurna (°C)   sm   → SMAP SPL3SMP_E (% vol)
 *  Las variables sin al menos 24 meses de dato real se OCULTAN (nunca se simulan).
 * ========================================================================== */
const CLIMATE_VARS_ALL = {
  precip: {
    tech: "Precipitación GPM IMERG (mm/mes)",
    citizen: "Lluvia del mes",
    unit: "mm",
    dec: 0,
    color: "#38bdf8",
    icon: CloudRain,
    src: SRC.precip,
  },
  ndvi: {
    tech: "NDVI MODIS MOD13C2 (0,05°, mensual)",
    citizen: "Verdor del bosque",
    unit: "",
    dec: 3,
    color: "#4ade80",
    icon: Leaf,
    src: SRC.ndvi,
  },
  lst: {
    tech: "Temperatura superficial MODIS MOD11C3 (°C, diurna)",
    citizen: "Calor del suelo",
    unit: "°C",
    dec: 1,
    color: "#fb923c",
    icon: Thermometer,
    src: SRC.lst,
  },
  sm: {
    tech: "Humedad superficial SMAP SPL3SMP_E (% vol)",
    citizen: "Humedad del suelo",
    unit: "%",
    dec: 1,
    color: "#22d3ee",
    icon: Droplets,
    src: SRC.sm,
  },
};
const ENSO_EVENTS = [
  { from: "Ene 16", to: "Abr 16", label: "El Niño 2015-16", color: "#ef4444" },
  { from: "Ago 20", to: "Ene 23", label: "La Niña 2020-23", color: "#3b82f6" },
  { from: "May 23", to: "Abr 24", label: "El Niño 2023-24", color: "#ef4444" },
  { from: "May 26", to: "Sep 26", label: "El Niño 2026", color: "#ef4444" },
];
const ensoPhase = (oni) => (oni >= 0.5 ? "El Niño" : oni <= -0.5 ? "La Niña" : "Neutral");
const rowLabel = (year, mi) => `${MONTH_ABBR[mi]} ${String(year).slice(2)}`;
const ymKey = (year, mi) => `${year}-${String(mi + 1).padStart(2, "0")}`;

/** Filas mensuales Ene 2016 → Sep 2026 (último ONI publicado: ASO 2026). Todo dato es real o null. */
function buildClimateRows(oniOverride = null) {
  const oniSrc = oniOverride || ENSO_REAL.oni;
  return Object.keys(ENSO_REAL.oni)
    .sort()
    .map((date, i) => {
      const year = Number(date.slice(0, 4));
      const mi = Number(date.slice(5, 7)) - 1;
      const m = SAT.monthly[date] || {};
      return {
        i,
        date,
        year,
        mi,
        label: rowLabel(year, mi),
        oni: oniSrc[date] ?? ENSO_REAL.oni[date],
        nino12: ENSO_REAL.nino12[date] ?? null,
        precip: m.precip ?? null,
        precip_chirps: m.precip_chirps ?? null,
        ndvi: m.ndvi ?? null,
        lst: m.lst ?? null,
        sm: m.sm ?? null,
      };
    });
}
const BASE_ROWS = buildClimateRows();
const nValid = (k) => BASE_ROWS.filter((r) => r[k] != null).length;
/** Solo variables con dato satelital real suficiente (≥ 24 meses). */
const CLIMATE_VARS = Object.fromEntries(Object.entries(CLIMATE_VARS_ALL).filter(([k]) => nValid(k) >= 24));
const CLIMATE_VAR_KEYS = Object.keys(CLIMATE_VARS);
const lastValid = (k) => [...BASE_ROWS].reverse().find((r) => r[k] != null);

function pearson(xs, ys) {
  const n = xs.length;
  const mx = xs.reduce((a, b) => a + b, 0) / n;
  const my = ys.reduce((a, b) => a + b, 0) / n;
  let sxy = 0;
  let sxx = 0;
  let syy = 0;
  for (let k = 0; k < n; k++) {
    sxy += (xs[k] - mx) * (ys[k] - my);
    sxx += (xs[k] - mx) ** 2;
    syy += (ys[k] - my) ** 2;
  }
  return { r: sxy / Math.sqrt(sxx * syy), b: sxy / sxx, a: my - (sxy / sxx) * mx, n };
}
/** Valor p bilateral de r (t de Student ≈ normal para n > 30; erf de Abramowitz-Stegun 7.1.26). */
function pValue(r, n) {
  const t = Math.abs(r) * Math.sqrt((n - 2) / (1 - r * r));
  const x = t / Math.SQRT2;
  const k = 1 / (1 + 0.3275911 * x);
  const erf = 1 - (((((1.061405429 * k - 1.453152027) * k + 1.421413741) * k - 0.284496736) * k + 0.254829592) * k) * Math.exp(-x * x);
  return Math.max(0, 1 - erf);
}

/* ---- ONI proyectado (oct 2026 → dic 2031): predicción del equipo, NO de NOAA ----
 * Estos números NO son valores publicados por NOAA CPC. El equipo los escribió a mano
 * en ENSO_COMMON y en ENSO_SCENARIOS. No hay una función que los calcule a partir de
 * la serie observada de src/data/enso_real.json.
 *
 * Qué se puede ver en el repo sobre cómo se armaron:
 *   · La nota original del código decía que los primeros meses seguían el texto de la
 *     discusión ENSO de NOAA CPC (12 nov 2026: El Niño fuerte probable hasta EFM 2027)
 *     y que después había tres caminos “según la estadística histórica” (ciclos de
 *     unos 3–7 años; ejemplos citados: 1998-2001, 2010-12, 2024-25). Esa idea no está
 *     programada: los °C son nodos fijos. NOAA publica probabilidades, no esta lista.
 *   · interpNodes() solo une esos nodos con una curva suave (interpolación coseno).
 *   · oniSdAt() es una fórmula de incertidumbre también escrita a mano.
 *   · Lo que SÍ usa el ONI histórico de NOAA es la regresión de lluvia, verdor, calor
 *     y humedad (buildClimate): anomalía ≈ a + b·ONI. Esa recta se evalúa sobre
 *     esta trayectoria del equipo. La recta no crea los valores de ONI futuro.
 *
 * En pantalla, toda esta parte lleva la etiqueta PREDICCION_ONI_LABEL.
 * El equipo debe confirmar el método antes de presentarlo como basado en NOAA.
 */
const PREDICCION_ONI_LABEL =
  "Predicción basada en datos previos de la NOAA; puede cambiar según avance el tiempo";
const ENSO_COMMON = [
  ["2026-09", 2.46],
  ["2026-10", 2.7],
  ["2026-11", 2.9],
  ["2026-12", 2.9],
  ["2027-01", 2.7],
  ["2027-02", 2.3],
  ["2027-04", 1.3],
  ["2027-06", 0.4],
];
const ENSO_SCENARIOS = {
  elnino: {
    label: "El Niño recurrente",
    color: "#ef4444",
    nodes: [
      ["2027-09", -0.3],
      ["2028-01", -0.6],
      ["2028-06", 0.0],
      ["2029-01", 0.9],
      ["2029-12", 1.6],
      ["2030-04", 0.6],
      ["2030-09", -0.4],
      ["2031-03", -0.2],
      ["2031-12", 0.9],
    ],
  },
  neutral: {
    label: "Neutral",
    color: "#94a3b8",
    nodes: [
      ["2027-09", -0.2],
      ["2028-01", -0.4],
      ["2028-09", 0.0],
      ["2029-01", 0.3],
      ["2029-09", 0.0],
      ["2030-01", -0.3],
      ["2030-09", 0.1],
      ["2031-01", 0.4],
      ["2031-12", 0.1],
    ],
  },
  lanina: {
    label: "La Niña",
    color: "#3b82f6",
    nodes: [
      ["2027-09", -0.8],
      ["2027-12", -1.4],
      ["2028-04", -0.6],
      ["2028-12", -1.0],
      ["2029-04", -0.3],
      ["2029-12", -0.6],
      ["2030-06", 0.0],
      ["2031-01", 0.6],
      ["2031-12", 0.3],
    ],
  },
};
const SCENARIO_KEYS = Object.keys(ENSO_SCENARIOS);
const FORECAST_END = "2031-12";
const NOAA_OUTLOOK_MONTHS = 5;
const monthIndex = (ym) => Number(ym.slice(0, 4)) * 12 + Number(ym.slice(5, 7)) - 1;
function interpNodes(nodes, t) {
  for (let k = 0; k < nodes.length - 1; k++) {
    const t0 = monthIndex(nodes[k][0]);
    const t1 = monthIndex(nodes[k + 1][0]);
    if (t >= t0 && t <= t1) {
      const f = (1 - Math.cos((Math.PI * (t - t0)) / (t1 - t0))) / 2; // interpolación coseno (suave)
      return lerp(nodes[k][1], nodes[k + 1][1], f);
    }
  }
  return nodes[nodes.length - 1][1];
}

/**
 * Climatologías (solo meses con dato), correlación ONI–anomalía con desfase óptimo (0–6 meses),
 * regresión lineal anomalía(t) = a + b·ONI(t − lag) y proyección a 5 años por escenario con banda 95 % creciente.
 */
function buildClimate(rows) {
  const clim = {};
  const climSd = {};
  CLIMATE_VAR_KEYS.forEach((v) => {
    clim[v] = Array.from({ length: 12 }, (_, mi) => mean(rows.filter((r) => r.mi === mi).map((r) => r[v])));
    const an = rows.filter((r) => r[v] != null).map((r) => r[v] - clim[v][r.mi]);
    climSd[v] = Math.sqrt(an.reduce((s, e) => s + e * e, 0) / Math.max(1, an.length - 1));
  });

  const stats = {};
  CLIMATE_VAR_KEYS.forEach((v) => {
    let best = null;
    for (let lag = 0; lag <= 6; lag++) {
      const xs = [];
      const ys = [];
      for (let t = lag; t < rows.length; t++) {
        if (rows[t][v] == null) continue;
        xs.push(rows[t - lag].oni);
        ys.push(rows[t][v] - clim[v][rows[t].mi]);
      }
      if (xs.length < 12) continue;
      const p = pearson(xs, ys);
      if (!best || Math.abs(p.r) > Math.abs(best.r)) {
        const resid = ys.map((y, k) => y - (p.a + p.b * xs[k]));
        const rmse = Math.sqrt(resid.reduce((s, e) => s + e * e, 0) / resid.length);
        best = { ...p, lag, rmse, r2: p.r * p.r, p: pValue(p.r, p.n) };
      }
    }
    stats[v] = best;
  });

  const last = rows[rows.length - 1];
  const tLast = last.year * 12 + last.mi;
  const H = monthIndex(FORECAST_END) - tLast;
  const common = [[last.date, last.oni], ...ENSO_COMMON.filter(([d]) => monthIndex(d) > tLast)];
  const oniPath = {};
  SCENARIO_KEYS.forEach((s) => {
    const nodes = [...common, ...ENSO_SCENARIOS[s].nodes];
    oniPath[s] = Array.from({ length: H }, (_, k) => round(interpNodes(nodes, tLast + k + 1), 2));
  });
  const oniSdAt = (h) => (h <= 0 ? 0 : h <= NOAA_OUTLOOK_MONTHS ? 0.12 + 0.04 * h : 0.32 + 0.08 * Math.sqrt(h - NOAA_OUTLOOK_MONTHS));
  const oniAt = (s, idx) => (idx < rows.length ? rows[idx].oni : oniPath[s][idx - rows.length]);

  const forecast = [];
  for (let h = 1; h <= H; h++) {
    const idx = rows.length - 1 + h;
    const mi = (last.mi + h) % 12;
    const year = last.year + Math.floor((last.mi + h) / 12);
    const sd = oniSdAt(h);
    const row = { label: rowLabel(year, mi), date: ymKey(year, mi), year, mi, h, noaa: h <= NOAA_OUTLOOK_MONTHS, oniSd: round(sd, 2) };
    SCENARIO_KEYS.forEach((s) => {
      const o = oniPath[s][h - 1];
      row[`oni_${s}`] = o;
      row[`oniBand_${s}`] = [round(o - 1.96 * sd, 2), round(o + 1.96 * sd, 2)];
      CLIMATE_VAR_KEYS.forEach((v) => {
        const st = stats[v];
        const lagIdx = idx - st.lag;
        const oL = oniAt(s, lagIdx);
        const oSd = lagIdx >= rows.length ? oniSdAt(lagIdx - rows.length + 1) : 0;
        const m = clim[v][mi] + st.a + st.b * oL;
        const half = 1.96 * Math.sqrt(st.rmse ** 2 * (1 + h / 60) + (st.b * oSd) ** 2);
        const d = CLIMATE_VARS[v].dec + 1;
        const pos = v === "precip" || v === "sm";
        row[`${v}_${s}`] = round(pos ? Math.max(0, m) : m, d);
        row[`${v}Band_${s}`] = [round(pos ? Math.max(0, m - half) : m - half, d), round(m + half, d)];
      });
    });
    forecast.push(row);
  }
  return { rows, clim, climSd, stats, forecast };
}

const CLIMATE_REAL = buildClimate(BASE_ROWS);

/** Índice (en climate.rows) del mes k (0–11) de la ventana "Actual" Oct 2025 → Sep 2026. */
const climateIdx = (climate, k) => climate.rows.length - 12 + k;

/* ---- Pérdida de bosque (Hansen GFC v1.13, Landsat 30 m) ---- */
const HANSEN_ROWS = Object.entries(HANSEN.loss_ha).map(([y, ha]) => ({ year: y, ha, pct: (ha / HANSEN.forest2000_ha) * 100 }));
const HANSEN_MEAN = mean(HANSEN_ROWS.slice(0, -1).map((r) => r.ha));
const HANSEN_LAST = HANSEN_ROWS[HANSEN_ROWS.length - 1];

/* ---- Catálogo NISAR GCOV (adquisiciones reales sobre la reserva) ---- */
const NISAR_KEY = (n) => `${n.date}_${n.direction[0]}${String(n.track).padStart(3, "0")}`;
const NISAR_BY_KEY = Object.fromEntries(NISAR.map((n) => [NISAR_KEY(n), n]));
const NISAR_TRACKS = [...new Set(NISAR.map((n) => `${n.direction} · track ${n.track} · frame ${n.frame}`))];
const NISAR_MONTHLY = (() => {
  const m = {};
  NISAR.forEach((n) => {
    const k = n.date.slice(0, 7);
    m[k] = m[k] || { label: rowLabel(Number(k.slice(0, 4)), Number(k.slice(5, 7)) - 1), Ascendente: 0, Descendente: 0 };
    m[k][n.direction] += 1;
  });
  return Object.keys(m)
    .sort()
    .map((k) => m[k]);
})();
const assetUrl = (p) => `${import.meta.env.BASE_URL}${p}`;

/* ============================================================================
 *  INDICADORES (semáforo) A PARTIR DE ANOMALÍAS REALES
 * ========================================================================== */
const LEVELS = {
  verde: { color: "#22c55e", label: "Bajo", ring: "ring-green-500/40", bg: "bg-green-500/10" },
  amarillo: { color: "#eab308", label: "Moderado", ring: "ring-yellow-500/40", bg: "bg-yellow-500/10" },
  rojo: { color: "#ef4444", label: "Alto", ring: "ring-red-500/40", bg: "bg-red-500/10" },
  gris: { color: "#64748b", label: "Sin dato", ring: "ring-slate-500/40", bg: "bg-slate-500/10" },
};

function monthIndicators(climate, k) {
  const r = climate.rows[climateIdx(climate, k)];
  const out = [];
  const oni = r.oni;
  out.push({
    key: "oni",
    icon: Waves,
    title: "Temperatura del Pacífico (El Niño)",
    tech: "ONI (NOAA CPC, ERSSTv5)",
    value: `${oni > 0 ? "+" : ""}${oni.toFixed(2)} °C`,
    level: Math.abs(oni) < 0.5 ? "verde" : Math.abs(oni) < 1.5 ? "amarillo" : "rojo",
    text:
      oni >= 0.5
        ? `El Niño ${oni >= 2 ? "muy fuerte" : oni >= 1.5 ? "fuerte" : "activo"}: el mar del Pacífico está más caliente de lo normal.`
        : oni <= -0.5
          ? "La Niña: el Pacífico está más frío de lo normal."
          : "Pacífico en condiciones normales (neutral).",
    source: `NOAA CPC (ERSSTv5) · anomalía °C · media móvil de 3 meses · ene 2016 – sep 2026 · descargado ${ENSO_REAL.metadata.descargado}`,
    sourceUrl: ENSO_REAL.metadata.oni.url,
  });
  const anom = (v) => (r[v] == null || climate.clim[v][r.mi] == null ? null : r[v] - climate.clim[v][r.mi]);
  if (CLIMATE_VARS.precip) {
    const a = anom("precip");
    const pct = a == null ? null : (a / climate.clim.precip[r.mi]) * 100;
    out.push({
      key: "precip",
      icon: CloudRain,
      title: "Lluvia",
      tech: SRC.precip.producto,
      value: r.precip == null ? "sin dato" : `${r.precip.toFixed(0)} mm (${pct > 0 ? "+" : ""}${pct.toFixed(0)} %)`,
      level: pct == null ? "gris" : pct < -40 || pct > 60 ? "rojo" : pct < -20 || pct > 35 ? "amarillo" : "verde",
      text:
        pct == null
          ? `Dato IMERG aún no integrado para este mes (último: ${lastValid("precip").label}).`
          : pct < -20
            ? "Llovió menos de lo normal: menos agua para ríos y comunidades."
            : pct > 35
              ? "Llovió mucho más de lo normal: atención a crecidas y deslaves."
              : "Lluvia cerca de lo normal para este mes.",
      source: `${SRC.precip.via} · ${D_DESCARGA}`,
    });
  }
  if (CLIMATE_VARS.ndvi) {
    const a = anom("ndvi");
    const z = a == null ? null : a / climate.climSd.ndvi;
    out.push({
      key: "ndvi",
      icon: Leaf,
      title: "Verdor del bosque",
      tech: "NDVI MODIS MOD13C2 v061",
      value: r.ndvi == null ? "sin dato" : `${r.ndvi.toFixed(3)} (${a > 0 ? "+" : ""}${a.toFixed(3)})`,
      level: z == null ? "gris" : z < -2 ? "rojo" : z < -1 ? "amarillo" : "verde",
      text: z == null ? "Sin imagen MODIS válida este mes." : z < -1 ? "El bosque se ve menos verde que de costumbre (estrés o nubosidad)." : "El bosque mantiene su verdor habitual.",
      source: `NASA LP DAAC · ${D_DESCARGA}`,
    });
  }
  if (CLIMATE_VARS.lst) {
    const a = anom("lst");
    out.push({
      key: "lst",
      icon: Thermometer,
      title: "Calor del suelo (de día)",
      tech: "LST diurna MODIS MOD11C3 v061",
      value: r.lst == null ? "sin dato" : `${r.lst.toFixed(1)} °C (${a > 0 ? "+" : ""}${a.toFixed(1)} °C)`,
      level: a == null ? "gris" : a > 2 ? "rojo" : a > 1 ? "amarillo" : "verde",
      text: a == null ? "Sin dato MODIS de cielo despejado este mes." : a > 1 ? "La superficie está más caliente de lo normal." : "Temperatura de la superficie dentro de lo normal.",
      source: `NASA LP DAAC · ${D_DESCARGA}`,
    });
  }
  if (CLIMATE_VARS.sm) {
    const a = anom("sm");
    out.push({
      key: "sm",
      icon: Droplets,
      title: "Humedad del suelo",
      tech: "SMAP SPL3SMP_E v006 (calidad no recomendada en bosque denso)",
      value: r.sm == null ? "sin dato" : `${r.sm.toFixed(1)} % (${a > 0 ? "+" : ""}${a.toFixed(1)})`,
      level: a == null ? "gris" : a < -6 ? "rojo" : a < -3 ? "amarillo" : "verde",
      text: a == null ? "SMAP no midió con calidad suficiente este mes." : a < -3 ? "El suelo está más seco que lo normal (indicador relativo)." : "Humedad del suelo cerca de lo normal (indicador relativo).",
      source: `NASA NSIDC DAAC · ${D_DESCARGA}`,
    });
  }
  out.push({
    key: "forest",
    icon: Trees,
    title: `Bosque perdido en ${HANSEN_LAST.year}`,
    tech: "Hansen GFC v1.13 (Landsat 30 m, cobertura ≥ 30 %)",
    value: `${HANSEN_LAST.ha.toFixed(1)} ha (${HANSEN_LAST.pct.toFixed(3)} %)`,
    level: HANSEN_LAST.ha > 3 * HANSEN_MEAN ? "rojo" : HANSEN_LAST.ha > 1.5 * HANSEN_MEAN ? "amarillo" : "verde",
    text: `Promedio 2001–2024: ${HANSEN_MEAN.toFixed(1)} ha/año. En total se perdió el ${((HANSEN.total_loss_ha / HANSEN.forest2000_ha) * 100).toFixed(2)} % del bosque desde 2000: la reserva protege.`,
    source: `UMD/GLAD · ${HANSEN.descargado}`,
  });
  return out;
}

/* ============================================================================
 *  EXPORTACIÓN (CSV / GeoJSON)
 * ========================================================================== */
function downloadFile(filename, content, mime) {
  const blob = new Blob([content], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
function rowsToCsv(rows) {
  if (!rows.length) return "";
  const headers = Object.keys(rows[0]);
  const esc = (v) => (v == null ? "" : /[",\n]/.test(String(v)) ? `"${String(v).replace(/"/g, '""')}"` : String(v));
  return [headers.join(","), ...rows.map((r) => headers.map((h) => esc(r[h])).join(","))].join("\n");
}

/* ============================================================================
 *  COMPONENTES DEL MAPA
 * ========================================================================== */
/** Comparador tipo cortina: recorta los panes "beforePane" (izq.) y "afterPane" (der.). */
function SwipeController({ enabled, position }) {
  const map = useMap();
  useEffect(() => {
    let raf = 0;
    const update = () => {
      const before = map.getPane("beforePane");
      const after = map.getPane("afterPane");
      if (!before || !after) {
        raf = requestAnimationFrame(update);
        return;
      }
      if (!enabled) {
        before.style.clip = "auto";
        after.style.clip = "auto";
        return;
      }
      const size = map.getSize();
      const nw = map.containerPointToLayerPoint([0, 0]);
      const se = map.containerPointToLayerPoint(size);
      const x = map.containerPointToLayerPoint([size.x * position, 0]).x;
      before.style.clip = `rect(${nw.y}px, ${x}px, ${se.y}px, ${nw.x}px)`;
      after.style.clip = `rect(${nw.y}px, ${se.x}px, ${se.y}px, ${x}px)`;
    };
    update();
    map.on("move zoom resize zoomend moveend viewreset", update);
    return () => {
      cancelAnimationFrame(raf);
      map.off("move zoom resize zoomend moveend viewreset", update);
    };
  }, [map, enabled, position]);
  return null;
}

/**
 * Capa GeoTIFF propia (NISAR / Sentinel-1). Usa loadGeoTIFF(); si devuelve una capa
 * Leaflet la agrega al pane indicado ("beforePane" = Fecha A, "afterPane" = Fecha B).
 */
function GeoTIFFOverlay({ url, pane, opacity }) {
  const map = useMap();
  useEffect(() => {
    let layer = null;
    let cancelled = false;
    loadGeoTIFF(url, { pane, opacity }).then((l) => {
      if (cancelled || !l) return;
      layer = l;
      layer.addTo(map);
    });
    return () => {
      cancelled = true;
      if (layer) map.removeLayer(layer);
    };
  }, [map, url, pane, opacity]);
  return null;
}

/** Vista previa oficial NISAR GCOV (PNG del ASF DAAC recortado a la reserva, EPSG:4326). */
function NisarOverlay({ granule, opacity }) {
  if (!granule) return null;
  return <ImageOverlay key={granule.file} url={assetUrl(granule.file)} bounds={granule.bounds} opacity={opacity} />;
}

/* Capas NASA GIBS que siguen a la línea de tiempo (mismo mes del panel). */
const GIBS_LAYERS = {
  none: { label: "Ninguna" },
  ndvi: {
    label: "NDVI mensual (MODIS Terra)",
    layer: "MODIS_Terra_L3_NDVI_Monthly",
    tileMatrixSet: "GoogleMapsCompatible_Level7",
    format: "png",
    maxNativeZoom: 7,
    date: (m) => `${m.ym}-01`,
  },
  lst: {
    label: "Temperatura superficial mensual (MODIS Terra)",
    layer: "MODIS_Terra_L3_Land_Surface_Temp_Monthly_Day",
    tileMatrixSet: "GoogleMapsCompatible_Level6",
    format: "png",
    maxNativeZoom: 6,
    date: (m) => `${m.ym}-01`,
  },
  truecolor: {
    label: "Color verdadero diario (MODIS Terra, día 15)",
    layer: "MODIS_Terra_CorrectedReflectance_TrueColor",
    tileMatrixSet: "GoogleMapsCompatible_Level9",
    format: "jpg",
    maxNativeZoom: 9,
    date: (m) => `${m.ym}-15`,
  },
};

/* ============================================================================
 *  UI PEQUEÑA REUTILIZABLE
 * ========================================================================== */
function Badge({ children, className = "" }) {
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-full border border-white/10 bg-white/5 px-2 py-0.5 text-[11px] font-medium text-slate-300 ${className}`}
    >
      {children}
    </span>
  );
}
function SectionTitle({ icon: Icon, children, right }) {
  return (
    <div className="mb-3 flex items-center justify-between gap-2">
      <h3 className="flex items-center gap-2 text-sm font-semibold uppercase tracking-wider text-cyan-300">
        <Icon className="h-4 w-4" /> {children}
      </h3>
      {right}
    </div>
  );
}
function TrafficLight({ level }) {
  return (
    <div className="flex flex-col gap-1 rounded-lg bg-black/50 p-1.5" aria-label={`Nivel ${LEVELS[level].label}`}>
      {["rojo", "amarillo", "verde"].map((l) => (
        <span
          key={l}
          className="h-3 w-3 rounded-full"
          style={{
            background: l === level ? LEVELS[l].color : "#1f2937",
            boxShadow: l === level ? `0 0 10px ${LEVELS[l].color}` : "none",
          }}
        />
      ))}
    </div>
  );
}
function SourceNote({ children }) {
  return (
    <p className="mt-2 flex flex-wrap items-center gap-1 text-[10px] leading-snug text-slate-500">
      <Database className="h-3 w-3 shrink-0" /> {children}
    </p>
  );
}
const chartTooltip = {
  contentStyle: { background: "#0a0f1f", border: "1px solid rgba(34,211,238,0.35)", borderRadius: 10, fontSize: 12 },
  labelStyle: { color: "#22d3ee", fontWeight: 600 },
  itemStyle: { color: "#e2e8f0" },
};

/* ============================================================================
 *  PANEL CLIMÁTICO · COLONSO CHALUPAS Y EL NIÑO (Histórico / Actual / Predicción 5 años)
 * ========================================================================== */
const PHASES = [
  { id: "historico", label: "Histórico 10 años (2016-2026)", icon: History },
  { id: "actual", label: "Actual", icon: Clock },
  { id: "prediccion", label: "Predicción (5 años)", icon: TrendingUp },
];
const oniColor = (v) => (v >= 0.5 ? "#ef4444" : v <= -0.5 ? "#3b82f6" : "#64748b");

function exportClimateCsv(climate) {
  const fuenteObs = `ONI observado NOAA CPC (anomalía °C, media móvil de 3 meses, ene 2016 – sep 2026, ${ENSO_REAL.metadata.oni.url}); ${CLIMATE_VAR_KEYS.map((v) => SRC[v].producto).join("; ")} (descarga ${D_DESCARGA})`;
  const hist = climate.rows.map((r) => {
    const o = {
      fecha: r.date,
      tipo: "observado",
      escenario: "",
      oni_c: r.oni,
      origen_oni: "observado NOAA CPC",
      oni_lo: "",
      oni_hi: "",
      nino12_noaa: r.nino12 ?? "",
    };
    CLIMATE_VAR_KEYS.forEach((v) => {
      o[v] = r[v] ?? "";
      o[`${v}_lo`] = "";
      o[`${v}_hi`] = "";
    });
    o.precip_chirps_comparacion = r.precip_chirps ?? "";
    o.fuente = fuenteObs;
    return o;
  });
  const fc = [];
  climate.forecast.forEach((f) =>
    SCENARIO_KEYS.forEach((s) => {
      const o = {
        fecha: f.date,
        tipo: "prediccion_equipo",
        escenario: ENSO_SCENARIOS[s].label,
        oni_c: f[`oni_${s}`],
        origen_oni: PREDICCION_ONI_LABEL,
        oni_lo: f[`oniBand_${s}`][0],
        oni_hi: f[`oniBand_${s}`][1],
        nino12_noaa: "",
      };
      CLIMATE_VAR_KEYS.forEach((v) => {
        o[v] = f[`${v}_${s}`];
        o[`${v}_lo`] = f[`${v}Band_${s}`][0];
        o[`${v}_hi`] = f[`${v}Band_${s}`][1];
      });
      o.precip_chirps_comparacion = "";
      o.fuente = PREDICCION_ONI_LABEL;
      fc.push(o);
    }),
  );
  downloadFile("nisar-pulse_colonso_enso_2016-2031.csv", rowsToCsv([...hist, ...fc]), "text/csv;charset=utf-8");
}

function ClimatePanel({ climate, source, phase, setPhase, climVar, setClimVar, scenario, setScenario, isSci, month }) {
  const vm = CLIMATE_VARS[climVar];
  const st = climate.stats[climVar];
  const curRow = climate.rows[climateIdx(climate, month)];
  const fmt = (x) => (x == null ? "—" : Number(x).toFixed(vm.dec));
  const sc = ENSO_SCENARIOS[scenario];
  const others = SCENARIO_KEYS.filter((s) => s !== scenario);

  let data;
  if (phase === "historico") data = climate.rows;
  else if (phase === "actual") data = climate.rows.slice(-12);
  else {
    const obs = climate.rows.slice(-24).map((r) => ({ ...r, obs: r[climVar], oniObs: r.oni, oniFc: null }));
    const lastObs = obs[obs.length - 1];
    if (lastObs.obs != null) {
      lastObs.fc = lastObs.obs; // une la variable observada con su proyección
      lastObs.band = [lastObs.obs, lastObs.obs];
      others.forEach((s) => (lastObs[`alt_${s}`] = lastObs.obs));
    }
    if (lastObs) lastObs.oniFc = lastObs.oni; // la línea punteada sale del último ONI observado
    data = [
      ...obs,
      ...climate.forecast.map((f) => {
        const row = {
          label: f.label,
          mi: f.mi,
          fc: f[`${climVar}_${scenario}`],
          band: f[`${climVar}Band_${scenario}`],
          oniObs: null,
          oniFc: f[`oni_${scenario}`],
          isFc: true,
        };
        others.forEach((s) => (row[`alt_${s}`] = f[`${climVar}_${s}`]));
        return row;
      }),
    ];
  }

  // Resumen: primeros 6 meses (NOAA + transición) y promedio 5 años del escenario elegido
  const anomPct = (list) => {
    const m = list.reduce((s, f) => s + (f[`${climVar}_${scenario}`] - climate.clim[climVar][f.mi]), 0) / list.length;
    return (m / (climate.clim[climVar].reduce((a, b) => a + b, 0) / 12)) * 100;
  };
  const near = anomPct(climate.forecast.slice(0, 6));
  const longT = anomPct(climate.forecast);
  const pctTxt = (p) => (Math.abs(p) < 2 ? "cerca de lo normal" : `≈${Math.abs(p).toFixed(0)} % ${p > 0 ? "por encima" : "por debajo"} de lo normal`);
  const varLabel = isSci ? vm.tech : vm.citizen;
  const yDomain = ["auto", "auto"];
  const lastV = lastValid(climVar);
  const firstFc = climate.forecast[0];
  const lastFc = climate.forecast[climate.forecast.length - 1];
  const oniBarKey = phase === "prediccion" ? "oniObs" : "oni";
  const oniBarName = isSci ? "ONI observado (NOAA CPC)" : "ONI observado";

  return (
    <section className="panel p-4 lg:col-span-12">
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <h3 className="mr-auto flex items-center gap-2 text-sm font-semibold uppercase tracking-wider text-cyan-300">
          <Waves className="h-4 w-4" />{" "}
          {isSci ? "ENSO (ONI) vs variables de superficie · RB Colonso Chalupas" : "El Niño y la Reserva Colonso Chalupas"}
        </h3>
        <div className="flex flex-wrap rounded-xl border border-white/10 bg-space-800 p-0.5 text-xs" role="tablist" aria-label="Fase temporal">
          {PHASES.map((p) => {
            const Icon = p.icon;
            return (
              <button
                key={p.id}
                role="tab"
                aria-selected={phase === p.id}
                onClick={() => setPhase(p.id)}
                className={`flex items-center gap-1 rounded-lg px-2.5 py-1.5 ${phase === p.id ? "bg-gradient-to-r from-nasa-blue to-cyan-600 text-white" : "text-slate-400 hover:text-white"}`}
              >
                <Icon className="h-3.5 w-3.5" /> {p.label}
              </button>
            );
          })}
        </div>
      </div>
      <div className="mb-3 flex flex-wrap items-center gap-1.5 text-xs">
        {CLIMATE_VAR_KEYS.map((k) => {
          const Icon = CLIMATE_VARS[k].icon;
          return (
            <button
              key={k}
              onClick={() => setClimVar(k)}
              className={`flex items-center gap-1 rounded-md border px-2 py-1 ${climVar === k ? "border-cyan-400/60 bg-cyan-400/15 text-cyan-100" : "border-white/10 text-slate-300"}`}
            >
              <Icon className="h-3.5 w-3.5" style={{ color: CLIMATE_VARS[k].color }} /> {isSci ? CLIMATE_VARS[k].tech : CLIMATE_VARS[k].citizen}
              {phase !== "prediccion" && (
                <span className="rounded bg-emerald-500/30 px-1 text-[9px] font-bold uppercase text-emerald-200">satélite</span>
              )}
            </button>
          );
        })}
        {phase === "prediccion" && (
          <div className="ml-2 flex flex-wrap items-center gap-1" role="radiogroup" aria-label="Escenario ENSO">
            <span className="text-slate-400">Escenario:</span>
            {SCENARIO_KEYS.map((s) => (
              <button
                key={s}
                role="radio"
                aria-checked={scenario === s}
                onClick={() => setScenario(s)}
                className={`rounded-md border px-2 py-1 ${scenario === s ? "text-white" : "border-white/10 text-slate-300"}`}
                style={scenario === s ? { borderColor: ENSO_SCENARIOS[s].color, background: `${ENSO_SCENARIOS[s].color}33` } : undefined}
              >
                {ENSO_SCENARIOS[s].label}
              </button>
            ))}
          </div>
        )}
        {phase === "prediccion" ? (
          <p className="w-full rounded-lg border border-amber-400/40 bg-amber-500/10 px-3 py-2 text-[11px] leading-relaxed text-amber-100">
            <span className="font-semibold text-amber-50">{PREDICCION_ONI_LABEL}.</span> La línea punteada ámbar es el ONI de
            octubre 2026 a diciembre 2031. Esos números los armó el equipo; NOAA CPC no los publicó. Las barras de color son el ONI
            observado.
          </p>
        ) : (
          <Badge className="ml-auto">
            <Database className="h-3 w-3" /> {source}
          </Badge>
        )}
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-12">
        <div className="lg:col-span-8">
        <div className={phase === "prediccion" ? "h-[30rem]" : "h-72"}>
          <ResponsiveContainer width="100%" height="100%">
            <ComposedChart data={data} margin={{ top: 10, right: 10, left: 0, bottom: phase === "prediccion" ? 8 : 0 }}>
              <CartesianGrid stroke="rgba(255,255,255,0.06)" />
              <XAxis
                dataKey="label"
                tick={{ fill: "#94a3b8", fontSize: 10 }}
                interval={phase === "historico" ? 11 : phase === "prediccion" ? 8 : 0}
              />
              <YAxis yAxisId="v" tick={{ fill: "#94a3b8", fontSize: 10 }} domain={yDomain} unit={vm.unit ? ` ${vm.unit}` : ""} width={60} />
              <YAxis
                yAxisId="oni"
                orientation="right"
                domain={[-3, 3]}
                tick={{ fill: "#94a3b8", fontSize: 10 }}
                unit=" °C"
                width={45}
                allowDataOverflow
              />
              <Tooltip
                {...chartTooltip}
                content={({ active, payload, label }) => {
                  if (!active || !payload?.length) return null;
                  const filas = payload.filter((p) => p.value != null && !(Array.isArray(p.value) && p.value[0] == null));
                  if (!filas.length) return null;
                  const proyectado = filas.some((p) => p.name === PREDICCION_ONI_LABEL || String(p.name).includes("(predicción)"));
                  return (
                    <div style={{ background: "#0a0f1f", border: "1px solid rgba(34,211,238,0.35)", borderRadius: 10, padding: "8px 10px", maxWidth: 320, fontSize: 12 }}>
                      <p style={{ color: "#22d3ee", fontWeight: 600, margin: "0 0 4px" }}>{label}</p>
                      {filas.map((p) => {
                        const titulo = p.name === PREDICCION_ONI_LABEL ? "ONI proyectado" : p.name;
                        let texto;
                        if (p.name === PREDICCION_ONI_LABEL || String(p.name).startsWith("ONI")) {
                          texto = `${Number(p.value).toFixed(2)} °C`;
                        } else if (Array.isArray(p.value)) {
                          texto = `${fmt(p.value[0])} – ${fmt(p.value[1])} ${vm.unit}`;
                        } else {
                          texto = `${fmt(p.value)} ${vm.unit}`;
                        }
                        const unidadObs = String(p.name).startsWith("ONI") && p.name !== PREDICCION_ONI_LABEL ? " · anomalía, media móvil 3 meses" : "";
                        return (
                          <p key={p.dataKey || p.name} style={{ color: "#e2e8f0", margin: "2px 0" }}>
                            {titulo}: {texto}
                            {unidadObs}
                          </p>
                        );
                      })}
                      {proyectado && <p style={{ color: "#fde68a", margin: "6px 0 0", lineHeight: 1.35 }}>{PREDICCION_ONI_LABEL}</p>}
                    </div>
                  );
                }}
              />
              <Legend wrapperStyle={{ fontSize: 11, color: "#cbd5e1" }} />
              {phase === "historico" &&
                ENSO_EVENTS.map((e) => (
                  <ReferenceArea
                    key={e.label}
                    yAxisId="oni"
                    x1={e.from}
                    x2={e.to}
                    fill={e.color}
                    fillOpacity={0.08}
                    label={{ value: e.label, fill: e.color, fontSize: 10, position: "insideTop" }}
                  />
                ))}
              <ReferenceLine yAxisId="oni" y={0.5} stroke="rgba(239,68,68,0.35)" strokeDasharray="3 3" />
              <ReferenceLine yAxisId="oni" y={-0.5} stroke="rgba(59,130,246,0.35)" strokeDasharray="3 3" />
              <Bar yAxisId="oni" dataKey={oniBarKey} name={oniBarName} barSize={phase === "actual" ? 10 : 3} isAnimationActive={false}>
                {data.map((d) => (
                  <Cell key={d.label} fill={oniColor(d.oniObs ?? d.oni)} fillOpacity={0.8} />
                ))}
              </Bar>
              {phase === "prediccion" ? (
                <>
                  <Line
                    yAxisId="oni"
                    dataKey="oniFc"
                    name={PREDICCION_ONI_LABEL}
                    stroke="#fbbf24"
                    strokeWidth={2.5}
                    strokeDasharray="6 4"
                    dot={false}
                    connectNulls={false}
                    isAnimationActive={false}
                  />
                  <Area
                    yAxisId="v"
                    dataKey="band"
                    name="Rango de incertidumbre (predicción)"
                    stroke="none"
                    fill={sc.color}
                    fillOpacity={0.18}
                    isAnimationActive={false}
                  />
                  {others.map((s) => (
                    <Line
                      key={s}
                      yAxisId="v"
                      dataKey={`alt_${s}`}
                      name={`${ENSO_SCENARIOS[s].label} (predicción)`}
                      stroke={ENSO_SCENARIOS[s].color}
                      strokeOpacity={0.55}
                      strokeWidth={1.5}
                      strokeDasharray="4 3"
                      dot={false}
                      isAnimationActive={false}
                    />
                  ))}
                  <Line
                    yAxisId="v"
                    dataKey="obs"
                    name={`${varLabel} (observado)`}
                    stroke={vm.color}
                    strokeWidth={2}
                    dot={false}
                    isAnimationActive={false}
                  />
                  <Line
                    yAxisId="v"
                    dataKey="fc"
                    name={`${sc.label} (predicción)`}
                    stroke="#f8fafc"
                    strokeWidth={2}
                    strokeDasharray="6 4"
                    dot={false}
                    isAnimationActive={false}
                  />
                </>
              ) : (
                <>
                  <Line
                    yAxisId="v"
                    dataKey={climVar}
                    name={varLabel}
                    stroke={vm.color}
                    strokeWidth={2}
                    dot={phase === "actual" ? { r: 3 } : false}
                    connectNulls={false}
                    isAnimationActive={false}
                  />
                  {climVar === "precip" && isSci && (
                    <Line
                      yAxisId="v"
                      dataKey="precip_chirps"
                      name="CHIRPS v2.0 (satélite + estaciones, comparación)"
                      stroke="#a78bfa"
                      strokeWidth={1}
                      strokeDasharray="4 3"
                      dot={false}
                      isAnimationActive={false}
                    />
                  )}
                </>
              )}
              {phase === "actual" && <ReferenceLine yAxisId="v" x={MONTHS[month].label} stroke="#fc3d21" strokeDasharray="4 3" />}
            </ComposedChart>
          </ResponsiveContainer>
        </div>
          <div className="mt-2 space-y-1 text-[11px] leading-relaxed text-slate-400">
            {phase === "prediccion" && (
              <p className="text-amber-100">
                <span className="mr-2 inline-block w-6 border-t-2 border-dashed border-amber-300 align-middle" />
                <span className="font-semibold">{PREDICCION_ONI_LABEL}.</span> También van con línea punteada la variable elegida y los
                otros escenarios. Las barras son datos ya medidos.
              </p>
            )}
            <p className="flex flex-wrap items-center gap-1 text-[10px] text-slate-500">
              <Database className="h-3 w-3 shrink-0" />
              ONI observado: anomalía en °C, media móvil de 3 meses. Periodo: enero 2016 – septiembre 2026 (último{" "}
              {ENSO_REAL.metadata.oni.ultimo}). Fuente: NOAA CPC, ERSSTv5.{" "}
              <a className="text-cyan-300 hover:underline" href={ENSO_REAL.metadata.oni.url} target="_blank" rel="noreferrer">
                Tabla oficial oni.ascii.txt
              </a>
              . Descarga de la app: {ENSO_REAL.metadata.descargado}. Variable: {vm.src.producto} ({vm.src.via}).
              {climVar === "precip" && isSci && phase !== "prediccion" ? " Línea violeta: CHIRPS v2.0 (comparación)." : ""}
            </p>
          </div>
        </div>

        <div className="space-y-3 text-xs lg:col-span-4">
          {isSci ? (
            <>
              <div className="rounded-xl border border-white/5 bg-white/[0.03] p-3">
                <p className="mb-2 font-semibold text-white">Regresión anomalía(t) = a + b·ONI(t − lag)</p>
                <div className="grid grid-cols-3 gap-2 font-mono">
                  {[
                    ["r de Pearson", st.r.toFixed(2)],
                    ["Desfase", `${st.lag} mes${st.lag === 1 ? "" : "es"}`],
                    ["R²", st.r2.toFixed(2)],
                    ["b", `${st.b.toFixed(vm.dec + 1)} ${vm.unit}/°C`],
                    ["RMSE", `${st.rmse.toFixed(vm.dec + 1)} ${vm.unit}`],
                    ["n (meses)", st.n],
                    ["p", st.p < 0.001 ? "< 0,001" : st.p.toFixed(3)],
                    ["σ anomalía", `${climate.climSd[climVar].toFixed(vm.dec + 1)} ${vm.unit}`],
                  ].map(([k, v]) => (
                    <div key={k}>
                      <p className="font-sans text-[10px] uppercase tracking-wider text-slate-400">{k}</p>
                      <p className="text-sm font-bold text-white">{v}</p>
                    </div>
                  ))}
                </div>
              </div>
              <table className="w-full">
                <thead>
                  <tr className="text-left text-slate-400">
                    <th className="py-1 font-medium">Variable · producto</th>
                    <th className="py-1 text-right font-medium">r</th>
                    <th className="py-1 text-right font-medium">lag</th>
                  </tr>
                </thead>
                <tbody className="font-mono">
                  {CLIMATE_VAR_KEYS.map((k) => (
                    <tr key={k} className={`border-t border-white/5 ${k === climVar ? "text-cyan-200" : "text-slate-300"}`}>
                      <td className="py-1 font-sans">
                        {SRC[k].producto}
                      </td>
                      <td className="py-1 text-right">{climate.stats[k].r.toFixed(2)}</td>
                      <td className="py-1 text-right">{climate.stats[k].lag} m</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <p className="text-[11px] leading-relaxed text-slate-400">
                ONI observado y Niño 1+2: NOAA CPC, anomalía en °C, media móvil de 3 meses (ERSSTv5). Periodo enero 2016 – septiembre 2026
                (descarga {ENSO_REAL.metadata.descargado}; último ONI {ENSO_REAL.metadata.oni.ultimo}).{" "}
                <a className="text-cyan-300 hover:underline" href={ENSO_REAL.metadata.oni.url} target="_blank" rel="noreferrer">
                  Tabla oficial NOAA CPC
                </a>
                . {vm.tech}: {vm.src.via}, resolución {vm.src.res}, media sobre el polígono WDPA 555593903 (descarga {D_DESCARGA}; último mes{" "}
                {lastV.label}).
                {vm.src.nota ? ` ${vm.src.nota}` : ""} Anomalías respecto a la climatología 2016–2026 del propio sensor.
                {phase === "prediccion" && (
                  <>
                    {" "}
                    De {firstFc.label} a {lastFc.label}: {PREDICCION_ONI_LABEL}. Esos °C de ONI los escribió el equipo; no son una tabla de NOAA.
                    La curva de esta variable en la parte punteada sale de la regresión de arriba aplicada a esa predicción. La banda es
                    ±1,96·√(RMSE²(1+h/60) + (b·σONI)²) y se ensancha con el tiempo.
                  </>
                )}
              </p>
              <button
                onClick={() => exportClimateCsv(climate)}
                className="flex w-full items-center justify-center gap-1.5 rounded-lg bg-emerald-500/20 px-3 py-2 text-xs font-semibold text-emerald-200 ring-1 ring-emerald-400/30 hover:bg-emerald-500/30"
              >
                <FileSpreadsheet className="h-4 w-4" /> Exportar series 2016–2026 + escenarios 2031 (CSV)
              </button>
            </>
          ) : (
            <>
              <div className="rounded-xl border border-white/5 bg-white/[0.03] p-3">
                <p className="text-[10px] uppercase tracking-wider text-slate-400">
                  {phase === "prediccion" ? `Escenario: ${sc.label}` : `En ${MONTHS[month].long}`}
                </p>
                <p className="mt-1 text-sm font-semibold text-white">
                  {phase === "prediccion"
                    ? `${PREDICCION_ONI_LABEL}. Escenario «${sc.label}»: en los próximos meses, ${vm.citizen.toLowerCase()} ${pctTxt(near)}. Hasta diciembre de 2031, el promedio de este escenario queda ${pctTxt(longT)}.`
                    : `El Pacífico está en fase ${ensoPhase(curRow.oni)} (ONI ${curRow.oni > 0 ? "+" : ""}${curRow.oni.toFixed(2)} °C, anomalía, media móvil de 3 meses). ${vm.citizen}: ${curRow[climVar] == null ? `dato satelital aún no disponible (último: ${lastV.label})` : `${fmt(curRow[climVar])} ${vm.unit} (normal del mes: ${fmt(climate.clim[climVar][curRow.mi])} ${vm.unit})`}.`}
                </p>
                {phase !== "prediccion" && (
                  <p className="mt-2 text-[11px] font-normal leading-relaxed text-slate-400">
                    Fuente del ONI observado: NOAA CPC, enero 2016 – septiembre 2026.{" "}
                    <a className="text-cyan-300 hover:underline" href={ENSO_REAL.metadata.oni.url} target="_blank" rel="noreferrer">
                      Ver la tabla oficial
                    </a>
                    .
                  </p>
                )}
              </div>
              {phase === "prediccion" && (
                <div className="flex gap-2 rounded-xl bg-amber-500/10 p-3 text-slate-300 ring-1 ring-amber-400/30">
                  <TriangleAlert className="mt-0.5 h-4 w-4 shrink-0 text-amber-300" />
                  <p className="leading-relaxed">
                    <b className="text-white">Son escenarios del equipo, no certezas.</b> {PREDICCION_ONI_LABEL}. Nadie puede saber hoy cómo estará
                    el Pacífico en 2030. La línea punteada es la predicción; las barras son mediciones ya hechas. La franja de color se ensancha
                    porque la incertidumbre crece con el tiempo. Sirve para prepararse (guardar agua, cuidar el bosque), no como un número exacto.
                  </p>
                </div>
              )}
              <div className="flex gap-2 rounded-xl bg-nasa-blue/20 p-3 text-slate-300">
                <Info className="mt-0.5 h-4 w-4 shrink-0 text-cyan-300" />
                <p className="leading-relaxed">
                  <b className="text-white">¿Qué es El Niño?</b> Cada pocos años el océano Pacífico frente a Ecuador y Perú se calienta (El Niño) o se
                  enfría (La Niña). Los satélites de la NASA muestran que aquí, en la cabecera del río Napo, El Niño se nota sobre todo en el calor: unos 5
                  meses después la superficie se calienta (relación clara). Sobre la lluvia el efecto es débil y no siempre igual: en 2023-24 llovió algo menos, pero en
                  2026 los satélites no coinciden. El bosque de Colonso Chalupas funciona como una esponja que guarda agua para Tena y Archidona.
                </p>
              </div>
              <div className="flex flex-wrap gap-2 text-[11px]">
                <span className="flex items-center gap-1">
                  <span className="h-2.5 w-2.5 rounded-sm bg-red-500" /> El Niño (mar cálido)
                </span>
                <span className="flex items-center gap-1">
                  <span className="h-2.5 w-2.5 rounded-sm bg-blue-500" /> La Niña (mar frío)
                </span>
                <span className="flex items-center gap-1">
                  <span className="h-2.5 w-2.5 rounded-sm bg-slate-500" /> Neutral
                </span>
              </div>
            </>
          )}
        </div>
      </div>
    </section>
  );
}
/* ============================================================================
 *  APLICACIÓN PRINCIPAL
 * ========================================================================== */
const DEFAULT_A = "2026-06-26_D011";
const DEFAULT_B = "2026-10-24_D011";

export default function App() {
  // Enlace profundo opcional: ?modo=cientifico&comparar=opacidad&fase=prediccion&escenario=lanina&variable=precip&a=2026-06-26_D011&b=2026-10-24_D011&gibs=ndvi
  const params = typeof window !== "undefined" ? new URLSearchParams(window.location.search) : new URLSearchParams();
  const [mode, setMode] = useState(params.get("modo") === "cientifico" ? "cientifico" : "ciudadano");
  const [month, setMonth] = useState(11);
  const [playing, setPlaying] = useState(false);
  const [compareMode, setCompareMode] = useState(params.get("comparar") === "opacidad" ? "opacity" : "swipe");
  const [swipePos, setSwipePos] = useState(0.5);
  const [opacityA, setOpacityA] = useState(0.85);
  const [opacityB, setOpacityB] = useState(0.85);
  const [keyA, setKeyA] = useState(NISAR_BY_KEY[params.get("a")] ? params.get("a") : DEFAULT_A);
  const [keyB, setKeyB] = useState(NISAR_BY_KEY[params.get("b")] ? params.get("b") : DEFAULT_B);
  const [gibsKey, setGibsKey] = useState(GIBS_LAYERS[params.get("gibs")] ? params.get("gibs") : "none");
  const [phase, setPhase] = useState(PHASES.some((p) => p.id === params.get("fase")) ? params.get("fase") : "actual");
  const [climVar, setClimVar] = useState(CLIMATE_VARS[params.get("variable")] ? params.get("variable") : CLIMATE_VAR_KEYS[0]);
  const [climate, setClimate] = useState(CLIMATE_REAL);
  const [climateSource, setClimateSource] = useState(`Satélite NASA + ONI NOAA · descargado ${D_DESCARGA}`);
  const [scenario, setScenario] = useState(ENSO_SCENARIOS[params.get("escenario")] ? params.get("escenario") : "lanina");
  const mapWrapRef = useRef(null);
  const draggingRef = useRef(false);
  const isSci = mode === "cientifico";

  const gA = NISAR_BY_KEY[keyA];
  const gB = NISAR_BY_KEY[keyB];
  const sameTrack = gA.track === gB.track;
  const daysAB = Math.round((new Date(gB.date) - new Date(gA.date)) / 86400000);
  const geotiffUrls = CONFIG.NISAR_GEOTIFF_URLS[ZONE.id] || {};
  const gibsCfg = GIBS_LAYERS[gibsKey];
  const gibs = gibsCfg.layer
    ? fetchNASAGibsLayer({ layer: gibsCfg.layer, date: gibsCfg.date(MONTHS[month]), tileMatrixSet: gibsCfg.tileMatrixSet, format: gibsCfg.format, maxNativeZoom: gibsCfg.maxNativeZoom })
    : null;

  // ONI en vivo (opcional, CONFIG.USE_LIVE_FETCH = true)
  useEffect(() => {
    let alive = true;
    fetchNOAA_ONI().then((list) => {
      if (!alive || !list) return;
      const live = Object.fromEntries(list.map((x) => [x.date, x.oni]));
      setClimate(buildClimate(buildClimateRows(live)));
      setClimateSource(`En vivo: NOAA CPC ONI · resto satélite NASA (${D_DESCARGA})`);
    });
    return () => {
      alive = false;
    };
  }, []);

  // Reproductor de la línea de tiempo
  useEffect(() => {
    if (!playing) return undefined;
    const id = setInterval(() => setMonth((m) => (m + 1) % 12), 1400);
    return () => clearInterval(id);
  }, [playing]);

  // Arrastre de la cortina
  useEffect(() => {
    const move = (e) => {
      if (!draggingRef.current || !mapWrapRef.current) return;
      const rect = mapWrapRef.current.getBoundingClientRect();
      const x = (e.touches ? e.touches[0].clientX : e.clientX) - rect.left;
      setSwipePos(clamp(x / rect.width, 0.02, 0.98));
    };
    const up = () => (draggingRef.current = false);
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
    return () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
    };
  }, []);

  const indicators = useMemo(() => monthIndicators(climate, month), [climate, month]);
  const worst = indicators.some((i) => i.level === "rojo") ? "rojo" : indicators.some((i) => i.level === "amarillo") ? "amarillo" : "verde";
  const smRows = useMemo(() => climate.rows.filter((r) => r.sm != null), [climate]);

  const exportSeriesCsv = () => {
    const rows = climate.rows.map((r) => ({
      fecha: r.date,
      oni_noaa: r.oni,
      nino12_noaa: r.nino12 ?? "",
      precip_imerg_mm: r.precip ?? "",
      precip_chirps_mm_comparacion: r.precip_chirps ?? "",
      ndvi_mod13c2: r.ndvi ?? "",
      lst_dia_mod11c3_c: r.lst ?? "",
      humedad_smap_pct: r.sm ?? "",
    }));
    downloadFile("nisar-pulse_colonso_series_satelitales_2016-2026.csv", rowsToCsv(rows), "text/csv;charset=utf-8");
  };
  const exportNisarCsv = () => {
    const rows = NISAR.map((n) => ({
      fecha: n.date,
      hora: n.time,
      granulo: n.granule,
      coleccion: n.collection,
      paso: n.direction,
      track: n.track,
      frame: n.frame,
      ciclo: n.cycle,
      polarizacion: n.pol,
      tamano_mb: n.size_mb,
      hdf5: n.h5,
      vista_previa: n.browse,
      reporte_qa: n.qa,
    }));
    downloadFile("nisar-pulse_colonso_granulos_NISAR_GCOV.csv", rowsToCsv(rows), "text/csv;charset=utf-8");
  };
  const exportGeoJSON = () => {
    const r = climate.rows[climateIdx(climate, month)];
    const fc = {
      type: "FeatureCollection",
      features: [
        {
          type: "Feature",
          geometry: COLONSO_WDPA.features[0].geometry,
          properties: {
            nombre: "Reserva Biológica Colonso Chalupas",
            wdpaid: 555593903,
            mes: r.date,
            oni_noaa: r.oni,
            precip_imerg_mm: r.precip,
            ndvi_mod13c2: r.ndvi,
            lst_dia_mod11c3_c: r.lst,
            humedad_smap_pct: r.sm,
            bosque_2000_ha: round(HANSEN.forest2000_ha, 1),
            perdida_2001_2025_ha: HANSEN.total_loss_ha,
            fuente: `WDPA (UNEP-WCMC & IUCN); NASA GES DISC, LP DAAC, NSIDC; UMD GLAD; NOAA CPC — descarga ${D_DESCARGA}`,
          },
        },
        ...[gA, gB].map((g, i) => {
          const [[s, w], [n, e]] = g.bounds;
          return {
            type: "Feature",
            geometry: { type: "Polygon", coordinates: [[[w, s], [e, s], [e, n], [w, n], [w, s]]] },
            properties: { rol: i === 0 ? "A" : "B", granulo: g.granule, fecha: g.date, paso: g.direction, track: g.track, frame: g.frame, hdf5: g.h5 },
          };
        }),
      ],
    };
    downloadFile(`nisar-pulse_colonso_${r.date}.geojson`, JSON.stringify(fc, null, 2), "application/geo+json");
  };

  const nisarSelect = (value, onChange, label) => (
    <select value={value} onChange={(e) => onChange(e.target.value)} className="max-w-[11rem] rounded-md border border-white/10 bg-space-800 px-2 py-1 text-xs" aria-label={label}>
      {NISAR_TRACKS.map((t) => (
        <optgroup key={t} label={t}>
          {NISAR.filter((n) => `${n.direction} · track ${n.track} · frame ${n.frame}` === t).map((n) => (
            <option key={NISAR_KEY(n)} value={NISAR_KEY(n)}>
              {fmtDate(n.date)} · {n.direction === "Ascendente" ? "Asc" : "Desc"}
            </option>
          ))}
        </optgroup>
      ))}
    </select>
  );

  return (
    <div className="starfield relative min-h-screen text-slate-200">
      {/* ================= BARRA SUPERIOR ================= */}
      <header className="sticky top-0 z-[1000] border-b border-white/10 bg-space-950/85 backdrop-blur-lg">
        <div className="mx-auto flex max-w-[1600px] flex-wrap items-center gap-3 px-4 py-3">
          <div className="flex items-center gap-3">
            <div className="relative flex h-11 w-11 items-center justify-center rounded-full bg-gradient-to-br from-nasa-blue to-cyan-500 shadow-glow">
              <Satellite className="h-6 w-6 text-white" />
              <span className="pulse-dot absolute -right-0.5 -top-0.5 h-3 w-3 rounded-full bg-nasa-red" />
            </div>
            <div>
              <h1 className="text-lg font-extrabold leading-tight tracking-tight text-white sm:text-xl">
                NISAR <span className="text-cyan-400">Pulse</span>
              </h1>
              <p className="text-[11px] text-slate-400 sm:text-xs">El Niño en la Reserva Colonso Chalupas · Visualizador Accesible de Ritmos de la Tierra</p>
            </div>
          </div>
          {phase !== "prediccion" && (
            <div className="order-3 hidden items-center gap-2 rounded-xl border border-emerald-400/40 bg-emerald-400/10 px-3 py-1.5 text-sm font-medium text-emerald-100 md:order-none md:ml-6 md:flex">
              <Satellite className="h-4 w-4" /> 100 % datos satelitales reales · NASA Earthdata
            </div>
          )}
          <div className="ml-auto flex items-center rounded-full border border-white/10 bg-space-800 p-1" role="radiogroup" aria-label="Perfil de usuario">
            <button
              role="radio"
              aria-checked={!isSci}
              onClick={() => setMode("ciudadano")}
              className={`flex items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-semibold transition sm:text-sm ${
                !isSci ? "bg-gradient-to-r from-emerald-500 to-cyan-500 text-white shadow" : "text-slate-400 hover:text-white"
              }`}
            >
              <GraduationCap className="h-4 w-4" /> Ciudadano / Educativo
            </button>
            <button
              role="radio"
              aria-checked={isSci}
              onClick={() => setMode("cientifico")}
              className={`flex items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-semibold transition sm:text-sm ${
                isSci ? "bg-gradient-to-r from-nasa-blue to-nasa-red text-white shadow" : "text-slate-400 hover:text-white"
              }`}
            >
              <Microscope className="h-4 w-4" /> Científico / Gestor
            </button>
          </div>
        </div>
      </header>

      <main className="relative z-10 mx-auto grid max-w-[1600px] grid-cols-1 gap-4 p-4 lg:grid-cols-12">
        {/* ================= MAPA + COMPARADOR NISAR ================= */}
        <section className="panel flex flex-col overflow-hidden lg:col-span-8">
          <div className="flex flex-wrap items-center gap-2 border-b border-white/10 p-3">
            <div className="mr-auto min-w-0">
              <h2 className="flex items-center gap-2 truncate text-base font-bold text-white">
                <Globe className="h-4 w-4 text-cyan-400" /> {ZONE.name}
              </h2>
              <p className="text-xs text-slate-400">{isSci ? ZONE.techTitle : ZONE.citizenTitle}</p>
            </div>
            <div className="flex rounded-lg border border-white/10 bg-space-800 p-0.5 text-xs">
              <button
                onClick={() => setCompareMode("swipe")}
                className={`flex items-center gap-1 rounded-md px-2.5 py-1.5 ${compareMode === "swipe" ? "bg-cyan-500/20 text-cyan-200" : "text-slate-400"}`}
              >
                <Columns2 className="h-3.5 w-3.5" /> Cortina
              </button>
              <button
                onClick={() => setCompareMode("opacity")}
                className={`flex items-center gap-1 rounded-md px-2.5 py-1.5 ${compareMode === "opacity" ? "bg-cyan-500/20 text-cyan-200" : "text-slate-400"}`}
              >
                <SlidersHorizontal className="h-3.5 w-3.5" /> Opacidad dual
              </button>
            </div>
            <label className="flex items-center gap-1 text-xs text-slate-300">
              <Calendar className="h-3.5 w-3.5 text-amber-300" /> A {nisarSelect(keyA, setKeyA, "Radar NISAR fecha A (antes)")}
            </label>
            <label className="flex items-center gap-1 text-xs text-slate-300">
              <Calendar className="h-3.5 w-3.5 text-cyan-300" /> B {nisarSelect(keyB, setKeyB, "Radar NISAR fecha B (después)")}
            </label>
          </div>

          <div className="flex flex-wrap items-center gap-2 border-b border-white/10 bg-space-800/50 px-3 py-2 text-xs">
            <span className="flex items-center gap-1 text-slate-400">
              <Layers className="h-3.5 w-3.5" /> Capa NASA GIBS del mes ({MONTHS[month].label}):
            </span>
            {Object.entries(GIBS_LAYERS).map(([k, v]) => (
              <button
                key={k}
                onClick={() => setGibsKey(k)}
                className={`rounded-md border px-2 py-1 ${gibsKey === k ? "border-cyan-400/60 bg-cyan-400/15 text-cyan-200" : "border-white/10 text-slate-300"}`}
              >
                {v.label}
              </button>
            ))}
            {isSci && (
              <span className="ml-auto font-mono text-[11px] text-slate-400">
                NISAR L2 GCOV · Banda L · {gA.pol} (HH/HV) · {sameTrack ? `mismo track ${gA.track}, Δt = ${daysAB} días` : "tracks distintos (geometría distinta)"}
              </span>
            )}
          </div>

          <div ref={mapWrapRef} className="relative min-h-[460px] w-full flex-1 sm:min-h-[540px] lg:min-h-[600px]">
            <MapContainer center={ZONE.center} zoom={ZONE.zoom} className="absolute inset-0" zoomControl scrollWheelZoom>
              <TileLayer url={CONFIG.BASEMAP_URL} maxZoom={18} attribution="Imágenes &copy; Esri, Maxar, Earthstar Geographics" />

              {/* Capa WMS de Sentinel-1 / NISAR (se activa al llenar CONFIG.SENTINEL1_WMS_URL) */}
              {CONFIG.SENTINEL1_WMS_URL && (
                <WMSTileLayer
                  url={CONFIG.SENTINEL1_WMS_URL}
                  params={{ layers: CONFIG.SENTINEL1_WMS_LAYER, format: "image/png", transparent: true, time: `${MONTHS[month].ym}-15` }}
                  opacity={0.7}
                />
              )}
              {/* Teselas XYZ/WMTS propias de NISAR (p. ej. titiler sobre COG) */}
              {CONFIG.NISAR_WMTS_TEMPLATE && <TileLayer url={CONFIG.NISAR_WMTS_TEMPLATE} opacity={0.7} />}

              {/* GeoTIFF/COG propios (CONFIG.NISAR_GEOTIFF_URLS) → mismos panes del comparador */}
              <GeoTIFFOverlay url={geotiffUrls.before} pane="beforePane" opacity={0.75} />
              <GeoTIFFOverlay url={geotiffUrls.after} pane="afterPane" opacity={0.75} />

              {/* Fecha A (antes) → lado izquierdo de la cortina */}
              <Pane name="beforePane" style={{ zIndex: 420 }}>
                <NisarOverlay granule={gA} opacity={compareMode === "opacity" ? opacityA : 0.9} />
              </Pane>
              {/* Fecha B (después) → lado derecho */}
              <Pane name="afterPane" style={{ zIndex: 430 }}>
                <NisarOverlay granule={gB} opacity={compareMode === "opacity" ? opacityB : 0.9} />
              </Pane>
              {/* Capa GIBS que sigue a la línea de tiempo */}
              <Pane name="gibsPane" style={{ zIndex: 440 }}>{gibs && <TileLayer key={gibs.url} url={gibs.url} {...gibs.options} />}</Pane>
              <Pane name="labelsPane" style={{ zIndex: 450, pointerEvents: "none" }}>
                <TileLayer url={CONFIG.LABELS_URL} maxZoom={18} />
                <Polygon positions={ZONE.polygon} pathOptions={{ color: "#facc15", weight: 2.5, dashArray: "6 4", fill: false }} interactive={false} />
                {isSci && <Rectangle bounds={gB.bounds} pathOptions={{ color: "#22d3ee", weight: 1, dashArray: "2 4", fill: false }} interactive={false} />}
              </Pane>
              <SwipeController enabled={compareMode === "swipe"} position={swipePos} />
            </MapContainer>

            {compareMode === "swipe" && (
              <>
                <div className="swipe-handle" style={{ left: `calc(${swipePos * 100}% - 1.5px)` }}>
                  <div
                    className="swipe-knob"
                    role="slider"
                    aria-label="Mover cortina antes/después"
                    aria-valuemin={0}
                    aria-valuemax={100}
                    aria-valuenow={Math.round(swipePos * 100)}
                    tabIndex={0}
                    onPointerDown={(e) => {
                      e.preventDefault();
                      draggingRef.current = true;
                    }}
                    onKeyDown={(e) => {
                      if (e.key === "ArrowLeft") setSwipePos((p) => clamp(p - 0.03, 0.02, 0.98));
                      if (e.key === "ArrowRight") setSwipePos((p) => clamp(p + 0.03, 0.02, 0.98));
                    }}
                  >
                    <ChevronsLeftRight className="h-5 w-5" />
                  </div>
                </div>
                <div className="pointer-events-none absolute left-14 top-3 z-[640] rounded-lg bg-black/70 px-2.5 py-1 text-xs font-semibold text-amber-200">
                  A · NISAR {fmtDate(gA.date)}
                </div>
                <div className="pointer-events-none absolute right-3 top-3 z-[640] rounded-lg bg-black/70 px-2.5 py-1 text-xs font-semibold text-cyan-200">
                  B · NISAR {fmtDate(gB.date)}
                </div>
              </>
            )}

            {compareMode === "opacity" && (
              <div className="absolute right-3 top-3 z-[640] w-56 rounded-xl border border-white/10 bg-black/75 p-3 text-xs backdrop-blur">
                <p className="mb-2 flex items-center gap-1 font-semibold text-slate-200">
                  <Eye className="h-3.5 w-3.5" /> Opacidad de capas
                </p>
                <label className="block text-amber-200">
                  A · {fmtDate(gA.date)}: {Math.round(opacityA * 100)}%
                  <input type="range" min={0} max={1} step={0.05} value={opacityA} onChange={(e) => setOpacityA(Number(e.target.value))} className="nisar-range mt-1 w-full" />
                </label>
                <label className="mt-2 block text-cyan-200">
                  B · {fmtDate(gB.date)}: {Math.round(opacityB * 100)}%
                  <input type="range" min={0} max={1} step={0.05} value={opacityB} onChange={(e) => setOpacityB(Number(e.target.value))} className="nisar-range mt-1 w-full" />
                </label>
              </div>
            )}

            {/* Leyenda */}
            <div className="absolute bottom-6 left-3 z-[640] w-72 rounded-xl border border-white/10 bg-black/80 p-3 text-[11px] backdrop-blur">
              <p className="mb-1 flex items-center gap-1 font-semibold text-slate-200">
                <Radar className="h-3.5 w-3.5 text-cyan-300" /> {isSci ? "NISAR GCOV · vista previa RGB HH/HV (Banda L)" : "Radar NISAR: ve a través de las nubes"}
              </p>
              <div className="flex gap-2">
                <span className="flex items-center gap-1">
                  <span className="h-2.5 w-2.5 rounded-sm" style={{ background: "#e8f5e0" }} /> {isSci ? "HV alto (volumen)" : "Bosque denso"}
                </span>
                <span className="flex items-center gap-1">
                  <span className="h-2.5 w-2.5 rounded-sm" style={{ background: "#c050c0" }} /> {isSci ? "HH ≫ HV (superficie)" : "Páramo / suelo abierto"}
                </span>
                <span className="flex items-center gap-1">
                  <span className="h-2.5 w-2.5 rounded-sm bg-black ring-1 ring-white/30" /> {isSci ? "baja σ⁰" : "Agua / sombra"}
                </span>
              </div>
              <p className="mt-1 text-[10px] text-slate-400">
                <span className="inline-block h-0.5 w-4 bg-yellow-400 align-middle" /> Límite oficial WDPA 555593903
              </p>
              <SourceNote>
                NASA/JPL-ISRO NISAR vía ASF DAAC (CMR) · {gA.collection.replace("NISAR_L2_", "")} / {gB.collection.replace("NISAR_L2_", "")} · descargado {D_DESCARGA}
                {gibs ? ` · Capa: NASA GIBS ${gibsCfg.layer} (${gibsCfg.date(MONTHS[month])})` : ""}
              </SourceNote>
            </div>
          </div>
        </section>

        {/* ================= PANEL LATERAL ================= */}
        <aside className="flex flex-col gap-4 lg:col-span-4">
          <div className="panel p-4">
            <SectionTitle icon={Gauge} right={<Badge>{MONTHS[month].long}</Badge>}>
              {isSci ? "Anomalías del mes (satélite)" : "Semáforo de la reserva"}
            </SectionTitle>
            {!isSci && (
              <div className={`mb-3 flex items-center gap-3 rounded-xl p-3 ring-1 ${LEVELS[worst].ring} ${LEVELS[worst].bg}`}>
                <TrafficLight level={worst} />
                <div>
                  <p className="text-xs uppercase tracking-wider text-slate-400">En pocas palabras</p>
                  <p className="text-sm font-semibold text-white">
                    {worst === "verde" && "Todo tranquilo: la reserva late a su ritmo normal."}
                    {worst === "amarillo" && "Atención: hay cambios que conviene vigilar."}
                    {worst === "rojo" && "Alerta: hay señales fuertes (como El Niño en el Pacífico) que conviene vigilar en la reserva."}
                  </p>
                </div>
              </div>
            )}
            <ul className="space-y-2">
              {indicators.map((ind) => {
                const Icon = ind.icon;
                return (
                  <li key={ind.key} className="flex gap-3 rounded-xl border border-white/5 bg-white/[0.03] p-2.5">
                    <span className="mt-1 h-3 w-3 shrink-0 rounded-full" style={{ background: LEVELS[ind.level].color, boxShadow: `0 0 8px ${LEVELS[ind.level].color}` }} />
                    <div className="min-w-0 flex-1">
                      <p className="flex items-center gap-1.5 text-xs font-semibold text-white">
                        <Icon className="h-3.5 w-3.5 text-cyan-300" /> {isSci ? ind.tech : ind.title}
                      </p>
                      <p className="font-mono text-sm text-cyan-100">{ind.value}</p>
                      {!isSci && <p className="text-[11px] leading-snug text-slate-400">{ind.text}</p>}
                      <p className="text-[10px] text-slate-500">
                        Fuente: {ind.source}
                        {ind.sourceUrl && (
                          <>
                            {" "}
                            ·{" "}
                            <a className="text-cyan-300 hover:underline" href={ind.sourceUrl} target="_blank" rel="noreferrer">
                              NOAA CPC
                            </a>
                          </>
                        )}
                      </p>
                    </div>
                  </li>
                );
              })}
            </ul>
          </div>

          {isSci && (
            <div className="panel p-4">
              <SectionTitle icon={Radar}>Gránulos NISAR del comparador</SectionTitle>
              {[
                ["A", gA, "text-amber-200"],
                ["B", gB, "text-cyan-200"],
              ].map(([k, g, c]) => (
                <div key={k} className="mb-2 rounded-lg border border-white/5 bg-white/[0.03] p-2 text-[11px]">
                  <p className={`font-semibold ${c}`}>
                    {k} · {fmtDate(g.date)} {g.time} · {g.direction} · track {g.track} · frame {g.frame} · ciclo {g.cycle}
                  </p>
                  <p className="break-all font-mono text-[10px] text-slate-400">{g.granule}</p>
                  <p className="mt-1 flex flex-wrap gap-2 text-[10px]">
                    <a className="flex items-center gap-0.5 text-cyan-300 hover:underline" href={g.h5} target="_blank" rel="noreferrer">
                      <ExternalLink className="h-3 w-3" /> HDF5 ({(g.size_mb / 1024).toFixed(1)} GB, Earthdata Login)
                    </a>
                    <a className="flex items-center gap-0.5 text-cyan-300 hover:underline" href={g.browse} target="_blank" rel="noreferrer">
                      <ExternalLink className="h-3 w-3" /> Vista previa
                    </a>
                    {g.qa && (
                      <a className="flex items-center gap-0.5 text-cyan-300 hover:underline" href={g.qa} target="_blank" rel="noreferrer">
                        <ExternalLink className="h-3 w-3" /> Reporte QA
                      </a>
                    )}
                  </p>
                </div>
              ))}
              <p className="text-[11px] leading-relaxed text-slate-400">
                {NISAR.length} adquisiciones GCOV con vista previa sobre la reserva ({fmtDate(NISAR[0].date)} → {fmtDate(NISAR[NISAR.length - 1].date)}), dos geometrías
                (ascendente track 76 y descendente track 11, revisita 12 días). Desplazamiento InSAR (GUNW) y humedad NISAR (L3 SME2): aún sin productos sobre la reserva en
                CMR al {D_DESCARGA}, por eso no se muestran.
              </p>
              <div className="mt-3 grid grid-cols-3 gap-2">
                <button
                  onClick={exportSeriesCsv}
                  className="flex items-center justify-center gap-1 rounded-lg bg-emerald-500/20 px-2 py-2 text-[11px] font-semibold text-emerald-200 ring-1 ring-emerald-400/30 hover:bg-emerald-500/30"
                >
                  <FileSpreadsheet className="h-4 w-4" /> Series CSV
                </button>
                <button
                  onClick={exportNisarCsv}
                  className="flex items-center justify-center gap-1 rounded-lg bg-cyan-500/20 px-2 py-2 text-[11px] font-semibold text-cyan-200 ring-1 ring-cyan-400/30 hover:bg-cyan-500/30"
                >
                  <FileSpreadsheet className="h-4 w-4" /> NISAR CSV
                </button>
                <button
                  onClick={exportGeoJSON}
                  className="flex items-center justify-center gap-1 rounded-lg bg-violet-500/20 px-2 py-2 text-[11px] font-semibold text-violet-200 ring-1 ring-violet-400/30 hover:bg-violet-500/30"
                >
                  <FileJson className="h-4 w-4" /> GeoJSON
                </button>
              </div>
            </div>
          )}

          {!isSci && (
            <div className="panel p-4 text-xs leading-relaxed text-slate-300">
              <SectionTitle icon={Info}>¿Qué estoy viendo?</SectionTitle>
              <p>
                El mapa muestra imágenes reales del radar <b className="text-white">NISAR</b> (NASA e ISRO), que ve el suelo aunque haya nubes, algo clave en esta zona donde
                casi siempre está nublado. Mueve la cortina para comparar dos fechas. Los semáforos usan mediciones de satélites de la NASA comparadas con lo normal
                de cada mes desde 2016.
              </p>
            </div>
          )}
        </aside>

        {/* ================= LÍNEA DE TIEMPO ================= */}
        <section className="panel p-4 lg:col-span-12">
          <div className="flex flex-wrap items-center gap-3">
            <SectionTitle icon={Clock}>Línea de tiempo · {MONTHS[0].label} → {MONTHS[11].label}</SectionTitle>
            <div className="ml-auto flex items-center gap-2">
              <button onClick={() => setMonth((m) => (m + 11) % 12)} className="rounded-lg border border-white/10 p-2 hover:bg-white/5" aria-label="Mes anterior">
                <SkipBack className="h-4 w-4" />
              </button>
              <button
                onClick={() => setPlaying((p) => !p)}
                className="flex items-center gap-1.5 rounded-lg bg-gradient-to-r from-nasa-blue to-cyan-600 px-4 py-2 text-sm font-semibold text-white"
                aria-label={playing ? "Pausar animación" : "Reproducir animación"}
              >
                {playing ? <Pause className="h-4 w-4" /> : <Play className="h-4 w-4" />}
                {playing ? "Pausar" : "Reproducir"}
              </button>
              <button onClick={() => setMonth((m) => (m + 1) % 12)} className="rounded-lg border border-white/10 p-2 hover:bg-white/5" aria-label="Mes siguiente">
                <SkipForward className="h-4 w-4" />
              </button>
            </div>
          </div>
          <input
            type="range"
            min={0}
            max={11}
            value={month}
            onChange={(e) => {
              setPlaying(false);
              setMonth(Number(e.target.value));
            }}
            className="nisar-range mt-2 w-full"
            aria-label="Mes de la línea de tiempo"
          />
          <div className="mt-1 flex justify-between text-[10px] text-slate-500">
            {MONTHS.map((m) => (
              <button key={m.k} onClick={() => setMonth(m.k)} className={m.k === month ? "font-bold text-cyan-300" : "hover:text-slate-300"}>
                {m.label}
              </button>
            ))}
          </div>
          <p className="mt-1 text-[10px] text-slate-500">La línea de tiempo actualiza los semáforos, la capa NASA GIBS del mapa y el marcador del gráfico «Actual».</p>
        </section>

        {/* ================= PANEL CLIMÁTICO ================= */}
        <ClimatePanel
          climate={climate}
          source={climateSource}
          phase={phase}
          setPhase={setPhase}
          climVar={climVar}
          setClimVar={setClimVar}
          scenario={scenario}
          setScenario={setScenario}
          isSci={isSci}
          month={month}
        />

        {/* ================= GRÁFICOS SATELITALES ================= */}
        {CLIMATE_VARS.sm && (
          <section className="panel p-4 lg:col-span-4">
            <SectionTitle icon={Droplets}>{isSci ? "Humedad superficial SMAP (% vol)" : "¿Qué tan húmedo está el suelo?"}</SectionTitle>
            <div className="h-56">
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={smRows} margin={{ top: 5, right: 10, left: -15, bottom: 0 }}>
                  <CartesianGrid stroke="rgba(255,255,255,0.06)" />
                  <XAxis dataKey="label" tick={{ fill: "#94a3b8", fontSize: 10 }} interval={11} />
                  <YAxis tick={{ fill: "#94a3b8", fontSize: 10 }} domain={["auto", "auto"]} unit="%" />
                  <Tooltip {...chartTooltip} formatter={(v) => [`${Number(v).toFixed(1)} %`, "Humedad SMAP"]} />
                  <Line dataKey="sm" stroke="#22d3ee" strokeWidth={1.5} dot={false} isAnimationActive={false} name="Humedad SMAP" />
                </LineChart>
              </ResponsiveContainer>
            </div>
            <SourceNote>
              {SRC.sm.producto} · {SRC.sm.via} · descargado {D_DESCARGA}. {isSci ? SRC.sm.nota : "Valor relativo: el bosque muy denso dificulta la medición."}
            </SourceNote>
          </section>
        )}

        <section className="panel p-4 lg:col-span-4">
          <SectionTitle icon={Trees}>{isSci ? "Pérdida anual de cobertura arbórea (ha)" : "¿Cuánto bosque se perdió cada año?"}</SectionTitle>
          <div className="h-56">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={HANSEN_ROWS} margin={{ top: 5, right: 10, left: -15, bottom: 0 }}>
                <CartesianGrid stroke="rgba(255,255,255,0.06)" />
                <XAxis dataKey="year" tick={{ fill: "#94a3b8", fontSize: 10 }} interval={3} />
                <YAxis tick={{ fill: "#94a3b8", fontSize: 10 }} unit=" ha" width={55} />
                <Tooltip {...chartTooltip} formatter={(v) => [`${Number(v).toFixed(1)} ha`, "Pérdida"]} />
                <ReferenceLine y={HANSEN_MEAN} stroke="#fbbf24" strokeDasharray="4 3" />
                <Bar dataKey="ha" isAnimationActive={false}>
                  {HANSEN_ROWS.map((r) => (
                    <Cell key={r.year} fill={["2016", "2024", "2025"].includes(r.year) ? "#f97316" : "#4ade80"} />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
          <p className="text-[11px] text-slate-400">
            {isSci
              ? `Bosque 2000 (cobertura ≥ 30 %): ${HANSEN.forest2000_ha.toLocaleString("es-MX", { maximumFractionDigits: 0 })} ha · pérdida 2001–2025: ${HANSEN.total_loss_ha.toFixed(1)} ha (${((HANSEN.total_loss_ha / HANSEN.forest2000_ha) * 100).toFixed(2)} %) · media ${HANSEN_MEAN.toFixed(1)} ha/año (línea).`
              : `De ${HANSEN.forest2000_ha.toLocaleString("es-MX", { maximumFractionDigits: 0 })} ha de bosque, solo ${HANSEN.total_loss_ha.toFixed(0)} ha se perdieron en 25 años: la reserva funciona.`}
          </p>
          <SourceNote>
            {HANSEN.fuente} · Landsat 30 m · polígono WDPA · descargado {HANSEN.descargado}
          </SourceNote>
        </section>

        <section className={`panel p-4 ${CLIMATE_VARS.sm ? "lg:col-span-4" : "lg:col-span-8"}`}>
          <SectionTitle icon={Radar}>{isSci ? "Adquisiciones NISAR GCOV sobre la reserva" : "¿Cuántas veces nos miró el radar NISAR?"}</SectionTitle>
          <div className="h-56">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={NISAR_MONTHLY} margin={{ top: 5, right: 10, left: -20, bottom: 0 }}>
                <CartesianGrid stroke="rgba(255,255,255,0.06)" />
                <XAxis dataKey="label" tick={{ fill: "#94a3b8", fontSize: 10 }} />
                <YAxis allowDecimals={false} tick={{ fill: "#94a3b8", fontSize: 10 }} />
                <Tooltip {...chartTooltip} />
                <Legend wrapperStyle={{ fontSize: 11, color: "#cbd5e1" }} />
                <Bar dataKey="Ascendente" stackId="a" fill="#22d3ee" isAnimationActive={false} />
                <Bar dataKey="Descendente" stackId="a" fill="#a78bfa" isAnimationActive={false} />
              </BarChart>
            </ResponsiveContainer>
          </div>
          <SourceNote>NASA CMR · colecciones NISAR_L2_GCOV (PROVISIONAL_V1 y V1) · ASF DAAC · descargado {D_DESCARGA}</SourceNote>
        </section>

        {/* ================= FUENTES ================= */}
        <section className="panel p-4 text-[11px] leading-relaxed text-slate-400 lg:col-span-12">
          <SectionTitle icon={Database}>Fuentes de los datos observados (descarga {D_DESCARGA})</SectionTitle>
          <ul className="grid gap-1 md:grid-cols-2">
            <li>
              <b className="text-slate-200">Radar:</b> NISAR L2 GCOV (NASA/JPL-ISRO), ASF DAAC — {NISAR.length} vistas previas oficiales.
            </li>
            <li>
              <b className="text-slate-200">Lluvia:</b> {SRC.precip.producto} — {SRC.precip.via}, {SRC.precip.res}.
            </li>
            <li>
              <b className="text-slate-200">Verdor:</b> {SRC.ndvi.producto} — {SRC.ndvi.via}, {SRC.ndvi.res}.
            </li>
            <li>
              <b className="text-slate-200">Calor del suelo:</b> {SRC.lst.producto} — {SRC.lst.via}, {SRC.lst.res}.
            </li>
            <li>
              <b className="text-slate-200">Humedad del suelo:</b> {SRC.sm.producto} — {SRC.sm.via}, {SRC.sm.res}.
            </li>
            <li>
              <b className="text-slate-200">Bosque:</b> {HANSEN.fuente}.
            </li>
            <li>
              <b className="text-slate-200">El Niño (observado):</b> NOAA CPC ONI (ERSSTv5), anomalía en °C, media móvil de 3 meses, enero 2016 –
              septiembre 2026 (último {ENSO_REAL.metadata.oni.ultimo}).{" "}
              <a className="text-cyan-300 hover:underline" href={ENSO_REAL.metadata.oni.url} target="_blank" rel="noreferrer">
                Tabla oficial
              </a>
              . Niño 1+2: OISST. La predicción de octubre 2026 a diciembre 2031 no es de NOAA: {PREDICCION_ONI_LABEL}.
            </li>
            <li>
              <b className="text-slate-200">Límite:</b> WDPA 555593903 (UNEP-WCMC & IUCN, Protected Planet), uso no comercial con atribución.
            </li>
          </ul>
        </section>
      </main>

      <footer className="relative z-10 mx-auto max-w-[1600px] px-4 pb-6 text-center text-[11px] text-slate-500">
        NISAR Pulse · MVP Open Source (MIT) · Datos observados: NASA Earthdata (GES DISC, LP DAAC, NSIDC, ASF), UMD GLAD y NOAA CPC.
        La predicción oct 2026 – dic 2031 es del equipo, no un producto de NOAA. NISAR es una misión conjunta NASA-ISRO.
      </footer>
    </div>
  );
}
