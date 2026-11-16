// Kestrel Yard: the map. A 44 x 34 m desert freight yard at dusk, two lanes
// (West and East), a mid corridor, and one bombsite — the Kestrel Pad — at the
// north end. Every box is a collider for players and bots and a surface a
// bullet stops on. Procedural textures only; the sun is a flat disc in the fog.
// Also owns the waypoint graph the bots walk and the shared AABB overlap test.
import * as THREE from 'three';
import { PALETTE } from './palette.js';
import { createTextures } from './textures.js';

// Waypoints: [x, z] nodes the bots route between. Edges are listed by index.
const WAYPOINTS = [
  [0, 13], // 0 player spawn (south gate)
  [-6, -13], // 1 bot spawn west
  [0, -13], // 2 bot spawn centre
  [6, -13], // 3 bot spawn east
  [0, -10.5], // 4 bombsite pad
  [-4.5, -10.5], // 5 site west corner
  [4.5, -10.5], // 6 site east corner
  [0, -6], // 7 mid north
  [0, 0], // 8 mid
  [0, 6], // 9 mid south
  [-13, 8], // 10 west lane south
  [-13, 0], // 11 west lane mid
  [-13, -8], // 12 west lane north
  [13, 8], // 13 east lane south
  [13, 0], // 14 east lane mid
  [13, -8], // 15 east lane north
  [-7, 0], // 16 west cross
  [7, 0], // 17 east cross
  [-7, -6], // 18 west cross north
  [7, -6], // 19 east cross north
  [-9, 10], // 20 west yard
  [9, 10], // 21 east yard
];
const EDGES = [
  [0, 9], [0, 20], [0, 21], [9, 8], [8, 7], [7, 4], [4, 5], [4, 6],
  [5, 18], [6, 19], [18, 16], [19, 17], [16, 11], [17, 14], [11, 10],
  [14, 13], [10, 20], [13, 21], [11, 12], [14, 15], [12, 18], [15, 19],
  [12, 5], [15, 6], [16, 8], [17, 8], [20, 10], [21, 13], [9, 20], [9, 21],
  [1, 12], [2, 7], [3, 15], [1, 5], [3, 6], [2, 4], [7, 18], [7, 19],
  [18, 12], [19, 15], [16, 20], [17, 21],
];

