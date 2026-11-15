/**
 * Globo 3D de la Reserva Biológica Colonso Chalupas.
 *
 * Imágenes base: Esri World Imagery (sin token), las mismas del mapa 2D.
 * Relieve: Copernicus DEM GLO-30 recortado en public/relieve/ (sin Cesium ion).
 * Capas: las de capas.config.ts, drapeadas sobre el globo.
 *
 * No calcula clima. La pendiente y el sombreado ya vienen calculados en los PNG.
 */

import { useEffect, useRef, useState } from "react";
import * as Cesium from "cesium";
import "cesium/Build/Cesium/Widgets/widgets.css";
import { CAPAS } from "./capas.config";
import PanelCapas from "./PanelCapas";
import { cargarMetaRelieve } from "./relieveDatos";
import { activarRelieve, type EstadoRelieve } from "./terreno";
import { cargarLimite, prefiereMenosMovimiento, type EstadoLimite } from "./limite";
import { acotarFecha, FECHA_MAX, fechaParaCapa, urlDeCapa } from "./tiempo";
import type { CapaImagen, CapaPuntos, EstadoCapaUi } from "./tipos";

const BASE_ESRI =
  "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}";

interface CapaDibujada {
  layer: Cesium.ImageryLayer;
  firma: string;
}

function estadoInicial(): Record<string, EstadoCapaUi> {
  const salida: Record<string, EstadoCapaUi> = {};
  for (const capa of CAPAS) {
    if (capa.tipo === "no-disponible") continue;
    salida[capa.id] = { activa: capa.activaAlInicio, opacidad: capa.opacidadInicial };
  }
  return salida;
}

