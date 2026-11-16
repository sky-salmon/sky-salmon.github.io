"""Export chosen game poses (as the site's idle: pose + breath + hairIdle layers) into one GLB for testing.
usage: export_clips.py out.glb fps name=Pose[:Pack] ..."""
import sys
from pathlib import Path
sys.path.insert(0, '/home/user/sky-fish-mod/tools')
import sky_avatar_glb as G
DATA = Path('/tmp/claude-0/-home-user/33f1d720-2b79-5949-88a1-6f8a4150d271/scratchpad/avwork/data/assets')
data = G.Data([DATA])
skel = G.Skeleton(G.AnimPack(data.file('CharSkyKid_Skeleton.animpack')))
anim = G.Anim(data, skel)
out, fps = Path(sys.argv[1]), float(sys.argv[2])
clips = {}
for spec in sys.argv[3:]:
    cid, src = spec.split('=')
    pose, _, pack = src.partition(':')
    pk, lc = anim.find(pose, pack or None)
    if lc['end'] > lc['start']:   # a real clip: play it as is
        clips[cid] = anim.frames(pose, pk, fps)
    else:                         # a one-frame pose: breathe on it like the game's idles
        clips[cid] = anim.idle(fps, stand_clip=(pose, pk))[0]
    print(cid, pk, pose, len(clips[cid]), 'frames')
out.write_bytes(G.skeleton_glb(skel, clips, fps))
