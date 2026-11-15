/**
 * Límite de la Reserva Biológica Colonso Chalupas.
 * Lee SOLO el GeoJSON oficial (WDPA ID 555593903).
 * Si el archivo no está o el id no coincide, no dibuja ninguna forma.
 */

import * as Cesium from "cesium";

const RUTA = `${import.meta.env.BASE_URL}data/colonso-chalupas-wdpa-555593903.geojson`;
const WDPA_ESPERADO = 555593903;

export interface EstadoLimite {
  disponible: boolean;
  detalle: string;
  nombre?: string;
  fuente?: string;
  fecha?: string;
  licencia?: string;
  url?: string;
  /** Encuadra la cámara con la geometría ya cargada. No usa coordenadas escritas a mano. */
  encuadrar?: (viewer: Cesium.Viewer, reducirMovimiento: boolean) => void;
  /** La misma reserva, con la cámara más baja para ver el relieve. */
  vistaInclinada?: (viewer: Cesium.Viewer, reducirMovimiento: boolean) => void;
}

interface FeatureWdpa {
  properties?: { site_id?: number | string; name?: string };
  geometry?: { type?: string; coordinates?: unknown };
}

interface ColeccionWdpa {
  metadata?: { source?: string; downloaded?: string; license?: string; url?: string };
  features?: FeatureWdpa[];
}

export async function cargarLimite(viewer: Cesium.Viewer, reducirMovimiento: boolean, estaVivo: () => boolean): Promise<EstadoLimite> {
  let json: ColeccionWdpa;
  try {
    const respuesta = await fetch(RUTA);
    if (!respuesta.ok) throw new Error(`HTTP ${respuesta.status}`);
    json = (await respuesta.json()) as ColeccionWdpa;
  } catch {
    return noCargado("dato no disponible. Límite oficial no cargado. No se pudo leer public/data/colonso-chalupas-wdpa-555593903.geojson.");
  }

  if (!estaVivo() || viewer.isDestroyed()) return noCargado("dato no disponible. Límite oficial no cargado.");

  const feature = (json.features ?? []).find((f) => idDe(f) === WDPA_ESPERADO);
  if (!feature?.geometry) {
    return noCargado("dato no disponible. Límite oficial no cargado. El archivo no trae el polígono WDPA 555593903.");
  }

  const anillos = anillosExteriores(feature.geometry);
  // map, no flatMap: cada anillo sigue siendo una lista de puntos.
  const posiciones = anillos.map(anilloACartesianos).filter((lista) => lista.length >= 3);
  if (posiciones.length === 0) {
    return noCargado("dato no disponible. Límite oficial no cargado. La geometría del archivo no es utilizable.");
  }

  const todas = posiciones.flat();
  const nombre = feature.properties?.name?.trim() || "WDPA 555593903";
  const meta = json.metadata;

  for (const anillo of posiciones) {
    viewer.entities.add({
      polyline: {
        positions: anillo,
        clampToGround: true,
        width: 3,
        material: new Cesium.PolylineDashMaterialProperty({
          color: Cesium.Color.fromCssColorString("#facc15"),
          dashLength: 16,
        }),
        arcType: Cesium.ArcType.GEODESIC,
      },
    });
    viewer.entities.add({
      polygon: {
        hierarchy: new Cesium.PolygonHierarchy(anillo),
        material: Cesium.Color.fromCssColorString("#facc15").withAlpha(0.18),
        classificationType: Cesium.ClassificationType.BOTH,
      },
    });
  }

  const centro = promedioVertices(anillos);
  if (centro) {
    viewer.entities.add({
      position: Cesium.Cartesian3.fromDegrees(centro.lon, centro.lat),
      label: {
        text: `${nombre} · WDPA ${WDPA_ESPERADO}`,
        font: "15px Inter, sans-serif",
        fillColor: Cesium.Color.WHITE,
        outlineColor: Cesium.Color.BLACK,
        outlineWidth: 3,
        style: Cesium.LabelStyle.FILL_AND_OUTLINE,
        heightReference: Cesium.HeightReference.CLAMP_TO_GROUND,
        disableDepthTestDistance: Number.POSITIVE_INFINITY,
        pixelOffset: new Cesium.Cartesian2(0, -8),
      },
    });
  }

  const esfera = Cesium.BoundingSphere.fromPoints(todas);
  const volar = (visor: Cesium.Viewer, reducir: boolean, heading: number, pitch: number, rango: number) => {
    if (visor.isDestroyed()) return;
    const offset = new Cesium.HeadingPitchRange(Cesium.Math.toRadians(heading), Cesium.Math.toRadians(pitch), esfera.radius * rango);
    // duration 0 = salto directo, sin vuelo de cámara (prefers-reduced-motion).
    visor.camera.flyToBoundingSphere(esfera, { duration: reducir ? 0 : 1.4, offset });
  };
  const encuadrar = (visor: Cesium.Viewer, reducir: boolean) => volar(visor, reducir, 0, -40, 2.6);
  // La cordillera queda al oeste del recorte (el DEM es más alto ahí). La cámara
  // se pone al este y mira hacia el oeste, 30° bajo el horizonte, para ver
  // las montañas sin quedar pegada al corte del borde.
  const vistaInclinada = (visor: Cesium.Viewer, reducir: boolean) => volar(visor, reducir, 80, -20, 1.65);

  encuadrar(viewer, reducirMovimiento);

  return {
    disponible: true,
    detalle: `Límite oficial cargado: ${nombre} (WDPA ${WDPA_ESPERADO}).`,
    nombre,
    fuente: meta?.source,
    fecha: meta?.downloaded,
    licencia: meta?.license,
    url: meta?.url,
    encuadrar,
    vistaInclinada,
  };
}

