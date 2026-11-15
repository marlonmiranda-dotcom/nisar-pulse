/**
 * Relieve del globo.
 *
 * 1. Si existe VITE_CESIUM_ION_TOKEN, pide Cesium World Terrain.
 * 2. Si no hay token, o ion no responde, intenta Esri World Elevation
 *    (Terrain3D). Es un servicio público: no lleva clave y el navegador
 *    puede leerlo (CORS). Las teselas Terrarium de AWS Open Data sí
 *    responden, pero ese bucket no envía CORS, así que el navegador no
 *    puede leer las alturas. Por eso no se usan.
 * 3. Si los dos fallan, el globo se queda en el elipsoide y dice
 *    "dato no disponible". No se inventan alturas.
 *
 * Este archivo NO lee un DEM propio, NO calcula pendientes y NO estima
 * susceptibilidad.
 */

import * as Cesium from "cesium";
import { CLASIFICACION_EXTERNA, CLASIFICACION_NO_DISPONIBLE, type ClasificacionCapa } from "./tipos";

export interface FichaProducto {
  nombre: string;
  variable: string;
  fuente: string;
  fuenteUrl: string;
  fecha: string;
  unidades: string;
  resolucionEspacial: string;
  resolucionTemporal: string;
  licencia: string;
}

export const FICHA_ION: FichaProducto = {
  nombre: "Cesium World Terrain",
  variable: "Modelo de elevación para visualizar el globo",
  fuente: "Cesium ion — Cesium World Terrain",
  fuenteUrl: "https://cesium.com/platform/cesium-ion/content/cesium-world-terrain/",
  fecha: "Servicio en línea. No es una fecha de análisis de este equipo.",
  unidades: "metros (altura que entrega el producto; no la recalculamos)",
  resolucionEspacial: "Variable, según Cesium World Terrain. Este visor no la mide.",
  resolucionTemporal: "No es una serie temporal en este visor.",
  licencia: "Términos de Cesium ion asociados al token del proyecto. La atribución de Cesium queda visible en el globo.",
};

export const FICHA_ESRI: FichaProducto = {
  nombre: "Esri World Elevation (Terrain 3D)",
  variable: "Modelo de elevación para visualizar el globo",
  fuente: "Esri — WorldElevation3D/Terrain3D (varias fuentes: USGS, NASA, CGIAR y otras que cita el servicio)",
  fuenteUrl: "https://elevation3d.arcgis.com/arcgis/rest/services/WorldElevation3D/Terrain3D/ImageServer",
  fecha: "Servicio en línea. No es una fecha de análisis de este equipo.",
  unidades: "metros (altura ortométrica que entrega el servicio; no la recalculamos)",
  resolucionEspacial: "Variable: el servicio dice de unos 1000 m a 50 cm según el lugar. Este visor no mide el píxel en la reserva.",
  resolucionTemporal: "No es una serie temporal en este visor.",
  licencia: "Términos de uso de Esri World Elevation. La atribución del servicio queda en el globo.",
};

/** Se muestra solo si ningún modelo respondió. */
export const FICHA_SIN_RELIEVE: FichaProducto = {
  nombre: "Relieve",
  variable: "Modelo de elevación para visualizar el globo",
  fuente: "Ninguna cargada",
  fuenteUrl: "https://cesium.com/platform/cesium-ion/content/cesium-world-terrain/",
  fecha: "Sin modelo",
  unidades: "metros (no hay alturas)",
  resolucionEspacial: "No aplica",
  resolucionTemporal: "No aplica",
  licencia: "No aplica",
};

const URL_ESRI =
  "https://elevation3d.arcgis.com/arcgis/rest/services/WorldElevation3D/Terrain3D/ImageServer";

export interface EstadoRelieve {
  disponible: boolean;
  clasificacion: ClasificacionCapa;
  detalle: string;
  ficha: FichaProducto;
}

