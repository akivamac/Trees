import * as THREE from 'three';

// ── Forage patch definitions ───────────────────────────────────────
const FORAGE_TYPES = [
  { id: 'huckleberry',  name: 'Huckleberry',     color: 0x5a1a7b, seasons: ['summer','fall'],         qty: [1,3], isMushroom: false },
  { id: 'rosehip',      name: 'Rosehip',          color: 0xcc3322, seasons: ['fall','spring'],         qty: [1,3], isMushroom: false, healthBonus: 5 },
  { id: 'wild_onion',   name: 'Wild Onion',       color: 0xd4d488, seasons: ['spring','summer'],       qty: [1,4], isMushroom: false },
  { id: 'pine_nuts',    name: 'Pine Nuts',        color: 0xc8a060, seasons: ['fall','winter'],         qty: [1,3], isMushroom: false },
  { id: 'chanterelle',  name: 'Chanterelle',      color: 0xe89020, seasons: ['fall'],                  qty: [1,2], isMushroom: true  },
  { id: 'oyster',       name: 'Oyster Mushroom',  color: 0xd8cfc0, seasons: ['fall','spring'],         qty: [1,3], isMushroom: true  },
  { id: 'elderberry',   name: 'Elderberry',       color: 0x221144, seasons: ['summer'],                qty: [2,5], isMushroom: false, rawPenalty: 5 },
  { id: 'death_cap',    name: 'Death Cap',        color: 0x99aa33, seasons: ['fall'],                  qty: [1,2], isMushroom: true,  sickness: 40 },
  { id: 'nightshade',   name: 'Nightshade Berry', color: 0x110022, seasons: ['summer','fall'],         qty: [2,4], isMushroom: false, sickness: 50 },
];

// Export type info for eating logic
export const FORAGE_INFO = {};
for (const t of FORAGE_TYPES) {
  FORAGE_INFO[t.name] = { sickness: t.sickness || 0, healthBonus: t.healthBonus || 0, rawPenalty: t.rawPenalty || 0 };
}

const FORAGE_COUNT  = 100;
const REGROW_DAYS   = 3;

export class ForagingManager {
  constructor(scene, state) {
    this._scene   = scene;
    this._state   = state;
    this._patches = []; // { data, mesh, type }
  }

  init() {
    const saved = this._state.world.foragePatches;
    if (saved && saved.length > 0) {
      for (const d of saved) {
        const type = FORAGE_TYPES.find(t => t.id === d.type);
        if (!type) continue;
        const mesh = this._makeMesh(type);
        mesh.position.set(d.x, 0, d.z);
        mesh.visible = !d.depleted;
        this._scene.add(mesh);
        this._patches.push({ data: d, mesh, type });
      }
      // Backfill if world expanded beyond old patch count
      if (saved.length < FORAGE_COUNT) this._generate(saved.length);
    } else {
      this._generate(0);
    }
  }

  _generate(startAt = 0) {
    const placed = this._patches.map(p => ({ x: p.data.x, z: p.data.z }));
    for (let i = startAt; i < FORAGE_COUNT; i++) {
      let x, z, tries = 0;
      do {
        x = -170 + Math.random() * 250;
        z = -55  + Math.random() * 310;
        tries++;
      } while (tries < 40 && (x > 82 || placed.some(p => Math.abs(p.x - x) < 4 && Math.abs(p.z - z) < 4)));

      const type = FORAGE_TYPES[Math.floor(Math.random() * FORAGE_TYPES.length)];
      const data = { x, z, type: type.id, depleted: false, regrowDay: 0 };
      const mesh = this._makeMesh(type);
      mesh.position.set(x, 0, z);
      this._scene.add(mesh);
      this._patches.push({ data, mesh, type });
      placed.push({ x, z });
    }
  }

  _makeMesh(type) {
    const g = new THREE.Group();
    if (type.isMushroom) {
      const stemMat = new THREE.MeshLambertMaterial({ color: 0xeeeedd });
      const capMat  = new THREE.MeshLambertMaterial({ color: type.color });
      const addMushroom = (ox, oz, scale) => {
        const stem = new THREE.Mesh(new THREE.CylinderGeometry(0.025 * scale, 0.032 * scale, 0.14 * scale, 6), stemMat);
        stem.position.set(ox, 0.07 * scale, oz);
        g.add(stem);
        const cap = new THREE.Mesh(new THREE.SphereGeometry(0.1 * scale, 7, 5, 0, Math.PI * 2, 0, Math.PI * 0.55), capMat);
        cap.position.set(ox, 0.15 * scale, oz);
        cap.rotation.x = Math.PI;
        g.add(cap);
      };
      addMushroom(0, 0, 1.0);
      addMushroom(-0.14, 0.08, 0.65);
      addMushroom(0.12, -0.06, 0.5);
    } else {
      // Berry / nut cluster
      const berryMat = new THREE.MeshLambertMaterial({ color: type.color });
      const stemMat  = new THREE.MeshLambertMaterial({ color: 0x2d5a18 });
      const leafMat  = new THREE.MeshLambertMaterial({ color: 0x2a7030, side: THREE.DoubleSide });
      const leaf = new THREE.Mesh(new THREE.CircleGeometry(0.22, 6), leafMat);
      leaf.rotation.x = -Math.PI / 2;
      leaf.position.y = 0.01;
      g.add(leaf);
      const count = 5 + Math.floor(Math.random() * 5);
      for (let i = 0; i < count; i++) {
        const r     = 0.038 + Math.random() * 0.022;
        const angle = Math.random() * Math.PI * 2;
        const dist  = 0.05 + Math.random() * 0.15;
        const h     = 0.05 + Math.random() * 0.12;
        const berry = new THREE.Mesh(new THREE.SphereGeometry(r, 5, 4), berryMat);
        berry.position.set(Math.cos(angle) * dist, h, Math.sin(angle) * dist);
        g.add(berry);
        const stem = new THREE.Mesh(new THREE.CylinderGeometry(0.005, 0.007, h, 4), stemMat);
        stem.position.set(Math.cos(angle) * dist, h / 2, Math.sin(angle) * dist);
        g.add(stem);
      }
    }
    g.userData.isForage = true;
    return g;
  }

  update(delta, day) {
    for (const p of this._patches) {
      if (p.data.depleted && day >= p.data.regrowDay) {
        p.data.depleted = false;
        p.mesh.visible  = true;
      }
    }
  }

  getNearby(pos, radius = 2.5) {
    let best = null, bestDist = radius;
    for (const p of this._patches) {
      if (p.data.depleted) continue;
      const dx = pos.x - p.data.x, dz = pos.z - p.data.z;
      const d  = Math.sqrt(dx * dx + dz * dz);
      if (d < bestDist) { best = p; bestDist = d; }
    }
    return best;
  }

  harvest(patch, day) {
    const t   = patch.type;
    const qty = t.qty[0] + Math.floor(Math.random() * (t.qty[1] - t.qty[0] + 1));
    patch.data.depleted  = true;
    patch.data.regrowDay = day + REGROW_DAYS;
    patch.mesh.visible   = false;
    return { name: t.name, qty, sickness: t.sickness || 0, healthBonus: t.healthBonus || 0, rawPenalty: t.rawPenalty || 0 };
  }

  syncToState() {
    return this._patches.map(p => p.data);
  }
}
