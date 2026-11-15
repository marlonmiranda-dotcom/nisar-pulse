/**
 * Lee public/relieve/meta.json y el heightmap que generó
 * scripts/relieve/preparar_relieve.py.
 *
 * Si el archivo falta o no trae el WDPA esperado, lanza un error que
 * empieza por "dato no disponible". No rellena alturas.
 */

export interface BBoxRelieve {
  oeste: number;
  sur: number;
  este: number;
  norte: number;
}

export interface TeselaRelieve {
  nombre: string;
  url: string;
  lastModified: string;
}

export interface MetaRelieve {
  wdpaId: number;
  producto: string;
  datasetOrigen: string;
  fuenteUrl: string;
  coleccionUrl: string;
  licenciaUrl: string;
  licencia: string;
  atribucion: string;
  referenciaVertical: string;
  crs: string;
  resolucionGrados: number;
  resolucionMetrosLonMedia: number;
  resolucionMetrosLatMedia: number;
  unidadesAltura: string;
  unidadesPendiente: string;
  fechaObjetosS3: string[];
  fechaProcesoUtc: string;
  margenKm: number;
  margenNota: string;
  bbox: BBoxRelieve;
  ancho: number;
  alto: number;
  alturaMinM: number;
  alturaMaxM: number;
  alturaMediaM: number;
  alturaEnteraMinM: number;
  alturaEnteraMaxM: number;
  alturaCodificacion: string;
  pendienteMinGrados: number;
  pendienteMaxGrados: number;
  pendienteMediaGrados: number;
  sombreado: { azimutGrados: number; altitudGrados: number; metodo: string };
  archivos: { altura: string; sombreado: string; pendiente: string };
  teselas: TeselaRelieve[];
}

const WDPA = 555593903;
const RUTA_META = `${import.meta.env.BASE_URL}relieve/meta.json`;

let metaEnCurso: Promise<MetaRelieve> | null = null;

export function cargarMetaRelieve(): Promise<MetaRelieve> {
  if (!metaEnCurso) {
    metaEnCurso = leerMeta().catch((error: unknown) => {
      metaEnCurso = null;
      throw error;
    });
  }
  return metaEnCurso;
}

async function leerMeta(): Promise<MetaRelieve> {
  let json: unknown;
  try {
    const respuesta = await fetch(RUTA_META);
    if (!respuesta.ok) throw new Error(`HTTP ${respuesta.status}`);
    json = await respuesta.json();
  } catch {
    throw new Error("dato no disponible. No se pudo leer public/relieve/meta.json. No se inventan alturas.");
  }
  return validarMeta(json);
}

export async function cargarAlturas(meta: MetaRelieve): Promise<Float32Array> {
  const nombre = meta.archivos.altura;
  let buffer: ArrayBuffer;
  try {
    const respuesta = await fetch(`${import.meta.env.BASE_URL}relieve/${nombre}`);
    if (!respuesta.ok) throw new Error(`HTTP ${respuesta.status}`);
    buffer = await respuesta.arrayBuffer();
  } catch {
    throw new Error("dato no disponible. No se pudo leer el heightmap del Copernicus DEM. No se inventan alturas.");
  }
  const n = meta.ancho * meta.alto;
  if (buffer.byteLength !== n * 2) {
    throw new Error("dato no disponible. El heightmap no tiene el tamaño que dice meta.json. No se inventan alturas.");
  }
  const vista = new DataView(buffer);
  const alturas = new Float32Array(n);
  for (let i = 0; i < n; i += 1) {
    const metros = vista.getUint16(i * 2, true);
    // 0 es el código de "sin dato" del script. En este recorte no debería aparecer.
    alturas[i] = metros === 0 ? Number.NaN : metros;
  }
  return alturas;
}

export function textoResolucion(meta: MetaRelieve): string {
  const lon = meta.resolucionMetrosLonMedia.toLocaleString("es-EC", { maximumFractionDigits: 1, minimumFractionDigits: 1 });
  const lat = meta.resolucionMetrosLatMedia.toLocaleString("es-EC", { maximumFractionDigits: 1, minimumFractionDigits: 1 });
  return `1 segundo de arco (GLO-30). En este recorte: ${lon} m de este a oeste y ${lat} m de norte a sur.`;
}

export function textoFechaVersion(meta: MetaRelieve): string {
  const fechas = meta.fechaObjetosS3.filter((f) => f.trim()).join(" · ");
  return fechas
    ? `Teselas COG en AWS Open Data, Last-Modified ${fechas}. Origen que declara el README del bucket: ${meta.datasetOrigen}.`
    : "dato no disponible. meta.json no trae la fecha de las teselas.";
}

