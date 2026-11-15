/**
 * Panel de capas. En el celular empieza cerrado; en la computadora se ve siempre.
 * Cada ficha muestra la fuente, la fecha, las unidades y la resolución,
 * aunque la casilla esté apagada.
 */

import { CAPAS } from "./capas.config";
import type { EstadoRelieve } from "./terreno";
import type { EstadoLimite } from "./limite";
import {
  CLASIFICACION_DERIVADA,
  CLASIFICACION_NO_DISPONIBLE,
  type CapaImagen,
  type EstadoCapaUi,
} from "./tipos";
import {
  FECHA_MAX,
  FECHA_MIN,
  TOTAL_DIAS,
  fechaDesdeIndice,
  fechaParaCapa,
  indiceDesdeFecha,
  textoFecha,
} from "./tiempo";

interface Props {
  abierto: boolean;
  fecha: string;
  exageracion: number;
  relieve: EstadoRelieve | null;
  limite: EstadoLimite | null;
  capasUi: Record<string, EstadoCapaUi>;
  erroresCapas: Record<string, string>;
  onFecha: (iso: string) => void;
  onExageracion: (valor: number) => void;
  onCapa: (id: string, cambio: Partial<EstadoCapaUi>) => void;
}

export default function PanelCapas({
  abierto,
  fecha,
  exageracion,
  relieve,
  limite,
  capasUi,
  erroresCapas,
  onFecha,
  onExageracion,
  onCapa,
}: Props) {
  const indice = indiceDesdeFecha(fecha);
  const relieveListo = relieve?.disponible === true;

  return (
    <div id="panel-capas" className={`${abierto ? "block" : "hidden"} max-h-[55vh] overflow-y-auto border-t border-white/10 bg-space-950/95 p-3 text-slate-100 lg:block lg:max-h-[640px] lg:w-80 lg:shrink-0 lg:border-l lg:border-t-0`}>
      <h3 className="text-sm font-bold text-white">Capas del globo</h3>
      <p className="mt-1 text-[11px] leading-snug text-slate-400">
        Las capas de la NASA llegan tal cual. La pendiente y el sombreado se calcularon antes, con el Copernicus DEM, y este panel solo los enciende.
      </p>

      <section className="mt-3 rounded-xl border border-white/10 bg-white/[0.03] p-3" aria-labelledby="ficha-limite">
        <h4 id="ficha-limite" className="text-xs font-semibold text-white">Límite de la reserva</h4>
        {limite?.disponible ? (
          <dl className="mt-2 space-y-1 text-[11px]">
            <Fila titulo="Estado" valor={limite.detalle} />
            <Fila titulo="Nombre en el archivo" valor={limite.nombre ?? "WDPA 555593903"} />
            <Fila titulo="Fuente" valor={limite.fuente ?? "No vino metadata.source en el archivo"} />
            <Fila titulo="Fecha de descarga" valor={limite.fecha ?? "Sin fecha en el archivo"} />
            <Fila titulo="Licencia" valor={limite.licencia ?? "Ver términos WDPA"} />
          </dl>
        ) : (
          <p className="mt-2 text-xs font-semibold text-amber-200" role="status">
            {limite?.detalle ?? "dato no disponible. Límite oficial no cargado."}
          </p>
        )}
        {limite?.url && (
          <a className="mt-2 inline-block text-[11px] text-cyan-300 underline" href={limite.url} target="_blank" rel="noreferrer">
            Ficha en Protected Planet
          </a>
        )}
      </section>

      <section className="mt-3 rounded-xl border border-white/10 bg-white/[0.03] p-3" aria-labelledby="ficha-relieve">
        <h4 id="ficha-relieve" className="text-xs font-semibold text-white">{relieve?.ficha.nombre ?? "Copernicus DEM GLO-30"}</h4>
        <p className={`mt-1 text-[11px] font-bold ${relieveListo ? "text-cyan-200" : "text-amber-200"}`} role="status">
          {relieve?.clasificacion ?? CLASIFICACION_NO_DISPONIBLE}
        </p>
        <p className="mt-1 text-[11px] leading-snug text-slate-300">{relieve?.detalle ?? "Cargando relieve…"}</p>
        <dl className="mt-2 space-y-1 text-[11px]">
          <Fila titulo="Variable" valor={relieve?.ficha.variable ?? "Altura del modelo de superficie"} />
          <Fila titulo="Fuente" valor={relieve?.ficha.fuente ?? "Copernicus DEM GLO-30 Public"} />
          <Fila titulo="Fecha de la versión" valor={relieve?.ficha.fecha ?? "dato no disponible"} />
          <Fila titulo="Unidades" valor={relieve?.ficha.unidades ?? "m"} />
          <Fila titulo="Resolución espacial" valor={relieve?.ficha.resolucionEspacial ?? "dato no disponible"} />
          <Fila titulo="Resolución temporal" valor={relieve?.ficha.resolucionTemporal ?? "No es una serie temporal."} />
          <Fila titulo="Alturas del recorte" valor={relieve?.ficha.alturas ?? "dato no disponible"} />
          <Fila titulo="Margen" valor={relieve?.ficha.margen ?? "dato no disponible"} />
          <Fila titulo="Referencia vertical" valor={relieve?.ficha.referenciaVertical ?? "EGM2008"} />
          <Fila titulo="Licencia" valor={relieve?.ficha.licencia ?? "dato no disponible"} />
        </dl>
        {relieve?.ficha.atribucion && (
          <p className="mt-2 text-[10px] leading-snug text-slate-400">{relieve.ficha.atribucion}</p>
        )}
        <a className="mt-2 inline-block text-[11px] text-cyan-300 underline" href={relieve?.ficha.fuenteUrl ?? "https://copernicus-dem-30m.s3.eu-central-1.amazonaws.com/readme.html"} target="_blank" rel="noreferrer">
          README del bucket (sin clave)
        </a>
        {relieveListo && relieve.ficha.teselas.length > 0 && (
          <ul className="mt-2 space-y-1">
            {relieve.ficha.teselas.map((tesela) => (
              <li key={tesela.nombre}>
                <a className="break-all text-[10px] text-cyan-300 underline" href={tesela.url} target="_blank" rel="noreferrer">
                  {tesela.nombre}
                </a>
              </li>
            ))}
          </ul>
        )}
        <label className="mt-3 block text-[11px] text-slate-200">
          Exageración vertical (solo visual): {relieveListo ? `${exageracion.toFixed(1)}×` : "1×, sin relieve"}
          <input
            className="nisar-range mt-1 w-full"
            type="range"
            min={1}
            max={3}
            step={0.1}
            value={relieveListo ? exageracion : 1}
            disabled={!relieveListo}
            aria-valuemin={1}
            aria-valuemax={3}
            aria-valuenow={relieveListo ? exageracion : 1}
            aria-valuetext={relieveListo ? `${exageracion.toFixed(1)} veces` : "dato no disponible"}
            onChange={(e) => onExageracion(Number(e.target.value))}
          />
        </label>
        <p className="mt-1 text-[10px] text-slate-400">
          Estira la vista entre 1× y 3×. No cambia la pendiente ya calculada.
          {!relieveListo && " Sin relieve, el control no cambia la altura."}
        </p>
      </section>

      <Limitaciones />

      <fieldset className="mt-3 rounded-xl border border-white/10 p-3">
        <legend className="px-1 text-xs font-semibold text-white">Fecha de las capas con serie</legend>
        <p id="ayuda-fecha" className="text-[11px] leading-snug text-slate-400">
          Pide otra imagen a la NASA. No calcula tendencias. Si ese día no existe en el archivo, la tesela puede no salir: no se rellena con un valor estimado.
        </p>
        <label className="mt-2 block text-[11px]">
          Fecha
          <input
            className="mt-1 w-full rounded-md border border-white/15 bg-space-800 px-2 py-1 text-sm text-white"
            type="date"
            min={FECHA_MIN}
            max={FECHA_MAX}
            value={fecha}
            aria-describedby="ayuda-fecha"
            onChange={(e) => onFecha(e.target.value)}
          />
        </label>
        <label className="mt-2 block text-[11px]">
          Recorrer el tiempo
          <input
            className="nisar-range mt-1 w-full"
            type="range"
            min={0}
            max={TOTAL_DIAS}
            step={1}
            value={indice}
            aria-valuemin={0}
            aria-valuemax={TOTAL_DIAS}
            aria-valuenow={indice}
            aria-valuetext={textoFecha(fecha)}
            onChange={(e) => onFecha(fechaDesdeIndice(Number(e.target.value)))}
          />
        </label>
        <p className="mt-1 text-xs font-semibold text-cyan-100" aria-live="polite">{textoFecha(fecha)}</p>
      </fieldset>

      <ul className="mt-3 space-y-3">
        {CAPAS.map((capa) => {
          const ui = capasUi[capa.id];
          const esImagen = capa.tipo === "imagen";
          const fechaPedida = esImagen && capa.tiempo ? fechaParaCapa(capa as CapaImagen, fecha) : null;
          return (
            <li key={capa.id} className="rounded-xl border border-white/10 bg-white/[0.03] p-3">
              <h4 id={`titulo-${capa.id}`} className="text-xs font-semibold text-white">{capa.nombre}</h4>
              <p className={`mt-1 text-[11px] font-bold ${capa.clasificacion === CLASIFICACION_NO_DISPONIBLE ? "text-amber-200" : "text-cyan-200"}`}>
                {capa.clasificacion}
              </p>
              {capa.tipo === "no-disponible" ? (
                <p className="mt-1 text-[11px] leading-snug text-amber-100" role="status">{capa.motivo}</p>
              ) : (
                <>
                  <label className="mt-2 flex items-center gap-2 text-xs">
                    <input
                      type="checkbox"
                      checked={ui?.activa ?? false}
                      aria-describedby={`ficha-${capa.id}`}
                      onChange={(e) => onCapa(capa.id, { activa: e.target.checked })}
                    />
                    Mostrar en el globo
                  </label>
                  <label className="mt-2 block text-[11px]">
                    Opacidad {Math.round((ui?.opacidad ?? capa.opacidadInicial) * 100)} %
                    <input
                      className="nisar-range mt-1 w-full"
                      type="range"
                      min={0}
                      max={1}
                      step={0.05}
                      value={ui?.opacidad ?? capa.opacidadInicial}
                      aria-label={`Opacidad de ${capa.nombre}`}
                      aria-valuetext={`${Math.round((ui?.opacidad ?? capa.opacidadInicial) * 100)} por ciento`}
                      onChange={(e) => onCapa(capa.id, { opacidad: Number(e.target.value) })}
                    />
                  </label>
                  {erroresCapas[capa.id] && (
                    <p className="mt-1 text-[11px] font-semibold text-amber-200" role="status">{erroresCapas[capa.id]}</p>
                  )}
                  {"leyenda" in capa && capa.leyenda.length > 0 && (
                    <Leyenda
                      paradas={capa.leyenda}
                      unidades={capa.unidades}
                      derivada={capa.clasificacion === CLASIFICACION_DERIVADA}
                    />
                  )}
                  {"leyendaUrl" in capa && capa.leyendaUrl && (
                    <a className="mt-1 inline-block text-[11px] text-cyan-300 underline" href={capa.leyendaUrl} target="_blank" rel="noreferrer">
                      Leyenda oficial de la NASA
                    </a>
                  )}
                </>
              )}
              <dl id={`ficha-${capa.id}`} className="mt-2 space-y-1 text-[11px]">
                <Fila titulo="Variable" valor={capa.variable} />
                <Fila titulo="Fuente" valor={capa.fuente} />
                <Fila titulo="Fecha o rango" valor={capa.fecha} />
                {fechaPedida && <Fila titulo="Fecha pedida ahora" valor={fechaPedida} />}
                <Fila titulo="Unidades" valor={capa.unidades} />
                <Fila titulo="Resolución espacial" valor={capa.resolucionEspacial} />
                <Fila titulo="Resolución temporal" valor={capa.resolucionTemporal} />
                <Fila titulo="Licencia" valor={capa.licencia} />
                {capa.aviso && <Fila titulo="Nota" valor={capa.aviso} />}
              </dl>
              <a className="mt-2 inline-block text-[11px] text-cyan-300 underline" href={capa.fuenteUrl} target="_blank" rel="noreferrer">
                Abrir la fuente
              </a>
            </li>
          );
        })}
      </ul>
      <p className="mt-3 text-[10px] leading-snug text-slate-500">
        Para sumar una capa, editen <span className="font-mono">src/globe/capas.config.ts</span>. La guía es COMO-AGREGAR-CAPAS.md.
      </p>
    </div>
  );
}

