/**
 * Series reales que el globo filtra con la fecha del control.
 * Los números salen de los JSON ya guardados. No se interpolan huecos
 * ni se atribuye un cambio a El Niño.
 */

import CAPAS from "../data/capas_reserva.json";
import RADAR from "../data/radar_real.json";
import SAT from "../data/satellite_real.json";
import BOSQUE_RAW from "../data/bosque_perdida.geojson?raw";
import AGUA_RAW from "../data/agua_ocurrencia.geojson?raw";

export interface PuntoAnio {
  lon: number;
  lat: number;
  grupo: string;
  anio: number;
}

export interface PuntoAgua {
  lon: number;
  lat: number;
  ocurrencia: number;
}

export interface Lectura {
  disponible: boolean;
  /** Una línea para la tarjeta del globo. */
  corto: string;
  /** Explicación para el panel. */
  nota: string;
}

export interface ImagenNisar {
  lectura: Lectura;
  url: string | null;
  oeste: number | null;
  sur: number | null;
  este: number | null;
  norte: number | null;
  firma: string;
}

interface FeaturePunto {
  properties?: { anio?: number; grupo?: string; ocurrencia?: number };
  geometry?: { type?: string; coordinates?: unknown };
}

interface Coleccion {
  features?: FeaturePunto[];
}

interface FilaHansen {
  anio: number;
  ha: number;
}

interface FilaJrc {
  anio: number;
  ha_estacional: number;
  ha_permanente: number;
  ha_total: number;
}

interface FilaOpera {
  date: string;
  area_agua_km2: number | null;
  fraccion_agua: number | null;
  reason: string | null;
}

interface FilaNisar {
  date: string;
  file: string;
  bounds: number[][];
  direction: string;
  track: number;
  collection: string;
}

const BOSQUE = JSON.parse(BOSQUE_RAW) as Coleccion;
const AGUA = JSON.parse(AGUA_RAW) as Coleccion;
const HANSEN = (CAPAS.bosque.serie as FilaHansen[]).slice().sort((a, b) => a.anio - b.anio);
const JRC = (CAPAS.agua_superficial.serie as FilaJrc[]).slice().sort((a, b) => a.anio - b.anio);
const OPERA = (RADAR.dswx as FilaOpera[]).slice().sort((a, b) => a.date.localeCompare(b.date));
const NISAR = (SAT.nisar as unknown as FilaNisar[]).slice().sort((a, b) => a.date.localeCompare(b.date));

const PUNTOS_HANSEN: PuntoAnio[] = [];
for (const feature of BOSQUE.features ?? []) {
  const par = parLonLat(feature);
  const anio = Number(feature.properties?.anio);
  if (!par || !Number.isFinite(anio)) continue;
  PUNTOS_HANSEN.push({
    lon: par[0],
    lat: par[1],
    anio,
    grupo: typeof feature.properties?.grupo === "string" ? feature.properties.grupo : "",
  });
}

const PUNTOS_JRC: PuntoAgua[] = [];
for (const feature of AGUA.features ?? []) {
  const par = parLonLat(feature);
  const ocurrencia = Number(feature.properties?.ocurrencia);
  if (!par || !Number.isFinite(ocurrencia)) continue;
  PUNTOS_JRC.push({ lon: par[0], lat: par[1], ocurrencia });
}

export function anioDe(fecha: string): number {
  return Number(fecha.slice(0, 4));
}

export function puntosHansen(anio: number): PuntoAnio[] {
  return PUNTOS_HANSEN.filter((punto) => punto.anio === anio);
}

export function puntosJrc(): PuntoAgua[] {
  return PUNTOS_JRC;
}

export function lecturaHansen(fecha: string): Lectura {
  const anio = anioDe(fecha);
  const fila = HANSEN.find((item) => item.anio === anio);
  if (!fila) {
    const primero = HANSEN[0]?.anio;
    const ultimo = HANSEN[HANSEN.length - 1]?.anio;
    return {
      disponible: false,
      corto: `Bosque ${anio}: dato no disponible`,
      nota: `dato no disponible. Hansen GFC v1.13 en este repositorio va de ${primero ?? "—"} a ${ultimo ?? "—"}. ${anio} no está en la serie. No se inventa la pérdida de ese año.`,
    };
  }
  const pixeles = puntosHansen(anio).length;
  return {
    disponible: true,
    corto: `Bosque ${anio}: ${num(fila.ha, 2)} ha`,
    nota: `${num(fila.ha, 2)} ha en ${anio}. ${pixeles} píxeles de 30 m (el punto se dibuja más grande para verlo). Es la pérdida de ese año, no una causa. No se atribuye a El Niño.`,
  };
}

