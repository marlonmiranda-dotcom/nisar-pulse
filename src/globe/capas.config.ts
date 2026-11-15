/**
 * ============================================================================
 *  CAPAS DEL GLOBO — archivo para el equipo de clima, radar y datos
 * ============================================================================
 *  Para agregar una capa: copia `PLANTILLA_PARA_COPIAR` dentro de `CAPAS`
 *  y cambia los textos por los de una fuente real. La guía está en
 *  src/globe/COMO-AGREGAR-CAPAS.md.
 *
 *  Las capas de abajo son imágenes públicas de NASA GIBS. El 2026-11-14 se
 *  comprobaron los identificadores contra:
 *  https://gibs.earthdata.nasa.gov/wmts/epsg3857/best/1.0.0/WMTSCapabilities.xml
 *  y una tesela de cada una sobre la reserva (zoom 6, tile 18/32).
 *
 *  Son "Capa de visualización (fuente externa)": este archivo no analiza
 *  el clima ni atribuye los cambios a ninguna causa.
 *  Si una variable no tiene servicio, queda en "dato no disponible".
 *  No pongas aquí números ni dibujos inventados.
 */

import {
  CLASIFICACION_DERIVADA,
  CLASIFICACION_EXTERNA,
  CLASIFICACION_NO_DISPONIBLE,
  type Capa,
  type CapaImagen,
  type CapaPuntos,
} from "./tipos";

const GIBS = "https://gibs.earthdata.nasa.gov/wmts/epsg3857/best";
const GUIA_GIBS = "https://nasa-gibs.github.io/gibs-api-docs/";

const RELIEVE = `${import.meta.env.BASE_URL}relieve`;
const README_DEM = "https://copernicus-dem-30m.s3.eu-central-1.amazonaws.com/readme.html";
const FECHA_DEM =
  "Teselas COG en AWS Open Data, Last-Modified 9 de mayo de 2022 (2022-05-09T14:52:38Z y 2022-05-09T14:53:04Z). El README del bucket declara el origen COP-DEM_GLO-30-DGED.";
const RESOLUCION_DEM =
  "1 segundo de arco (GLO-30). En este recorte, unos 30,9 m de este a oeste y 30,7 m de norte a sur.";
const LICENCIA_DEM =
  "Copernicus DEM, uso público gratuito con atribución. © DLR e.V. 2010-2014 and © Airbus Defence and Space GmbH 2014-2018 provided under COPERNICUS by the European Union and ESA; all rights reserved.";

