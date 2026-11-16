// Weapons: the catalogue, the view model, and the firing cycle. Four guns and
// one grenade, each with its own damage, fire rate, magazine, spread and price;
// main.js owns the ray and the damage, this module owns the numbers and the
// look of the gun in the player's hands. Spread grows with movement and with
// sustained fire, so stopping to aim pays.
import * as THREE from 'three';
import { PALETTE } from './palette.js';

export const WEAPONS = {
  pistol: {
    id: 'pistol', name: 'P9 Sidekick', price: 0, damage: 34, headMult: 2.5,
    mag: 12, reserve: 48, gap: 0.16, reload: 1.4, auto: false,
    spreadStill: 0.003, spreadMove: 0.016, kick: 0.011, range: 60,
  },
  smg: {
    id: 'smg', name: 'VEX-9 SMG', price: 1500, damage: 26, headMult: 2.2,
    mag: 30, reserve: 120, gap: 0.08, reload: 1.8, auto: true,
    spreadStill: 0.006, spreadMove: 0.03, kick: 0.008, range: 55,
  },
  rifle: {
    id: 'rifle', name: 'KR-7 Carbine', price: 2700, damage: 33, headMult: 2.8,
    mag: 25, reserve: 100, gap: 0.1, reload: 2.1, auto: true,
    spreadStill: 0.0018, spreadMove: 0.026, kick: 0.013, range: 80,
  },
  dmr: {
    id: 'dmr', name: 'L-50 Longbow', price: 4750, damage: 82, headMult: 2.0,
    mag: 5, reserve: 20, gap: 0.95, reload: 2.8, auto: false,
    spreadStill: 0.0006, spreadMove: 0.05, kick: 0.038, range: 90,
  },
};
export const GRENADE = {
  id: 'grenade', name: 'F-1 Frag', price: 300, maxCarry: 2,
  fuse: 1.7, blastRadius: 6.5, blastDamage: 110,
};
export const WEAPON_ORDER = ['pistol', 'smg', 'rifle', 'dmr'];

const MUZZLE_TIME = 0.07;
const TRACE_TIME = 0.09;

