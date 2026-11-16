# python3 mklight.py base.json out.json side fwd up exposure warmI [ry] → warm spot placed relative to the kid's head in camera terms:
# side = units toward screen-left, fwd = units toward the camera, up = height above the ground
import json, sys, numpy as np
base, out, side, fwd, up, expo, wI = sys.argv[1], sys.argv[2], *map(float, sys.argv[3:8])
ry = float(sys.argv[8]) if len(sys.argv) > 8 else -0.45
c = json.load(open(base)); C = np.array(c['cam']['pos']); T = np.array(c['cam']['tgt'])
head = np.array([-1.23, 7.46, 2.97])
f = T - C; f[1] = 0; f /= np.linalg.norm(f); r = np.cross(f, [0, 1, 0]); r /= np.linalg.norm(r)
P = head - r * side - f * fwd; P[1] = up
c['kid'] = {'pos': [0, 0, 0], 'ry': ry, 'pivot': 'head'}
c['shadows'] = True; c['exposure'] = expo
c['light'].update({'warmPos': P.round(2).tolist(), 'warmI': wI, 'spot': {'angle': 1.05, 'penumbra': 0.9, 'target': (head + [0, -2, 0]).round(2).tolist()}})
json.dump(c, open(out, 'w')); print(out, 'lamp', P.round(2).tolist())
