// The look plan for EMBERLINE, in one place: a dusk desert freight yard.
// Six named values carry the whole palette; the lighting and the canvas textures
// in textures.js make every shade the game needs. The same names are the CSS
// custom properties in index.html.
export const PALETTE = {
  canvas: '#262a38', // dusk sky
  surface: '#3d3a33', // weathered concrete
  hairline: '#6b5a44', // dry timber / rusted steel
  ink: '#f2ede3', // warm off-white
  muted: '#9a938a', // dusty grey
  accent: '#ffb454', // amber signal light
  sand: '#b89a6b', // yard ground
  rust: '#c65a2e', // enemy uniforms, hazard paint
  teal: '#4fc3a1', // friendly markers, buy-menu accents
};

export function shade(name) {
  return PALETTE[name];
}
