/**
 * Predicción del equipo: una recta que sigue los años ya medidos.
 *
 * No es un pronóstico de una agencia. Es la cuenta más simple que se puede
 * revisar con lápiz:
 *
 *   1. Se toman los años con dato (x = año, y = el valor de ese año).
 *   2. Se busca la recta y = a + b·x que más se acerca a esos puntos
 *      (mínimos cuadrados).
 *   3. b es cuánto cambia y cada año. Puede ser casi cero.
 *   4. Para un año futuro se calcula y con esa misma recta.
 *   5. La banda del 95 % es un intervalo de predicción: dice dónde podría
 *      caer un año nuevo, no solo dónde está el promedio. Por eso es ancha.
 *
 *      mitad = t · s · √( 1 + 1/n + (x − x̄)² / Sxx )
 *
 *      s  = desviación de los puntos alrededor de la recta
 *      n  = cuántos años entraron en la recta
 *      t  = valor de la tabla t de Student (dos colas, 95 %)
 *      Sxx = suma de (año − año medio)²
 *
 * La banda se abre al alejarse del último año. Si llegan datos nuevos,
 * la recta se vuelve a calcular y el dibujo cambia.
 *
 * Esta cuenta no dice la causa. Un año más alto no prueba El Niño,
 * ni la gente, ni ninguna causa única.
 */

// Tabla clásica de t (dos colas, 95 %). Entre dos filas se interpola.
const T_95 = [
  [1, 12.706], [2, 4.303], [3, 3.182], [4, 2.776], [5, 2.571],
  [6, 2.447], [7, 2.365], [8, 2.306], [9, 2.262], [10, 2.228],
  [12, 2.179], [15, 2.131], [20, 2.086], [24, 2.064], [30, 2.042],
  [40, 2.021], [60, 2], [120, 1.98], [1000, 1.96],
];

function t95(grados) {
  const df = Math.max(1, grados);
  if (df >= 1000) return 1.96;
  let anterior = T_95[0];
  for (const fila of T_95) {
    if (df === fila[0]) return fila[1];
    if (df < fila[0]) {
      const parte = (df - anterior[0]) / (fila[0] - anterior[0]);
      return anterior[1] + parte * (fila[1] - anterior[1]);
    }
    anterior = fila;
  }
  return 1.96;
}

function redondear(valor, decimales) {
  const f = 10 ** decimales;
  return Math.round(valor * f) / f;
}

/**
 * puntos: [{ x: año, y: número, usar: true/false }]
 * Los puntos con usar === false se dibujan y no entran en la recta
 * (por ejemplo un año al que le faltan meses).
 */
export function proyectar(puntos, { anios = 5, decimales = 2 } = {}) {
  const limpios = (puntos || []).filter((p) => p && Number.isFinite(p.x) && Number.isFinite(p.y));
  const usados = limpios.filter((p) => p.usar !== false);
  if (usados.length < 3) {
    return { ok: false, motivo: "Hacen falta al menos 3 años con dato para dibujar la recta." };
  }

  const n = usados.length;
  const xMedia = usados.reduce((s, p) => s + p.x, 0) / n;
  const yMedia = usados.reduce((s, p) => s + p.y, 0) / n;
  let sxx = 0;
  let sxy = 0;
  for (const p of usados) {
    sxx += (p.x - xMedia) ** 2;
    sxy += (p.x - xMedia) * (p.y - yMedia);
  }
  const b = sxy / sxx;
  const a = yMedia - b * xMedia;

  let sse = 0;
  for (const p of usados) {
    sse += (p.y - (a + b * p.x)) ** 2;
  }
  const s = Math.sqrt(sse / (n - 2));
  const t = t95(n - 2);
  // ¿La pendiente sobresale del ruido? Se compara |b| con la tabla t.
  const errorDeB = s / Math.sqrt(sxx);
  const tB = errorDeB === 0 ? 0 : Math.abs(b) / errorDeB;
  const debil = tB < t;

  const yEn = (x) => a + b * x;
  const bandaEn = (x) => {
    const mitad = t * s * Math.sqrt(1 + 1 / n + (x - xMedia) ** 2 / sxx);
    return [yEn(x) - mitad, yEn(x) + mitad];
  };

  const ultimo = Math.max(...limpios.map((p) => p.x));
  const primero = Math.min(...limpios.map((p) => p.x));
  const porX = new Map(limpios.map((p) => [p.x, p]));
  const filas = [];
  for (let x = primero; x <= ultimo + anios; x += 1) {
    const real = porX.get(x);
    const [lo, hi] = bandaEn(x);
    filas.push({
      anio: String(x),
      valor: real ? redondear(real.y, decimales) : null,
      recta: redondear(yEn(x), decimales),
      // La banda se ve desde el último año medido hacia los 5 años siguientes.
      banda: x >= ultimo ? [redondear(lo, decimales), redondear(hi, decimales)] : null,
    });
  }

  const final = filas[filas.length - 1];
  return {
    ok: true,
    n,
    a,
    b,
    s,
    debil,
    decimales,
    filas,
    ultimoAnio: ultimo,
    anioFinal: Number(final.anio),
    valorFinal: final.recta,
    bandaFinal: final.banda,
  };
}

export function frasePrediccion(resultado, { que, unidad }) {
  if (!resultado.ok) return resultado.motivo;
  const cambio = Math.abs(resultado.b).toFixed(resultado.decimales);
  const sentido = resultado.b > 0.0000001 ? "sube" : resultado.b < -0.0000001 ? "baja" : "casi no se mueve";
  const fuerza = resultado.debil
    ? " Ese cambio por año es pequeño comparado con lo que el dato sube y baja solo. La banda queda ancha."
    : " La pendiente se nota por encima del ruido de un año a otro, y aun así la banda muestra la duda.";
  const [lo, hi] = resultado.bandaFinal;
  return `La recta del equipo ${sentido} cerca de ${cambio} ${unidad} cada año.${fuerza} En ${resultado.anioFinal} la proyección de ${que} es ${resultado.valorFinal} ${unidad}, con una banda de ${lo} a ${hi}. Es una prolongación de los años citados. No dice la causa y puede cambiar con datos nuevos.`;
}
