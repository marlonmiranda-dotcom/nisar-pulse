import json, numpy as np, rasterio, math
from rasterio.windows import from_bounds
from rasterio.features import geometry_mask
from shapely.geometry import shape
V = "GFC-2025-v1.13"
B = f"/vsicurl/https://storage.googleapis.com/earthenginepartners-hansen/{V}/Hansen_{V}_%s_00N_080W.tif"
geom = json.load(open('../../src/data/colonso_wdpa.geojson'))['features'][0]['geometry']
minx, miny, maxx, maxy = shape(geom).bounds
out = {}
for lay in ["treecover2000", "lossyear"]:
    with rasterio.open(B % lay) as ds:
        w = from_bounds(minx, miny, maxx, maxy, ds.transform).round_offsets().round_lengths()
        a = ds.read(1, window=w); tr = ds.window_transform(w)
        out[lay] = a
inside = geometry_mask([geom], out_shape=a.shape, transform=tr, invert=True)
lat = (miny + maxy) / 2
px_ha = (0.00025 * 111320) * (0.00025 * 111320 * math.cos(math.radians(lat))) / 1e4
tc = out["treecover2000"]; ly = out["lossyear"]
forest = inside & (tc >= 30)
res = {"version": V, "pixel_ha": px_ha, "area_ha": float(inside.sum() * px_ha), "forest2000_ha": float(forest.sum() * px_ha),
       "mean_treecover2000": float(tc[inside].mean()),
       "loss_ha": {str(2000 + y): round(float((forest & (ly == y)).sum() * px_ha), 2) for y in range(1, 26)}}
res["total_loss_ha"] = round(sum(res["loss_ha"].values()), 2)
json.dump(res, open("hansen.json", "w"), indent=1); print(json.dumps(res))
