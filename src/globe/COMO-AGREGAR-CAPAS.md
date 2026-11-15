# Cómo agregar una capa al globo

Esta guía es para el equipo de clima, el de radar/NISAR y el de relieve.
El globo **no analiza** datos: solo los muestra. Una capa nueva tiene que
venir de una fuente real (un WMTS, un WMS o un GeoJSON). No se dibujan
estaciones, polígonos ni colores “de ejemplo” presentados como mediciones.

## 1. Capa de imágenes (clima, NDVI, radar en teselas)

1. Abre `src/globe/capas.config.ts`.
2. Copia el objeto `PLANTILLA_PARA_COPIAR`.
3. Pégalo **dentro** del arreglo `CAPAS` (antes del `];`).
4. Cambia `id` por uno nuevo, sin espacios.
5. Pon la URL real en `url`.
   - Teselas tipo Google/OSM: la URL lleva `{z}`, `{y}` y `{x}`.
   - Si la imagen cambia con el tiempo, deja `{fecha}` en la URL y
     `tiempo: { paso: "dia" }` o `{ paso: "mes" }`.
     El paso `"mes"` pide el día 1 de ese mes, que es como publica GIBS
     las capas mensuales. No convierte el día en un promedio.
   - Si es un WMS, usa `servicio: "wms"`, `url` del servicio y `capasWms`
     con el nombre de la capa. La fecha viaja en el parámetro `time`.
6. Llena la ficha con lo que diga el proveedor: fuente, fecha o rango,
   unidades, resolución espacial, resolución temporal y licencia.
7. En `clasificacion` deja `"Capa de visualización (fuente externa)"`
   si la imagen viene de otra institución. No escribas que es un análisis
   del equipo.
8. Arma `leyenda` con los valores **publicados** por esa fuente.
   Cada parada necesita `valor` (número), `etiqueta` (texto) y `patron`
   (`solido`, `rayas`, `puntos`, `diagonal` o `cuadros`), además del color.
   Así la leyenda no depende solo del color.
9. Guarda y recarga. La capa aparece en el panel con su casilla y su opacidad.

Ejemplo mínimo (no lo actives hasta cambiar la URL):

```ts
{
  id: "mi-lluvia",
  tipo: "imagen",
  servicio: "xyz",
  nombre: "Lluvia de mi fuente",
  variable: "Precipitación diaria",
  clasificacion: "Capa de visualización (fuente externa)",
  fuente: "Institución — nombre del producto",
  fuenteUrl: "https://documentacion-del-producto",
  fecha: "2016-01-01 a 2026-10-15",
  unidades: "mm/día",
  resolucionEspacial: "La que publique la fuente",
  resolucionTemporal: "Diaria",
  licencia: "La que pida la fuente",
  url: "https://servidor-real/tiles/{fecha}/{z}/{y}/{x}.png",
  nivelMaximo: 8,
  opacidadInicial: 0.7,
  activaAlInicio: false,
  tiempo: { paso: "dia" },
  leyenda: [
    { valor: "0", etiqueta: "Sin lluvia (según la paleta de la fuente)", color: "#f8fafc", patron: "solido" },
    { valor: "20", etiqueta: "20 mm/día (según la paleta de la fuente)", color: "#0369a1", patron: "rayas" },
  ],
}
```

Si la variable todavía no tiene servicio, no inventes la imagen.
Agrega un objeto con `tipo: "no-disponible"` y `clasificacion: "dato no disponible"`,
como `estaciones` y `nisar-globo` en el mismo archivo. El panel muestra ese aviso.

## 2. Capa de puntos (estaciones)

1. Consigue un GeoJSON oficial (por ejemplo de INAMHI u otra institución).
2. Guárdalo en `public/data/` y anota fuente, fecha y licencia en `public/data/README.md`.
3. Copia `PLANTILLA_PUNTOS` dentro de `CAPAS`.
4. Pon en `urlPuntos` la ruta del archivo, por ejemplo
   `` `${import.meta.env.BASE_URL}data/estaciones-inamhi.geojson` ``.
5. El globo solo dibuja geometrías `Point` o `MultiPoint` de ese archivo.
   El nombre sale de `nombre`, `name`, `estacion` o `station`.
   Si el archivo no carga, el panel dice **dato no disponible** y no inventa sitios.

## 3. Relieve

El terreno 3D no usa Cesium ion ni un token de pago. Sale del Copernicus DEM
GLO-30 recortado a la reserva.

- El script `scripts/relieve/preparar_relieve.py` descarga las teselas públicas
  (sin clave), recorta con 5 km de margen, calcula la pendiente en grados y
  el sombreado, y deja los archivos en `public/relieve/`. La guía del script
  es `scripts/relieve/README.md`.
- `src/globe/terreno.ts` lee `altura_u16.bin` y arma un
  `CustomHeightmapTerrainProvider`. Si el archivo no carga, el panel dice
  **dato no disponible** y el globo se queda en el elipsoide. No se inventan alturas.
- Fuera del rectángulo del recorte la altura es 0 (el elipsoide). El corte
  del borde no es una falla. La ficha de limitaciones lo explica.
- La exageración vertical (1× a 3×) solo estira la vista. No cambia la pendiente.
- «Relieve sombreado» y «Pendiente (°)» están en `CAPAS` con `servicio: "local"`.
  El rectángulo geográfico lo lee el globo desde `public/relieve/meta.json`.
  No copies esas coordenadas a mano. Si cambias el recorte, vuelve a correr el script.

## 4. Qué no hacer

- No pegar coordenadas de la reserva “a ojo”. El límite sale del GeoJSON WDPA.
- No generar una rampa de colores y decir que es una medición.
- No atribuir un cambio de la imagen a El Niño ni a otra causa: el globo
  solo enseña la fecha que la persona eligió.
