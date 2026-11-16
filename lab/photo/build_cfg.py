# camera from (azimuth, height, distance, fov) aimed so the head lands at the photo's head pixel; walls placed by rays
import numpy as np, json, sys
from scipy.optimize import least_squares
W,H=1920,1200
az,hgt,dist,fov=[float(x) for x in sys.argv[1:5]]
import os
BRICK=float(os.environ.get("BRICK",40)); TEALH=float(os.environ.get("TEALH",3))
headpx=np.array([float(sys.argv[5]),float(sys.argv[6])]) if len(sys.argv)>6 else np.array([480,640])
head=np.array([-1.23,7.46,2.97])
def basis(yaw,pitch):
    f=np.array([np.sin(yaw)*np.cos(pitch), np.sin(pitch), np.cos(yaw)*np.cos(pitch)]); r=np.cross(f,[0,1,0]); r/=np.linalg.norm(r); u=np.cross(r,f); return f,r,u
a=np.radians(az); C=head+np.array([np.sin(a)*dist,0,-np.cos(a)*dist]); C[1]=hgt
t=np.tan(np.radians(fov)/2)
def pix(yaw,pitch,X):
    f,r,u=basis(yaw,pitch); d=X-C; z=d@f
    return np.array([((d@r)/(z*t*W/H)*0.5+0.5)*W, (-(d@u)/(z*t)*0.5+0.5)*H])
s=least_squares(lambda q: pix(q[0],q[1],head)-headpx,[np.arctan2(head[0]-C[0],head[2]-C[2]),0.3])
yaw,pitch=s.x; f,r,u=basis(yaw,pitch)
def ray(px,py):
    x=(px/W*2-1)*t*W/H; y=(1-py/H*2)*t; d=f+x*r+y*u; return d/np.linalg.norm(d)
def proj(X): return pix(yaw,pitch,X)
def flat(v): v=np.array([v[0],0,v[2]]); return v/np.linalg.norm(v)
# tower: corner foot where the photo shows it; its face recedes toward the rows' vanishing point
vp=flat(ray(1680,1170)); horizon_y=None
d=ray(1100,1062); base=C+d*((0-C[1])/d[1]) if d[1]<-1e-3 else C+flat(d)*110
if np.linalg.norm(base-C)>140: base=C+flat(d)*110
def height_at(P,py):
    for hh in np.linspace(0,200,40001):
        if proj(P+[0,hh,0])[1]<=py: return hh
    return 200
wallh=height_at(base,380); teal=height_at(base,520)
A=base-vp*220
# the taller tower behind: the wall line seen at photo x=900 (its right edge)
def on_wall_at(px):
    best=None
    for s_ in np.linspace(0,220,4401):
        P=base-vp*s_; x=proj(P+[0,1,0])[0]
        if best is None or abs(x-px)<best[0]: best=(abs(x-px),P)
    return best[1]
P900=on_wall_at(900)
# low wall: its near end tucked behind the tower corner, its top running from photo (1100,650) to (1920,640)
def at_depth(px,py,depth): d=ray(px,py); return C+d*depth
nearD=np.linalg.norm(base-C)+6
P1=at_depth(1100,650,nearD); lowH=P1[1]
d2=ray(1920,640); s2=(lowH-C[1])/d2[1] if abs(d2[1])>1e-4 else 300; P2=C+d2*min(max(s2,nearD),900)
LOW={'a':[float(P1[0]),0,float(P1[2])],'b':[float(P2[0]),0,float(P2[2])],'height':float(lowH)}
# the witch-hat spire: brim centre at photo (1675,640), 230 px across, 230 units away
HD=230; hb=C+ray(1675,640)*HD; hatScale=(230/((H/2)/t))*HD/6.35
# low wall: top at y~650 beyond the corner
dl=flat(ray(1500,650)); pl=C+dl*(np.linalg.norm(base-C)+12); perp=np.cross([0,1,0],dl)
lowh=height_at(np.array([pl[0],0,pl[2]]),650)
wr=ray(1640,600); br=ray(1800,300)
def tower(ray_, dist_, r):
    p=C+flat(ray_)*dist_; top=C[1]+ray_[1]/np.linalg.norm([ray_[0],ray_[2]])*dist_; return p, top
wt,wtop=tower(wr,230,26); bt,btop=tower(br,300,52)
wl=C+ray(60,1180)*3.2   # the warm light just out of frame, bottom-left
cfg={"kid":{"pos":[0,0,0],"ry":0},"cam":{"pos":C.round(3).tolist(),"tgt":(C+f*10).round(3).tolist(),"fov":fov},
 "wall":{"a":A.round(2).tolist(),"b":base.round(2).tolist(),"height":round(wallh,2),"brick":BRICK,"teal":[round(teal-TEALH,2),round(teal+TEALH,2)]},
 "tall":{"a":(A-vp*2).round(2).tolist(),"b":P900.round(2).tolist(),"height":round(wallh*2.6,2),"setback":3},
 "low":{"a":[round(x,2) for x in LOW['a']],"b":[round(x,2) for x in LOW['b']],"height":round(LOW['height'],2),"depth":10},
 "fog":{"color":"#8d8266","near":60,"far":560},
 "light":{"amb":"#2a2a18","ambI":0.55,"key":"#a8a27c","keyI":0.55,"warm":"#ffb050","warmI":38,"warmPos":wl.round(2).tolist()},
 "lowTile":34,"ground":"#25280e",
 "towers":[{"pos":[round(hb[0],1),0,round(hb[2],1)],"r":12,"h":round(hb[1],1),"hat":True,"hatScaleAbs":round(hatScale,2),"hatRy":1.9},
           {"pos":[round(bt[0],1),0,round(bt[2],1)],"r":24,"h":round((btop-60)*1.1,1),"hat":False,"spike":80}]}
for k in ('low',):
    cfg[k]['a'][1]=0; cfg[k]['b'][1]=0
json.dump(cfg,open(sys.argv[7] if len(sys.argv)>7 else 'cfg2.json','w')); print(json.dumps(cfg))
