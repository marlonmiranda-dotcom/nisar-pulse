# Datos del globo

## Límite oficial — Reserva Biológica Colonso Chalupas

Archivo: `public/data/colonso-chalupas-wdpa-555593903.geojson`

Es una copia del polígono que ya estaba en el repositorio
(`src/data/colonso_wdpa.geojson`). El mapa 2D sigue leyendo el original.
El globo 3D lee **esta** ruta. Si el archivo falta, o si ningún elemento
tiene `site_id` 555593903, el globo muestra **dato no disponible** y
**límite oficial no cargado**. No dibuja un rectángulo ni otro contorno.

| Campo | Valor (viene dentro del propio GeoJSON) |
| --- | --- |
| Fuente | UNEP-WCMC & IUCN (2026), Protected Planet: The World Database on Protected Areas (WDPA), WDPAID 555593903 |
| URL | https://www.protectedplanet.net/555593903 |
| Servicio citado en el archivo | https://data-gis.unep-wcmc.org/server/rest/services/ProtectedSites/The_World_Database_of_Protected_Areas/MapServer/1 |
| Fecha de descarga | 2026-11-14 |
| Nota de geometría | El archivo indica simplificación Douglas-Peucker, tolerancia 0.001° (3403 → 152 vértices), con el área conservada |
| Licencia | Términos de uso de la WDPA: uso no comercial, con atribución. https://www.protectedplanet.net/en/legal |

El código del repositorio es MIT. Este GeoJSON **no**: conserva la licencia WDPA.

### Cómo obtenerlo de nuevo

1. Entra a https://www.protectedplanet.net/555593903 y acepta los términos de la WDPA.
2. Descarga el polígono del sitio **555593903** (no uses el de otra área).
3. Guárdalo como `public/data/colonso-chalupas-wdpa-555593903.geojson`.
4. El GeoJSON debe ser un `FeatureCollection` y el elemento de la reserva
   debe traer `properties.site_id` igual a `555593903`.
5. Anota en esta tabla la fecha de tu descarga y no borres la atribución.

También se puede consultar el servicio de UNEP-WCMC citado arriba
(`MapServer/1`, campo `site_id`). Hay que respetar los mismos términos
antes de guardar la geometría en el repositorio.

## Relieve y capas climáticas

No van en esta carpeta.

- El relieve es Cesium World Terrain y solo aparece con `VITE_CESIUM_ION_TOKEN`.
  Sin token, la pantalla dice **dato no disponible**. No hay un DEM calculado aquí.
- Las imágenes de NASA GIBS se piden en vivo. No se guardan rásteres sintéticos.
- Si más adelante agregan estaciones u otra capa de puntos, dejen el GeoJSON
  en esta carpeta y escriban aquí la fuente, la fecha y la licencia.
  La forma de conectarlo está en `src/globe/COMO-AGREGAR-CAPAS.md`.
