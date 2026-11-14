import json, re, glob, os, numpy as np
from PIL import Image
W0, E0, S0, N0 = -78.42, -77.68, -1.22, -0.60
meta = json.load(open('nisar_all.json')); out = []
for o in meta:
    if not o['png']: continue
    base = os.path.basename(o['png']); kml = base.replace('.png', '.kml')
    c = re.search(r'<coordinates>([^<]+)', open('nisar/' + kml).read()).group(1).split()
    pts = [tuple(map(float, p.split(','))) for p in c]
    w = min(p[0] for p in pts); e = max(p[0] for p in pts); s = min(p[1] for p in pts); n = max(p[1] for p in pts)
    im = Image.open('nisar/' + base).convert('RGB'); Wp, Hp = im.size
    x0 = int((W0 - w) / (e - w) * Wp); x1 = int(np.ceil((E0 - w) / (e - w) * Wp))
    y0 = int((n - N0) / (n - s) * Hp); y1 = int(np.ceil((n - S0) / (n - s) * Hp))
    cr = np.array(im.crop((x0, y0, x1, y1)))
    alpha = np.where(cr.sum(axis=2) == 0, 0, 255).astype(np.uint8)
    cov = float((alpha > 0).mean())
    rgba = Image.fromarray(np.dstack([cr, alpha]), 'RGBA')
    p = o['id'].split('_'); date = o['start'][:10]; track = p[5]; direc = p[6]; frame = p[7]
    fn = f"gcov_{date}_{direc}{track}.png"
    rgba.save(f"../../public/nisar/{fn}", optimize=True)
    bw = w + x0 / Wp * (e - w); be = w + x1 / Wp * (e - w); bn = n - y0 / Hp * (n - s); bs = n - y1 / Hp * (n - s)
    out.append(dict(date=date, time=o['start'][11:16] + " UTC", granule=o['id'], collection=o['coll'], track=int(track), frame=int(frame),
                    direction="Ascendente" if direc == "A" else "Descendente", cycle=int(p[4]), pol=p[9], file=f"nisar/{fn}",
                    bounds=[[round(bs, 5), round(bw, 5)], [round(bn, 5), round(be, 5)]], coverage=round(cov, 3),
                    h5=o['h5'], browse=o['png'], qa=o['qa'], size_mb=round(float(o['size_mb'] or 0), 1)))
    print(fn, rgba.size, round(cov, 2), os.path.getsize(f"../../public/nisar/{fn}") // 1024, "KB")
json.dump(out, open('nisar_meta.json', 'w'), indent=1)
