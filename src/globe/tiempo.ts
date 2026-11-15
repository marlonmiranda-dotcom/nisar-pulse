/**
 * Fechas del control de tiempo.
 * Solo arma la fecha que se pide a NASA GIBS. No promedia ni rellena huecos.
 */

import type { CapaImagen } from "./tipos";

/** Primera fecha del control. Está dentro de los archivos GIBS consultados el 2026-11-14. */
export const FECHA_MIN = "2016-01-01";

/**
 * Última fecha del control.
 * Las teselas diarias de GIBS (IMERG, nubes, SMAP) se comprobaron hasta el
 * 2026-10-15. El control llega al 2026-11-12 porque esa es la última escena
 * OPERA DSWx-S1 guardada en src/data/radar_real.json. Si un día posterior
 * no tiene tesela GIBS, no se rellena.
 */
export const FECHA_MAX = "2026-11-12";

export const TOTAL_DIAS = diasEntre(FECHA_MIN, FECHA_MAX);

export function acotarFecha(iso: string): string {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(iso)) return FECHA_MAX;
  if (iso < FECHA_MIN) return FECHA_MIN;
  if (iso > FECHA_MAX) return FECHA_MAX;
  return iso;
}

export function sumarDias(iso: string, dias: number): string {
  const [anio, mes, dia] = iso.split("-").map(Number);
  const fecha = new Date(Date.UTC(anio, mes - 1, dia));
  fecha.setUTCDate(fecha.getUTCDate() + dias);
  return fecha.toISOString().slice(0, 10);
}

export function diasEntre(desde: string, hasta: string): number {
  const a = partes(desde);
  const b = partes(hasta);
  const ms = Date.UTC(b.anio, b.mes - 1, b.dia) - Date.UTC(a.anio, a.mes - 1, a.dia);
  return Math.round(ms / 86_400_000);
}

export function fechaDesdeIndice(indice: number): string {
  const tope = Math.max(0, Math.min(TOTAL_DIAS, indice));
  return sumarDias(FECHA_MIN, tope);
}

export function indiceDesdeFecha(iso: string): number {
  return diasEntre(FECHA_MIN, acotarFecha(iso));
}

/** Texto largo en español de Ecuador, sin depender de la zona horaria del navegador. */
export function textoFecha(iso: string): string {
  const { anio, mes, dia } = partes(iso);
  return new Date(Date.UTC(anio, mes - 1, dia)).toLocaleDateString("es-EC", {
    day: "numeric",
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  });
}

/**
 * Fecha que realmente va en la URL.
 * Una capa mensual de GIBS usa el día 1 (así está publicado el archivo).
 * Una capa diaria usa el día elegido. No convertimos eso en un promedio mensual.
 */
export function fechaParaCapa(capa: CapaImagen, fecha: string): string {
  if (capa.tiempo?.paso === "mes") return `${fecha.slice(0, 7)}-01`;
  return fecha;
}

export function urlDeCapa(capa: CapaImagen, fecha: string): string {
  return capa.url.replaceAll("{fecha}", fechaParaCapa(capa, fecha));
}

function partes(iso: string): { anio: number; mes: number; dia: number } {
  const [anio, mes, dia] = iso.split("-").map(Number);
  return { anio, mes, dia };
}