export function createWorld(scene) {
  const textures = createTextures();
  const group = new THREE.Group();
  scene.add(group);

  const materials = {
    sand: new THREE.MeshStandardMaterial({ map: textures.sand, roughness: 0.95, metalness: 0 }),
    concrete: new THREE.MeshStandardMaterial({ map: textures.concrete, roughness: 0.9, metalness: 0.02 }),
    steel: new THREE.MeshStandardMaterial({ map: textures.steel, roughness: 0.55, metalness: 0.45 }),
    timber: new THREE.MeshStandardMaterial({ map: textures.timber, roughness: 0.85, metalness: 0 }),
    hazard: new THREE.MeshStandardMaterial({ map: textures.hazard, roughness: 0.8, metalness: 0.05 }),
    rust: new THREE.MeshStandardMaterial({ color: new THREE.Color(PALETTE.rust), roughness: 0.7, metalness: 0.15 }),
    dark: new THREE.MeshStandardMaterial({ color: new THREE.Color(PALETTE.canvas), roughness: 0.9, metalness: 0 }),
  };

  const colliders = [];
  const shootables = [];
  const probe = new THREE.Box3();

  function box(w, h, d, x, y, z, material, collide = true) {
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), materials[material]);
    mesh.position.set(x, y, z);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    group.add(mesh);
    if (collide) {
      colliders.push(new THREE.Box3().setFromObject(mesh));
      shootables.push(mesh);
    }
    return mesh;
  }

  // Ground and the yard wall, 44 x 34 m, 4.4 m high, open to the dusk sky.
  box(44.4, 0.4, 34.4, 0, -0.2, 0, 'sand');
  box(0.5, 4.4, 34.4, -22.2, 2.2, 0, 'concrete');
  box(0.5, 4.4, 34.4, 22.2, 2.2, 0, 'concrete');
  box(44.4, 4.4, 0.5, 0, 2.2, -17.2, 'concrete');
  box(44.4, 4.4, 0.5, 0, 2.2, 17.2, 'concrete');

  // Bombsite: the Kestrel Pad, a hazard-striped square at the north end.
  const pad = new THREE.Mesh(new THREE.BoxGeometry(6.4, 0.12, 6.4), materials.hazard);
  pad.position.set(0, 0.06, -10.5);
  pad.receiveShadow = true;
  group.add(pad);
  // The pad is flat: it blocks nothing, but bullets still stop on its edge boxes.
  box(6.4, 0.5, 0.3, 0, 0.25, -13.7, 'hazard');
  box(6.4, 0.5, 0.3, 0, 0.25, -7.3, 'hazard');
  box(0.3, 0.5, 6.4, -3.2, 0.25, -10.5, 'hazard');
  box(0.3, 0.5, 6.4, 3.2, 0.25, -10.5, 'hazard');

  // Site sign on the north wall, so the map names itself in-world.
  const sign = new THREE.Mesh(
    new THREE.PlaneGeometry(4.2, 4.2),
    new THREE.MeshStandardMaterial({ map: textures.sign, roughness: 0.85 }),
  );
  sign.position.set(0, 2.6, -16.9);
  group.add(sign);

  // Freight containers: the tall steel cover that splits the lanes.
  box(6.2, 2.6, 2.5, -13, 1.3, -4, 'steel');
  box(6.2, 2.6, 2.5, 13, 1.3, -4, 'steel');
  box(6.2, 2.6, 2.5, -13, 3.9, -4, 'rust'); // stacked second container, west
  box(2.5, 2.6, 6.2, -17.5, 1.3, 6, 'steel');
  box(2.5, 2.6, 6.2, 17.5, 1.3, 6, 'steel');

  // Timber crates: crouch cover down mid and at the lane mouths.
  box(1.7, 1.7, 1.7, 0, 0.85, -2, 'timber');
  box(1.2, 1.2, 1.2, 1.4, 0.6, -2.6, 'timber');
  box(1.7, 1.1, 1.7, -5.5, 0.55, 3, 'timber');
  box(1.7, 1.1, 1.7, 5.5, 0.55, 3, 'timber');
  box(1.7, 1.7, 1.7, -9.5, 0.85, -6.5, 'timber');
  box(1.7, 1.7, 1.7, 9.5, 0.85, -6.5, 'timber');
  box(1.2, 1.2, 1.2, -7.5, 0.6, 10.5, 'timber');
  box(1.2, 1.2, 1.2, 7.5, 0.6, 10.5, 'timber');

  // Low concrete barriers: lane chokes you can shoot over while crouched behind.
  box(2.6, 1.1, 0.7, -13, 0.55, 4, 'concrete');
  box(2.6, 1.1, 0.7, 13, 0.55, 4, 'concrete');
  box(2.6, 1.1, 0.7, -7, 0.55, -6, 'concrete');
  box(2.6, 1.1, 0.7, 7, 0.55, -6, 'concrete');
  box(3.4, 1.1, 0.7, 0, 0.55, 8.5, 'concrete');

  // Mid pillars and the south watch block: sightline breaks, not full cover.
  box(1.1, 3.4, 1.1, -3.5, 1.7, -6, 'concrete');
  box(1.1, 3.4, 1.1, 3.5, 1.7, -6, 'concrete');
  box(3.2, 2.3, 3.2, -10, 1.15, 12.5, 'dark');
  box(3.2, 2.3, 3.2, 10, 1.15, 12.5, 'dark');

  // Low sun on the western horizon, a flat amber disc in the fog.
  const sun = new THREE.Mesh(
    new THREE.CircleGeometry(3.2, 24),
    new THREE.MeshBasicMaterial({ color: new THREE.Color(PALETTE.accent), fog: false }),
  );
  sun.position.set(-60, 9, -30);
  sun.lookAt(0, 2, 0);
  scene.add(sun);

  // Light: a low amber key from the west (sunset), a cool dusk fill, sky gradient.
  const sky = new THREE.HemisphereLight(new THREE.Color('#7d84a8'), new THREE.Color('#4a3a28'), 0.95);
  scene.add(sky);
  const key = new THREE.DirectionalLight(new THREE.Color('#ffb454'), 2.4);
  key.position.set(-18, 12, 6);
  key.target.position.set(4, 0, -4);
  key.castShadow = true;
  key.shadow.mapSize.set(2048, 2048);
  key.shadow.camera.left = -26;
  key.shadow.camera.right = 26;
  key.shadow.camera.top = 26;
  key.shadow.camera.bottom = -26;
  key.shadow.camera.far = 70;
  key.shadow.bias = -0.0006;
  scene.add(key, key.target);
  const fill = new THREE.DirectionalLight(new THREE.Color('#8d94b8'), 0.5);
  fill.position.set(14, 10, 12);
  scene.add(fill);

  // Shared AABB test: a capsule approximated as a box of half-width radius and
  // height, lifted by `lift` so standing on the floor is not a wall hit.
  function overlaps(x, y, z, radius, height, lift) {
    probe.min.set(x - radius, y + lift, z - radius);
    probe.max.set(x + radius, y + height - lift, z + radius);
    for (const collider of colliders) if (probe.intersectsBox(collider)) return collider;
    return null;
  }

  return {
    colliders,
    shootables,
    group,
    overlaps,
    site: { x: 0, z: -10.5, radius: 3.4 },
    spawns: {
      player: new THREE.Vector3(0, 0, 13),
      bots: [
        new THREE.Vector3(-6, 0, -13),
        new THREE.Vector3(0, 0, -13),
        new THREE.Vector3(6, 0, -13),
        new THREE.Vector3(-9, 0, -12),
      ],
    },
    waypoints: { nodes: WAYPOINTS, edges: EDGES },
  };
}