export default function GloboColonso() {
  const contenedorRef = useRef<HTMLDivElement | null>(null);
  const viewerRef = useRef<Cesium.Viewer | null>(null);
  const imagenesRef = useRef<Map<string, CapaDibujada>>(new Map());
  const puntosRef = useRef<Map<string, Cesium.Entity[]>>(new Map());

  const [listo, setListo] = useState(false);
  const [abierto, setAbierto] = useState(false);
  const [fecha, setFecha] = useState(FECHA_MAX);
  const [fechaAplicada, setFechaAplicada] = useState(FECHA_MAX);
  const [exageracion, setExageracion] = useState(2);
  const [relieve, setRelieve] = useState<EstadoRelieve | null>(null);
  const [limite, setLimite] = useState<EstadoLimite | null>(null);
  const [capasUi, setCapasUi] = useState<Record<string, EstadoCapaUi>>(estadoInicial);
  const [erroresCapas, setErroresCapas] = useState<Record<string, string>>({});
  const [reducirMovimiento, setReducirMovimiento] = useState(prefiereMenosMovimiento);

  useEffect(() => {
    const medio = window.matchMedia("(prefers-reduced-motion: reduce)");
    const alCambiar = () => setReducirMovimiento(medio.matches);
    medio.addEventListener("change", alCambiar);
    return () => medio.removeEventListener("change", alCambiar);
  }, []);

  useEffect(() => {
    const id = window.setTimeout(() => setFechaAplicada(fecha), 250);
    return () => window.clearTimeout(id);
  }, [fecha]);

  useEffect(() => {
    const el = contenedorRef.current;
    if (!el) return undefined;
    let vivo = true;
    const estaVivo = () => vivo;

    const viewer = new Cesium.Viewer(el, {
      animation: false,
      timeline: false,
      baseLayerPicker: false,
      geocoder: false,
      homeButton: false,
      sceneModePicker: false,
      navigationHelpButton: false,
      fullscreenButton: false,
      infoBox: false,
      selectionIndicator: false,
      shouldAnimate: false,
      terrainProvider: new Cesium.EllipsoidTerrainProvider(),
      baseLayer: new Cesium.ImageryLayer(
        new Cesium.UrlTemplateImageryProvider({
          url: BASE_ESRI,
          maximumLevel: 18,
          credit: "Imágenes base © Esri, Maxar, Earthstar Geographics",
        }),
      ),
    });
    viewer.scene.globe.baseColor = Cesium.Color.fromCssColorString("#0b1d36");
    viewer.scene.verticalExaggeration = 1;
    viewer.cesiumWidget.screenSpaceEventHandler.removeInputAction(Cesium.ScreenSpaceEventType.LEFT_DOUBLE_CLICK);
    viewer.canvas.setAttribute(
      "aria-label",
      "Globo 3D interactivo. El límite, el relieve y las capas se explican en los avisos y en el panel.",
    );
    viewerRef.current = viewer;

    void (async () => {
      const [estadoRelieve, estadoLimite] = await Promise.all([
        activarRelieve(viewer, estaVivo),
        cargarLimite(viewer, prefiereMenosMovimiento(), estaVivo),
      ]);
      if (!estaVivo() || viewer.isDestroyed()) return;
      viewer.scene.globe.depthTestAgainstTerrain = estadoRelieve.disponible;
      setRelieve(estadoRelieve);
      setLimite(estadoLimite);
      setListo(true);
    })();

    return () => {
      vivo = false;
      imagenesRef.current.clear();
      puntosRef.current.clear();
      if (!viewer.isDestroyed()) viewer.destroy();
      if (viewerRef.current === viewer) viewerRef.current = null;
      setListo(false);
    };
  }, []);

  useEffect(() => {
    const viewer = viewerRef.current;
    if (!listo || !viewer || viewer.isDestroyed() || !relieve?.disponible) return;
    viewer.scene.verticalExaggeration = exageracion;
    viewer.scene.verticalExaggerationRelativeHeight = 0;
    viewer.scene.requestRender();
  }, [listo, relieve, exageracion]);

  useEffect(() => {
    const viewer = viewerRef.current;
    if (!listo || !viewer || viewer.isDestroyed()) return undefined;
    let cancelado = false;
    void sincronizarImagenes(viewer, fechaAplicada, capasUi, imagenesRef.current, () => cancelado, anotarError).then(() => {
      if (!cancelado && viewerRef.current && !viewerRef.current.isDestroyed()) {
        viewerRef.current.scene.requestRender();
      }
    });
    return () => {
      cancelado = true;
    };
  }, [listo, fechaAplicada, capasUi]);

  useEffect(() => {
    const viewer = viewerRef.current;
    if (!listo || !viewer || viewer.isDestroyed()) return;
    let cancelado = false;
    void sincronizarPuntos(viewer, capasUi, puntosRef.current, (id, mensaje) => {
      if (cancelado) return;
      anotarError(id, mensaje);
    }).then(() => {
      if (!cancelado && viewerRef.current && !viewerRef.current.isDestroyed()) {
        viewerRef.current.scene.requestRender();
      }
    });
    return () => {
      cancelado = true;
    };
  }, [listo, capasUi]);

  const anotarError = (id: string, mensaje: string | null) => {
    setErroresCapas((prev) => {
      if (!mensaje) {
        if (!(id in prev)) return prev;
        const copia = { ...prev };
        delete copia[id];
        return copia;
      }
      if (prev[id] === mensaje) return prev;
      return { ...prev, [id]: mensaje };
    });
  };

  const moverCamara = (modo: "centrar" | "inclinada") => {
    const viewer = viewerRef.current;
    if (!viewer || viewer.isDestroyed()) return;
    const reducir = reducirMovimiento || prefiereMenosMovimiento();
    if (modo === "inclinada") limite?.vistaInclinada?.(viewer, reducir);
    else limite?.encuadrar?.(viewer, reducir);
  };

  return (
    <div className="flex flex-col lg:min-h-[640px] lg:flex-row">
      <div className="relative h-[52vh] min-h-[300px] w-full lg:h-auto lg:min-h-[640px] lg:flex-1">
        <div ref={contenedorRef} className="globo-cesium absolute inset-0" />
        <div className="pointer-events-none absolute left-3 right-16 top-3 z-10 flex flex-col gap-2">
          <p className="pointer-events-auto max-w-md rounded-lg bg-black/80 px-3 py-2 text-xs leading-snug text-slate-100">
            Globo 3D. La vista de detalle 2D conserva el comparador NISAR.
          </p>
          {limite && !limite.disponible && (
            <p className="pointer-events-auto max-w-md rounded-lg bg-amber-300 px-3 py-2 text-xs font-bold text-black" role="status">
              {limite.detalle}
            </p>
          )}
          {relieve && !relieve.disponible && (
            <p className="pointer-events-auto max-w-md rounded-lg bg-amber-300 px-3 py-2 text-xs font-bold text-black" role="status">
              {relieve.detalle}
            </p>
          )}
          {relieve?.disponible && (
            <p className="pointer-events-auto max-w-md rounded-lg bg-black/75 px-3 py-2 text-[11px] text-cyan-100" role="status">
              {relieve.clasificacion}. {relieve.resumen}
            </p>
          )}
        </div>
        <div className="absolute bottom-8 left-3 z-10 flex flex-wrap gap-2">
          <button
            type="button"
            className="rounded-lg bg-space-950/90 px-3 py-2 text-xs font-semibold text-white ring-1 ring-white/20 lg:hidden"
            aria-expanded={abierto}
            aria-controls="panel-capas"
            onClick={() => setAbierto((v) => !v)}
          >
            {abierto ? "Ocultar capas" : "Capas"}
          </button>
          <button
            type="button"
            className="rounded-lg bg-cyan-700 px-3 py-2 text-xs font-semibold text-white ring-1 ring-white/20 disabled:opacity-50"
            onClick={() => moverCamara("inclinada")}
            disabled={!limite?.disponible}
            aria-describedby={limite?.disponible ? undefined : "aviso-sin-limite"}
          >
            Ir a la reserva
          </button>
          <button
            type="button"
            className="rounded-lg bg-space-950/90 px-3 py-2 text-xs font-semibold text-white ring-1 ring-white/20 disabled:opacity-50"
            onClick={() => moverCamara("centrar")}
            disabled={!limite?.disponible}
          >
            Centrar reserva
          </button>
          {!limite?.disponible && (
            <span id="aviso-sin-limite" className="sr-only">
              dato no disponible. Límite oficial no cargado.
            </span>
          )}
        </div>
      </div>
      <PanelCapas
        abierto={abierto}
        fecha={fecha}
        exageracion={exageracion}
        relieve={relieve}
        limite={limite}
        capasUi={capasUi}
        erroresCapas={erroresCapas}
        onFecha={(iso) => setFecha(acotarFecha(iso))}
        onExageracion={setExageracion}
        onCapa={(id, cambio) => setCapasUi((prev) => ({ ...prev, [id]: { ...prev[id], ...cambio } }))}
      />
    </div>
  );
}

