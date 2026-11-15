/**
 * Radar NISAR y superficie — series reales de src/data/radar_real.json.
 * No interpola: un hueco es ausencia de medición, nunca un cero inventado.
 * No atribuye los cambios a El Niño.
 */
import React, { useMemo, useState } from "react";
import {
  ResponsiveContainer,
  ComposedChart,
  Line,
  Scatter,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ReferenceLine,
} from "recharts";
import { Radar, TriangleAlert, Database } from "lucide-react";
import RADAR from "../data/radar_real.json";

const META = RADAR.metadata;
const GCOV_META = META.fuentes.gcov;
const DSWX_META = META.fuentes.dswx;
const WM_META = META.fuentes.watermask;
const SME2 = RADAR.sme2_serie;
const DESCARGA = META.descargado;

const MESES = ["ene", "feb", "mar", "abr", "may", "jun", "jul", "ago", "sep", "oct", "nov", "dic"];
const TIP = {
  background: "#0a0f1f",
  border: "1px solid rgba(34,211,238,0.35)",
  borderRadius: 10,
  fontSize: 12,
  color: "#e2e8f0",
  padding: "8px 10px",
  maxWidth: 280,
};

const HH = "#22d3ee";
const HV = "#fbbf24";
const AGUA = "#38bdf8";
const SIN_DATO = "#fb7185";
const REC = "#fbbf24";

function parseUtc(iso) {
  if (iso == null || iso === "") return NaN;
  const s = String(iso);
  const day = s.slice(0, 10);
  const clock = s.includes("T") ? s.slice(11, 19).replace(/Z$/, "") || "00:00:00" : "00:00:00";
  return Date.parse(`${day}T${clock}Z`);
}

function fmtDia(ms) {
  const d = new Date(ms);
  return `${d.getUTCDate()} ${MESES[d.getUTCMonth()]}`;
}

function fmtFecha(iso) {
  const ms = typeof iso === "number" ? iso : parseUtc(iso);
  if (!Number.isFinite(ms)) return "";
  const d = new Date(ms);
  const base = `${d.getUTCDate()} ${MESES[d.getUTCMonth()]} ${d.getUTCFullYear()}`;
  const s = typeof iso === "string" ? iso : "";
  if (!s.includes("T")) return `${base} UTC`;
  const hh = String(d.getUTCHours()).padStart(2, "0");
  const mm = String(d.getUTCMinutes()).padStart(2, "0");
  return `${base} ${hh}:${mm} UTC`;
}

function num(v, digits) {
  if (v == null || Number.isNaN(Number(v))) return null;
  return Number(v).toLocaleString("es-MX", { minimumFractionDigits: digits, maximumFractionDigits: digits });
}

function doiHref(doi) {
  if (!doi) return null;
  const s = String(doi);
  return s.startsWith("http") ? s : `https://doi.org/${s}`;
}

function madurezDe(collection) {
  const c = collection || "";
  if (c.includes("BETA")) return "beta";
  if (c.includes("PROVISIONAL")) return "provisional";
  return "v1";
}

function etiquetaMadurez(m) {
  if (m === "v1") return "V1";
  if (m === "beta") return "BETA precalibrado";
  return "provisional";
}

function unico(valores) {
  const s = [...new Set(valores.filter((v) => v != null))];
  return s.length === 1 ? s[0] : null;
}

function Fuente({ children }) {
  return (
    <p className="mt-2 flex flex-wrap items-center gap-x-1 gap-y-0.5 text-[10px] leading-snug text-slate-500">
      <Database className="h-3 w-3 shrink-0" />
      {children}
    </p>
  );
}

function Enlace({ href, children }) {
  if (!href) return null;
  return (
    <a className="text-cyan-300 hover:underline" href={href} target="_blank" rel="noreferrer">
      {children}
    </a>
  );
}

function CajaTip({ children }) {
  return <div style={TIP}>{children}</div>;
}

