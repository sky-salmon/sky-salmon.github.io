# Photo recreation (Days of Mischief, Lazy-stance squat)

Rebuilds one in-game photo with the site's kid model and the game's own assets, to design interactions on.

- `look.json` — the outfit decoded from the player's QR (pieces, dyes, height, scale; the raw QR is not kept).
- `lazy.glb` — the Lazy stance's stand / sit / squat / sleep poses (`idleStandLazy` … from CharKidAnimEmote_C), baked like the
  site's idles (pose + breath + hairIdle), exported with `export_clips.py` (needs the staged game data).
- `env/` — the level's `WallBrick` / `Brick` textures (albedo + normal) and the `WitchHat` mesh from the game files.
- `scene.mjs` — the scene: kid (squatLazy), brick tower with its teal course, low wall, distant spires, olive fog and sky,
  warm lamp below the frame. Every placement number is in its CFG; `cfg_fin.json` is the matched shot.
- `build_cfg.py` — derives the layout from the camera: tower corner, wall direction (the brick rows' vanishing point), low
  wall and spire, by casting rays through where they sit in the photo.
- `scene.js` / `anim.js` — headless renders (still, and frames for a video), served from the site root on :8766.

Approximations: the Bat cape's orange band (the game's chameleon band needs mesh uv3 and runtime values; here a rim on the
hem), the far towers are simple shapes, and the kid's light is tuned by eye (darkened, warm lamp, black hat kept black).
