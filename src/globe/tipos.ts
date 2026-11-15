/**
 * Tipos del globo. Un compañero nuevo solo necesita entender `Capa`:
 * es la ficha de una capa (de dónde sale, qué mide y cómo se dibuja).
 * Este archivo no calcula clima, elevación ni pendiente.
 */

/** Frase obligatoria cuando la imagen llega tal cual de otra institución (GIBS, etc.). */
export const CLASIFICACION_EXTERNA = "Capa de visualización (fuente externa)";

/** Pendiente y sombreado: se calcularon aquí a partir del DEM, no son un mapa oficial. */
export const CLASIFICACION_DERIVADA = "Cálculo local a partir del DEM abierto";

/** Frase obligatoria cuando no hay archivo o servicio. */
export const CLASIFICACION_NO_DISPONIBLE = "dato no disponible";

export type ClasificacionCapa =
  | typeof CLASIFICACION_EXTERNA
  | typeof CLASIFICACION_DERIVADA
  | typeof CLASIFICACION_NO_DISPONIBLE;

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
   * "local": un PNG de public/relieve/. La extensión geográfica sale de meta.json,
   * no se escribe a mano. Si el archivo no carga, el panel dice "dato no disponible".
   */
  servicio: "xyz" | "wms" | "local";
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

export type Capa = CapaImagen | CapaPuntos | CapaNoDisponible;

export interface EstadoCapaUi {
  activa: boolean;
  opacidad: number;
}
