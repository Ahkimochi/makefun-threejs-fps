// The enemy squad: four bots in rust uniforms who walk the waypoint graph,
// hold corners, and react to what they see and hear. Each bot runs a small
// state machine — patrol, hold, investigate, engage, defuse, dead — with a
// reaction delay before its first shot and a burst-fire pattern after it.
// Vision is a range + facing + line-of-sight raycast; hearing is a noise
// radius the player raises by firing or by an explosion.
import * as THREE from 'three';
import { PALETTE } from './palette.js';

const BOT_COUNT = 4;
const HEALTH = 100;
const WALK_SPEED = 3.3;
const VISION_RANGE = 30;
const VISION_HALF_ANGLE = 0.96; // ~55 degrees
const REACTION_MIN = 0.35;
const REACTION_MAX = 0.65;
const BURST_SHOTS = 3;
const BURST_GAP = 0.12;
const BURST_PAUSE = 0.75;
const BOT_DAMAGE = 11;
const DEFUSE_TIME = 5;
const RADIUS = 0.34;
const HEIGHT = 1.72;

const HELMETS = ['#c65a2e', '#8a4a28', '#b07830', '#7a3a3a'];

export function createBots(scene, world, random) {
  const nodes = world.waypoints.nodes;
  const edges = world.waypoints.edges;
  const adjacency = nodes.map(() => []);
  for (const [a, b] of edges) {
    adjacency[a].push(b);
    adjacency[b].push(a);
  }

  const uniform = new THREE.MeshStandardMaterial({ color: new THREE.Color(PALETTE.rust), roughness: 0.75, metalness: 0.05 });
  const dark = new THREE.MeshStandardMaterial({ color: new THREE.Color(PALETTE.canvas), roughness: 0.85 });
  const torsoGeometry = new THREE.BoxGeometry(0.52, 0.72, 0.3);
  const headGeometry = new THREE.SphereGeometry(0.16, 14, 10);
  const legGeometry = new THREE.BoxGeometry(0.2, 0.62, 0.22);
  const gunGeometry = new THREE.BoxGeometry(0.07, 0.09, 0.55);

  const bots = [];
  const hitMeshes = [];
  const raycaster = new THREE.Raycaster();
  raycaster.far = 40;
  const toPlayer = new THREE.Vector3();
  const eyePos = new THREE.Vector3();
  const tmp = new THREE.Vector3();
  const dirVec = new THREE.Vector3();

  function nearestNode(x, z) {
    let best = 0;
    let bestDist = Infinity;
    for (let i = 0; i < nodes.length; i += 1) {
      const dx = nodes[i][0] - x;
      const dz = nodes[i][1] - z;
      const d = dx * dx + dz * dz;
      if (d < bestDist) {
        bestDist = d;
        best = i;
      }
    }
    return best;
  }

  // Breadth-first route over the waypoint graph, as a list of node indices.
  function route(fromNode, toNode) {
    if (fromNode === toNode) return [toNode];
    const prev = new Array(nodes.length).fill(-1);
    const queue = [fromNode];
    prev[fromNode] = fromNode;
    while (queue.length > 0) {
      const current = queue.shift();
      if (current === toNode) break;
      for (const next of adjacency[current]) {
        if (prev[next] === -1) {
          prev[next] = current;
          queue.push(next);
        }
      }
    }
    if (prev[toNode] === -1) return [toNode];
    const path = [];
    let node = toNode;
    while (node !== fromNode) {
      path.unshift(node);
      node = prev[node];
    }
    return path;
  }

  for (let i = 0; i < BOT_COUNT; i += 1) {
    const helmet = new THREE.MeshStandardMaterial({ color: new THREE.Color(HELMETS[i]), roughness: 0.5, metalness: 0.2 });
    const group = new THREE.Group();
    const legL = new THREE.Mesh(legGeometry, dark);
    legL.position.set(-0.13, 0.31, 0);
    const legR = new THREE.Mesh(legGeometry, dark);
    legR.position.set(0.13, 0.31, 0);
    const torso = new THREE.Mesh(torsoGeometry, uniform);
    torso.position.y = 1.0;
    const head = new THREE.Mesh(headGeometry, helmet);
    head.position.y = 1.53;
    const gun = new THREE.Mesh(gunGeometry, dark);
    gun.position.set(0.2, 1.05, -0.3);
    group.add(legL, legR, torso, head, gun);
    group.traverse((mesh) => {
      if (mesh.isMesh) {
        mesh.castShadow = true;
        mesh.receiveShadow = true;
      }
    });
    scene.add(group);

    const bot = {
      id: i,
      group,
      torso,
      head,
      legL,
      legR,
      health: HEALTH,
      alive: true,
      state: 'patrol',
      yaw: Math.PI,
      node: 1 + i,
      path: [],
      pathIndex: 0,
      holdLeft: 0,
      scanPhase: random() * Math.PI * 2,
      visionTimer: random() * 0.15,
      canSeePlayer: false,
      reactionLeft: 0,
      burstLeft: 0,
      shotTimer: 0,
      defuseLeft: 0,
      fall: 0,
      walkPhase: random() * Math.PI * 2,
      targetNode: 4,
    };
    torso.userData.bot = bot;
    torso.userData.part = 'torso';
    head.userData.bot = bot;
    head.userData.part = 'head';
    legL.userData.bot = bot;
    legL.userData.part = 'legs';
    legR.userData.bot = bot;
    legR.userData.part = 'legs';
    hitMeshes.push(torso, head, legL, legR);
    bots.push(bot);
  }

  function pickPatrolTarget(bot) {
    // Lanes, mid and the site corners: the routes a defender actually walks.
    const choices = [4, 5, 6, 7, 8, 11, 12, 14, 15, 16, 17, 18, 19];
    bot.targetNode = choices[Math.floor(random() * choices.length)];
    bot.path = route(bot.node, bot.targetNode);
    bot.pathIndex = 0;
    bot.state = 'patrol';
  }

  function moveAlongPath(bot, dt) {
    if (bot.pathIndex >= bot.path.length) return true;
    const target = nodes[bot.path[bot.pathIndex]];
    const dx = target[0] - bot.group.position.x;
    const dz = target[1] - bot.group.position.z;
    const dist = Math.hypot(dx, dz);
    if (dist < 0.5) {
      bot.node = bot.path[bot.pathIndex];
      bot.pathIndex += 1;
      return bot.pathIndex >= bot.path.length;
    }
    const step = (WALK_SPEED * dt) / dist;
    const nx = bot.group.position.x + dx * step;
    const nz = bot.group.position.z + dz * step;
    // Axis-separated slide, same AABB test as the player.
    if (!world.overlaps(nx, 0, bot.group.position.z, RADIUS, HEIGHT, 0.04)) bot.group.position.x = nx;
    if (!world.overlaps(bot.group.position.x, 0, nz, RADIUS, HEIGHT, 0.04)) bot.group.position.z = nz;
    bot.yaw = Math.atan2(dx, dz);
    bot.walkPhase += dt * 9;
    bot.legL.rotation.x = Math.sin(bot.walkPhase) * 0.5;
    bot.legR.rotation.x = -Math.sin(bot.walkPhase) * 0.5;
    return false;
  }

  function canSee(bot, playerPos) {
    toPlayer.set(playerPos.x - bot.group.position.x, 0, playerPos.z - bot.group.position.z);
    const dist = toPlayer.length();
    if (dist > VISION_RANGE || dist < 0.01) return false;
    const facingX = Math.sin(bot.yaw);
    const facingZ = Math.cos(bot.yaw);
    const dot = (toPlayer.x * facingX + toPlayer.z * facingZ) / dist;
    if (dot < Math.cos(VISION_HALF_ANGLE)) return false;
    eyePos.set(bot.group.position.x, 1.55, bot.group.position.z);
    tmp.set(playerPos.x, playerPos.y + 1.2, playerPos.z);
    dirVec.copy(tmp).sub(eyePos);
    const range = dirVec.length();
    dirVec.normalize();
    raycaster.set(eyePos, dirVec);
    const hit = raycaster.intersectObjects(world.shootables, false)[0];
    return !hit || hit.distance >= range - 0.3;
  }

  function fireAtPlayer(bot, player, events) {
    // Accuracy falls with distance and with the player's movement; a burst of
    // three, then a pause. Hits do flat damage; misses still draw a tracer.
    const dist = bot.group.position.distanceTo(player.position);
    const speed = Math.hypot(player.velocity.x, player.velocity.z);
    let chance = 0.52 - dist * 0.012 - speed * 0.03;
    if (player.crouching) chance -= 0.06;
    chance = Math.max(0.06, Math.min(0.6, chance));
    eyePos.set(bot.group.position.x + Math.sin(bot.yaw) * 0.3, 1.45, bot.group.position.z + Math.cos(bot.yaw) * 0.3);
    tmp.set(player.position.x, player.position.y + player.eye - 0.25, player.position.z);
    if (random() < chance) {
      events.onPlayerHit(BOT_DAMAGE, bot);
      events.tracer(eyePos, tmp, false);
    } else {
      tmp.x += (random() - 0.5) * 2.4;
      tmp.y += (random() - 0.5) * 1.6;
      tmp.z += (random() - 0.5) * 2.4;
      events.tracer(eyePos, tmp, false);
    }
    events.onBotShot(bot);
  }

  return {
    bots,
    hitMeshes,
    aliveCount() {
      let count = 0;
      for (const bot of bots) if (bot.alive) count += 1;
      return count;
    },
    damage(mesh, amount) {
      const bot = mesh.userData.bot;
      if (!bot || !bot.alive) return false;
      bot.health -= amount;
      if (bot.defuseLeft > 0) bot.defuseLeft = 0; // a hit breaks a defuse
      if (bot.health > 0) return false;
      bot.alive = false;
      bot.health = 0;
      bot.state = 'dead';
      bot.fall = 0;
      return true;
    },
    hearNoise(x, z, radius) {
      for (const bot of bots) {
        if (!bot.alive || bot.state === 'engage' || bot.state === 'defuse') continue;
        const dx = bot.group.position.x - x;
        const dz = bot.group.position.z - z;
        if (dx * dx + dz * dz > radius * radius) continue;
        bot.targetNode = nearestNode(x, z);
        bot.path = route(bot.node, bot.targetNode);
        bot.pathIndex = 0;
        bot.state = 'investigate';
      }
    },
    setBombPlanted(planted) {
      for (const bot of bots) {
        if (!bot.alive) continue;
        if (planted) {
          // The closest bot goes for the defuse; the rest converge on the site.
          bot.targetNode = 4;
          bot.path = route(bot.node, 4);
          bot.pathIndex = 0;
          bot.state = 'investigate';
        } else {
          pickPatrolTarget(bot);
        }
      }
    },
    reset() {
      for (let i = 0; i < bots.length; i += 1) {
        const bot = bots[i];
        const spawn = world.spawns.bots[i];
        bot.group.position.copy(spawn);
        bot.group.rotation.set(0, 0, 0);
        bot.yaw = Math.PI;
        bot.health = HEALTH;
        bot.alive = true;
        bot.state = 'patrol';
        bot.node = 1 + i;
        bot.fall = 0;
        bot.burstLeft = 0;
        bot.shotTimer = 0;
        bot.defuseLeft = 0;
        bot.canSeePlayer = false;
        bot.legL.rotation.x = 0;
        bot.legR.rotation.x = 0;
        pickPatrolTarget(bot);
      }
    },
    freeze(frozen) {
      for (const bot of bots) bot.frozen = frozen;
    },
    aimPoint(index) {
      const bot = bots[index % bots.length];
      return new THREE.Vector3(bot.group.position.x, 1.1, bot.group.position.z);
    },
    step(dt, time, player, events, bombPlanted) {
      for (const bot of bots) {
        if (!bot.alive) {
          bot.fall = Math.min(1, bot.fall + dt / 0.4);
          bot.group.rotation.x = -bot.fall * 1.5;
          bot.group.position.y = -bot.fall * 0.1;
          continue;
        }
        if (bot.frozen) continue;
        bot.group.rotation.y = bot.yaw;

        // Vision, staggered per bot so the raycasts spread across frames.
        bot.visionTimer -= dt;
        if (bot.visionTimer <= 0) {
          bot.visionTimer = 0.15;
          const seen = player.alive && canSee(bot, player.position);
          if (seen && !bot.canSeePlayer) {
            bot.reactionLeft = REACTION_MIN + random() * (REACTION_MAX - REACTION_MIN);
          }
          bot.canSeePlayer = seen;
          if (seen && bot.state !== 'engage') {
            bot.state = 'engage';
            bot.burstLeft = 0;
            bot.shotTimer = 0;
          } else if (!seen && bot.state === 'engage') {
            pickPatrolTarget(bot);
          }
        }

        if (bot.state === 'engage') {
          // Face the player, strafe a little, and shoot in bursts.
          const dx = player.position.x - bot.group.position.x;
          const dz = player.position.z - bot.group.position.z;
          bot.yaw = Math.atan2(dx, dz);
          bot.group.rotation.y = bot.yaw;
          if (bot.reactionLeft > 0) {
            bot.reactionLeft -= dt;
          } else if (bot.canSeePlayer && player.alive) {
            bot.shotTimer -= dt;
            if (bot.shotTimer <= 0) {
              if (bot.burstLeft <= 0) {
                bot.burstLeft = BURST_SHOTS;
                bot.shotTimer = BURST_PAUSE;
              } else {
                bot.burstLeft -= 1;
                bot.shotTimer = BURST_GAP;
                fireAtPlayer(bot, player, events);
              }
            }
          }
          continue;
        }

        if (bot.state === 'defuse') {
          bot.defuseLeft -= dt;
          if (bot.defuseLeft <= 0) events.onDefused();
          continue;
        }

        if (bot.state === 'hold') {
          bot.holdLeft -= dt;
          bot.yaw += Math.sin(time * 0.7 + bot.scanPhase) * dt * 0.9;
          if (bot.holdLeft <= 0) pickPatrolTarget(bot);
          continue;
        }

        // patrol / investigate: walk the route, then hold and scan.
        const arrived = moveAlongPath(bot, dt);
        if (arrived) {
          if (bombPlanted && bot.node === 4) {
            // At the pad with the bomb down: start the defuse.
            bot.state = 'defuse';
            bot.defuseLeft = DEFUSE_TIME;
            events.onDefuseStart(bot);
          } else {
            bot.state = 'hold';
            bot.holdLeft = 1.5 + random() * 2.5;
          }
        }
      }

      // Cheap separation so bots never stand inside each other.
      for (let i = 0; i < bots.length; i += 1) {
        for (let j = i + 1; j < bots.length; j += 1) {
          const a = bots[i];
          const b = bots[j];
          if (!a.alive || !b.alive) continue;
          const dx = b.group.position.x - a.group.position.x;
          const dz = b.group.position.z - a.group.position.z;
          const d2 = dx * dx + dz * dz;
          if (d2 > 0.01 && d2 < 0.64) {
            const d = Math.sqrt(d2);
            const push = (0.8 - d) / 2 / d;
            a.group.position.x -= dx * push;
            a.group.position.z -= dz * push;
            b.group.position.x += dx * push;
            b.group.position.z += dz * push;
          }
        }
      }
    },
  };
}
