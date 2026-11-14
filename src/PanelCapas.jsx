/**
 * Gráficos de bosque, verdor y agua, más la predicción del equipo.
 * Los números salen de src/data/capas_reserva.json (script scripts/capas/).
 * La recta se calcula en src/prediccion.js, a la vista, para que se pueda leer.
 */
import { useMemo } from "react";
import {
  ResponsiveContainer,
  ComposedChart,
  Area,
  Bar,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
} from "recharts";
import { Trees, Leaf, Droplets, TriangleAlert, ExternalLink, Database } from "lucide-react";
import CAPAS from "./data/capas_reserva.json";
import { proyectar, frasePrediccion } from "./prediccion.js";

const tooltip = {
  contentStyle: { background: "#0a0f1f", border: "1px solid rgba(34,211,238,0.35)", borderRadius: 10, fontSize: 12 },
  labelStyle: { color: "#22d3ee", fontWeight: 600 },
  itemStyle: { color: "#e2e8f0" },
};

function puntosDe(serie, clave) {
  return serie.map((fila) => ({
    x: fila.anio,
    y: fila[clave],
    usar: fila.entra_en_recta !== false,
  }));
}

function Aviso({ item }) {
  return (
    <div className="flex gap-2 rounded-xl bg-amber-500/10 p-3 ring-1 ring-amber-400/40">
      <TriangleAlert className="mt-0.5 h-4 w-4 shrink-0 text-amber-300" />
      <div className="min-w-0">
        <p className="text-xs font-semibold text-amber-100">{item.titulo}: dato no disponible</p>
        <p className="mt-0.5 text-[11px] leading-snug text-slate-300">{item.motivo}</p>
        {item.que_debe_correr_el_equipo && (
          <p className="mt-1 text-[11px] leading-snug text-slate-400">Para conseguirlo: {item.que_debe_correr_el_equipo}</p>
        )}
        {item.url && (
          <a className="mt-1 inline-flex items-center gap-1 text-[11px] text-cyan-300 hover:underline" href={item.url} target="_blank" rel="noreferrer">
            <ExternalLink className="h-3 w-3" /> Ficha del dato
          </a>
        )}
      </div>
    </div>
  );
}

function Grafico({ titulo, icon: Icon, color, unidad, decimales, que, serie, clave, meta, isSci, conRecta = true }) {
  const proy = useMemo(
    () => (conRecta ? proyectar(puntosDe(serie, clave), { anios: CAPAS.prediccion.anios_hacia_adelante, decimales }) : null),
    [serie, clave, decimales, conRecta],
  );
  const filas = conRecta && proy?.ok ? proy.filas : serie.map((fila) => ({ anio: String(fila.anio), valor: fila[clave] }));
  return (
    <section className="panel p-4">
      <h3 className="mb-1 flex items-center gap-2 text-sm font-semibold text-white">
        <Icon className="h-4 w-4 text-cyan-300" /> {titulo}
      </h3>
      <p className="mb-2 text-[11px] leading-snug text-slate-400">
        {meta.periodo} · {meta.unidad} · {meta.resolucion}
      </p>
      <div className="h-56">
        {conRecta && proy && !proy.ok ? (
          <p className="text-sm text-amber-200">{proy.motivo}</p>
        ) : (
          <ResponsiveContainer width="100%" height="100%">
            <ComposedChart data={filas} margin={{ top: 8, right: 8, left: -12, bottom: 0 }}>
              <CartesianGrid stroke="rgba(255,255,255,0.06)" />
              <XAxis dataKey="anio" tick={{ fill: "#94a3b8", fontSize: 10 }} interval={conRecta ? 4 : 5} />
              <YAxis tick={{ fill: "#94a3b8", fontSize: 10 }} width={48} domain={["auto", "auto"]} />
              <Tooltip
                {...tooltip}
                formatter={(valor, nombre) => {
                  if (nombre === "Banda 95 %" && Array.isArray(valor)) return [`${valor[0]} a ${valor[1]} ${unidad}`, nombre];
                  if (valor == null) return ["—", nombre];
                  return [`${valor} ${unidad}`, nombre];
                }}
              />
              <Legend wrapperStyle={{ fontSize: 11 }} />
              {conRecta && <Area dataKey="banda" name="Banda 95 %" stroke="none" fill={color} fillOpacity={0.28} isAnimationActive={false} />}
              <Bar dataKey="valor" name="Dato medido" fill={color} isAnimationActive={false} />
              {conRecta && <Line dataKey="recta" name="Recta del equipo" stroke="#f8fafc" strokeDasharray="5 4" dot={false} strokeWidth={1.6} isAnimationActive={false} />}
            </ComposedChart>
          </ResponsiveContainer>
        )}
      </div>
      <p className="mt-2 text-[11px] leading-relaxed text-slate-300">
        {conRecta ? frasePrediccion(proy, { que, unidad }) : meta.motivo_sin_recta}
      </p>
      {conRecta && proy?.ok && proy.debil && (
        <p className="mt-1 text-[11px] text-amber-200/90">Tendencia débil: no conviene leer la recta como un cambio seguro.</p>
      )}
      <p className="mt-2 flex flex-wrap items-center gap-1 text-[10px] leading-snug text-slate-500">
        <Database className="h-3 w-3 shrink-0" />
        {meta.producto}. Descargado {meta.descargado}.{" "}
        <a className="inline-flex items-center gap-0.5 text-cyan-300 hover:underline" href={meta.url} target="_blank" rel="noreferrer">
          <ExternalLink className="h-3 w-3" /> Ver la fuente
        </a>
      </p>
      {isSci && (
        <details className="mt-2 text-[11px] text-slate-400">
          <summary className="cursor-pointer text-cyan-200">Cómo se calculó</summary>
          <ol className="mt-1 list-decimal space-y-0.5 pl-4">
            {(meta.pasos || []).map((paso) => (
              <li key={paso}>{paso}</li>
            ))}
            {conRecta && (
              <li>La recta y la banda están en src/prediccion.js. Entran {proy?.ok ? proy.n : 0} años. Un año incompleto se ve en el gráfico y no mueve la recta.</li>
            )}
          </ol>
        </details>
      )}
    </section>
  );
}

