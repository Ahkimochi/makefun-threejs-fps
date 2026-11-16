// EMBERLINE: boot and the one loop. A fixed 60 Hz simulation feeds a render
// at the display's rate; the simulation (player, bots, grenades, rounds) never
// allocates in its hot path — vectors, the raycaster and the tracer pool are
// reused. ?shot=start|play|end with &seed=N sets up a deterministic frame
// for a capture, renders it twice, then freezes it and sets window.__shotReady.
import * as THREE from 'three';
import { PALETTE } from './palette.js';
import { createWorld } from './world.js';
import { createInput } from './input.js';
import { createPlayer } from './player.js';
import { createWeapons, WEAPONS, WEAPON_ORDER, GRENADE } from './weapons.js';
import { createBots } from './bots.js';
import { createRounds, PLANT_SECONDS } from './rounds.js';
import { createHud } from './hud.js';
import { audio } from './audio.js';

const FIXED_STEP = 1 / 60;
const params = new URLSearchParams(window.location.search);
const shot = params.get('shot');
const seed = Number.parseInt(params.get('seed') ?? '1', 10) || 1;

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
const random = mulberry32(seed);

const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
document.getElementById('game').appendChild(renderer.domElement);

const scene = new THREE.Scene();
scene.background = new THREE.Color(PALETTE.canvas);
scene.fog = new THREE.Fog(new THREE.Color(PALETTE.canvas), 26, 70);
const camera = new THREE.PerspectiveCamera(74, window.innerWidth / window.innerHeight, 0.05, 160);
scene.add(camera);

const world = createWorld(scene);
const hud = createHud();
const input = createInput(renderer.domElement, onLockChange);
const player = createPlayer(world);
const weapons = createWeapons(camera, scene);
const bots = createBots(scene, world, random);
const rounds = createRounds();

const raycaster = new THREE.Raycaster();
raycaster.far = 100;
const shootables = world.shootables.concat(bots.hitMeshes);
const direction = new THREE.Vector3();
const muzzle = new THREE.Vector3();
const endPoint = new THREE.Vector3();
const body = player.state;
const roundState = rounds.state;

// The defenders start on their spawn line, frozen until the buy phase ends;
// without this they would stand stacked at the origin until the first round.
bots.reset();
bots.freeze(true);

// Grenades: a pool of three, thrown on an arc, fused, then a blast that
// damages bots and the player by distance.
const grenades = [];
{
  const geo = new THREE.SphereGeometry(0.09, 10, 8);
  const mat = new THREE.MeshStandardMaterial({ color: new THREE.Color(PALETTE.canvas), roughness: 0.5, metalness: 0.4 });
  for (let i = 0; i < 3; i += 1) {
    const mesh = new THREE.Mesh(geo, mat);
    mesh.visible = false;
    scene.add(mesh);
    grenades.push({ mesh, active: false, pos: new THREE.Vector3(), vel: new THREE.Vector3(), fuse: 0 });
  }
}
const blastMesh = new THREE.Mesh(
  new THREE.SphereGeometry(1, 18, 12),
  new THREE.MeshBasicMaterial({ color: new THREE.Color(PALETTE.accent), transparent: true, opacity: 0, depthWrite: false }),
);
blastMesh.visible = false;
scene.add(blastMesh);
let blastLife = 0;

const markerHoldMs = shot ? 4000 : 90;
let started = false;
let frozen = false;
let accumulator = 0;
let lastTime = performance.now();
let elapsed = 0;
let overShown = false;

const botEvents = {
  onPlayerHit(amount, bot) {
    if (!body.alive) return;
    const died = player.damage(amount);
    hud.setHealth(body.health);
    hud.damageFlash();
    audio.hurt();
    if (died) endRound(false, 'You were taken down.');
  },
  tracer(from, to) {
    weapons.tracer(from, to);
  },
  onBotShot() {
    audio.enemyShot();
  },
  onDefuseStart() {
    hud.killfeed('A defender is defusing the charge!', false);
    hud.showBanner('DEFUSE IN PROGRESS', 'Stop the defender at the pad', 2000);
  },
  onDefused() {
    endRound(false, 'The charge was defused.');
  },
};

function syncCamera() {
  camera.position.set(body.position.x, body.position.y + body.eye, body.position.z);
  camera.rotation.set(body.pitch, body.yaw, 0, 'YXZ');
}

function aimAt(point) {
  const dx = point.x - body.position.x;
  const dy = point.y - (body.position.y + body.eye);
  const dz = point.z - body.position.z;
  const length = Math.hypot(dx, dy, dz) || 1;
  body.yaw = Math.atan2(-dx, -dz);
  body.pitch = Math.asin(Math.max(-1, Math.min(1, dy / length)));
  syncCamera();
}

