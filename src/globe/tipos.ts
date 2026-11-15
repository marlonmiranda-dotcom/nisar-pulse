/**
 * Tipos del globo. Un compañero nuevo solo necesita entender `Capa`:
 * es la ficha de una capa (de dónde sale, qué mide y cómo se dibuja).
 * Este archivo no calcula clima, elevación ni pendiente.
 */

/** Frase obligatoria para GIBS y para el terreno de Cesium ion. */
export const CLASIFICACION_EXTERNA = "Capa de visualización (fuente externa)";

/** Frase obligatoria cuando no hay token, archivo o servicio. */
export const CLASIFICACION_NO_DISPONIBLE = "dato no disponible";

export type ClasificacionCapa = typeof CLASIFICACION_EXTERNA | typeof CLASIFICACION_NO_DISPONIBLE;

/** Un tramo de la leyenda. El número y el patrón importan tanto como el color. */
export interface ParadaLeyenda {
  valor: string;
  etiqueta: string;
  /** Color de la paleta oficial de la fuente (no es una escala calculada aquí). */
  color: string;
  patron: "solido" | "rayas" | "puntos" | "diagonal" | "cuadros";
}

/** Datos que el panel muestra siempre, esté o no encendida la capa. */
export interface FichaCapa {
  id: string;
  nombre: string;
  variable: string;
  clasificacion: ClasificacionCapa;
  fuente: string;
  fuenteUrl: string;
  /** Rango publicado por la fuente, o la fecha que se está pidiendo. */
  fecha: string;
  unidades: string;
  resolucionEspacial: string;
  resolucionTemporal: string;
  licencia: string;
  aviso?: string;
}

export interface CapaImagen extends FichaCapa {
  tipo: "imagen";
  /**
   * "xyz": URL con {z} {y} {x} y, si hay serie, {fecha}.
   * "wms": servicio WMS; la fecha viaja en el parámetro time.
   */
  servicio: "xyz" | "wms";
  url: string;
  capasWms?: string;
  /** Zoom nativo máximo de las teselas (el número del TileMatrixSet de GIBS). */
  nivelMaximo?: number;
  opacidadInicial: number;
  activaAlInicio: boolean;
  /** Si existe, el control de fecha cambia la imagen. "mes" pide el día 1. */
  tiempo?: { paso: "dia" | "mes" };
  leyenda: ParadaLeyenda[];
  leyendaUrl?: string;
}

export interface CapaPuntos extends FichaCapa {
  tipo: "puntos";
  /** GeoJSON de puntos REALES. Si falla la descarga, se muestra "dato no disponible". */
  urlPuntos: string;
  opacidadInicial: number;
  activaAlInicio: boolean;
  leyenda: ParadaLeyenda[];
}

export interface CapaNoDisponible extends FichaCapa {
  tipo: "no-disponible";
  motivo: string;
}

/**
 * Serie ya descargada en el repositorio (no es un WMTS).
 * El globo filtra por la fecha del control. No rellena huecos.
 */
export interface CapaSerieLocal extends FichaCapa {
  tipo: "serie";
  serie: "hansen-anio" | "opera-fecha" | "jrc-historica" | "nisar-imagen";
  opacidadInicial: number;
  activaAlInicio: boolean;
  leyenda: ParadaLeyenda[];
}

export type Capa = CapaImagen | CapaPuntos | CapaNoDisponible | CapaSerieLocal;

export interface EstadoCapaUi {
  activa: boolean;
  opacidad: number;
}
