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

El relieve no es una entrada de `CAPAS`. Vive en `src/globe/terreno.ts`.

- Con `VITE_CESIUM_ION_TOKEN` en `.env` (o como secreto `VITE_CESIUM_ION_TOKEN`
  de GitHub Actions; ver el README), el globo pide **Cesium World Terrain**.
  En el panel se marca como **Capa de visualización (fuente externa)**.
  Nunca escriban el token en el código.
- Sin token, o si ion falla, el globo intenta **Esri World Elevation (Terrain 3D)**.
  Es un servicio público, sin clave, y el navegador puede leerlo.
  Si tampoco responde, dice **dato no disponible** y se queda en el elipsoide.
  No se fabrica un modelo de elevación.
- El control de exageración vertical solo estira ese modelo externo.
  No calcula pendiente ni susceptibilidad. Esas dos cosas, y las estaciones
  del INAMHI, quedan en **dato no disponible** hasta que haya un archivo real.
- Si el equipo de relieve trae después un `CesiumTerrainProvider` propio,
  el lugar para conectarlo es la función `activarRelieve`, en el comentario
  `EQUIPO DE RELIEVE`. No hace falta calcular alturas en este visor.

## 3b. Series que ya están conectadas a la fecha

Hansen (por año), OPERA DSWx-S1 (por fecha), JRC/Landsat (1984–2021) y las
vistas previas NISAR no son un WMTS nuevo. Salen de los JSON del repositorio
y las arma `src/globe/seriesLocales.ts`. En `capas.config.ts` llevan
`tipo: "serie"`. OPERA es la serie de agua reciente. JRC es la histórica.
No las junten en una sola capa ni digan que el cambio lo causó El Niño.

## 4. Qué no hacer

- No pegar coordenadas de la reserva “a ojo”. El límite sale del GeoJSON WDPA.
- No generar una rampa de colores y decir que es una medición.
- No atribuir un cambio de la imagen a El Niño ni a otra causa: el globo
  solo enseña la fecha que la persona eligió.