function pushHud() {
  hud.setAmmo(weapons.state.mag, weapons.state.reserve);
  hud.setWeapon(weapons.current().name);
  hud.setHealth(body.health);
  hud.setMoney(roundState.money);
  hud.setTimer(roundState.phase === 'planted' ? roundState.fuse : roundState.timer, roundState.phase);
  hud.setScore(roundState.wins, roundState.losses, roundState.round);
}

function shoot(spread) {
  if (!weapons.takeRound()) {
    audio.dryFire();
    return false;
  }
  camera.getWorldDirection(direction);
  direction.x += (random() * 2 - 1) * spread;
  direction.y += (random() * 2 - 1) * spread;
  direction.z += (random() * 2 - 1) * spread;
  direction.normalize();
  scene.updateMatrixWorld(true);
  raycaster.set(camera.position, direction);
  const hit = raycaster.intersectObjects(shootables, false)[0];
  endPoint.copy(direction).multiplyScalar(weapons.current().range).add(camera.position);
  weapons.muzzleWorld(muzzle);
  if (hit) {
    endPoint.copy(hit.point);
    const bot = hit.object.userData.bot;
    if (bot && bot.alive) {
      const def = weapons.current();
      const part = hit.object.userData.part;
      const mult = part === 'head' ? def.headMult : part === 'legs' ? 0.75 : 1;
      const killed = bots.damage(hit.object, def.damage * mult);
      hud.hitMarker(killed, markerHoldMs);
      if (killed) {
        rounds.addKill();
        hud.killfeed(`You dropped Defender ${bot.id + 1}${part === 'head' ? ' — headshot' : ''}  +$300`, true);
        audio.kill();
      } else {
        audio.hit();
      }
      pushHud();
      if (bots.aliveCount() === 0) endRound(true, 'Yard cleared — every defender is down.');
    }
  }
  weapons.tracer(muzzle, endPoint);
  weapons.pullTrigger();
  audio.shot(weapons.current().id);
  player.recoil(weapons.current().kick * (0.8 + random() * 0.4), (random() * 2 - 1) * 0.004);
  bots.hearNoise(body.position.x, body.position.z, 24);
  pushHud();
  return true;
}

function throwGrenade() {
  if (weapons.state.grenades <= 0 || roundState.phase === 'over') return;
  const slot = grenades.find((g) => !g.active);
  if (!slot) return;
  weapons.state.grenades -= 1;
  camera.getWorldDirection(direction);
  slot.pos.copy(camera.position);
  slot.vel.copy(direction).multiplyScalar(15);
  slot.vel.y += 3.5;
  slot.fuse = GRENADE.fuse;
  slot.active = true;
  slot.mesh.visible = true;
  slot.mesh.position.copy(slot.pos);
  pushHud();
}

function explodeGrenade(slot) {
  slot.active = false;
  slot.mesh.visible = false;
  blastMesh.position.copy(slot.pos);
  blastMesh.visible = true;
  blastLife = 0.28;
  audio.explosion();
  bots.hearNoise(slot.pos.x, slot.pos.z, 42);
  for (const bot of bots.bots) {
    if (!bot.alive) continue;
    const dist = bot.group.position.distanceTo(slot.pos);
    if (dist < GRENADE.blastRadius) {
      const amount = GRENADE.blastDamage * (1 - dist / GRENADE.blastRadius);
      const killed = bots.damage(bot.torso, amount);
      if (killed) {
        rounds.addKill();
        hud.killfeed(`Frag dropped Defender ${bot.id + 1}  +$300`, true);
      }
    }
  }
  const playerDist = body.position.distanceTo(slot.pos);
  if (body.alive && playerDist < GRENADE.blastRadius) {
    const amount = GRENADE.blastDamage * (1 - playerDist / GRENADE.blastRadius) * 0.5;
    if (player.damage(amount)) endRound(false, 'Caught by your own frag.');
    hud.setHealth(body.health);
    hud.damageFlash();
  }
  pushHud();
  if (bots.aliveCount() === 0) endRound(true, 'Yard cleared — every defender is down.');
}

function stepGrenades(dt) {
  for (const slot of grenades) {
    if (!slot.active) continue;
    slot.vel.y -= 14 * dt;
    slot.pos.x += slot.vel.x * dt;
    slot.pos.y += slot.vel.y * dt;
    slot.pos.z += slot.vel.z * dt;
    if (slot.pos.y < 0.09) {
      slot.pos.y = 0.09;
      slot.vel.y *= -0.42;
      slot.vel.x *= 0.6;
      slot.vel.z *= 0.6;
    }
    if (world.overlaps(slot.pos.x, slot.pos.y - 0.09, slot.pos.z, 0.09, 0.18, 0)) {
      slot.vel.x *= -0.4;
      slot.vel.z *= -0.4;
    }
    slot.mesh.position.copy(slot.pos);
    slot.fuse -= dt;
    if (slot.fuse <= 0) explodeGrenade(slot);
  }
  if (blastLife > 0) {
    blastLife -= dt;
    const t = Math.max(0, blastLife / 0.28);
    blastMesh.scale.setScalar(1 + (1 - t) * GRENADE.blastRadius);
    blastMesh.material.opacity = t * 0.5;
    if (blastLife <= 0) blastMesh.visible = false;
  }
}