function Fila({ titulo, valor }: { titulo: string; valor: string }) {
  return (
    <div>
      <dt className="text-slate-500">{titulo}</dt>
      <dd className="text-slate-200">{valor}</dd>
    </div>
  );
}

function Limitaciones() {
  return (
    <section className="mt-3 rounded-xl border border-amber-300/40 bg-amber-300/10 p-3" aria-labelledby="ficha-limitaciones">
      <h4 id="ficha-limitaciones" className="text-xs font-semibold text-amber-100">Limitaciones del relieve</h4>
      <ul className="mt-2 list-disc space-y-1 pl-4 text-[11px] leading-snug text-slate-200">
        <li>El píxel mide unos 30 m. Un deslizamiento pequeño, un camino o una quebrada estrecha puede no verse.</li>
        <li>Es un modelo de superficie (DSM). La copa del bosque entra en la altura. Las nubes y la vegetación de la toma de radar afectan el modelo. No es el suelo desnudo.</li>
        <li>La pendiente es un factor de susceptibilidad. No es un mapa de riesgo oficial y no dice dónde va a ocurrir un deslizamiento.</li>
        <li>La cartografía oficial sería la del Ministerio del Ambiente (MAE) y el Sistema Nacional de Áreas Protegidas (SNAP), o la del Instituto Geográfico Militar (IGM). Esos mapas no están incluidos.</li>
        <li>No hay un índice de susceptibilidad compuesto. Harían falta geología, suelos y lluvia a esta escala, y esos datos no están cargados. Solo se muestran pendiente y relieve.</li>
        <li>Fuera del recorte el globo sigue el elipsoide (altura 0). El corte del borde no es una falla del terreno.</li>
        <li>Las alturas vienen en metros sobre el geoide EGM2008 y se dibujan sobre el elipsoide WGS84. La ondulación del geoide no está en el visor: dato no disponible, y por eso no se corrige.</li>
      </ul>
    </section>
  );
}

function Leyenda({ paradas, unidades, derivada }: { paradas: { valor: string; etiqueta: string; color: string; patron: string }[]; unidades: string; derivada: boolean }) {
  return (
    <figure className="mt-2">
      <figcaption className="text-[10px] text-slate-400">
        {derivada
          ? `Leyenda (${unidades}). Clases calculadas en este repositorio. El patrón acompaña al color.`
          : `Leyenda (${unidades}). Cada valor lleva número, texto y patrón; el color es el de la fuente.`}
      </figcaption>
      <ul className="mt-1 space-y-1">
        {paradas.map((parada) => (
          <li key={`${parada.patron}-${parada.valor}-${parada.etiqueta}`} className="flex items-center gap-2 text-[11px]">
            <span
              aria-hidden="true"
              className={`patron-${parada.patron} inline-block h-4 w-8 shrink-0 rounded-sm border border-white/30`}
              style={{ backgroundColor: parada.color }}
            />
            <span className="font-mono text-cyan-100">{parada.valor}</span>
            <span className="text-slate-300">{parada.etiqueta}</span>
          </li>
        ))}
      </ul>
    </figure>
  );
}