function MadurezDot({ cx, cy, payload, seriesKey, fill }) {
  if (cx == null || cy == null || !payload) return null;
  const v = payload[seriesKey];
  if (v == null) return null;
  const mad = payload[`mad_${seriesKey}`];
  if (mad === "v1") {
    const r = 5.5;
    return <polygon points={`${cx},${cy - r} ${cx + r},${cy} ${cx},${cy + r} ${cx - r},${cy}`} fill={fill} stroke="#fff" strokeWidth={1} />;
  }
  if (mad === "beta") {
    return <polygon points={`${cx},${cy - 6} ${cx + 5.5},${cy + 4.5} ${cx - 5.5},${cy + 4.5}`} fill="#0a0f1f" stroke={fill} strokeWidth={1.5} />;
  }
  return <circle cx={cx} cy={cy} r={3.5} fill={fill} stroke="#0a0f1f" strokeWidth={1} />;
}

function Cruz({ cx, cy, payload }) {
  if (cx == null || cy == null || payload?.sin == null) return null;
  return (
    <g>
      <line x1={cx - 4} y1={cy - 4} x2={cx + 4} y2={cy + 4} stroke={SIN_DATO} strokeWidth={1.6} />
      <line x1={cx - 4} y1={cy + 4} x2={cx + 4} y2={cy - 4} stroke={SIN_DATO} strokeWidth={1.6} />
    </g>
  );
}

function ejeX() {
  return (
    <XAxis
      dataKey="t"
      type="number"
      domain={["dataMin", "dataMax"]}
      scale="time"
      tickFormatter={fmtDia}
      tick={{ fill: "#94a3b8", fontSize: 10 }}
      minTickGap={28}
    />
  );
}

function prepararGcov(escenas) {
  const porFecha = new Map();
  escenas.forEach((s) => {
    if (s.hh_sigma0_mean_db == null && s.hv_sigma0_mean_db == null) return;
    const mad = madurezDe(s.collection);
    const beta = mad === "beta";
    const asc = s.direction === "Ascending";
    const lado = `${asc ? "asc" : "desc"}${beta ? "_beta" : ""}`;
    const row = porFecha.get(s.date) || {
      t: parseUtc(s.date),
      date: s.date,
      utc: s.datetime_utc || s.date,
    };
    row[`hh_${lado}`] = s.hh_sigma0_mean_db;
    row[`hv_${lado}`] = s.hv_sigma0_mean_db;
    row[`mad_hh_${lado}`] = mad;
    row[`mad_hv_${lado}`] = mad;
    porFecha.set(s.date, row);
  });
  return [...porFecha.values()].sort((a, b) => a.t - b.t);
}

function ticksEntre(min, max) {
  const start = Math.ceil((min - 1e-9) * 10) / 10;
  const end = Math.floor((max + 1e-9) * 10) / 10;
  const out = [];
  for (let v = start; v <= end + 1e-9; v = Math.round((v + 0.1) * 10) / 10) out.push(v);
  return out.length ? out : [Number(min.toFixed(2)), Number(max.toFixed(2))];
}

function prepararAgua(fechas) {
  const areas = fechas.map((d) => d.area_agua_km2).filter((v) => v != null);
  const min = Math.min(...areas);
  const max = Math.max(...areas);
  const ySin = max + (max - min) * 0.55;
  const rows = fechas.map((d) => ({
    t: parseUtc(d.date),
    date: d.date,
    utc: d.date,
    area: d.area_agua_km2,
    sin: d.area_agua_km2 == null ? ySin : null,
    reason: d.reason,
  }));
  return {
    rows,
    yMin: min - (max - min) * 0.25,
    yMax: ySin + (max - min) * 0.2,
    ySin,
    ticks: ticksEntre(min, max),
    nSin: rows.filter((r) => r.area == null).length,
  };
}

