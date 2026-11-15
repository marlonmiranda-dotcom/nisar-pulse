# Relieve para el globo

Estos archivos los generó `scripts/relieve/preparar_relieve.py`
a partir del **Copernicus DEM GLO-30 Public** (COP-DEM_GLO-30-DGED),
bucket `s3://copernicus-dem-30m`, sin credenciales.

| Archivo | Contenido |
| --- | --- |
| `meta.json` | Fuente, fecha `Last-Modified` de las teselas, rectángulo, resolución y estadísticas. |
| `altura_u16.bin` | Metros enteros, uint16 little-endian. Lo usa el terreno 3D. |
| `sombreado.png` | Hillshade (azimut 315°, altitud 45°). |
| `pendiente.png` | Pendiente en grados, por clases. |

No edites los binarios a mano. Si faltan, el globo dice **dato no disponible**
y no inventa alturas. La guía para regenerarlos es `scripts/relieve/README.md`.

Atribución obligatoria del DEM:

© DLR e.V. 2010-2014 and © Airbus Defence and Space GmbH 2014-2018 provided under COPERNICUS by the European Union and ESA; all rights reserved.

README del bucket:
<https://copernicus-dem-30m.s3.eu-central-1.amazonaws.com/readme.html>