export function lecturaOpera(fecha: string): Lectura {
  const exacta = OPERA.find((item) => item.date === fecha);
  const validas = OPERA.filter((item) => item.area_agua_km2 != null && !item.reason);
  const previa = [...validas].reverse().find((item) => item.date <= fecha);
  const primera = validas[0]?.date ?? OPERA[0]?.date;

  if (exacta && exacta.area_agua_km2 != null && !exacta.reason) {
    return {
      disponible: true,
      corto: `OPERA ${exacta.date}: ${num(exacta.area_agua_km2, 4)} km²`,
      nota: `Observación de esta fecha. Fracción del área válida: ${fraccion(exacta.fraccion_agua)}. Clases WTR 1 y 3 (agua abierta y vegetación inundada). No es un mapa de inundación y no se atribuye a El Niño.`,
    };
  }

  if (exacta?.reason) {
    const extra = previa
      ? ` La última observación con área en o antes de esta fecha es ${previa.date}: ${num(previa.area_agua_km2 ?? 0, 4)} km². No es el valor de hoy.`
      : "";
    return {
      disponible: false,
      corto: `OPERA ${fecha}: dato no disponible`,
      nota: `dato no disponible. ${exacta.reason}${extra}`,
    };
  }

  if (!previa) {
    return {
      disponible: false,
      corto: "OPERA: dato no disponible",
      nota: `dato no disponible. No hay una escena OPERA DSWx-S1 en o antes de esta fecha. La primera con área en el archivo es ${primera ?? "sin fecha"}.`,
    };
  }

  return {
    disponible: false,
    corto: `OPERA: sin escena el ${fecha}`,
    nota: `No hay escena OPERA en ${fecha}. La última con área en o antes de esa fecha es ${previa.date}: ${num(previa.area_agua_km2 ?? 0, 4)} km² (fracción ${fraccion(previa.fraccion_agua)}). No se rellenan los días de en medio y ese número no es de ${fecha}.`,
  };
}

export function lecturaJrc(fecha: string): Lectura {
  const anio = anioDe(fecha);
  const fila = JRC.find((item) => item.anio === anio);
  const primero = JRC[0]?.anio;
  const ultimo = JRC[JRC.length - 1]?.anio;
  if (!fila) {
    return {
      disponible: false,
      corto: `JRC ${anio}: dato no disponible`,
      nota: `dato no disponible. La clasificación anual JRC/Landsat en este archivo va de ${primero ?? "—"} a ${ultimo ?? "—"}. ${anio} no tiene hectáreas. Los puntos del mapa, si se encienden, son la ocurrencia de todo ese periodo, no el agua de ${anio}.`,
    };
  }
  return {
    disponible: true,
    corto: `JRC ${anio}: ${num(fila.ha_total, 2)} ha`,
    nota: `${num(fila.ha_total, 2)} ha en ${anio} (estacional ${num(fila.ha_estacional, 2)} + permanente ${num(fila.ha_permanente, 2)}). Es agua que el Landsat pudo marcar ese año, no toda el agua del suelo. Los puntos son la ocurrencia 1984–2021, no un mapa solo de ${anio}. No se atribuye a El Niño.`,
  };
}

export function imagenNisar(fecha: string): ImagenNisar {
  const exacta = NISAR.find((item) => item.date === fecha);
  const previa = [...NISAR].reverse().find((item) => item.date <= fecha);
  const primera = NISAR[0]?.date;
  const elegida = exacta ?? null;

  if (!elegida && !previa) {
    return {
      lectura: {
        disponible: false,
        corto: "NISAR: dato no disponible",
        nota: `dato no disponible. No hay una vista previa NISAR en o antes de esta fecha. La primera del catálogo es ${primera ?? "sin fecha"}.`,
      },
      url: null,
      oeste: null,
      sur: null,
      este: null,
      norte: null,
      firma: "ninguna",
    };
  }

  if (!elegida && previa) {
    const rect = rectangulo(previa);
    return {
      lectura: {
        disponible: false,
        corto: `NISAR: vista previa ${previa.date} (no es ${fecha})`,
        nota: `No hay vista previa el ${fecha}. Se muestra la última en o antes: ${previa.date}, ${previa.direction}, track ${previa.track}. No es una imagen de ${fecha}.`,
      },
      url: `${import.meta.env.BASE_URL}${previa.file}`,
      ...rect,
      firma: previa.date,
    };
  }

  const escena = elegida as FilaNisar;
  const rect = rectangulo(escena);
  return {
    lectura: {
      disponible: true,
      corto: `NISAR ${escena.date}: vista previa`,
      nota: `Vista previa oficial de ${escena.date} (${escena.direction}, track ${escena.track}, ${escena.collection}). El rectángulo es el que ya usa el mapa 2D. No es un análisis nuevo.`,
    },
    url: `${import.meta.env.BASE_URL}${escena.file}`,
    ...rect,
    firma: escena.date,
  };
}

function rectangulo(escena: FilaNisar): Pick<ImagenNisar, "oeste" | "sur" | "este" | "norte"> {
  const sur = Number(escena.bounds?.[0]?.[0]);
  const oeste = Number(escena.bounds?.[0]?.[1]);
  const norte = Number(escena.bounds?.[1]?.[0]);
  const este = Number(escena.bounds?.[1]?.[1]);
  if (![sur, oeste, norte, este].every(Number.isFinite)) {
    return { oeste: null, sur: null, este: null, norte: null };
  }
  return { oeste, sur, este, norte };
}

function parLonLat(feature: FeaturePunto): [number, number] | null {
  if (feature.geometry?.type !== "Point" || !Array.isArray(feature.geometry.coordinates)) return null;
  const lon = Number(feature.geometry.coordinates[0]);
  const lat = Number(feature.geometry.coordinates[1]);
  if (!Number.isFinite(lon) || !Number.isFinite(lat)) return null;
  return [lon, lat];
}

function num(valor: number, decimales: number): string {
  return valor.toLocaleString("es-EC", {
    minimumFractionDigits: decimales,
    maximumFractionDigits: decimales,
  });
}

function fraccion(valor: number | null): string {
  if (valor == null || !Number.isFinite(valor)) return "dato no disponible";
  return valor.toLocaleString("es-EC", { maximumFractionDigits: 6 });
}