export const CAPAS: Capa[] = [
  {
    id: "relieve-sombreado",
    tipo: "imagen",
    servicio: "local",
    nombre: "Relieve sombreado",
    variable: "Sombreado analítico (hillshade) del modelo de superficie",
    clasificacion: CLASIFICACION_DERIVADA,
    fuente: "Copernicus DEM GLO-30 Public (AWS Open Data), calculado con scripts/relieve/preparar_relieve.py",
    fuenteUrl: README_DEM,
    fecha: FECHA_DEM,
    unidades: "adimensional, de 1 (sombra) a 255 (ladera iluminada)",
    resolucionEspacial: RESOLUCION_DEM,
    resolucionTemporal: "No es una serie. Es un modelo de superficie, una sola versión.",
    licencia: LICENCIA_DEM,
    aviso:
      "Iluminación de mapa: azimut 315° (noroeste) y altitud 45°, el valor por defecto de gdaldem hillshade. No es una foto ni una medición de luz real. La exageración vertical del globo no cambia esta imagen.",
    url: `${RELIEVE}/sombreado.png`,
    opacidadInicial: 0.55,
    activaAlInicio: false,
    leyenda: [
      { valor: "1", etiqueta: "Sombra (ladera de espaldas a la luz)", color: "#141414", patron: "solido" },
      { valor: "255", etiqueta: "Ladera iluminada", color: "#f4f4f5", patron: "rayas" },
    ],
  },
  {
    id: "pendiente",
    tipo: "imagen",
    servicio: "local",
    nombre: "Pendiente (°)",
    variable: "Pendiente del terreno",
    clasificacion: CLASIFICACION_DERIVADA,
    fuente: "Copernicus DEM GLO-30 Public (AWS Open Data), método de Horn, igual que gdaldem slope",
    fuenteUrl: README_DEM,
    fecha: FECHA_DEM,
    unidades: "grados",
    resolucionEspacial: RESOLUCION_DEM,
    resolucionTemporal: "No es una serie. Es un modelo de superficie, una sola versión.",
    licencia: LICENCIA_DEM,
    aviso:
      "Clases de visualización calculadas en este repositorio (0–10, 10–20, 20–30, 30–45 y más de 45 grados; 45° queda en la clase 30–45). Es un factor de susceptibilidad, no un mapa de riesgo oficial. La paleta es ColorBrewer YlOrBr, no una escala del MAE ni del IGM. La exageración vertical no modifica estos grados.",
    url: `${RELIEVE}/pendiente.png`,
    opacidadInicial: 0.75,
    activaAlInicio: false,
    leyenda: [
      { valor: "0–10", etiqueta: "0 a menos de 10 grados", color: "#fff7bc", patron: "solido" },
      { valor: "10–20", etiqueta: "10 a menos de 20 grados", color: "#fec44f", patron: "rayas" },
      { valor: "20–30", etiqueta: "20 a menos de 30 grados", color: "#fe9929", patron: "puntos" },
      { valor: "30–45", etiqueta: "30 a 45 grados (incluye 45)", color: "#d95f0e", patron: "cuadros" },
      { valor: "> 45", etiqueta: "Más de 45 grados", color: "#993404", patron: "diagonal" },
    ],
  },
  {
    id: "imerg-tasa",
    tipo: "imagen",
    servicio: "xyz",
    nombre: "Precipitación IMERG",
    variable: "Tasa de precipitación",
    clasificacion: CLASIFICACION_EXTERNA,
    fuente: "NASA GIBS — IMERG_Precipitation_Rate (GPM IMERG)",
    fuenteUrl: GUIA_GIBS,
    fecha: "Archivo diario publicado: 2000-06-01 en adelante, con huecos (GetCapabilities, 2026-11-14). El control pide un día concreto.",
    unidades: "mm/h",
    resolucionEspacial: "Teselas WMTS GoogleMapsCompatible_Level6. Este visor no mide el tamaño del píxel.",
    resolucionTemporal: "Diaria (dimensión Time P1D en GetCapabilities).",
    licencia: "NASA EOSDIS GIBS, uso público con atribución a NASA.",
    aviso: "Es la tasa de ese día (lluvia o nieve según la paleta NASA), no un total del mes y no un análisis del equipo.",
    url: `${GIBS}/IMERG_Precipitation_Rate/default/{fecha}/GoogleMapsCompatible_Level6/{z}/{y}/{x}.png`,
    nivelMaximo: 6,
    opacidadInicial: 0.7,
    activaAlInicio: false,
    tiempo: { paso: "dia" },
    leyendaUrl: "https://gibs.earthdata.nasa.gov/legends/GPM_Precipitation_Rate_H.svg",
    leyenda: [
      { valor: "0.1", etiqueta: "Lluvia 0.1 – 0.106 mm/h", color: "#00764e", patron: "puntos" },
      { valor: "1", etiqueta: "Lluvia 1 – 1.059 mm/h", color: "#c3e400", patron: "solido" },
      { valor: "2", etiqueta: "Lluvia 1.995 – 2.114 mm/h", color: "#ffb006", patron: "rayas" },
      { valor: "5", etiqueta: "Lluvia 5.012 – 5.309 mm/h", color: "#ff4233", patron: "cuadros" },
      { valor: "10", etiqueta: "Lluvia 10 – 10.593 mm/h", color: "#e70000", patron: "diagonal" },
      { valor: "≥ 53", etiqueta: "Lluvia ≥ 53.088 mm/h", color: "#330000", patron: "rayas" },
      { valor: "1", etiqueta: "Nieve 1 – 1.059 mm/h (otra paleta NASA)", color: "#4f73c4", patron: "diagonal" },
      { valor: "10", etiqueta: "Nieve 10 – 10.593 mm/h (otra paleta NASA)", color: "#770bd1", patron: "puntos" },
    ],
  },
  {
    id: "modis-lst",
    tipo: "imagen",
    servicio: "xyz",
    nombre: "Temperatura de superficie MODIS",
    variable: "LST diurna mensual",
    clasificacion: CLASIFICACION_EXTERNA,
    fuente: "NASA GIBS — MODIS_Terra_L3_Land_Surface_Temp_Monthly_Day",
    fuenteUrl: GUIA_GIBS,
    fecha: "Mensual, 2000-03-01 a 2026-10-01 (GetCapabilities, 2026-11-14). Se pide el día 1 del mes.",
    unidades: "K",
    resolucionEspacial: "Teselas WMTS GoogleMapsCompatible_Level6. Este visor no mide el tamaño del píxel.",
    resolucionTemporal: "Mensual (dimensión Time P1M).",
    licencia: "NASA EOSDIS GIBS, uso público con atribución a NASA.",
    aviso: "Paleta oficial en kelvin. No es un mapa de anomalías hecho por el equipo.",
    url: `${GIBS}/MODIS_Terra_L3_Land_Surface_Temp_Monthly_Day/default/{fecha}/GoogleMapsCompatible_Level6/{z}/{y}/{x}.png`,
    nivelMaximo: 6,
    opacidadInicial: 0.7,
    activaAlInicio: false,
    tiempo: { paso: "mes" },
    leyendaUrl: "https://gibs.earthdata.nasa.gov/legends/MODIS_Land_Surface_Temp_H.svg",
    leyenda: [
      { valor: "< 200", etiqueta: "Menos de 200.0 K", color: "#c900ff", patron: "solido" },
      { valor: "240", etiqueta: "240.2 – 240.8 K", color: "#0061ff", patron: "rayas" },
      { valor: "270", etiqueta: "270.2 – 270.8 K", color: "#49ff56", patron: "puntos" },
      { valor: "290", etiqueta: "290.0 – 290.6 K", color: "#c5ff00", patron: "cuadros" },
      { valor: "310", etiqueta: "309.8 – 310.4 K", color: "#ffcd00", patron: "diagonal" },
      { valor: "330", etiqueta: "330.2 – 330.8 K", color: "#ff6400", patron: "rayas" },
      { valor: "≥ 350", etiqueta: "350.0 K o más", color: "#ff0100", patron: "puntos" },
    ],
  },
  {
    id: "modis-ndvi",
    tipo: "imagen",
    servicio: "xyz",
    nombre: "NDVI MODIS",
    variable: "Índice de vegetación",
    clasificacion: CLASIFICACION_EXTERNA,
    fuente: "NASA GIBS — MODIS_Terra_L3_NDVI_Monthly",
    fuenteUrl: GUIA_GIBS,
    fecha: "Mensual, 2000-03-01 a 2025-03-01 y 2025-05-01 a 2026-10-01. Abril 2025 no está en el archivo.",
    unidades: "NDVI (sin unidad, de −0.2 a 1 en la paleta)",
    resolucionEspacial: "Teselas WMTS GoogleMapsCompatible_Level7. Este visor no mide el tamaño del píxel.",
    resolucionTemporal: "Mensual (dimensión Time P1M). Se pide el día 1 del mes.",
    licencia: "NASA EOSDIS GIBS, uso público con atribución a NASA.",
    aviso: "Los cortes son intervalos de la paleta NASA (colormap MODIS_L3_NDVI), no clases calculadas aquí.",
    url: `${GIBS}/MODIS_Terra_L3_NDVI_Monthly/default/{fecha}/GoogleMapsCompatible_Level7/{z}/{y}/{x}.png`,
    nivelMaximo: 7,
    opacidadInicial: 0.72,
    activaAlInicio: true,
    tiempo: { paso: "mes" },
    leyendaUrl: "https://gibs.earthdata.nasa.gov/legends/MODIS_L3_NDVI_H.svg",
    leyenda: [
      { valor: "0.00", etiqueta: "0.000 – 0.005", color: "#f1ecec", patron: "solido" },
      { valor: "0.20", etiqueta: "0.200 – 0.205", color: "#b19883", patron: "rayas" },
      { valor: "0.40", etiqueta: "0.3975 – 0.4050", color: "#8fb716", patron: "puntos" },
      { valor: "0.60", etiqueta: "0.600 – 0.610", color: "#398700", patron: "cuadros" },
      { valor: "0.80", etiqueta: "0.800 – 0.810", color: "#056400", patron: "diagonal" },
      { valor: "0.95", etiqueta: "0.950 – 0.960", color: "#003601", patron: "rayas" },
    ],
  },
  {
    id: "modis-nubes",
    tipo: "imagen",
    servicio: "xyz",
    nombre: "Fracción de nubes MODIS",
    variable: "Fracción de nubes diurna",
    clasificacion: CLASIFICACION_EXTERNA,
    fuente: "NASA GIBS — MODIS_Terra_Cloud_Fraction_Day",
    fuenteUrl: GUIA_GIBS,
    fecha: "Diaria desde 2000-02-24, con huecos. Default del servicio el 2026-11-14: 2026-11-15.",
    unidades: "%",
    resolucionEspacial: "Teselas WMTS GoogleMapsCompatible_Level6. Este visor no mide el tamaño del píxel.",
    resolucionTemporal: "Diaria (dimensión Time P1D).",
    licencia: "NASA EOSDIS GIBS, uso público con atribución a NASA.",
    aviso: "La escala oficial va de 0 a 100 %. Aquí están las marcas que NASA rotula en la leyenda.",
    url: `${GIBS}/MODIS_Terra_Cloud_Fraction_Day/default/{fecha}/GoogleMapsCompatible_Level6/{z}/{y}/{x}.png`,
    nivelMaximo: 6,
    opacidadInicial: 0.7,
    activaAlInicio: false,
    tiempo: { paso: "dia" },
    leyendaUrl: "https://gibs.earthdata.nasa.gov/legends/MODIS_Cloud_Fraction_H.svg",
    leyenda: [
      { valor: "0–5", etiqueta: "0 – 5 %", color: "#660077", patron: "solido" },
      { valor: "6–11", etiqueta: "6 – 11 %", color: "#b70f8d", patron: "rayas" },
      { valor: "19–24", etiqueta: "19 – 24 %", color: "#0000aa", patron: "puntos" },
      { valor: "31–37", etiqueta: "31 – 37 %", color: "#0088ee", patron: "cuadros" },
      { valor: "44–49", etiqueta: "44 – 49 %", color: "#008800", patron: "diagonal" },
      { valor: "57–62", etiqueta: "57 – 62 %", color: "#ffff00", patron: "rayas" },
      { valor: "69–75", etiqueta: "69 – 75 %", color: "#bb8800", patron: "puntos" },
      { valor: "82–87", etiqueta: "82 – 87 %", color: "#6e0000", patron: "cuadros" },
    ],
  },
  {
    id: "smap-humedad",
    tipo: "imagen",
    servicio: "xyz",
    nombre: "Humedad del suelo SMAP",
    variable: "Humedad superficial (día)",
    clasificacion: CLASIFICACION_EXTERNA,
    fuente: "NASA GIBS — SMAP_L3_Passive_Enhanced_Day_Soil_Moisture",
    fuenteUrl: GUIA_GIBS,
    fecha: "Diaria, con huecos, desde 2015-03-31. El 2026-10-15 está dentro de un tramo publicado.",
    unidades: "cm³/cm³",
    resolucionEspacial: "Teselas WMTS GoogleMapsCompatible_Level6. Este visor no mide el tamaño del píxel.",
    resolucionTemporal: "Diaria (dimensión Time P1D).",
    licencia: "NASA EOSDIS GIBS, uso público con atribución a NASA.",
    aviso: "Solo se muestra la imagen de GIBS. Este equipo no evalúa la calidad del píxel.",
    url: `${GIBS}/SMAP_L3_Passive_Enhanced_Day_Soil_Moisture/default/{fecha}/GoogleMapsCompatible_Level6/{z}/{y}/{x}.png`,
    nivelMaximo: 6,
    opacidadInicial: 0.7,
    activaAlInicio: false,
    tiempo: { paso: "dia" },
    leyendaUrl: "https://gibs.earthdata.nasa.gov/legends/SMAP_Soil_Moisture_H.svg",
    leyenda: [
      { valor: "0.00", etiqueta: "0.000 – 0.002 cm³/cm³", color: "#ffa200", patron: "solido" },
      { valor: "0.10", etiqueta: "0.099 – 0.102 cm³/cm³", color: "#fffe00", patron: "rayas" },
      { valor: "0.20", etiqueta: "0.201 – 0.203 cm³/cm³", color: "#008200", patron: "puntos" },
      { valor: "0.30", etiqueta: "0.300 – 0.302 cm³/cm³", color: "#00ffff", patron: "cuadros" },
      { valor: "0.40", etiqueta: "0.399 – 0.402 cm³/cm³", color: "#000cff", patron: "diagonal" },
      { valor: "0.50", etiqueta: "0.501 – 0.503 cm³/cm³", color: "#00006b", patron: "rayas" },
      { valor: "≥ 0.60", etiqueta: "0.600 cm³/cm³ o más", color: "#505050", patron: "puntos" },
    ],
  },
  {
    id: "estaciones",
    tipo: "no-disponible",
    nombre: "Estaciones meteorológicas",
    variable: "Observación en superficie",
    clasificacion: CLASIFICACION_NO_DISPONIBLE,
    fuente: "Sin archivo en este repositorio",
    fuenteUrl: GUIA_GIBS,
    fecha: "Sin serie cargada",
    unidades: "Según el archivo que agregue el equipo",
    resolucionEspacial: "Puntos (aún no hay GeoJSON)",
    resolucionTemporal: "Según el archivo que agregue el equipo",
    licencia: "La del archivo oficial que se agregue",
    motivo:
      "dato no disponible. No hay un GeoJSON de estaciones verificado. El equipo de clima puede sumar una capa de puntos con coordenadas reales (ver COMO-AGREGAR-CAPAS.md). No se dibujan estaciones de ejemplo.",
  },
  {
    id: "nisar-globo",
    tipo: "no-disponible",
    nombre: "Radar NISAR sobre el globo",
    variable: "Retrodispersión (vista previa)",
    clasificacion: CLASIFICACION_NO_DISPONIBLE,
    fuente: "Sin servicio de teselas público en la configuración del globo",
    fuenteUrl: "https://nisar-docs.asf.alaska.edu/gcov/",
    fecha: "Sin serie de teselas en el globo",
    unidades: "No aplica hasta tener un WMTS real",
    resolucionEspacial: "No aplica hasta tener un WMTS real",
    resolucionTemporal: "No aplica hasta tener un WMTS real",
    licencia: "NASA/JPL e ISRO, cuando el equipo conecte el servicio",
    motivo:
      "dato no disponible. El globo no tiene un WMTS de NISAR sin clave. La vista de detalle 2D sigue mostrando las vistas previas ya descargadas. El equipo de radar puede agregar la URL real en este archivo.",
  },
];

