/**
 * Panel de capas. En el celular empieza cerrado; en la computadora se ve siempre.
 * Cada ficha muestra la fuente, la fecha, las unidades y la resolución,
 * aunque la casilla esté apagada.
 */

import { CAPAS } from "./capas.config";
import { FICHA_RELIEVE, type EstadoRelieve } from "./terreno";
import type { EstadoLimite } from "./limite";
import {
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
  erroresPuntos: Record<string, string>;
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
  erroresPuntos,
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
        Las capas marcadas como visualización vienen de fuera. Este panel no calcula el clima ni el relieve.
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
        <h4 id="ficha-relieve" className="text-xs font-semibold text-white">{FICHA_RELIEVE.nombre}</h4>
        <p className={`mt-1 text-[11px] font-bold ${relieveListo ? "text-cyan-200" : "text-amber-200"}`} role="status">
          {relieve?.clasificacion ?? CLASIFICACION_NO_DISPONIBLE}
        </p>
        <p className="mt-1 text-[11px] leading-snug text-slate-300">{relieve?.detalle ?? "Cargando relieve…"}</p>
        <dl className="mt-2 space-y-1 text-[11px]">
          <Fila titulo="Variable" valor={FICHA_RELIEVE.variable} />
          <Fila titulo="Fuente" valor={FICHA_RELIEVE.fuente} />
          <Fila titulo="Fecha" valor={FICHA_RELIEVE.fecha} />
          <Fila titulo="Unidades" valor={FICHA_RELIEVE.unidades} />
          <Fila titulo="Resolución espacial" valor={FICHA_RELIEVE.resolucionEspacial} />
          <Fila titulo="Resolución temporal" valor={FICHA_RELIEVE.resolucionTemporal} />
          <Fila titulo="Licencia" valor={FICHA_RELIEVE.licencia} />
        </dl>
        <a className="mt-2 inline-block text-[11px] text-cyan-300 underline" href={FICHA_RELIEVE.fuenteUrl} target="_blank" rel="noreferrer">
          Documentación del producto
        </a>
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
          Estira el modelo que entrega Cesium. No calcula pendiente ni susceptibilidad.
          {!relieveListo && " Sin relieve, el control no cambia la altura."}
        </p>
      </section>

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
          const fechaPedida = esImagen ? fechaParaCapa(capa as CapaImagen, fecha) : null;
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
                  {erroresPuntos[capa.id] && (
                    <p className="mt-1 text-[11px] font-semibold text-amber-200" role="status">{erroresPuntos[capa.id]}</p>
                  )}
                  {"leyenda" in capa && capa.leyenda.length > 0 && (
                    <Leyenda paradas={capa.leyenda} unidades={capa.unidades} />
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

function Leyenda({ paradas, unidades }: { paradas: { valor: string; etiqueta: string; color: string; patron: string }[]; unidades: string }) {
  return (
    <figure className="mt-2">
      <figcaption className="text-[10px] text-slate-400">
        Leyenda ({unidades}). Cada valor lleva número, texto y patrón; el color es el de la fuente.
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
