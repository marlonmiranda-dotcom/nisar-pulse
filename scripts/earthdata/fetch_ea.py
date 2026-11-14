import earthaccess, json, sys, re, math, numpy as np, netCDF4, threading, time
from concurrent.futures import ThreadPoolExecutor, as_completed
from shapely.geometry import shape, Point
from shapely.prepared import prep
prod = sys.argv[1]; start = sys.argv[2] if len(sys.argv) > 2 else "2016-01-01"; end = sys.argv[3] if len(sys.argv) > 3 else "2026-11-14"
earthaccess.login(strategy="netrc"); S = earthaccess.get_requests_https_session()
poly = prep(shape(json.load(open('../../src/data/colonso_wdpa.geojson'))['features'][0]['geometry']))
def cmg_idx():
    rows = list(range(1814, 1822)); cols = list(range(2035, 2043))
    m = np.array([[poly.contains(Point(-180 + 0.05 * (c + .5), 90 - 0.05 * (r + .5))) for c in cols] for r in rows])
    return rows, cols, m
if prod in ("MOD13C2", "MOD11C3"):
    rows, cols, M = cmg_idx(); sl = f"[{rows[0]}:1:{rows[-1]}][{cols[0]}:1:{cols[-1]}]"
    vars_ = ["/MOD_Grid_monthly_CMG_VI/Data_Fields/CMG_0_05_Deg_Monthly_NDVI", "/MOD_Grid_monthly_CMG_VI/Data_Fields/CMG_0_05_Deg_Monthly_pixel_reliability"] if prod == "MOD13C2" else ["/MODIS_MONTHLY_0_05DEG_CMG_LST/Data_Fields/LST_Day_CMG", "/MODIS_MONTHLY_0_05DEG_CMG_LST/Data_Fields/LST_Night_CMG"]
elif prod in ("GPM_3IMERGM", "GPM_3IMERGDL"):
    lo = list(range(1017, 1022)); la = list(range(889, 893)); sl = f"[0:1:0][{lo[0]}:1:{lo[-1]}][{la[0]}:1:{la[-1]}]"
    M = np.array([[poly.contains(Point(-179.95 + 0.1 * i, -89.95 + 0.1 * j)) for j in la] for i in lo])
    vars_ = ["/Grid/precipitation"] if prod == "GPM_3IMERGM" else ["/precipitation"]
elif prod == "SPL3SMP_E":
    from pyproj import Transformer
    T = Transformer.from_crs(4326, 6933, always_xy=True); cell = 9008.055210146; x0 = -17367530.44516138; y0 = 7314540.830638
    def rc(lon, lat):
        x, y = T.transform(lon, lat); return int((y0 - y) // cell), int((x - x0) // cell)
    r0, c0 = rc(-78.25, -0.74); r1, c1 = rc(-77.85, -1.08)
    rows = list(range(r0, r1 + 1)); cols = list(range(c0, c1 + 1))
    Ti = Transformer.from_crs(6933, 4326, always_xy=True)
    M = np.array([[poly.contains(Point(*Ti.transform(x0 + (c + .5) * cell, y0 - (r + .5) * cell))) for c in cols] for r in rows])
    if M.sum() == 0: M[:] = True
    sl = f"[{rows[0]}:1:{rows[-1]}][{cols[0]}:1:{cols[-1]}]"
    vars_ = ["/Soil_Moisture_Retrieval_Data_AM/soil_moisture", "/Soil_Moisture_Retrieval_Data_AM/retrieval_qual_flag", "/Soil_Moisture_Retrieval_Data_PM/soil_moisture_pm", "/Soil_Moisture_Retrieval_Data_PM/retrieval_qual_flag_pm"]
print(prod, "mask px", int(M.sum()), flush=True)
gs = earthaccess.search_data(short_name=prod, temporal=(start, end), count=-1)
stride = int(sys.argv[5]) if len(sys.argv) > 5 else 1
if stride > 1:
    gs = [g for g in gs if (int(g["umm"]["TemporalExtent"]["RangeDateTime"]["BeginningDateTime"][8:10]) - 1) % stride == 0]
print("granules", len(gs), flush=True)
def od(g):
    for x in g["umm"].get("RelatedUrls", []):
        if "opendap.earthdata.nasa.gov" in x["URL"]: return x["URL"]
def tstart(g): return g["umm"]["TemporalExtent"]["RangeDateTime"]["BeginningDateTime"][:10]
def parse(content, g):
    r = type("R", (), {"content": content})
    ds = netCDF4.Dataset("m", memory=r.content); ds.set_auto_mask(False); ds.set_auto_scale(False)
    def get(p):
        parts = p.strip("/").split("/"); o = ds
        for q in parts[:-1]: o = o.groups[q]
        return np.array(o.variables[parts[-1]][:])
    out = {"date": tstart(g)}
    if prod == "MOD13C2":
        nd = get(vars_[0]).astype(float); rel = get(vars_[1])
        ok = M & (nd != -3000) & (rel <= 1); out["ndvi"] = float(nd[ok].mean() * 1e-4) if ok.any() else None; out["n"] = int(ok.sum())
    elif prod == "MOD11C3":
        for k, v in (("lst_day", vars_[0]), ("lst_night", vars_[1])):
            a_ = get(v).astype(float); ok = M & (a_ > 0); out[k] = float(a_[ok].mean() * 0.02 - 273.15) if ok.any() else None; out["n_" + k] = int(ok.sum())
    elif prod.startswith("GPM"):
        p = get(vars_[0])[0].astype(float); ok = M & (p >= 0); out["p"] = float(p[ok].mean()) if ok.any() else None; out["n"] = int(ok.sum())
    else:
        for k, v, f in (("am", vars_[0], vars_[1]), ("pm", vars_[2], vars_[3])):
            sm = get(v).astype(float); fl = get(f)
            ok = M & (sm > -9000); okr = ok & ((fl & 1) == 0)
            out[k] = float(sm[ok].mean()) if ok.any() else None; out[k + "_rec"] = float(sm[okr].mean()) if okr.any() else None
            out["n_" + k] = int(ok.sum()); out["n_" + k + "_rec"] = int(okr.sum())
    return out

LOCK = threading.Lock()
def one(g):
    u = od(g); ce = ";".join(v + sl for v in vars_)
    for a in range(4):
        try:
            r = S.get(u + ".dap.nc4", params={"dap4.ce": ce}, timeout=120)
            if r.status_code != 200: raise Exception(f"HTTP {r.status_code} " + r.text[:150].replace(chr(10)," "))
            with LOCK:
                return parse(r.content, g)
        except Exception as e:
            err = str(e); time.sleep(3 + 5 * a)
    return {"date": tstart(g), "error": err}
import os
PART = f"part_{prod}.json"
res = [r for r in (json.load(open(PART)) if os.path.exists(PART) else []) if "error" not in r]
done = {r["date"] for r in res}
gs = [g for g in gs if tstart(g) not in done]
print("pendientes", len(gs), flush=True)
with ThreadPoolExecutor(int(sys.argv[4]) if len(sys.argv) > 4 else 10) as ex:
    fs = [ex.submit(one, g) for g in gs]
    for i, f in enumerate(as_completed(fs)):
        res.append(f.result())
        if i % 50 == 0:
            print(i, res[-1], flush=True); json.dump(res, open(PART, "w"))
res.sort(key=lambda x: x["date"])
json.dump(res, open(f"ea_{prod}.json", "w")); print("DONE", len(res), sum("error" in r for r in res), flush=True)