export function createWeapons(camera, scene) {
  const grip = new THREE.MeshStandardMaterial({ color: new THREE.Color(PALETTE.hairline), roughness: 0.7, metalness: 0.25 });
  const steel = new THREE.MeshStandardMaterial({ color: new THREE.Color(PALETTE.ink), roughness: 0.45, metalness: 0.4 });
  const accent = new THREE.MeshStandardMaterial({ color: new THREE.Color(PALETTE.accent), roughness: 0.5, metalness: 0.2 });

  // One view model per weapon, built from boxes; only the equipped one shows.
  const models = {};
  function buildModel(def) {
    const model = new THREE.Group();
    const scale = def.id === 'pistol' ? 0.7 : def.id === 'dmr' ? 1.25 : 1;
    const receiver = new THREE.Mesh(new THREE.BoxGeometry(0.09 * scale, 0.1 * scale, 0.42 * scale), steel);
    const barrel = new THREE.Mesh(new THREE.BoxGeometry(0.045 * scale, 0.045 * scale, 0.4 * scale), grip);
    barrel.position.set(0, 0.025 * scale, -0.38 * scale);
    const stock = new THREE.Mesh(new THREE.BoxGeometry(0.075 * scale, 0.08 * scale, 0.22 * scale), grip);
    stock.position.set(0, -0.02 * scale, 0.3 * scale);
    model.add(receiver, barrel, stock);
    if (def.id === 'dmr') {
      const scope = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.05, 0.16), accent);
      scope.position.set(0, 0.09, -0.05);
      model.add(scope);
    }
    if (def.id === 'smg') {
      const mag = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.16, 0.07), grip);
      mag.position.set(0, -0.12, -0.08);
      model.add(mag);
    }
    model.position.set(0.24, -0.2, -0.42);
    model.visible = false;
    camera.add(model);
    return model;
  }
  for (const id of WEAPON_ORDER) models[id] = buildModel(WEAPONS[id]);
  models.pistol.visible = true; // the starting weapon shows from the first frame

  const flash = new THREE.Mesh(
    new THREE.PlaneGeometry(0.16, 0.16),
    new THREE.MeshBasicMaterial({ color: new THREE.Color(PALETTE.accent), transparent: true, opacity: 0.75, depthWrite: false, side: THREE.DoubleSide }),
  );
  flash.position.set(0.24, -0.18, -0.95);
  flash.visible = false;
  camera.add(flash);
  const flashLight = new THREE.PointLight(new THREE.Color(PALETTE.accent), 0, 6);
  flashLight.position.set(0.24, -0.16, -0.6);
  camera.add(flashLight);

  // Tracer pool: ten reusable lines, no allocation while shooting.
  const tracers = [];
  for (let i = 0; i < 10; i += 1) {
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(new Float32Array(6), 3));
    const line = new THREE.Line(geometry, new THREE.LineBasicMaterial({
      color: new THREE.Color(PALETTE.accent), transparent: true, opacity: 0, blending: THREE.AdditiveBlending,
    }));
    line.visible = false;
    line.frustumCulled = false;
    scene.add(line);
    tracers.push({ line, life: 0 });
  }
  let tracerIndex = 0;

  // Ammo lives per weapon in the stash: switching guns never refills one.
  const state = {
    equipped: 'pistol',
    owned: { pistol: true },
    stash: { pistol: { mag: WEAPONS.pistol.mag, reserve: WEAPONS.pistol.reserve } },
    mag: WEAPONS.pistol.mag,
    reserve: WEAPONS.pistol.reserve,
    cooldown: 0,
    reloadLeft: 0,
    flash: 0,
    kick: 0,
    bloom: 0,
    grenades: 0,
  };

  function saveStash() {
    const slot = state.stash[state.equipped];
    slot.mag = state.mag;
    slot.reserve = state.reserve;
  }

  function loadStash() {
    const slot = state.stash[state.equipped];
    state.mag = slot.mag;
    state.reserve = slot.reserve;
  }

  function current() {
    return WEAPONS[state.equipped];
  }

  function step(dt) {
    state.cooldown = Math.max(0, state.cooldown - dt);
    state.flash = Math.max(0, state.flash - dt);
    state.bloom = Math.max(0, state.bloom - dt * 0.09);
    state.kick += (0 - state.kick) * Math.min(1, dt * 13);
    const model = models[state.equipped];
    model.position.z = -0.42 + state.kick;
    model.rotation.x = state.kick * 2.4;
    flash.visible = state.flash > 0;
    flash.rotation.z = state.flash * 28;
    flashLight.intensity = state.flash > 0 ? 16 : 0;
    if (state.reloadLeft > 0) {
      state.reloadLeft = Math.max(0, state.reloadLeft - dt);
      const def = current();
      model.rotation.x = -0.55 * Math.min(1, (def.reload - state.reloadLeft) * 2);
      if (state.reloadLeft === 0) {
        const need = def.mag - state.mag;
        const take = Math.min(need, state.reserve);
        state.mag += take;
        state.reserve -= take;
      }
    }
    for (const tracer of tracers) {
      if (tracer.life <= 0) continue;
      tracer.life -= dt;
      tracer.line.material.opacity = Math.max(0, tracer.life / TRACE_TIME) * 0.85;
      if (tracer.life <= 0) tracer.line.visible = false;
    }
  }

  return {
    state,
    current,
    step,
    ready() {
      return state.mag > 0 && state.cooldown === 0 && state.reloadLeft === 0;
    },
    pullTrigger() {
      const def = current();
      state.cooldown = def.gap;
      state.flash = MUZZLE_TIME;
      state.kick = def.id === 'dmr' ? 0.11 : 0.055;
      state.bloom = Math.min(0.05, state.bloom + (def.id === 'smg' ? 0.004 : 0.006));
    },
    takeRound() {
      if (state.mag <= 0) return false;
      state.mag -= 1;
      return true;
    },
    reload() {
      const def = current();
      if (state.reloadLeft > 0 || state.mag === def.mag || state.reserve === 0) return false;
      state.reloadLeft = def.reload;
      return true;
    },
    spread(speed) {
      const def = current();
      const moving = Math.min(1, speed / 5.4);
      return def.spreadStill + moving * def.spreadMove + state.bloom;
    },
    equip(id) {
      if (!state.owned[id] || id === state.equipped) return false;
      saveStash();
      models[state.equipped].visible = false;
      state.equipped = id;
      loadStash();
      state.cooldown = 0;
      state.reloadLeft = 0;
      state.flash = 0;
      state.kick = 0;
      state.bloom = 0;
      models[id].visible = true;
      return true;
    },
    buy(id, money) {
      const def = WEAPONS[id];
      if (!def || state.owned[id] || money < def.price) return money;
      state.owned[id] = true;
      state.stash[id] = { mag: def.mag, reserve: def.reserve };
      this.equip(id);
      return money - def.price;
    },
    buyGrenade(money) {
      if (state.grenades >= GRENADE.maxCarry || money < GRENADE.price) return money;
      state.grenades += 1;
      return money - GRENADE.price;
    },
    refillAmmo() {
      // Between rounds every owned weapon is topped up to a full magazine
      // and reserve; the equipped one is synced back into the live counters.
      for (const id of Object.keys(state.owned)) {
        const def = WEAPONS[id];
        state.stash[id].mag = def.mag;
        state.stash[id].reserve = def.reserve;
      }
      loadStash();
      state.reloadLeft = 0;
      state.cooldown = 0;
      state.flash = 0;
      state.kick = 0;
      state.bloom = 0;
    },
    reset() {
      for (const id of WEAPON_ORDER) models[id].visible = false;
      state.owned = { pistol: true };
      state.stash = { pistol: { mag: WEAPONS.pistol.mag, reserve: WEAPONS.pistol.reserve } };
      state.equipped = 'pistol';
      state.grenades = 0;
      models.pistol.visible = true;
      this.refillAmmo();
    },
    showFlash() {
      state.flash = MUZZLE_TIME;
      flashLight.intensity = 16;
    },
    tracer(from, to) {
      const tracer = tracers[tracerIndex];
      tracerIndex = (tracerIndex + 1) % tracers.length;
      const positions = tracer.line.geometry.attributes.position.array;
      positions[0] = from.x;
      positions[1] = from.y;
      positions[2] = from.z;
      positions[3] = to.x;
      positions[4] = to.y;
      positions[5] = to.z;
      tracer.line.geometry.attributes.position.needsUpdate = true;
      tracer.life = TRACE_TIME;
      tracer.line.visible = true;
      tracer.line.material.opacity = 0.85;
    },
    muzzleWorld(out) {
      // The muzzle in world space, for tracers fired by the player.
      out.set(0.24, -0.18, -0.95);
      return camera.localToWorld(out);
    },
  };
}