export function activarRelieve(viewer: Cesium.Viewer, estaVivo: () => boolean): Promise<EstadoRelieve> {
  const token = (import.meta.env.VITE_CESIUM_ION_TOKEN ?? "").trim();
  if (token) {
    return intentarIon(viewer, estaVivo, token).then((ion) => {
      if (ion.disponible || !estaVivo() || viewer.isDestroyed()) return ion;
      return intentarEsri(viewer, estaVivo, `Cesium World Terrain no se pudo abrir. ${ion.detalle}`);
    });
  }
  return intentarEsri(viewer, estaVivo, "");
}

function intentarIon(viewer: Cesium.Viewer, estaVivo: () => boolean, token: string): Promise<EstadoRelieve> {
  if (!estaVivo() || viewer.isDestroyed()) {
    return Promise.resolve(fallo("dato no disponible. El globo se cerró antes de cargar el relieve."));
  }
  // EQUIPO DE RELIEVE: el token solo vive en el entorno. No lo escriban en el código.
  Cesium.Ion.defaultAccessToken = token;
  const terreno = Cesium.Terrain.fromWorldTerrain({ requestVertexNormals: true });
  viewer.scene.setTerrain(terreno);
  return esperar(viewer, estaVivo, terreno, {
    disponible: true,
    clasificacion: CLASIFICACION_EXTERNA,
    ficha: FICHA_ION,
    detalle:
      "Capa de visualización (fuente externa). Cesium World Terrain llega desde Cesium ion. Este equipo no calcula elevación, pendiente ni susceptibilidad.",
  });
}

function intentarEsri(viewer: Cesium.Viewer, estaVivo: () => boolean, avisoPrevio: string): Promise<EstadoRelieve> {
  if (!estaVivo() || viewer.isDestroyed()) {
    return Promise.resolve(fallo("dato no disponible. El globo se cerró antes de cargar el relieve."));
  }
  const terreno = new Cesium.Terrain(Cesium.ArcGISTiledElevationTerrainProvider.fromUrl(URL_ESRI));
  viewer.scene.setTerrain(terreno);
  const prefijo = avisoPrevio ? `${avisoPrevio} ` : "Sin token de Cesium ion. ";
  return esperar(viewer, estaVivo, terreno, {
    disponible: true,
    clasificacion: CLASIFICACION_EXTERNA,
    ficha: FICHA_ESRI,
    detalle:
      `${prefijo}Se usa Esri World Elevation (Terrain 3D), un modelo abierto que no pide clave. Capa de visualización (fuente externa). Este equipo no calcula elevación, pendiente ni susceptibilidad.`,
  });
}

function esperar(
  viewer: Cesium.Viewer,
  estaVivo: () => boolean,
  terreno: Cesium.Terrain,
  exito: EstadoRelieve,
): Promise<EstadoRelieve> {
  return new Promise((resolve) => {
    let cerrado = false;
    const terminar = (estado: EstadoRelieve) => {
      if (cerrado) return;
      cerrado = true;
      window.clearTimeout(temporizador);
      resolve(estado);
    };
    const temporizador = window.setTimeout(() => {
      dejarElipsoide(viewer, estaVivo);
      terminar(fallo("dato no disponible. El modelo de elevación no respondió a tiempo. No se inventan alturas."));
    }, 20_000);
    terreno.readyEvent.addEventListener(() => {
      if (!estaVivo() || viewer.isDestroyed()) {
        terminar(fallo("dato no disponible. El globo se cerró durante la carga del relieve."));
        return;
      }
      terminar(exito);
    });
    terreno.errorEvent.addEventListener(() => {
      dejarElipsoide(viewer, estaVivo);
      terminar(fallo("dato no disponible. El modelo de elevación no se pudo abrir. No se inventan alturas."));
    });
  });
}

function fallo(detalle: string): EstadoRelieve {
  return { disponible: false, clasificacion: CLASIFICACION_NO_DISPONIBLE, detalle, ficha: FICHA_SIN_RELIEVE };
}

function dejarElipsoide(viewer: Cesium.Viewer, estaVivo: () => boolean): void {
  if (!estaVivo() || viewer.isDestroyed()) return;
  viewer.scene.setTerrain(new Cesium.Terrain(Promise.resolve(new Cesium.EllipsoidTerrainProvider())));
  viewer.scene.verticalExaggeration = 1;
  viewer.scene.verticalExaggerationRelativeHeight = 0;
}
