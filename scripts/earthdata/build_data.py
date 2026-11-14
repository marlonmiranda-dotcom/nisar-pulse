import json, os, calendar, collections, statistics
D = "2026-11-14"
enso = json.load(open('../../src/data/enso_real.json'))
monthly = collections.defaultdict(dict)
src = {}
# --- Precipitación GPM IMERG ---
fin = [r for r in json.load(open('ea_GPM_3IMERGM.json')) if r.get('p') is not None]
for r in fin:
    y, m = int(r['date'][:4]), int(r['date'][5:7])
    monthly[r['date'][:7]]['precip'] = round(r['p'] * 24 * calendar.monthrange(y, m)[1], 1)
    monthly[r['date'][:7]]['precip_run'] = "final"
last_final = max(r['date'][:7] for r in fin)
dl = collections.defaultdict(list)
if os.path.exists('ea_GPM_3IMERGDL.json'):
    for r in json.load(open('ea_GPM_3IMERGDL.json')):
        if r.get('p') is not None: dl[r['date'][:7]].append(r['p'])
late = []
for k, v in sorted(dl.items()):
    y, m = map(int, k.split('-'))
    if k > last_final and len(v) >= calendar.monthrange(y, m)[1]:
        monthly[k]['precip'] = round(sum(v), 1); monthly[k]['precip_run'] = "late"; late.append(k)
src['precip'] = dict(producto="GPM IMERG V07 (Final mensual GPM_3IMERGM" + (f" + Late diario GPM_3IMERGDL desde {late[0]}" if late else "") + ")",
                     via="NASA GES DISC · Earthdata Cloud OPeNDAP", res="0.1°", url="https://doi.org/10.5067/GPM/IMERG/3B-MONTH/07",
                     ultimo_final=last_final, meses_late=late)
for k, v in enso['precip'].items(): monthly[k]['precip_chirps'] = v
# --- MODIS ---
for r in json.load(open('ea_MOD13C2.json')):
    if r.get('ndvi') is not None: monthly[r['date'][:7]]['ndvi'] = round(r['ndvi'], 4)
for r in json.load(open('ea_MOD11C3.json')):
    if r.get('lst_day') is not None: monthly[r['date'][:7]]['lst'] = round(r['lst_day'], 2)
    if r.get('lst_night') is not None: monthly[r['date'][:7]]['lst_night'] = round(r['lst_night'], 2)
src['ndvi'] = dict(producto="MODIS/Terra MOD13C2 v061 NDVI mensual", via="NASA LP DAAC · Earthdata Cloud OPeNDAP", res="0.05° (~5,6 km)", url="https://doi.org/10.5067/MODIS/MOD13C2.061")
src['lst'] = dict(producto="MODIS/Terra MOD11C3 v061 LST diurna mensual", via="NASA LP DAAC · Earthdata Cloud OPeNDAP", res="0.05° (~5,6 km)", url="https://doi.org/10.5067/MODIS/MOD11C3.061")
# --- SMAP ---
sm = collections.defaultdict(list); smr = collections.defaultdict(int)
for r in json.load(open('ea_SPL3SMP_E.json')):
    for k in ("am", "pm"):
        if r.get(k) is not None: sm[r['date'][:7]].append(r[k])
        if r.get(k + "_rec") is not None: smr[r['date'][:7]] += 1
for k, v in sm.items():
    if len(v) >= 2:
        monthly[k]['sm'] = round(statistics.mean(v) * 100, 1); monthly[k]['sm_n'] = len(v)
src['sm'] = dict(producto="SMAP L3 Radiometer Enhanced 9 km SPL3SMP_E v006 (pasadas AM+PM)", via="NASA NSIDC DAAC · Earthdata Cloud OPeNDAP", res="9 km (EASE-Grid 2.0)", url="https://doi.org/10.5067/M20OXIZHY3RJ",
                 nota="Muestreo cada 5 días; ningún píxel de la reserva tiene calidad 'recomendada' (bosque denso, VWC > 5 kg/m²): usar como indicador relativo.")
src['sm']['recomendados'] = sum(smr.values())
months = sorted(k for k in monthly if "2016-01" <= k <= "2026-12")
out = dict(metadata=dict(descargado=D, poligono="WDPA 555593903 (simplificado)", fuentes=src),
           monthly={k: monthly[k] for k in months},
           hansen=json.load(open('hansen.json')), nisar=json.load(open('nisar_meta.json')))
out['hansen']['fuente'] = "Hansen/UMD/Google/USGS/NASA Global Forest Change 2000–2025 v1.13 (Landsat)"
out['hansen']['url'] = "https://storage.googleapis.com/earthenginepartners-hansen/GFC-2025-v1.13/download.html"
out['hansen']['descargado'] = D
json.dump(out, open('../../src/data/satellite_real.json', 'w'), ensure_ascii=False, separators=(',', ':'))
cnt = collections.Counter(v for m in out['monthly'].values() for v in m)
print(cnt, months[0], months[-1], src['precip']['via'])
for var in ['precip', 'ndvi', 'lst', 'sm']:
    ks = [k for k in months if var in out['monthly'][k]]; print(var, ks[0], ks[-1], len(ks))