function prepararSme2(serie) {
  return serie
    .filter((r) => !r.error && r.mean != null)
    .map((r) => {
      const beta = (r.collection || "").includes("BETA") || r.precalibrado === true;
      const rec = r.recomendado && r.recomendado.mean != null ? r.recomendado.mean : null;
      return {
        t: parseUtc(r.start_utc || r.date),
        utc: r.start_utc || r.date,
        meanProv: beta ? null : r.mean,
        recProv: beta ? null : rec,
        meanBeta: beta ? r.mean : null,
        recBeta: beta ? rec : null,
      };
    })
    .sort((a, b) => a.t - b.t);
}

function avisoBosque(serie) {
  const prov = serie.filter((r) => (r.collection || "").includes("PROVISIONAL") && !r.error && r.n_pixeles_poligono);
  if (!prov.length) return null;
  const pix = prov.reduce((a, r) => a + r.n_pixeles_poligono, 0);
  const tree = prov.reduce((a, r) => a + (r.n_tree_cover_en_poligono || 0), 0);
  const treePct = (tree / pix) * 100;
  const positivos = prov.map((r) => r.n_recomendado).filter((n) => n > 0).sort((a, b) => a - b);
  const mediana = positivos.length ? positivos[Math.floor(positivos.length / 2)] : 0;
  const base = prov[0].n_pixeles_poligono || 1;
  const recPct = Math.round((mediana / base) * 100);
  const ceros = prov.filter((r) => r.n_recomendado === 0).map((r) => (r.start_utc || "").slice(0, 10));
  return { treePct, mediana, recPct, ceros };
}

function TipGcov({ active, payload }) {
  if (!active || !payload?.length) return null;
  const row = payload[0].payload;
  const utiles = payload.filter((p) => p.value != null && (String(p.dataKey).startsWith("hh_") || String(p.dataKey).startsWith("hv_")));
  if (!utiles.length) return null;
  return (
    <CajaTip>
      <p className="font-semibold text-cyan-300">{fmtFecha(row.utc || row.t)}</p>
      {utiles.map((p) => (
        <p key={p.dataKey}>
          {p.name}: {num(p.value, 2)} dB
          <span className="text-slate-400"> · {etiquetaMadurez(row[`mad_${p.dataKey}`])}</span>
        </p>
      ))}
      <p className="mt-1 text-[10px] text-slate-400">Solo esta fecha. No es un valor rellenado.</p>
    </CajaTip>
  );
}

function TipAgua({ active, payload }) {
  if (!active || !payload?.length) return null;
  const row = payload[0].payload;
  if (row.area == null) {
    return (
      <CajaTip>
        <p className="font-semibold text-cyan-300">{fmtFecha(row.date)}</p>
        <p>Sin dato. No es 0 km².</p>
        <p className="mt-1 text-[10px] text-slate-400">Todos los píxeles del polígono son relleno (clase 255).</p>
      </CajaTip>
    );
  }
  return (
    <CajaTip>
      <p className="font-semibold text-cyan-300">{fmtFecha(row.date)}</p>
      <p>Agua: {num(row.area, 2)} km²</p>
    </CajaTip>
  );
}

function TipSme2({ active, payload }) {
  if (!active || !payload?.length) return null;
  const row = payload[0].payload;
  const utiles = payload.filter((p) => p.value != null);
  if (!utiles.length) return null;
  return (
    <CajaTip>
      <p className="font-semibold text-cyan-300">{fmtFecha(row.utc || row.t)}</p>
      {utiles.map((p) => (
        <p key={p.dataKey}>
          {p.name}: {num(p.value, 3)} m³/m³
        </p>
      ))}
      <p className="mt-1 text-[10px] text-slate-400">Si una serie no aparece, ese día no tiene dato. No es cero.</p>
    </CajaTip>
  );
}

const leyenda = { wrapperStyle: { fontSize: 11, color: "#cbd5e1", paddingTop: 4 } };
const grid = <CartesianGrid stroke="rgba(255,255,255,0.06)" />;
const tickY = { fill: "#94a3b8", fontSize: 10 };

