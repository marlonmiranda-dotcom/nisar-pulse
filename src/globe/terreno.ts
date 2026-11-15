/**
 * Relieve 3D sin Cesium ion.
 *
 * El heightmap sale de public/relieve/altura_u16.bin (Copernicus DEM GLO-30,
 * recortado por scripts/relieve/preparar_relieve.py). CustomHeightmapTerrainProvider
 * lo muestra solo dentro de ese rectángulo. Fuera, la altura es 0: el elipsoide.
 *
 * Este archivo no inventa elevaciones. Si el binario o meta.json fallan,
 * el globo se queda en el elipsoide y la ficha dice "dato no disponible".
 */

import * as Cesium from "cesium";
import {
  cargarAlturas,
  cargarMetaRelieve,
  textoFechaVersion,
  textoResolucion,
  type MetaRelieve,
} from "./relieveDatos";
import { CLASIFICACION_EXTERNA, CLASIFICACION_NO_DISPONIBLE, type ClasificacionCapa } from "./tipos";

/** Muestras por tesela de Cesium. 65 es la rejilla habitual (incluye los bordes). */
const MUESTRAS = 65;

export interface FichaRelieve {
  nombre: string;
  variable: string;
  fuente: string;
  fuenteUrl: string;
  fecha: string;
  unidades: string;
  resolucionEspacial: string;
  resolucionTemporal: string;
  licencia: string;
  atribucion: string;
  referenciaVertical: string;
  alturas: string;
  margen: string;
  teselas: { nombre: string; url: string }[];
}

export interface EstadoRelieve {
  disponible: boolean;
  clasificacion: ClasificacionCapa;
  /** Texto corto, encima del globo. */
  resumen: string;
  /** Texto largo, en el panel. */
  detalle: string;
  ficha: FichaRelieve;
}

const FICHA_VACIA: FichaRelieve = {
  nombre: "Copernicus DEM GLO-30",
  variable: "Altura del modelo de superficie",
  fuente: "Copernicus DEM GLO-30 Public (AWS Open Data)",
  fuenteUrl: "https://copernicus-dem-30m.s3.eu-central-1.amazonaws.com/readme.html",
  fecha: "dato no disponible",
  unidades: "m (EGM2008)",
  resolucionEspacial: "dato no disponible",
  resolucionTemporal: "No es una serie temporal. Es un modelo de superficie.",
  licencia: "dato no disponible",
  atribucion: "",
  referenciaVertical: "EGM2008",
  alturas: "dato no disponible",
  margen: "dato no disponible",
  teselas: [],
};

export function activarRelieve(viewer: Cesium.Viewer, estaVivo: () => boolean): Promise<EstadoRelieve> {
  return cargarYActivar(viewer, estaVivo);
}

async function cargarYActivar(viewer: Cesium.Viewer, estaVivo: () => boolean): Promise<EstadoRelieve> {
  let meta: MetaRelieve;
  let alturas: Float32Array;
  try {
    meta = await cargarMetaRelieve();
    if (!estaVivo() || viewer.isDestroyed()) return fallo("dato no disponible. El globo se cerró antes de cargar el relieve.");
    alturas = await cargarAlturas(meta);
  } catch (error) {
    dejarElipsoide(viewer, estaVivo);
    const mensaje = error instanceof Error ? error.message : "dato no disponible. No se pudo leer el relieve.";
    return fallo(mensaje.startsWith("dato no disponible") ? mensaje : `dato no disponible. ${mensaje}`);
  }
  if (!estaVivo() || viewer.isDestroyed()) return fallo("dato no disponible. El globo se cerró durante la carga del relieve.");

  const proveedor = crearProveedor(meta, alturas);
  viewer.scene.setTerrain(new Cesium.Terrain(Promise.resolve(proveedor)));
  const minima = meta.alturaEnteraMinM.toLocaleString("es-EC");
  const maxima = meta.alturaEnteraMaxM.toLocaleString("es-EC");
  return {
    disponible: true,
    clasificacion: CLASIFICACION_EXTERNA,
    resumen: `Copernicus DEM en la reserva (unos ${minima}–${maxima} m). Fuera del recorte el globo sigue el elipsoide, altura 0.`,
    detalle:
      "Capa de visualización (fuente externa). El terreno 3D es el Copernicus DEM GLO-30 recortado a la reserva más 5 km. Fuera de ese rectángulo no hay DEM: el globo vuelve al elipsoide (altura 0) y el borde se ve como un corte. No es una falla geológica. Las alturas son ortométricas (geoide EGM2008) y se dibujan sobre el elipsoide WGS84 sin restar la ondulación del geoide, porque ese modelo no está en el visor.",
    ficha: fichaDesde(meta),
  };
}

