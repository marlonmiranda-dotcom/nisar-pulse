# Cómo colaborar en TerraPulse

TerraPulse es el proyecto del concurso (4 estudiantes, Ecuador). En este repositorio la aplicación se llama **NISAR Pulse**: un visualizador de datos satelitales de la Reserva Biológica Colonso Chalupas. Esta guía es para empezar sin pisarnos el trabajo.

## 1. Qué necesitas

- [Git](https://git-scm.com/)
- [Node.js](https://nodejs.org/) 18 o superior (el proyecto usa npm)

## 2. Clonar el repositorio

```bash
git clone https://github.com/marlonmiranda-dotcom/nisar-pulse.git
cd nisar-pulse
npm install
```

## 3. Variables de entorno

```bash
cp .env.example .env
```

`.env` no se sube a Git. En tu computadora déjalo como está (valores vacíos): `npm run dev` funciona sin claves.

Las descargas de NASA Earthdata (`scripts/earthdata/`) no usan `.env`. El usuario y la contraseña van en `~/.netrc`, fuera del repositorio. Nunca los pegues en el código ni en un commit.

## 4. Ver la aplicación

```bash
npm run dev
```

Abre http://localhost:5173. Para comprobar que compila:

```bash
npm run build
```

## 5. Ramas

**Nunca trabajes directo en `main`.** `main` es la versión que se publica en GitHub Pages.

Antes de empezar, actualiza tu copia:

```bash
git checkout main
git pull
```

Crea una rama según el tipo de cambio:

| Tipo | Nombre | Ejemplo |
| --- | --- | --- |
| Función nueva | `feature/<area>-<descripcion>` | `feature/mapa-globo-3d` |
| Corrección | `fix/<area>-<descripcion>` | `fix/clima-unidades-lluvia` |
| Documentación | `docs/<descripcion>` | `docs/fuentes-hansen` |

`<area>` puede ser `mapa`, `clima`, `nisar`, `relieve` o `datos`. Usa minúsculas y guiones, sin espacios.

```bash
git checkout -b feature/clima-grafico-oni
```

## 6. Commits claros

Un commit = una idea. El mensaje dice qué cambió, en español y en presente.

```bash
git add src/clima/GraficoOni.jsx
git commit -m "Muestra la unidad °C en el eje del gráfico ONI"
git push -u origin feature/clima-grafico-oni
```

No hagas commit de `node_modules/`, `dist/` ni `.env`.

## 7. Abrir un pull request

1. Sube tu rama (`git push -u origin <tu-rama>`).
2. En GitHub, abre un **Pull request** contra `main`.
3. Completa la plantilla: qué cambia, cómo probarlo, una captura y el checklist.
4. Pide la revisión a otro integrante.

## 8. Revisión antes de fusionar

Cada pull request necesita **1 revisión de otro integrante** antes de fusionarse a `main`. Quien escribió el cambio no cuenta como revisor. No fusiones tu propio PR sin esa aprobación.

## 9. Regla de datos

No inventes ni simules datos. Si un valor no existe, déjalo vacío u oculta el indicador. Todo dato que entre a la app debe citar:

- **fuente** (producto, organismo y URL o DOI)
- **fecha** de descarga o de consulta
- **unidades** (mm/mes, °C, %, ha, etc.)
- **resolución** (por ejemplo 0,1°, 30 m, 9 km)

Para pedir o registrar una fuente usa la plantilla de issue **Fuente de datos** (`.github/ISSUE_TEMPLATE/datos.md`).

## 10. Áreas sugeridas

| Integrante | Área | Por dónde empezar en `src/App.jsx` |
| --- | --- | --- |
| 1 | Globo 3D y mapa | Mapa Leaflet y comparador, aprox. líneas 1473–1634. Componentes `SwipeController`, `GeoTIFFOverlay`, `NisarOverlay` (712–804). |
| 2 | Clima y datos | Series y escenarios ENSO (295–563), semáforos (587–689) y `ClimatePanel` (857–1266). Datos en `src/data/`. |
| 3 | Radar NISAR y superficie | Catálogo NISAR (570–585), capas del mapa (1524–1558) y gráficos SMAP / adquisiciones (1799–1864). Imágenes en `public/nisar/`. |
| 4 | Relieve, integración y GitHub | Pérdida de bosque Hansen (565–568 y 1820–1846). Hoy no hay un módulo de relieve aparte. También el armado de la página (`App`, desde la línea 1273), ramas, revisiones y Pages. |

Hoy casi toda la interfaz vive en `src/App.jsx`. Al dividirla en módulos, muevan un bloque cada vez y no cambien los números ni las fuentes.