export function prefiereMenosMovimiento(): boolean {
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

function noCargado(detalle: string): EstadoLimite {
  return { disponible: false, detalle };
}

function idDe(feature: FeatureWdpa): number {
  const crudo = feature.properties?.site_id;
  const numero = typeof crudo === "number" ? crudo : Number(crudo);
  return Number.isFinite(numero) ? numero : NaN;
}

function anillosExteriores(geometria: { type?: string; coordinates?: unknown }): number[][][] {
  if (geometria.type === "Polygon" && Array.isArray(geometria.coordinates)) {
    const exterior = geometria.coordinates[0];
    return Array.isArray(exterior) ? [exterior as number[][]] : [];
  }
  if (geometria.type === "MultiPolygon" && Array.isArray(geometria.coordinates)) {
    const salida: number[][][] = [];
    for (const poli of geometria.coordinates) {
      if (Array.isArray(poli) && Array.isArray(poli[0])) salida.push(poli[0] as number[][]);
    }
    return salida;
  }
  return [];
}

function anilloACartesianos(anillo: number[][]): Cesium.Cartesian3[] {
  const pares: number[] = [];
  for (const punto of anillo) {
    if (!Array.isArray(punto) || punto.length < 2) continue;
    const lon = Number(punto[0]);
    const lat = Number(punto[1]);
    if (!Number.isFinite(lon) || !Number.isFinite(lat)) continue;
    pares.push(lon, lat);
  }
  if (pares.length < 6) return [];
  return Cesium.Cartesian3.fromDegreesArray(pares);
}

/** Promedio de los vértices del archivo, solo para colocar el rótulo. */
function promedioVertices(anillos: number[][][]): { lon: number; lat: number } | null {
  let sumaLon = 0;
  let sumaLat = 0;
  let n = 0;
  for (const anillo of anillos) {
    for (const punto of anillo) {
      if (!Array.isArray(punto) || punto.length < 2) continue;
      const lon = Number(punto[0]);
      const lat = Number(punto[1]);
      if (!Number.isFinite(lon) || !Number.isFinite(lat)) continue;
      sumaLon += lon;
      sumaLat += lat;
      n += 1;
    }
  }
  if (n === 0) return null;
  return { lon: sumaLon / n, lat: sumaLat / n };
}