function fichaDesde(meta: MetaRelieve): FichaRelieve {
  const minOriginal = meta.alturaMinM.toLocaleString("es-EC", { maximumFractionDigits: 1 });
  const maxOriginal = meta.alturaMaxM.toLocaleString("es-EC", { maximumFractionDigits: 1 });
  const media = meta.alturaMediaM.toLocaleString("es-EC", { maximumFractionDigits: 0 });
  return {
    nombre: meta.producto,
    variable: "Altura del modelo de superficie (DSM)",
    fuente: `${meta.producto} — ${meta.datasetOrigen}`,
    fuenteUrl: meta.fuenteUrl,
    fecha: textoFechaVersion(meta),
    unidades: `${meta.unidadesAltura}, ${meta.referenciaVertical}`,
    resolucionEspacial: textoResolucion(meta),
    resolucionTemporal: "No es una serie temporal. Es un modelo de superficie.",
    licencia: meta.licencia,
    atribucion: meta.atribucion,
    referenciaVertical: meta.referenciaVertical,
    alturas: `${meta.alturaEnteraMinM.toLocaleString("es-EC")}–${meta.alturaEnteraMaxM.toLocaleString("es-EC")} m en el globo (metros enteros). Antes de redondear: ${minOriginal}–${maxOriginal} m, media ${media} m.`,
    margen: `${meta.margenKm.toLocaleString("es-EC")} km. ${meta.margenNota}`,
    teselas: meta.teselas.map((t) => ({ nombre: t.nombre, url: t.url })),
  };
}

function crearProveedor(meta: MetaRelieve, alturas: Float32Array): Cesium.CustomHeightmapTerrainProvider {
  const esquema = new Cesium.GeographicTilingScheme();
  const { oeste, sur, este, norte } = meta.bbox;
  const paso = meta.resolucionGrados;
  const ancho = meta.ancho;
  const alto = meta.alto;

  const alturaEn = (lon: number, lat: number): number => {
    if (lon < oeste || lon > este || lat < sur || lat > norte) return 0;
    // El centro del píxel (0, 0) está medio píxel adentro de la esquina noroeste.
    const col = Math.min(ancho - 1, Math.max(0, (lon - oeste) / paso - 0.5));
    const fila = Math.min(alto - 1, Math.max(0, (norte - lat) / paso - 0.5));
    const c0 = Math.floor(col);
    const f0 = Math.floor(fila);
    const c1 = Math.min(c0 + 1, ancho - 1);
    const f1 = Math.min(f0 + 1, alto - 1);
    const dc = col - c0;
    const df = fila - f0;
    const h00 = alturas[f0 * ancho + c0];
    const h10 = alturas[f0 * ancho + c1];
    const h01 = alturas[f1 * ancho + c0];
    const h11 = alturas[f1 * ancho + c1];
    if (!Number.isFinite(h00) || !Number.isFinite(h10) || !Number.isFinite(h01) || !Number.isFinite(h11)) return 0;
    // Interpolación bilineal entre postes del DEM, solo para la malla. No crea un DEM nuevo.
    return h00 * (1 - dc) * (1 - df) + h10 * dc * (1 - df) + h01 * (1 - dc) * df + h11 * dc * df;
  };

  return new Cesium.CustomHeightmapTerrainProvider({
    width: MUESTRAS,
    height: MUESTRAS,
    tilingScheme: esquema,
    credit: meta.atribucion,
    callback: (x, y, level) => {
      const rect = esquema.tileXYToRectangle(x, y, level);
      const west = Cesium.Math.toDegrees(rect.west);
      const south = Cesium.Math.toDegrees(rect.south);
      const east = Cesium.Math.toDegrees(rect.east);
      const north = Cesium.Math.toDegrees(rect.north);
      const salida = new Float32Array(MUESTRAS * MUESTRAS);
      if (east < oeste || west > este || north < sur || south > norte) return salida;
      const tramos = MUESTRAS - 1;
      for (let fila = 0; fila < MUESTRAS; fila += 1) {
        const lat = north - ((north - south) * fila) / tramos;
        const base = fila * MUESTRAS;
        for (let col = 0; col < MUESTRAS; col += 1) {
          const lon = west + ((east - west) * col) / tramos;
          salida[base + col] = alturaEn(lon, lat);
        }
      }
      return salida;
    },
  });
}

function fallo(detalle: string): EstadoRelieve {
  return {
    disponible: false,
    clasificacion: CLASIFICACION_NO_DISPONIBLE,
    resumen: detalle,
    detalle,
    ficha: FICHA_VACIA,
  };
}

function dejarElipsoide(viewer: Cesium.Viewer, estaVivo: () => boolean): void {
  if (!estaVivo() || viewer.isDestroyed()) return;
  viewer.scene.setTerrain(new Cesium.Terrain(Promise.resolve(new Cesium.EllipsoidTerrainProvider())));
  viewer.scene.verticalExaggeration = 1;
  viewer.scene.verticalExaggerationRelativeHeight = 0;
}