async function sincronizarImagenes(
  viewer: Cesium.Viewer,
  fecha: string,
  capasUi: Record<string, EstadoCapaUi>,
  registro: Map<string, CapaDibujada>,
  cancelado: () => boolean,
  alFallar: (id: string, mensaje: string | null) => void,
): Promise<void> {
  const activas = new Set<string>();
  for (const capa of CAPAS) {
    if (capa.tipo !== "imagen") continue;
    const ui = capasUi[capa.id];
    if (!ui?.activa) continue;
    activas.add(capa.id);
    const firma = capa.servicio === "local"
      ? `local|${capa.url}`
      : `${fechaParaCapa(capa, fecha)}|${capa.servicio}|${capa.url}`;
    const previa = registro.get(capa.id);
    if (previa && previa.firma === firma) {
      previa.layer.alpha = ui.opacidad;
      continue;
    }
    quitarImagen(viewer, registro, capa.id);
    let proveedor: Cesium.ImageryProvider;
    try {
      proveedor = capa.servicio === "local"
        ? await proveedorLocal(capa)
        : proveedorImagen(capa, fecha);
    } catch (error) {
      const mensaje = error instanceof Error ? error.message : "dato no disponible. No se pudo dibujar la capa.";
      alFallar(capa.id, mensaje.startsWith("dato no disponible") ? mensaje : `dato no disponible. ${mensaje}`);
      continue;
    }
    if (cancelado() || viewer.isDestroyed()) return;
    alFallar(capa.id, null);
    const layer = viewer.imageryLayers.addImageryProvider(proveedor);
    layer.alpha = ui.opacidad;
    registro.set(capa.id, { layer, firma });
  }
  for (const id of [...registro.keys()]) {
    if (!activas.has(id)) quitarImagen(viewer, registro, id);
  }
  if (!viewer.isDestroyed()) viewer.scene.requestRender();
}

async function proveedorLocal(capa: CapaImagen): Promise<Cesium.ImageryProvider> {
  const meta = await cargarMetaRelieve();
  const { oeste, sur, este, norte } = meta.bbox;
  return Cesium.SingleTileImageryProvider.fromUrl(capa.url, {
    rectangle: Cesium.Rectangle.fromDegrees(oeste, sur, este, norte),
    credit: capa.fuente,
  });
}

function proveedorImagen(capa: CapaImagen, fecha: string): Cesium.ImageryProvider {
  if (capa.servicio === "wms") {
    return new Cesium.WebMapServiceImageryProvider({
      url: capa.url,
      layers: capa.capasWms ?? "",
      parameters: {
        transparent: true,
        format: "image/png",
        ...(capa.tiempo ? { time: fechaParaCapa(capa, fecha) } : {}),
      },
      credit: capa.fuente,
    });
  }
  return new Cesium.UrlTemplateImageryProvider({
    url: urlDeCapa(capa, fecha),
    maximumLevel: capa.nivelMaximo,
    credit: capa.fuente,
    tilingScheme: new Cesium.WebMercatorTilingScheme(),
  });
}

function quitarImagen(viewer: Cesium.Viewer, registro: Map<string, CapaDibujada>, id: string): void {
  const previa = registro.get(id);
  if (!previa || viewer.isDestroyed()) return;
  viewer.imageryLayers.remove(previa.layer, true);
  registro.delete(id);
}