export default function RadarPanel() {
  const [verBeta, setVerBeta] = useState(false);
  const escenas = RADAR.gcov || [];
  const gcovRows = useMemo(() => prepararGcov(escenas), [escenas]);
  const agua = useMemo(() => prepararAgua(RADAR.dswx || []), []);
  const sme2Rows = useMemo(() => prepararSme2(SME2?.serie || []), []);
  const bosque = useMemo(() => avisoBosque(SME2?.serie || []), []);

  const trackAsc = unico(escenas.filter((s) => s.direction === "Ascending").map((s) => s.track));
  const trackDesc = unico(escenas.filter((s) => s.direction === "Descending").map((s) => s.track));
  const epsg = unico(escenas.map((s) => s.epsg));
  const metros = unico(escenas.map((s) => s.pixel_spacing_m));
  const gcovVisibles = verBeta ? gcovRows : gcovRows.filter((r) => r.hh_asc != null || r.hv_asc != null || r.hh_desc != null || r.hv_desc != null);

  const seriesGcov = [
    { key: "hh_asc", name: `HH ascendente (track ${trackAsc ?? "—"})`, stroke: HH, dash: undefined, beta: false },
    { key: "hv_asc", name: `HV ascendente (track ${trackAsc ?? "—"})`, stroke: HV, dash: undefined, beta: false },
    { key: "hh_desc", name: `HH descendente (track ${trackDesc ?? "—"})`, stroke: HH, dash: "6 4", beta: false },
    { key: "hv_desc", name: `HV descendente (track ${trackDesc ?? "—"})`, stroke: HV, dash: "6 4", beta: false },
    { key: "hh_asc_beta", name: `HH ascendente BETA (precalibrado)`, stroke: HH, dash: "2 2", beta: true },
    { key: "hv_asc_beta", name: `HV ascendente BETA (precalibrado)`, stroke: HV, dash: "2 2", beta: true },
    { key: "hh_desc_beta", name: `HH descendente BETA (precalibrado)`, stroke: HH, dash: "2 2", beta: true },
    { key: "hv_desc_beta", name: `HV descendente BETA (precalibrado)`, stroke: HV, dash: "2 2", beta: true },
  ].filter((s) => gcovRows.some((r) => r[s.key] != null) && (verBeta || !s.beta));

  const cols = GCOV_META.colecciones || {};
  const teselas = (DSWX_META.teselas_mgrs_en_caja_que_intersectan || []).join(" y ");
  const clases = (DSWX_META.clases_agua_usadas || []).join(" y ");
  const espSme2 = SME2?.espaciado_nominal_m != null ? Math.round(SME2.espaciado_nominal_m) : null;

  return (
    <section id="radar-nisar-superficie" className="panel p-4 lg:col-span-12" aria-labelledby="titulo-radar-superficie">
      <style>{`#radar-nisar-superficie .recharts-legend-item-text { color: #cbd5e1 !important; }`}</style>
      <div className="mb-3">
        <h2 id="titulo-radar-superficie" className="flex items-center gap-2 text-base font-bold text-white">
          <Radar className="h-4 w-4 text-cyan-400" /> Radar NISAR y superficie
        </h2>
        <p className="mt-1 max-w-4xl text-sm leading-relaxed text-slate-300">
          Tres mediciones reales dentro de la reserva. Cada punto es una fecha con dato. Si un día no se pudo medir, queda un hueco:
          no lo rellenamos ni lo ponemos en cero. Estos cambios no se atribuyen a El Niño.
        </p>
      </div>

      <article className="mt-4 border-t border-white/10 pt-4">
        <div className="mb-2 flex flex-wrap items-start justify-between gap-2">
          <h3 className="text-sm font-semibold text-cyan-200">Retrodispersión sigma0 GCOV (dB)</h3>
          <button
            type="button"
            aria-pressed={verBeta}
            onClick={() => setVerBeta((v) => !v)}
            className={`rounded-lg border px-3 py-1.5 text-xs font-semibold ${
              verBeta ? "border-amber-300/50 bg-amber-400/15 text-amber-100" : "border-white/10 text-slate-300 hover:bg-white/5"
            }`}
          >
            {verBeta ? "Ocultar BETA (precalibrado)" : "Mostrar BETA (precalibrado)"}
          </button>
        </div>
        <p className="mb-2 max-w-4xl text-[13px] leading-relaxed text-slate-300">
          Sigma0 es la energía del radar que vuelve del bosque y del suelo. HH y HV son dos formas de medirla.
          La órbita ascendente (track {trackAsc ?? "—"}) y la descendente (track {trackDesc ?? "—"}) miran la reserva desde lados distintos:
          por eso sus curvas no coinciden. Esa separación es la geometría de observación, no un cambio del bosque.
          Círculo = provisional. Rombo = V1. Triángulo = BETA, marcado como precalibrado.
        </p>
        <div className="h-72 w-full min-w-0">
          <ResponsiveContainer width="100%" height="100%">
            <ComposedChart data={gcovVisibles} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
              {grid}
              {ejeX()}
              <YAxis tick={tickY} width={48} unit=" dB" domain={["auto", "auto"]} />
              <Tooltip content={<TipGcov />} />
              <Legend {...leyenda} />
              {seriesGcov.map((s) => (
                <Line
                  key={s.key}
                  dataKey={s.key}
                  name={s.name}
                  stroke={s.stroke}
                  strokeWidth={1.75}
                  strokeDasharray={s.dash}
                  type="linear"
                  connectNulls
                  dot={(props) => <MadurezDot cx={props.cx} cy={props.cy} payload={props.payload} seriesKey={s.key} fill={s.stroke} />}
                  activeDot={(props) => <MadurezDot cx={props.cx} cy={props.cy} payload={props.payload} seriesKey={s.key} fill={s.stroke} />}
                  isAnimationActive={false}
                />
              ))}
            </ComposedChart>
          </ResponsiveContainer>
        </div>
        <p className="mt-1 text-[11px] leading-relaxed text-slate-400">
          La línea solo une las escenas reales de la misma órbita. No inventa los días de en medio.
          {metros != null ? ` Píxel de ${num(metros, 0)} m.` : ""} {epsg != null ? ` EPSG:${epsg}.` : ""} Gamma0 RTC pasado a sigma0 con
          rtcGammaToSigmaFactor; la media se calcula en lineal y después se pasa a dB. No hay máscara de layover ni de sombra.
          Unidad: dB. Fechas en UTC.
        </p>
        <Fuente>
          {GCOV_META.producto}. Guía: <Enlace href={GCOV_META.guia}>nisar-docs GCOV</Enlace>.
          DOI V1 <Enlace href={doiHref(cols.NISAR_L2_GCOV_V1?.doi)}>{cols.NISAR_L2_GCOV_V1?.doi}</Enlace>
          {" · "}provisional <Enlace href={doiHref(cols.NISAR_L2_GCOV_PROVISIONAL_V1?.doi)}>{cols.NISAR_L2_GCOV_PROVISIONAL_V1?.doi}</Enlace>
          {" · "}BETA <Enlace href={doiHref(cols.NISAR_L2_GCOV_BETA_V1?.doi)}>{cols.NISAR_L2_GCOV_BETA_V1?.doi}</Enlace>.
          Especificación: <Enlace href={GCOV_META.especificacion}>D-102274</Enlace>.
          Resolución: {GCOV_META.resolucion}. Descarga {DESCARGA}.
        </Fuente>
      </article>

      <article className="mt-6 border-t border-white/10 pt-4">
        <h3 className="mb-2 text-sm font-semibold text-cyan-200">Agua superficial OPERA DSWx-S1 (km² dentro de la reserva)</h3>
        <p className="mb-2 max-w-4xl text-[13px] leading-relaxed text-slate-300">
          Kilómetros cuadrados clasificados como agua dentro del polígono: clases {clases || "1 y 3"} (agua abierta y vegetación inundada).
          Resolución {DSWX_META.resolucion || "30 m"}. Teselas {teselas || "T17MRU y T17MRV"}.
          Las cruces son fechas sin dato (el polígono entero es relleno). No son cero: ese día no sabemos el área.
        </p>
        <div className="h-72 w-full min-w-0">
          <ResponsiveContainer width="100%" height="100%">
            <ComposedChart data={agua.rows} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
              {grid}
              {ejeX()}
              <YAxis tick={tickY} width={56} unit=" km²" domain={[agua.yMin, agua.yMax]} ticks={agua.ticks} />
              <Tooltip content={<TipAgua />} />
              <Legend {...leyenda} />
              <ReferenceLine
                y={agua.ySin}
                stroke="rgba(251,113,133,0.35)"
                strokeDasharray="3 3"
                label={{ value: "sin dato", fill: "#fb7185", fontSize: 10, position: "insideTopRight" }}
              />
              <Line
                dataKey="area"
                name="Área de agua (clases 1 y 3)"
                stroke={AGUA}
                strokeWidth={1.75}
                type="linear"
                connectNulls={false}
                dot={{ r: 2.5, fill: AGUA, stroke: "#0a0f1f" }}
                isAnimationActive={false}
              />
              <Scatter dataKey="sin" name="Sin dato (no es 0)" fill={SIN_DATO} shape={(props) => <Cruz cx={props.cx} cy={props.cy} payload={props.payload} />} isAnimationActive={false} />
            </ComposedChart>
          </ResponsiveContainer>
        </div>
        <p className="mt-1 text-[11px] leading-relaxed text-slate-400">
          {agua.nSin} fechas quedan en blanco en el JSON y aquí se ven como cruces, separadas de la curva.
          La máscara NISAR_WATERMASK {WM_META.version_teselas || "v0.5"} mide distancia a la orilla, no si el píxel es agua.
          Por eso no hay un área de agua estática
          {RADAR.watermask?.area_agua_km2 == null ? " (el valor está en null)." : "."} Unidad: km². Fechas en UTC.
        </p>
        <Fuente>
          {DSWX_META.producto}. DOI <Enlace href={DSWX_META.doi_url || doiHref(DSWX_META.doi)}>{DSWX_META.doi}</Enlace>.
          Especificación: <Enlace href={DSWX_META.especificacion}>DSWx-S1</Enlace>.
          Resolución {DSWX_META.resolucion}. Teselas {teselas}. Capa {DSWX_META.capa}. Descarga {DESCARGA}.
          {" "}WATERMASK: <Enlace href={WM_META.readme}>README v0.5</Enlace>
          {WM_META.url_catalogo ? <> · <Enlace href={WM_META.url_catalogo}>catálogo</Enlace></> : null}.
          {WM_META.doi ? <> DOI <Enlace href={doiHref(WM_META.doi)}>{WM_META.doi}</Enlace>.</> : ` ${WM_META.nota_doi || ""}`}
        </Fuente>
      </article>

      <article className="mt-6 border-t border-white/10 pt-4">
        <h3 className="mb-2 text-sm font-semibold text-cyan-200">Humedad del suelo SME2 (m³/m³)</h3>
        <p className="mb-2 max-w-4xl text-[13px] leading-relaxed text-slate-300">
          La línea cian es la media de todos los píxeles válidos. La línea ámbar es solo el subconjunto de calidad recomendada.
          El trazo continuo es provisional. El trazo discontinuo es BETA y está marcado como precalibrado.
          Si la línea ámbar se corta, ese día no hubo píxeles recomendados: el hueco no es cero.
        </p>
        {bosque && (
          <div className="mb-3 flex gap-2 rounded-xl border border-amber-400/40 bg-amber-400/10 p-3 text-[13px] leading-relaxed text-amber-50" role="note">
            <TriangleAlert className="mt-0.5 h-4 w-4 shrink-0 text-amber-300" />
            <p>
              El {bosque.treePct.toLocaleString("es-MX", { minimumFractionDigits: 1, maximumFractionDigits: 1 })} % de los píxeles del polígono es bosque denso y el producto lo marca como no recomendado.
              En la mayoría de las fechas solo unos {bosque.mediana.toLocaleString("es-MX")} píxeles (cerca del {bosque.recPct} %) tienen calidad recomendada.
              {bosque.ceros.length > 0 && (
                <> En {bosque.ceros.map((d) => fmtFecha(d).replace(" UTC", "")).join(" y ")} hay 0 píxeles recomendados: la media recomendada queda en blanco, no en cero.</>
              )}{" "}
              Todavía no hay una versión validada. Úsalo como tendencia relativa, no como un valor absoluto, y no lo atribuyas a El Niño.
            </p>
          </div>
        )}
        <div className="h-72 w-full min-w-0">
          <ResponsiveContainer width="100%" height="100%">
            <ComposedChart data={sme2Rows} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
              {grid}
              {ejeX()}
              <YAxis tick={tickY} width={52} domain={["auto", "auto"]} tickFormatter={(v) => num(v, 2)} />
              <Tooltip content={<TipSme2 />} />
              <Legend {...leyenda} />
              <Line dataKey="meanProv" name="Media válida · provisional" stroke={HH} strokeWidth={1.75} type="linear" connectNulls={false} dot={{ r: 3, fill: HH, stroke: "#0a0f1f" }} isAnimationActive={false} />
              <Line dataKey="recProv" name="Calidad recomendada · provisional" stroke={REC} strokeWidth={1.75} type="linear" connectNulls={false} dot={{ r: 3, fill: REC, stroke: "#0a0f1f" }} isAnimationActive={false} />
              <Line dataKey="meanBeta" name="Media válida · BETA (precalibrado)" stroke={HH} strokeDasharray="5 4" strokeWidth={1.75} type="linear" connectNulls={false} dot={{ r: 3, fill: "#0a0f1f", stroke: HH }} isAnimationActive={false} />
              <Line dataKey="recBeta" name="Calidad recomendada · BETA (precalibrado)" stroke={REC} strokeDasharray="5 4" strokeWidth={1.75} type="linear" connectNulls={false} dot={{ r: 3, fill: "#0a0f1f", stroke: REC }} isAnimationActive={false} />
            </ComposedChart>
          </ResponsiveContainer>
        </div>
        <p className="mt-1 text-[11px] leading-relaxed text-slate-400">
          Variable {SME2?.variable || "/science/LSAR/SME2/grids/soilMoisture"}. Unidad {SME2?.unidades_producto || "m³/m³"} (m³/m³).
          Rejilla {SME2?.rejilla || "EASE-Grid 2.0"}
          {SME2?.epsg != null ? `, EPSG:${SME2.epsg}` : ""}
          {espSme2 != null ? `, unos ${espSme2} m` : ""}.
          El eje se acerca a los datos para que se vea la tendencia; no empieza en cero y no rellena huecos. Fechas en UTC.
        </p>
        <Fuente>
          {SME2?.producto || "NISAR L3 SME2"}. Guía: <Enlace href={SME2?.guia}>nisar-docs SME2</Enlace>.
          DOI provisional <Enlace href={doiHref(SME2?.doi_provisional)}>{SME2?.doi_provisional}</Enlace>
          {" · "}BETA <Enlace href={doiHref(SME2?.doi_beta)}>{SME2?.doi_beta}</Enlace>.
          Especificación: <Enlace href={SME2?.especificacion}>D-107677</Enlace>.
          Resolución ~{espSme2 ?? "200"} m. Descarga {DESCARGA}.
        </Fuente>
      </article>
    </section>
  );
}
