/**
 * Relieve del globo.
 *
 * Solo conecta Cesium World Terrain si existe VITE_CESIUM_ION_TOKEN.
 * Si no hay token, o el servicio falla, el globo se queda en el elipsoide
 * y la ficha dice "dato no disponible".
 *
 * Este archivo NO lee alturas, NO calcula pendientes y NO estima susceptibilidad.
 * El equipo de relieve, si más adelante trae su propio CesiumTerrainProvider,
 * puede reemplazar el bloque marcado "EQUIPO DE RELIEVE" — sin inventar un DEM aquí.
 */

import * as Cesium from "cesium";
import { CLASIFICACION_EXTERNA, CLASIFICACION_NO_DISPONIBLE, type ClasificacionCapa } from "./tipos";

export const FICHA_RELIEVE = {
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

export interface EstadoRelieve {
  disponible: boolean;
  clasificacion: ClasificacionCapa;
  detalle: string;
}

export function activarRelieve(viewer: Cesium.Viewer, estaVivo: () => boolean): Promise<EstadoRelieve> {
  const token = (import.meta.env.VITE_CESIUM_ION_TOKEN ?? "").trim();
  if (!token) {
    dejarElipsoide(viewer, estaVivo);
    return Promise.resolve({
      disponible: false,
      clasificacion: CLASIFICACION_NO_DISPONIBLE,
      detalle:
        "dato no disponible. Relieve no disponible sin token. Agrega VITE_CESIUM_ION_TOKEN en .env (mira .env.example). El globo usa el elipsoide: no inventamos alturas.",
    });
  }

  // EQUIPO DE RELIEVE: aquí se pide el terreno externo. No calculen alturas en el navegador.
  Cesium.Ion.defaultAccessToken = token;
  const terreno = Cesium.Terrain.fromWorldTerrain({ requestVertexNormals: true });
  if (!estaVivo() || viewer.isDestroyed()) {
    return Promise.resolve(fallo("dato no disponible. El globo se cerró antes de cargar el relieve."));
  }
  viewer.scene.setTerrain(terreno);

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
      terminar(fallo("dato no disponible. Cesium World Terrain no respondió. No se inventan alturas."));
    }, 20_000);

    terreno.readyEvent.addEventListener(() => {
      if (!estaVivo() || viewer.isDestroyed()) {
        terminar(fallo("dato no disponible. El globo se cerró durante la carga del relieve."));
        return;
      }
      terminar({
        disponible: true,
        clasificacion: CLASIFICACION_EXTERNA,
        detalle:
          "Capa de visualización (fuente externa). Cesium World Terrain llega desde Cesium ion. Este equipo no calcula elevación, pendiente ni susceptibilidad.",
      });
    });
    terreno.errorEvent.addEventListener(() => {
      dejarElipsoide(viewer, estaVivo);
      terminar(fallo("dato no disponible. El token no pudo abrir Cesium World Terrain. No se inventan alturas."));
    });
  });
}

function fallo(detalle: string): EstadoRelieve {
  return { disponible: false, clasificacion: CLASIFICACION_NO_DISPONIBLE, detalle };
}

function dejarElipsoide(viewer: Cesium.Viewer, estaVivo: () => boolean): void {
  if (!estaVivo() || viewer.isDestroyed()) return;
  viewer.scene.setTerrain(new Cesium.Terrain(Promise.resolve(new Cesium.EllipsoidTerrainProvider())));
  viewer.scene.verticalExaggeration = 1;
  viewer.scene.verticalExaggerationRelativeHeight = 0;
}