function plantStep(dt, keys) {
  const inSite = Math.hypot(body.position.x - world.site.x, body.position.z - world.site.z) <= world.site.radius;
  if (roundState.phase === 'live' && body.alive && inSite && keys.has('KeyE')) {
    roundState.plantProgress += dt / PLANT_SECONDS;
    if (roundState.plantProgress >= 1) {
      roundState.plantProgress = 0;
      rounds.plantBomb();
      bots.setBombPlanted(true);
      hud.setPlant(0, false);
      hud.showBanner('CHARGE PLANTED', 'Hold the pad — 35 seconds to detonation', 3000);
      hud.killfeed('Charge planted  +$300', true);
      audio.plantDone();
      pushHud();
    } else {
      hud.setPlant(roundState.plantProgress, true);
      if (Math.floor(roundState.plantProgress * 10) !== Math.floor((roundState.plantProgress - dt / PLANT_SECONDS) * 10)) audio.plantBeep();
    }
  } else {
    if (roundState.plantProgress > 0) roundState.plantProgress = 0;
    hud.setPlant(0, false);
  }
}

function endRound(won, reason) {
  if (roundState.phase === 'over') return;
  const result = rounds.endRound(won, reason);
  bots.freeze(true);
  overShown = false;
  if (result === 'win') audio.roundWin();
  else audio.roundLose();
  if (document.pointerLockElement) document.exitPointerLock();
  hud.hideBuy();
  pushHud();
}

function nextRoundOrRestart() {
  if (roundState.matchOver) {
    rounds.startMatch();
    weapons.reset();
  } else {
    rounds.nextRound();
  }
  player.reset(world.spawns.player);
  bots.reset();
  bots.freeze(true);
  weapons.refillAmmo();
  for (const slot of grenades) {
    slot.active = false;
    slot.mesh.visible = false;
  }
  blastMesh.visible = false;
  pushHud();
  hud.showBanner(`ROUND ${roundState.round}`, roundState.phase === 'buy' ? 'Press B to buy — then take the pad' : '', 2600);
}

function buyItems() {
  const items = WEAPON_ORDER.map((id, i) => {
    const def = WEAPONS[id];
    return {
      id,
      key: String(i + 1),
      name: def.name,
      desc: `${def.damage} dmg · ${def.mag} rnd · ${def.auto ? 'auto' : 'semi'}`,
      price: def.price,
      owned: Boolean(weapons.state.owned[id]),
    };
  });
  items.push({
    id: 'grenade', key: '5', name: 'F-1 Frag', desc: `Blast ${GRENADE.blastDamage} · carry ${weapons.state.grenades}/${GRENADE.maxCarry}`, price: GRENADE.price, owned: false,
  });
  return items;
}

hud.onPlay(() => {
  if (shot) return;
  audio.unlock();
  if (roundState.phase === 'over') {
    hud.hideOverlay();
    nextRoundOrRestart();
    input.requestLock();
    return;
  }
  input.requestLock();
});

hud.onBuy((id) => {
  if (roundState.phase !== 'buy') return;
  const before = roundState.money;
  if (id === 'grenade') roundState.money = weapons.buyGrenade(roundState.money);
  else roundState.money = weapons.buy(id, roundState.money);
  if (roundState.money !== before) {
    audio.buy();
    hud.showBuy(buyItems(), roundState.money);
    pushHud();
  }
});

function onLockChange(locked) {
  if (shot) return;
  if (locked) {
    started = true;
    hud.hideOverlay();
    if (roundState.phase === 'buy') hud.showBanner(`ROUND ${roundState.round}`, 'Press B to buy — then take the pad', 2600);
  } else if (roundState.phase !== 'over') {
    hud.hideBuy();
    hud.showOverlay(started ? 'paused' : 'start');
  }
}

function step(dt) {
  elapsed += dt;
  const phaseBefore = roundState.phase;
  const event = rounds.step(dt);
  if (event === 'live' && phaseBefore === 'buy') {
    bots.freeze(false);
    hud.hideBuy();
    hud.showBanner('ROUND LIVE', 'Plant the charge on the Kestrel Pad', 2200);
  }
  if (roundState.phase === 'live' || roundState.phase === 'planted') {
    player.step(dt, input.state.keys);
    bots.step(dt, elapsed, body, botEvents, roundState.bombPlanted);
    plantStep(dt, input.state.keys);
  }
  weapons.step(dt);
  stepGrenades(dt);
  if (roundState.phase === 'over' && !overShown) {
    overShown = true;
    hud.showOverlay(roundState.matchOver ? 'matchEnd' : 'roundEnd', {
      won: roundState.overWon,
      reason: roundState.overReason,
      wins: roundState.wins,
      losses: roundState.losses,
    });
  }
}

