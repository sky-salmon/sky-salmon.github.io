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
- `cfg_v2.json` — the second pass: the kid turned 0.45 rad about its head (`kid.pivot: "head"`, so the matched hat stays put),
  the warm lamp as a low spot light in front and to the left with soft shadows (`light.spot`, `light.fill`, `shadows`), warmer
  hair (`hairTint`), and everything brighter (`exposure` 1.35, about 18 % over the photo's mean).
- `view.html` — the live view: drag to turn round the kid's head (the photo's framing turns with it), wheel or pinch to move in
  and out, double-click or the camera button to go back to the photo; the view starts mirrored like the edited photo. The camera
  stays above the grass and in front of the tower wall.
- `scene.js` / `anim.js` / `sweep.js` — headless renders (still, frames for a video, one load with many variants), served from
  the site root on :8766. `mklight.py` places the lamp in camera terms (left / toward the camera / height).

Approximations: the kid's build reads wider than in the photo (the game's cloth and camera lens are not known exactly), the Bat cape's orange band (the game's chameleon band needs mesh uv3 and runtime values; here a rim on the
hem), the far towers are simple shapes, and the kid's light is tuned by eye (darkened, warm lamp, black hat kept black).