function validarMeta(json: unknown): MetaRelieve {
  if (!esObjeto(json)) throw new Error("dato no disponible. meta.json no es un objeto.");
  const wdpa = numero(json.wdpaId, "wdpaId");
  if (wdpa !== WDPA) {
    throw new Error(`dato no disponible. meta.json no es el recorte de WDPA ${WDPA}.`);
  }
  const bbox = bboxDe(json.bbox);
  const ancho = entero(json.ancho, "ancho");
  const alto = entero(json.alto, "alto");
  const resolucion = numero(json.resolucionGrados, "resolucionGrados");
  if (Math.abs(resolucion - 1 / 3600) > 1e-12) {
    throw new Error("dato no disponible. La resolución del recorte no es 1 segundo de arco.");
  }
  if (json.crs !== "EPSG:4326") {
    throw new Error("dato no disponible. El recorte no está en EPSG:4326.");
  }
  const archivos = json.archivos;
  if (!esObjeto(archivos) || !esNombre(archivos.altura) || !esNombre(archivos.sombreado) || !esNombre(archivos.pendiente)) {
    throw new Error("dato no disponible. meta.json no trae los nombres de los archivos de relieve.");
  }
  const sombreado = json.sombreado;
  if (!esObjeto(sombreado)) throw new Error("dato no disponible. meta.json no describe el sombreado.");
  const teselas = teselasDe(json.teselas);
  if (teselas.length === 0) throw new Error("dato no disponible. meta.json no lista las teselas del DEM.");
  const fechas = Array.isArray(json.fechaObjetosS3) ? json.fechaObjetosS3.filter((f): f is string => typeof f === "string") : [];
  return {
    wdpaId: wdpa,
    producto: texto(json.producto, "producto"),
    datasetOrigen: texto(json.datasetOrigen, "datasetOrigen"),
    fuenteUrl: texto(json.fuenteUrl, "fuenteUrl"),
    coleccionUrl: texto(json.coleccionUrl, "coleccionUrl"),
    licenciaUrl: texto(json.licenciaUrl, "licenciaUrl"),
    licencia: texto(json.licencia, "licencia"),
    atribucion: texto(json.atribucion, "atribucion"),
    referenciaVertical: texto(json.referenciaVertical, "referenciaVertical"),
    crs: "EPSG:4326",
    resolucionGrados: resolucion,
    resolucionMetrosLonMedia: numero(json.resolucionMetrosLonMedia, "resolucionMetrosLonMedia"),
    resolucionMetrosLatMedia: numero(json.resolucionMetrosLatMedia, "resolucionMetrosLatMedia"),
    unidadesAltura: texto(json.unidadesAltura, "unidadesAltura"),
    unidadesPendiente: texto(json.unidadesPendiente, "unidadesPendiente"),
    fechaObjetosS3: fechas,
    fechaProcesoUtc: texto(json.fechaProcesoUtc, "fechaProcesoUtc"),
    margenKm: numero(json.margenKm, "margenKm"),
    margenNota: texto(json.margenNota, "margenNota"),
    bbox,
    ancho,
    alto,
    alturaMinM: numero(json.alturaMinM, "alturaMinM"),
    alturaMaxM: numero(json.alturaMaxM, "alturaMaxM"),
    alturaMediaM: numero(json.alturaMediaM, "alturaMediaM"),
    alturaEnteraMinM: numero(json.alturaEnteraMinM, "alturaEnteraMinM"),
    alturaEnteraMaxM: numero(json.alturaEnteraMaxM, "alturaEnteraMaxM"),
    alturaCodificacion: texto(json.alturaCodificacion, "alturaCodificacion"),
    pendienteMinGrados: numero(json.pendienteMinGrados, "pendienteMinGrados"),
    pendienteMaxGrados: numero(json.pendienteMaxGrados, "pendienteMaxGrados"),
    pendienteMediaGrados: numero(json.pendienteMediaGrados, "pendienteMediaGrados"),
    sombreado: {
      azimutGrados: numero(sombreado.azimutGrados, "sombreado.azimutGrados"),
      altitudGrados: numero(sombreado.altitudGrados, "sombreado.altitudGrados"),
      metodo: texto(sombreado.metodo, "sombreado.metodo"),
    },
    archivos: {
      altura: archivos.altura as string,
      sombreado: archivos.sombreado as string,
      pendiente: archivos.pendiente as string,
    },
    teselas,
  };
}

function bboxDe(valor: unknown): BBoxRelieve {
  if (!esObjeto(valor)) throw new Error("dato no disponible. meta.json no trae bbox.");
  const bbox = {
    oeste: numero(valor.oeste, "bbox.oeste"),
    sur: numero(valor.sur, "bbox.sur"),
    este: numero(valor.este, "bbox.este"),
    norte: numero(valor.norte, "bbox.norte"),
  };
  if (!(bbox.oeste < bbox.este) || !(bbox.sur < bbox.norte)) {
    throw new Error("dato no disponible. El bbox del recorte está al revés.");
  }
  // Un recorte de Colonso Chalupas tiene que caer en el Ecuador continental.
  // Si el archivo apunta a otro lugar, no se dibuja.
  if (bbox.norte > 2 || bbox.sur < -6 || bbox.oeste < -82 || bbox.este > -74) {
    throw new Error("dato no disponible. El bbox del recorte no cae sobre la reserva.");
  }
  return bbox;
}

function teselasDe(valor: unknown): TeselaRelieve[] {
  if (!Array.isArray(valor)) return [];
  const salida: TeselaRelieve[] = [];
  for (const item of valor) {
    if (!esObjeto(item)) continue;
    if (typeof item.nombre !== "string" || typeof item.url !== "string") continue;
    salida.push({
      nombre: item.nombre,
      url: item.url,
      lastModified: typeof item.lastModified === "string" ? item.lastModified : "",
    });
  }
  return salida;
}

function esObjeto(valor: unknown): valor is Record<string, unknown> {
  return typeof valor === "object" && valor !== null;
}

function esNombre(valor: unknown): valor is string {
  return typeof valor === "string" && /^[a-z0-9_.-]+$/.test(valor);
}

function numero(valor: unknown, nombre: string): number {
  if (typeof valor !== "number" || !Number.isFinite(valor)) {
    throw new Error(`dato no disponible. meta.json no trae un número válido en ${nombre}.`);
  }
  return valor;
}

function entero(valor: unknown, nombre: string): number {
  const n = numero(valor, nombre);
  if (!Number.isInteger(n) || n < 2) {
    throw new Error(`dato no disponible. meta.json no trae un tamaño válido en ${nombre}.`);
  }
  return n;
}

function texto(valor: unknown, nombre: string): string {
  if (typeof valor !== "string" || !valor.trim()) {
    throw new Error(`dato no disponible. meta.json no trae texto en ${nombre}.`);
  }
  return valor.trim();
}
