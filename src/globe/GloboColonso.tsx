/**
 * Globo 3D de la Reserva Biológica Colonso Chalupas.
 *
 * Imágenes base: Esri World Imagery (sin token), las mismas del mapa 2D.
 * Relieve: Cesium World Terrain solo si hay token de ion.
 * Capas: las de capas.config.ts, drapeadas sobre el globo.
 *
 * No calcula clima, elevación, pendiente ni susceptibilidad.
 */

import { useEffect, useRef, useState } from "react";
import * as Cesium from "cesium";
import "cesium/Build/Cesium/Widgets/widgets.css";
import { CAPAS } from "./capas.config";
import PanelCapas from "./PanelCapas";
import { activarRelieve, type EstadoRelieve } from "./terreno";
import { cargarLimite, prefiereMenosMovimiento, type EstadoLimite } from "./limite";
import { acotarFecha, FECHA_MAX, fechaParaCapa, textoFecha, urlDeCapa } from "./tiempo";
import {
  imagenNisar,
  lecturaHansen,
  lecturaJrc,
  lecturaOpera,
  puntosHansen,
  puntosJrc,
  anioDe,
} from "./seriesLocales";
import type { CapaImagen, CapaPuntos, CapaSerieLocal, EstadoCapaUi } from "./tipos";

const BASE_ESRI =
  "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}";

interface CapaDibujada {
  layer: Cesium.ImageryLayer;
  firma: string;
}

function fechaInicial(): string {
  const pedida = new URLSearchParams(window.location.search).get("fecha") ?? "";
  return /^\d{4}-\d{2}-\d{2}$/.test(pedida) ? acotarFecha(pedida) : FECHA_MAX;
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
  const seriesRef = useRef<SeriesDibujadas>(seriesVacias());

  const [listo, setListo] = useState(false);
  const [abierto, setAbierto] = useState(false);
  const [fecha, setFecha] = useState(fechaInicial);
  const [fechaAplicada, setFechaAplicada] = useState(FECHA_MAX);
  const [exageracion, setExageracion] = useState(1.5);
  const [relieve, setRelieve] = useState<EstadoRelieve | null>(null);
  const [limite, setLimite] = useState<EstadoLimite | null>(null);
  const [capasUi, setCapasUi] = useState<Record<string, EstadoCapaUi>>(estadoInicial);
  const [erroresPuntos, setErroresPuntos] = useState<Record<string, string>>({});
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
      seriesRef.current = seriesVacias();
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
    if (!listo || !viewer || viewer.isDestroyed()) return;
    sincronizarImagenes(viewer, fechaAplicada, capasUi, imagenesRef.current);
  }, [listo, fechaAplicada, capasUi]);

  useEffect(() => {
    const viewer = viewerRef.current;
    if (!listo || !viewer || viewer.isDestroyed()) return undefined;
    let cancelado = false;
    void sincronizarSeries(viewer, fechaAplicada, capasUi, seriesRef.current, () => cancelado, (id, mensaje) => {
      if (cancelado) return;
      setErroresPuntos((prev) => {
        if (!mensaje) {
          if (!prev[id]) return prev;
          const next = { ...prev };
          delete next[id];
          return next;
        }
        return { ...prev, [id]: mensaje };
      });
    });
    return () => {
      cancelado = true;
      seriesRef.current.nisarFirma = "";
    };
  }, [listo, fechaAplicada, capasUi]);

  useEffect(() => {
    const viewer = viewerRef.current;
    if (!listo || !viewer || viewer.isDestroyed()) return;
    let cancelado = false;
    void sincronizarPuntos(viewer, capasUi, puntosRef.current, (id, mensaje) => {
      if (cancelado) return;
      setErroresPuntos((prev) => ({ ...prev, [id]: mensaje }));
    }).then(() => {
      if (!cancelado && viewerRef.current && !viewerRef.current.isDestroyed()) {
        viewerRef.current.scene.requestRender();
      }
    });
    return () => {
      cancelado = true;
    };
  }, [listo, capasUi]);

  const centrar = () => {
    const viewer = viewerRef.current;
    if (!viewer || viewer.isDestroyed() || !limite?.encuadrar) return;
    limite.encuadrar(viewer, reducirMovimiento || prefiereMenosMovimiento());
  };

  return (
    <div className="flex flex-col lg:min-h-[640px] lg:flex-row">
      <div className="relative h-[52vh] min-h-[300px] w-full lg:h-auto lg:min-h-[640px] lg:flex-1">
        <div ref={contenedorRef} className="globo-cesium absolute inset-0" />
        <div className="pointer-events-none absolute left-3 right-16 top-3 z-10 flex flex-col gap-2">
          <p className="pointer-events-auto max-w-xs rounded-lg bg-black/80 px-2 py-1 text-[11px] leading-snug text-slate-100 sm:max-w-md sm:px-3 sm:py-2 sm:text-xs">
            Globo 3D. El mapa 2D conserva el comparador NISAR.
          </p>
          {limite && !limite.disponible && (
            <p className="pointer-events-auto max-w-xs rounded-lg bg-amber-300 px-2 py-1 text-[11px] font-bold text-black sm:max-w-md" role="status">
              {limite.detalle}
            </p>
          )}
          {relieve && !relieve.disponible && (
            <p className="pointer-events-auto max-w-xs rounded-lg bg-amber-300 px-2 py-1 text-[11px] font-bold text-black sm:max-w-md" role="status">
              {relieve.detalle}
            </p>
          )}
          {relieve?.disponible && (
            <p className="pointer-events-auto max-w-xs rounded-lg bg-black/75 px-2 py-1 text-[11px] text-cyan-100 sm:max-w-md" role="status">
              {relieve.ficha.nombre}. Alturas del servicio, no calculadas aquí.
            </p>
          )}
          <div className="pointer-events-auto max-w-xs rounded-lg bg-black/80 px-2 py-1.5 text-[11px] leading-snug text-slate-100 sm:max-w-md sm:px-3" aria-live="polite">
            <p className="font-semibold text-white">{textoFecha(fecha)}</p>
            <ul className="mt-0.5 space-y-0.5">
              <li>{lecturaHansen(fecha).corto}</li>
              <li>{lecturaOpera(fecha).corto}</li>
              <li>{lecturaJrc(fecha).corto}</li>
              <li>{imagenNisar(fecha).lectura.corto}</li>
            </ul>
          </div>
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
            className="rounded-lg bg-space-950/90 px-3 py-2 text-xs font-semibold text-white ring-1 ring-white/20 disabled:opacity-50"
            onClick={centrar}
            disabled={!limite?.disponible}
            aria-describedby={limite?.disponible ? undefined : "aviso-sin-limite"}
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
        erroresPuntos={erroresPuntos}
        onFecha={(iso) => setFecha(acotarFecha(iso))}
        onExageracion={setExageracion}
        onCapa={(id, cambio) => setCapasUi((prev) => ({ ...prev, [id]: { ...prev[id], ...cambio } }))}
      />
    </div>
  );
}