async function sincronizarPuntos(
  viewer: Cesium.Viewer,
  capasUi: Record<string, EstadoCapaUi>,
  registro: Map<string, Cesium.Entity[]>,
  alFallar: (id: string, mensaje: string) => void,
): Promise<void> {
  for (const capa of CAPAS) {
    if (capa.tipo !== "puntos") continue;
    const ui = capasUi[capa.id];
    const previas = registro.get(capa.id) ?? [];
    if (!ui?.activa) {
      borrarPuntos(viewer, registro, capa.id);
      continue;
    }
    if (previas.length > 0) {
      aplicarOpacidadPuntos(previas, ui.opacidad);
      continue;
    }
    const entidades = await leerPuntos(viewer, capa, ui.opacidad, alFallar);
    if (viewer.isDestroyed()) return;
    registro.set(capa.id, entidades);
  }
}

async function leerPuntos(
  viewer: Cesium.Viewer,
  capa: CapaPuntos,
  opacidad: number,
  alFallar: (id: string, mensaje: string) => void,
): Promise<Cesium.Entity[]> {
  let json: { features?: { properties?: Record<string, unknown>; geometry?: { type?: string; coordinates?: unknown } }[] };
  try {
    const respuesta = await fetch(capa.urlPuntos);
    if (!respuesta.ok) throw new Error(`HTTP ${respuesta.status}`);
    json = await respuesta.json();
  } catch {
    alFallar(capa.id, "dato no disponible. No se pudo leer el GeoJSON de puntos. No se dibujan sitios de ejemplo.");
    return [];
  }
  const entidades: Cesium.Entity[] = [];
  for (const feature of json.features ?? []) {
    const listas = coordenadasDePuntos(feature.geometry);
    const nombre = textoPropiedad(feature.properties, ["nombre", "name", "estacion", "station"]) ?? "Punto";
    for (const [lon, lat] of listas) {
      if (viewer.isDestroyed()) return entidades;
      const entidad = viewer.entities.add({
        position: Cesium.Cartesian3.fromDegrees(lon, lat),
        point: {
          pixelSize: 10,
          color: Cesium.Color.CYAN.withAlpha(opacidad),
          outlineColor: Cesium.Color.BLACK,
          outlineWidth: 2,
          heightReference: Cesium.HeightReference.CLAMP_TO_GROUND,
        },
        label: {
          text: nombre,
          font: "13px Inter, sans-serif",
          fillColor: Cesium.Color.WHITE.withAlpha(opacidad),
          outlineColor: Cesium.Color.BLACK,
          outlineWidth: 2,
          style: Cesium.LabelStyle.FILL_AND_OUTLINE,
          heightReference: Cesium.HeightReference.CLAMP_TO_GROUND,
          pixelOffset: new Cesium.Cartesian2(0, -16),
          disableDepthTestDistance: Number.POSITIVE_INFINITY,
        },
      });
      entidades.push(entidad);
    }
  }
  if (entidades.length === 0) {
    alFallar(capa.id, "dato no disponible. El GeoJSON no trae puntos utilizables.");
  }
  return entidades;
}

function coordenadasDePuntos(geometria: { type?: string; coordinates?: unknown } | undefined): [number, number][] {
  if (!geometria) return [];
  const crudas = geometria.type === "Point"
    ? [geometria.coordinates]
    : geometria.type === "MultiPoint" && Array.isArray(geometria.coordinates)
      ? geometria.coordinates
      : [];
  const salida: [number, number][] = [];
  for (const item of crudas) {
    if (!Array.isArray(item) || item.length < 2) continue;
    const lon = Number(item[0]);
    const lat = Number(item[1]);
    if (!Number.isFinite(lon) || !Number.isFinite(lat)) continue;
    salida.push([lon, lat]);
  }
  return salida;
}

function textoPropiedad(props: Record<string, unknown> | undefined, claves: string[]): string | null {
  if (!props) return null;
  for (const clave of claves) {
    const valor = props[clave];
    if (typeof valor === "string" && valor.trim()) return valor.trim();
  }
  return null;
}

function borrarPuntos(viewer: Cesium.Viewer, registro: Map<string, Cesium.Entity[]>, id: string): void {
  const previas = registro.get(id);
  if (!previas || viewer.isDestroyed()) return;
  for (const entidad of previas) viewer.entities.remove(entidad);
  registro.delete(id);
}

function aplicarOpacidadPuntos(entidades: Cesium.Entity[], opacidad: number): void {
  for (const entidad of entidades) {
    const punto = entidad.point;
    const etiqueta = entidad.label;
    if (punto?.color) punto.color = new Cesium.ConstantProperty(Cesium.Color.CYAN.withAlpha(opacidad));
    if (etiqueta?.fillColor) etiqueta.fillColor = new Cesium.ConstantProperty(Cesium.Color.WHITE.withAlpha(opacidad));
  }
}