export default function PanelCapas({ isSci }) {
  const bosque = CAPAS.bosque;
  const ndvi = CAPAS.ndvi;
  const agua = CAPAS.agua_superficial;
  const rios = CAPAS.rios;
  const avisos = CAPAS.no_disponibles.filter((item) => item.id !== "hydrorivers");

  return (
    <section className="lg:col-span-12">
      <div className="mb-3">
        <h2 className="text-base font-bold text-white">Bosque, agua y una predicción sencilla</h2>
        <p className="text-xs text-slate-400">
          {isSci
            ? "Series anuales dentro del polígono WDPA 555593903. La línea punteada es la predicción del equipo (recta), con banda del 95 %."
            : "Cada barra es un año real. La línea punteada es nuestra proyección: sigue la tendencia y puede cambiar. No explica la causa."}
        </p>
      </div>

      <div className="mb-4 grid gap-3 md:grid-cols-2">
        {avisos.map((item) => (
          <Aviso key={item.id} item={item} />
        ))}
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        {bosque.estado === "ok" ? (
          <Grafico
            titulo={isSci ? "Pérdida de bosque (ha/año)" : "¿Cuánto bosque se perdió cada año?"}
            icon={Trees}
            color="#f97316"
            unidad="ha"
            decimales={2}
            que="la pérdida de bosque"
            serie={bosque.serie}
            clave="ha"
            meta={bosque}
            isSci={isSci}
          />
        ) : (
          <Aviso item={{ titulo: "Pérdida de bosque", motivo: "Sin archivo de Hansen." }} />
        )}
        {ndvi.estado === "ok" ? (
          <Grafico
            titulo={isSci ? "NDVI medio del año" : "¿Qué tan verde se ve el bosque?"}
            icon={Leaf}
            color="#4ade80"
            unidad=""
            decimales={4}
            que="el verdor (NDVI)"
            serie={ndvi.serie}
            clave="ndvi"
            meta={ndvi}
            isSci={isSci}
          />
        ) : null}
        {agua.estado === "ok" ? (
          <Grafico
            titulo={isSci ? "Agua superficial (ha/año)" : "¿Cuánta agua se ve desde el satélite?"}
            icon={Droplets}
            color="#38bdf8"
            unidad="ha"
            decimales={2}
            que="el agua visible"
            serie={agua.serie}
            clave="ha_total"
            meta={agua}
            isSci={isSci}
            conRecta={agua.permite_recta === true}
          />
        ) : (
          <Aviso item={{ titulo: "Agua superficial", motivo: "Sin archivo del JRC." }} />
        )}
      </div>

      <div className="panel mt-4 p-4 text-[12px] leading-relaxed text-slate-300">
        <p className="font-semibold text-white">Cómo leer la predicción</p>
        <p className="mt-1">
          La recta usa solo los años históricos de cada gráfico. La banda es un intervalo de predicción del 95 %:
          se abre porque, lejos de los datos, hay más duda. {CAPAS.prediccion.aviso}
        </p>
        {agua.ocurrencia && (
          <p className="mt-2">
            Ocurrencia oficial (JRC, 30 m, {agua.ocurrencia.periodo}): hubo agua alguna vez en {agua.ocurrencia.ha_alguna_vez} ha.
            En esos píxeles el agua estuvo presente el {agua.ocurrencia.ocurrencia_media_en_pixeles_con_agua} % de las observaciones.
            Con ocurrencia de al menos 50 %: {agua.ocurrencia.ha_al_menos_50} ha.
          </p>
        )}
        {agua.cambio_epocas && (
          <p className="mt-2">
            Cambio entre épocas ({agua.cambio_epocas.epocas}, 30 m): {agua.cambio_epocas.ha_mas_agua} ha con más agua y {agua.cambio_epocas.ha_menos_agua} ha con menos.
            Es la diferencia que midió el JRC. No es una predicción y no dice la causa.
          </p>
        )}
        <p className="mt-2 text-[11px] text-slate-400">
          Ríos en el mapa: {rios.producto}. {rios.dentro_de_la_reserva ? `Dentro de la reserva hay ${Object.entries(rios.dentro_de_la_reserva).map(([k, v]) => `${v} ${k}`).join(", ")}.` : ""}{" "}
          {agua.nota_30m} HydroRIVERS: dato no disponible. {rios.hydrorivers.motivo}
        </p>
      </div>
    </section>
  );
}
