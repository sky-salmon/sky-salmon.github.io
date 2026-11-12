// The kid a visitor last measured on the height page, kept in this browser only (height.js writes these keys):
// the look from their outfit QR and the height / scale numbers. The home island dresses its kid from the same
// record, so both pages show the visitor's own kid; with nothing saved, both show the game's starting outfit.
export const KEY_LOOK = 'candle.height.look';    // { pieces, dyes, attitude, … } from the last outfit QR
export const KEY_INPUT = 'candle.height.input';  // { height, scale, src, at } from the last result

function read(key) {
  try { const v = localStorage.getItem(key); return v ? JSON.parse(v) : null; } catch { return null; }
}

// { pieces: {slot: name} | null, dyes, attitude, height, scale }; pieces null = the starting outfit
export function savedLook() {
  const look = read(KEY_LOOK), input = read(KEY_INPUT);
  const hasLook = !!(look && look.pieces && typeof look.pieces === 'object');
  const hasBody = !!(input && Number.isFinite(input.height) && Number.isFinite(input.scale));
  return {
    pieces: hasLook ? look.pieces : null,
    dyes: hasLook && look.dyes && typeof look.dyes === 'object' ? look.dyes : {},
    attitude: hasLook && Number.isFinite(look.attitude) ? look.attitude : 0,
    height: hasBody ? input.height : 0,
    scale: hasBody ? input.scale : 0
  };
}