/**
 * PLANTILLA. No está dentro de CAPAS, así que el globo no la dibuja.
 * Cuando tengan una URL real, cópienla dentro de CAPAS y borren este aviso.
 */
export const PLANTILLA_PARA_COPIAR: CapaImagen = {
  id: "mi-capa",
  tipo: "imagen",
  servicio: "xyz",
  nombre: "Nombre corto que verá la gente",
  variable: "Qué variable es (por ejemplo: lluvia diaria)",
  clasificacion: CLASIFICACION_EXTERNA,
  fuente: "Institución y nombre del producto",
  fuenteUrl: "https://enlace-a-la-documentacion-del-producto",
  fecha: "Desde cuándo hasta cuándo publica datos la fuente",
  unidades: "mm, °C, NDVI…",
  resolucionEspacial: "Lo que diga la ficha del producto, sin medirla ustedes",
  resolucionTemporal: "diaria, mensual…",
  licencia: "Licencia o atribución que pide la fuente",
  aviso: "Capa de visualización (fuente externa). No es un análisis del equipo.",
  url: "https://REEMPLAZA-CON-URL-REAL/{fecha}/{z}/{y}/{x}.png",
  nivelMaximo: 8,
  opacidadInicial: 0.7,
  activaAlInicio: false,
  tiempo: { paso: "dia" },
  leyenda: [
    { valor: "0", etiqueta: "Valor bajo publicado por la fuente", color: "#f4f4f5", patron: "solido" },
    { valor: "10", etiqueta: "Valor alto publicado por la fuente", color: "#0369a1", patron: "rayas" },
  ],
};

/** Otra plantilla, para puntos (estaciones). Tampoco está en CAPAS. */
export const PLANTILLA_PUNTOS: CapaPuntos = {
  id: "mis-estaciones",
  tipo: "puntos",
  nombre: "Estaciones (archivo real)",
  variable: "La que traiga el GeoJSON",
  clasificacion: CLASIFICACION_EXTERNA,
  fuente: "Institución que publicó el GeoJSON",
  fuenteUrl: "https://enlace-al-archivo-oficial",
  fecha: "Fecha de la descarga, escrita en la ficha",
  unidades: "Las del archivo",
  resolucionEspacial: "Puntos de estaciones",
  resolucionTemporal: "La del archivo",
  licencia: "La del archivo",
  urlPuntos: `${import.meta.env.BASE_URL}data/REEMPLAZA-estaciones.geojson`,
  opacidadInicial: 1,
  activaAlInicio: false,
  leyenda: [
    { valor: "punto", etiqueta: "Estación (el nombre sale del GeoJSON)", color: "#22d3ee", patron: "puntos" },
  ],
};