function frame(now) {
  requestAnimationFrame(frame);
  const dt = Math.min((now - lastTime) / 1000, 0.1);
  lastTime = now;
  if (!frozen) {
    const look = input.takeLook();
    player.look(look.x, look.y);
    if (roundState.phase !== 'over' && body.alive) {
      if (input.state.firing && weapons.ready()) shoot(weapons.spread(player.groundSpeed()));
      if (input.takePressed('KeyR') && weapons.reload()) audio.reload();
      if (input.takePressed('KeyG')) throwGrenade();
      for (let i = 0; i < WEAPON_ORDER.length; i += 1) {
        if (input.takePressed(`Digit${i + 1}`) && weapons.equip(WEAPON_ORDER[i])) pushHud();
      }
      if (input.takePressed('KeyB') && roundState.phase === 'buy') {
        if (hud.buyOpen()) hud.hideBuy();
        else hud.showBuy(buyItems(), roundState.money);
      }
    }
    accumulator += dt;
    let steps = 0;
    while (accumulator >= FIXED_STEP && steps < 5) {
      step(FIXED_STEP);
      accumulator -= FIXED_STEP;
      steps += 1;
    }
    if (accumulator > FIXED_STEP * 5) accumulator = 0;
    syncCamera();
    pushHud();
  }
  renderer.render(scene, camera);
}

function settle(steps) {
  for (let i = 0; i < steps; i += 1) step(FIXED_STEP);
}

function runShot(name) {
  hud.hideOverlay();
  body.pitch = 0;
  body.yaw = 0;
  bots.reset();
  if (name === 'start') {
    // Buy phase at the south gate, looking up mid to the pad: the buy menu open.
    body.position.set(0, 0, 13);
    rounds.startRound();
    bots.freeze(true);
    settle(20);
    aimAt(new THREE.Vector3(0, 1.5, -10.5));
    hud.showBuy(buyItems(), roundState.money);
  } else if (name === 'play') {
    // Mid-round: live, one defender in the sights down the west lane, one shot fired.
    rounds.startRound();
    roundState.phase = 'live';
    roundState.timer = 87;
    bots.freeze(false);
    const bot = bots.bots[1];
    bot.group.position.set(-5.5, 0, -8);
    bot.node = 18;
    bot.state = 'hold';
    bot.holdLeft = 30;
    bot.yaw = Math.PI;
    const bot2 = bots.bots[0];
    bot2.group.position.set(13, 0, -8);
    bot2.node = 15;
    bot2.state = 'hold';
    bot2.holdLeft = 30;
    bot2.yaw = Math.PI;
    body.position.set(0, 0, 4);
    settle(20);
    aimAt(bots.aimPoint(1));
    shoot(0);
    settle(1);
    weapons.showFlash();
  } else {
    // Round end: every defender down in the open yard, the win overlay up.
    rounds.startRound();
    roundState.phase = 'live';
    roundState.timer = 100;
    bots.freeze(true); // staged: the defenders hold still for the capture
    const spots = [[-5, 0], [5, 0], [-3, -3], [3, -3]];
    for (let i = 0; i < bots.bots.length; i += 1) {
      const staged = bots.bots[i];
      staged.group.position.set(spots[i][0], 0, spots[i][1]);
      staged.state = 'hold';
      staged.holdLeft = 30;
    }
    body.position.set(0, 0, 2);
    settle(10);
    for (let i = 0; i < bots.bots.length; i += 1) {
      aimAt(bots.aimPoint(i));
      for (let r = 0; r < 3; r += 1) {
        shoot(0);
        settle(8);
      }
    }
    settle(20);
    aimAt(new THREE.Vector3(0, 1.2, -10.5));
    hud.showOverlay('roundEnd', {
      won: true,
      reason: 'Yard cleared — every defender is down.',
      wins: roundState.wins,
      losses: roundState.losses,
    });
  }
  pushHud();
  paintTwiceThenReady();
}

function paintTwiceThenReady() {
  let painted = 0;
  function paint() {
    requestAnimationFrame(paint);
    syncCamera();
    renderer.render(scene, camera);
    painted += 1;
    if (painted === 2) {
      window.__shotReady = true;
      frozen = true;
    }
  }
  requestAnimationFrame(paint);
}

window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
});

window.__game = { rounds, bots, player, weapons, world };
syncCamera();
pushHud();
if (shot) runShot(shot);
else {
  hud.showOverlay('start');
  requestAnimationFrame(frame);
}