function sincronizarImagenes(
  viewer: Cesium.Viewer,
  fecha: string,
  capasUi: Record<string, EstadoCapaUi>,
  registro: Map<string, CapaDibujada>,
): void {
  const activas = new Set<string>();
  for (const capa of CAPAS) {
    if (capa.tipo !== "imagen") continue;
    const ui = capasUi[capa.id];
    if (!ui?.activa) continue;
    activas.add(capa.id);
    const firma = `${fechaParaCapa(capa, fecha)}|${capa.servicio}`;
    const previa = registro.get(capa.id);
    if (previa && previa.firma === firma) {
      previa.layer.alpha = ui.opacidad;
      continue;
    }
    quitarImagen(viewer, registro, capa.id);
    const layer = viewer.imageryLayers.addImageryProvider(proveedorImagen(capa, fecha));
    layer.alpha = ui.opacidad;
    registro.set(capa.id, { layer, firma });
  }
  for (const id of [...registro.keys()]) {
    if (!activas.has(id)) quitarImagen(viewer, registro, id);
  }
  viewer.scene.requestRender();
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

interface SeriesDibujadas {
  hansenFirma: string;
  hansen: Cesium.Entity[];
  jrcFirma: string;
  jrc: Cesium.Entity[];
  nisarFirma: string;
  nisar: Cesium.ImageryLayer | null;
}

function seriesVacias(): SeriesDibujadas {
  return { hansenFirma: "", hansen: [], jrcFirma: "", jrc: [], nisarFirma: "", nisar: null };
}

async function sincronizarSeries(
  viewer: Cesium.Viewer,
  fecha: string,
  capasUi: Record<string, EstadoCapaUi>,
  registro: SeriesDibujadas,
  cancelado: () => boolean,
  alFallar: (id: string, mensaje: string) => void,
): Promise<void> {
  const hansen = capaSerie("hansen-anio");
  const jrc = capaSerie("jrc-historica");
  const nisar = capaSerie("nisar-imagen");
  const uiHansen = hansen ? capasUi[hansen.id] : undefined;
  const uiJrc = jrc ? capasUi[jrc.id] : undefined;
  const uiNisar = nisar ? capasUi[nisar.id] : undefined;

  const anio = anioDe(fecha);
  const firmaHansen = uiHansen?.activa ? `${anio}|${uiHansen.opacidad}` : "off";
  if (firmaHansen !== registro.hansenFirma) {
    borrarEntidades(viewer, registro.hansen);
    registro.hansen = [];
    registro.hansenFirma = firmaHansen;
    if (uiHansen?.activa && hansen) {
      const puntos = puntosHansen(anio);
      alFallar(hansen.id, "");
      registro.hansen = puntos.map((punto) => viewer.entities.add({
        position: Cesium.Cartesian3.fromDegrees(punto.lon, punto.lat),
        point: {
          pixelSize: 8,
          color: colorGrupo(punto.grupo).withAlpha(uiHansen.opacidad),
          outlineColor: Cesium.Color.BLACK.withAlpha(uiHansen.opacidad),
          outlineWidth: 1,
          heightReference: Cesium.HeightReference.CLAMP_TO_GROUND,
          disableDepthTestDistance: Number.POSITIVE_INFINITY,
        },
      }));
    }
  }

  const firmaJrc = uiJrc?.activa ? `on|${uiJrc.opacidad}` : "off";
  if (firmaJrc !== registro.jrcFirma) {
    borrarEntidades(viewer, registro.jrc);
    registro.jrc = [];
    registro.jrcFirma = firmaJrc;
    if (uiJrc?.activa && jrc) {
      const puntos = puntosJrc();
      if (puntos.length === 0) {
        alFallar(jrc.id, "dato no disponible. El GeoJSON de ocurrencia JRC no trae puntos.");
      }
      registro.jrc = puntos.map((punto) => {
        const color = (punto.ocurrencia >= 50 ? Cesium.Color.fromCssColorString("#0369a1") : Cesium.Color.fromCssColorString("#7dd3fc")).withAlpha(uiJrc.opacidad);
        return viewer.entities.add({
          position: Cesium.Cartesian3.fromDegrees(punto.lon, punto.lat),
          point: {
            pixelSize: punto.ocurrencia >= 50 ? 7 : 5,
            color,
            outlineWidth: 0,
            heightReference: Cesium.HeightReference.CLAMP_TO_GROUND,
            disableDepthTestDistance: Number.POSITIVE_INFINITY,
          },
        });
      });
    }
  }

  const imagen = imagenNisar(fecha);
  const firmaNisar = uiNisar?.activa && imagen.url ? `${imagen.firma}|${uiNisar.opacidad}` : "off";
  if (firmaNisar !== registro.nisarFirma) {
    if (registro.nisar) {
      viewer.imageryLayers.remove(registro.nisar, true);
      registro.nisar = null;
    }
    registro.nisarFirma = firmaNisar;
    if (uiNisar?.activa && nisar && imagen.url != null && imagen.oeste != null && imagen.sur != null && imagen.este != null && imagen.norte != null) {
      try {
        const provider = await Cesium.SingleTileImageryProvider.fromUrl(imagen.url, {
          rectangle: Cesium.Rectangle.fromDegrees(imagen.oeste, imagen.sur, imagen.este, imagen.norte),
          credit: "Vista previa NISAR L2 GCOV · ASF DAAC",
        });
        if (cancelado() || viewer.isDestroyed() || registro.nisarFirma !== firmaNisar) return;
        const layer = viewer.imageryLayers.addImageryProvider(provider);
        layer.alpha = uiNisar.opacidad;
        registro.nisar = layer;
        alFallar(nisar.id, "");
      } catch {
        if (!cancelado()) {
          alFallar(nisar.id, "dato no disponible. No se pudo abrir la vista previa NISAR de esa fecha.");
        }
      }
    }
  } else if (registro.nisar && uiNisar) {
    registro.nisar.alpha = uiNisar.opacidad;
  }

  if (!viewer.isDestroyed()) viewer.scene.requestRender();
}

function capaSerie(id: string): CapaSerieLocal | undefined {
  const capa = CAPAS.find((item) => item.id === id);
  return capa?.tipo === "serie" ? capa : undefined;
}

function colorGrupo(grupo: string): Cesium.Color {
  if (grupo === "2019-2025") return Cesium.Color.fromCssColorString("#ef4444");
  if (grupo === "2011-2018") return Cesium.Color.fromCssColorString("#f97316");
  return Cesium.Color.fromCssColorString("#facc15");
}

function borrarEntidades(viewer: Cesium.Viewer, entidades: Cesium.Entity[]): void {
  if (viewer.isDestroyed()) return;
  for (const entidad of entidades) viewer.entities.remove(entidad);
}

function aplicarOpacidadPuntos(entidades: Cesium.Entity[], opacidad: number): void {
  for (const entidad of entidades) {
    const punto = entidad.point;
    const etiqueta = entidad.label;
    if (punto?.color) punto.color = new Cesium.ConstantProperty(Cesium.Color.CYAN.withAlpha(opacidad));
    if (etiqueta?.fillColor) etiqueta.fillColor = new Cesium.ConstantProperty(Cesium.Color.WHITE.withAlpha(opacidad));
  }
}
