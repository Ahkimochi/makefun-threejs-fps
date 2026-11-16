// Procedural textures, drawn once on offscreen canvases: no image files, no
// network. Every texture is a repeatable tile the map's materials share, so the
// yard reads as sand, concrete, corrugated steel and hazard paint instead of
// flat colour. Deterministic: one seeded generator, so every run looks the same.
import * as THREE from 'three';

function mulberry32(initial) {
  let a = initial;
  return function random() {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function canvasTexture(size, draw, repeatX = 1, repeatY = 1) {
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  draw(canvas.getContext('2d'), size);
  const texture = new THREE.CanvasTexture(canvas);
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.RepeatWrapping;
  texture.repeat.set(repeatX, repeatY);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = 4;
  return texture;
}

function speckle(ctx, size, random, count, colours, minR, maxR) {
  for (let i = 0; i < count; i += 1) {
    ctx.fillStyle = colours[Math.floor(random() * colours.length)];
    ctx.globalAlpha = 0.12 + random() * 0.25;
    const r = minR + random() * (maxR - minR);
    ctx.beginPath();
    ctx.arc(random() * size, random() * size, r, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.globalAlpha = 1;
}

export function createTextures() {
  const random = mulberry32(20261116);

  // Yard sand: warm base, grain speckle, a few darker patches and tyre tracks.
  const sand = canvasTexture(256, (ctx, s) => {
    ctx.fillStyle = '#b89a6b';
    ctx.fillRect(0, 0, s, s);
    speckle(ctx, s, random, 2600, ['#a8875a', '#c8ab7d', '#96794e', '#d0b586'], 0.6, 2.4);
    ctx.strokeStyle = 'rgba(90, 70, 45, 0.25)';
    ctx.lineWidth = 5;
    for (let i = 0; i < 5; i += 1) {
      const y = random() * s;
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.bezierCurveTo(s * 0.3, y + 14, s * 0.7, y - 14, s, y + 6);
      ctx.stroke();
    }
  }, 10, 8);

  // Weathered concrete: grey base, stains, hairline cracks.
  const concrete = canvasTexture(256, (ctx, s) => {
    ctx.fillStyle = '#8d8578';
    ctx.fillRect(0, 0, s, s);
    speckle(ctx, s, random, 1800, ['#7a7264', '#9c9484', '#6e675c', '#a8a08e'], 0.8, 3.2);
    ctx.strokeStyle = 'rgba(60, 55, 45, 0.35)';
    ctx.lineWidth = 1;
    for (let i = 0; i < 9; i += 1) {
      let x = random() * s;
      let y = random() * s;
      ctx.beginPath();
      ctx.moveTo(x, y);
      for (let j = 0; j < 4; j += 1) {
        x += (random() - 0.5) * 60;
        y += (random() - 0.5) * 60;
        ctx.lineTo(x, y);
      }
      ctx.stroke();
    }
  }, 3, 2);

  // Corrugated steel: vertical ribs with rust streaks, for containers and walls.
  const steel = canvasTexture(256, (ctx, s) => {
    ctx.fillStyle = '#5d6a72';
    ctx.fillRect(0, 0, s, s);
    for (let x = 0; x < s; x += 16) {
      const grad = ctx.createLinearGradient(x, 0, x + 16, 0);
      grad.addColorStop(0, 'rgba(255,255,255,0.14)');
      grad.addColorStop(0.5, 'rgba(0,0,0,0.22)');
      grad.addColorStop(1, 'rgba(255,255,255,0.05)');
      ctx.fillStyle = grad;
      ctx.fillRect(x, 0, 16, s);
    }
    speckle(ctx, s, random, 320, ['#c65a2e', '#8a4a28', '#74503a'], 1, 5);
  }, 2, 1);

  // Timber planks: warm boards with gaps and grain lines, for crates and the tower.
  const timber = canvasTexture(256, (ctx, s) => {
    ctx.fillStyle = '#7a5c38';
    ctx.fillRect(0, 0, s, s);
    for (let y = 0; y < s; y += 32) {
      ctx.fillStyle = y % 64 === 0 ? '#82643d' : '#6f5230';
      ctx.fillRect(0, y, s, 30);
      ctx.fillStyle = 'rgba(30, 20, 10, 0.55)';
      ctx.fillRect(0, y + 30, s, 2);
      ctx.strokeStyle = 'rgba(40, 26, 12, 0.35)';
      ctx.lineWidth = 1;
      for (let i = 0; i < 4; i += 1) {
        const gy = y + 6 + random() * 20;
        ctx.beginPath();
        ctx.moveTo(0, gy);
        ctx.bezierCurveTo(s * 0.3, gy + 3, s * 0.7, gy - 3, s, gy);
        ctx.stroke();
      }
    }
  }, 2, 2);

  // Hazard chevrons: amber and charcoal diagonal stripes, for the bombsite pad
  // and the low barriers. One tile, repeated around the pad edge.
  const hazard = canvasTexture(128, (ctx, s) => {
    ctx.fillStyle = '#ffb454';
    ctx.fillRect(0, 0, s, s);
    ctx.fillStyle = '#23262e';
    for (let x = -s; x < s * 2; x += 32) {
      ctx.beginPath();
      ctx.moveTo(x, s);
      ctx.lineTo(x + 16, s);
      ctx.lineTo(x + 16 + s, 0);
      ctx.lineTo(x + s, 0);
      ctx.closePath();
      ctx.fill();
    }
  }, 4, 1);

  // Faded painted sign: "KESTREL YARD" in stencil blocks on a rust panel, used
  // once on the site wall so the map names itself in-world.
  const sign = canvasTexture(512, (ctx, s) => {
    ctx.fillStyle = '#4a4640';
    ctx.fillRect(0, 0, s, s);
    speckle(ctx, s, random, 900, ['#3c3833', '#5a554c', '#c65a2e'], 1, 4);
    ctx.fillStyle = '#ffb454';
    ctx.font = 'bold 64px system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('KESTREL', s / 2, s / 2 - 44);
    ctx.fillText('YARD', s / 2, s / 2 + 40);
    ctx.strokeStyle = '#ffb454';
    ctx.lineWidth = 4;
    ctx.strokeRect(18, 18, s - 36, s - 36);
  });

  return { sand, concrete, steel, timber, hazard, sign };
}
