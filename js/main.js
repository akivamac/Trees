import * as THREE from 'three';
import { Player }                           from './player.js?v=2';
import { createWorld, placeGroundTools }    from './world.js?v=28';
import { updateUI }                         from './ui.js?v=6';
import { state, loadState, saveState as _rawSaveState } from './state.js?v=17';
import { Hands }                            from './hands.js?v=5';
import { FallenTree }                       from './fallen-tree.js?v=3';
import { makeHandTool, makeLitMatchTool, makeGroundTool } from './tools.js?v=5';
import { FireManager }                       from './fire.js?v=2';
import { FireAudio }                         from './fire-audio.js?v=1';
import { WildlifeManager }                   from './wildlife.js?v=1';
import { TrapManager }                       from './trapping.js?v=3';

loadState();
// time now restores from save

// Wrap saveState to sync runtime arrays first
function saveState() { syncWorldState(); _rawSaveState(); }

// ── Renderer ──────────────────────────────────────────────────────
const canvas = document.getElementById('canvas');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.shadowMap.enabled = true;
renderer.shadowMap.type    = THREE.PCFSoftShadowMap;
renderer.toneMapping       = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.0;
renderer.autoClear = false;

// ── Camera ────────────────────────────────────────────────────────
const camera = new THREE.PerspectiveCamera(75, 1, 0.1, 1000);

// ── Scene ─────────────────────────────────────────────────────────
const worldScene = new THREE.Scene();
const { sun, ambient, billboards, binMesh, riverMesh } = createWorld(worldScene);

// ── Player / Hands ────────────────────────────────────────────────
const player = new Player(camera, canvas);
const hands  = new Hands(renderer);

// ── Ground Tools ──────────────────────────────────────────────────
// Restore equipped tool in hand from saved state
if (state.equippedTool) {
  hands.holdItem(1, makeHandTool(state.equippedTool));
}

let groundItems = placeGroundTools(worldScene, state.world.groundToolsPickedUp);
// Flat mesh list for raycasting (rebuilt when a tool is picked up)
let groundMeshes = groundItems.flatMap(gi => gi.meshes);

function rebuildGroundMeshList() {
  groundMeshes = groundItems.flatMap(gi => gi.meshes);
}

function dropEquippedTool(side) {
  if (!state.equippedTool) return;
  const name = state.equippedTool;
  // Don't drop Tent/Canvas this way — they have special placement
  // Drop the tool as a physical ground object
  const fwd = new THREE.Vector3();
  camera.getWorldDirection(fwd); fwd.y = 0; fwd.normalize();
  const dropPos = camera.position.clone().addScaledVector(fwd, 1.2);
  dropPos.y = 0;

  const group = makeGroundTool(name); // makeGroundTool handles unknown names with a box
  group.position.copy(dropPos);
  worldScene.add(group);
  groundItems.push({ name, group, _dropped: true });
  rebuildGroundMeshList();

  state.equippedTool = null;
  hands.dropItem(side);
  showToast(`Set down ${name}.`);
  saveState();
}

function grabGroundItem(item, side) {
  // Remove from world
  worldScene.remove(item.group);
  groundItems = groundItems.filter(gi => gi !== item);
  rebuildGroundMeshList();

  // Track original ground tools as picked up (prevents re-spawn on reload)
  if (!item._dropped && !state.world.groundToolsPickedUp.includes(item.name)) {
    state.world.groundToolsPickedUp.push(item.name);
  }

  // Add to inventory
  const existing = state.inventory.find(i => i.name === item.name);
  if (existing) existing.quantity++;
  else state.inventory.push({ name: item.name, quantity: 1 });

  // Equip immediately
  state.equippedTool = item.name;

  // Show in hand
  const toolMesh = makeHandTool(item.name);
  hands.holdItem(side, toolMesh);

  state.journal.push({ day: state.time.day, text: `Picked up the ${item.name}.` });
  saveState();
  showToast(`Picked up ${item.name}`);
}

// ── Resize ────────────────────────────────────────────────────────
function resize() {
  const wrap = document.getElementById('game-wrap');
  renderer.setSize(wrap.clientWidth, wrap.clientHeight);
  camera.aspect = wrap.clientWidth / wrap.clientHeight;
  camera.updateProjectionMatrix();
}
window.addEventListener('resize', resize);
resize();

// ── Overlay ───────────────────────────────────────────────────────
const overlay = document.getElementById('overlay');
const playBtn = document.getElementById('play-btn');

playBtn.addEventListener('click', () => {
  player.lock();
  if (player.isMobile) overlay.style.display = 'none';
});
if (player.controls) {
  player.controls.addEventListener('lock',   () => { overlay.style.display = 'none'; });
  player.controls.addEventListener('unlock', () => { overlay.style.display = 'flex'; });
}

// ── Day / Night ────────────────────────────────────────────────────
const SKY = {
  night: new THREE.Color(0x1a2540),
  dawn:  new THREE.Color(0xff9955),
  day:   new THREE.Color(0x87ceeb),
  dusk:  new THREE.Color(0xff7744),
};
function lerp3(a, b, t) { return a.clone().lerp(b, t); }
function getSkyColor(h) {
  if (h < 4)  return SKY.night.clone();
  if (h < 6)  return lerp3(SKY.night, SKY.dawn,  (h - 4) / 2);
  if (h < 8)  return lerp3(SKY.dawn,  SKY.day,   (h - 6) / 2);
  if (h < 18) return SKY.day.clone();
  if (h < 20) return lerp3(SKY.day,   SKY.dusk,  (h - 18) / 2);
  if (h < 22) return lerp3(SKY.dusk,  SKY.night, (h - 20) / 2);
  return SKY.night.clone();
}
function updateDayNight(h) {
  const sky = getSkyColor(h);
  worldScene.background = sky;
  worldScene.fog.color  = sky;
  const inDay      = h >= 6 && h <= 20;
  const strength   = inDay ? Math.sin(((h - 6) / 14) * Math.PI) : 0;
  sun.intensity    = strength * 1.6;
  ambient.intensity = 0.25 + strength * 0.5;
  const a = ((h - 6) / 14) * Math.PI;
  sun.position.set(Math.cos(a - Math.PI / 2) * 150, Math.sin(a) * 150, -30);
  sun.color.set(h < 9 || h > 17 ? 0xffb347 : 0xfff5e0);
}

// ── Arm Pads ──────────────────────────────────────────────────────
(function () {
  [{ padId: 'arm-pad-left', side: -1 }, { padId: 'arm-pad-right', side: 1 }]
    .forEach(({ padId, side }) => {
      const pad = document.getElementById(padId);
      if (!pad) return;
      const dot = pad.querySelector('.arm-dot');
      function applyPad(cx, cy) {
        const r  = pad.getBoundingClientRect();
        const nx = Math.max(-1, Math.min(1, ((cx - r.left) / r.width  - 0.5) * 2));
        const ny = Math.max(-1, Math.min(1, ((cy - r.top)  / r.height - 0.5) * 2));
        dot.style.left = `${(nx * 0.5 + 0.5) * 100}%`;
        dot.style.top  = `${(ny * 0.5 + 0.5) * 100}%`;
        hands.setArmOffset(side, nx, ny);
      }
      pad.addEventListener('pointerdown', e => { e.preventDefault(); pad.setPointerCapture(e.pointerId); applyPad(e.clientX, e.clientY); });
      pad.addEventListener('pointermove', e => { if (pad.hasPointerCapture(e.pointerId)) applyPad(e.clientX, e.clientY); });
      pad.addEventListener('pointerup',     () => {});
      pad.addEventListener('pointercancel', () => {});
    });

  document.querySelectorAll('.curl-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const side   = Number(btn.dataset.side);
      const curled = !btn.classList.contains('curled');
      btn.classList.toggle('curled', curled);
      btn.textContent = curled ? 'Uncurl' : 'Curl';
      hands.setCurl(side, curled);

      if (curled) {
        // Grab nearby meat first
        if (worldMeat.length > 0 && !heldFish && !heldWorldItem) {
          let closest = null, closestDist = Infinity;
          for (const wm of worldMeat) {
            const d = camera.position.distanceTo(wm.mesh.position);
            if (d < 3.5 && d < closestDist) { closest = wm; closestDist = d; }
          }
          if (closest) {
            worldScene.remove(closest.mesh);
            worldMeat.splice(worldMeat.indexOf(closest), 1);
            const handMesh = makeMeatMesh(closest.name);
            handMesh.scale.setScalar(0.7);
            handMesh.position.set(0, 0.02, -0.08);
            hands.dropItem(side);
            hands.holdItem(side, handMesh);
            const other = side === 1 ? -1 : 1;
            if (state.equippedTool) hands.holdItem(other, makeHandTool(state.equippedTool));
            heldFish = { worldMesh: closest.mesh, handMesh, side, name: closest.name, isMeat: true };
            showToast(`Holding ${closest.name}`);
            return;
          }
        }

        // Grab nearby fish first
        if (worldFish.length > 0 && !heldFish && !heldWorldItem) {
          let closest = null, closestDist = Infinity;
          for (const wf of worldFish) {
            const d = camera.position.distanceTo(wf.mesh.position);
            if (d < 3.5 && d < closestDist) { closest = wf; closestDist = d; }
          }
          if (closest) { grabFish(closest, side); return; }
        }
        // Grab nearby world branch / log with both hands
        if (!heldWorldItem && !heldFish && !heldLog) {
          let closestWI = null, closestWIDist = Infinity;
          for (const wi of worldItems) {
            if (!wi.onGround) continue;
            const d = camera.position.distanceTo(wi.mesh.position);
            if (d < 3.5 && d < closestWIDist) { closestWI = wi; closestWIDist = d; }
          }
          let closestFT = null, closestFTDist = Infinity;
          for (const ft of fallenTrees) {
            const p = new THREE.Vector3(); ft.group.getWorldPosition(p);
            const d = camera.position.distanceTo(p);
            if (d < 5 && d < closestFTDist) { closestFT = ft; closestFTDist = d; }
          }
          if (closestWI && closestWIDist <= closestFTDist) { grabLog(closestWI, side); return; }
          if (closestFT) { grabFallenTrunk(closestFT, side); return; }
        }
        // Pick up nearby placed lantern
        if (!heldFish && !heldWorldItem && !heldLog && !heldBarrel) {
          const nearL = nearestLantern(6);
          if (nearL) {
            worldScene.remove(nearL.mesh);
            if (nearL.light) { worldScene.remove(nearL.light); }
            lanternMeshes.splice(lanternMeshes.indexOf(nearL), 1);
            const di = state.world.lanterns.indexOf(nearL.data);
            if (di !== -1) state.world.lanterns.splice(di, 1);
            const existing = state.inventory.find(i => i.name === 'Lantern');
            if (existing) existing.quantity++; else state.inventory.push({ name: 'Lantern', quantity: 1 });
            showToast('Picked up lantern.');
            saveState();
            return;
          }
        }
        // Grab nearby barrel
        if (barrelMeshes.length > 0 && !heldFish && !heldWorldItem && !heldBarrel) {
          let closest = null, closestDist = Infinity;
          for (const b of barrelMeshes) {
            const d = camera.position.distanceTo(new THREE.Vector3(b.data.x, 0, b.data.z));
            if (d < 4 && d < closestDist) { closest = b; closestDist = d; }
          }
          if (closest) { grabBarrel(closest, side); return; }
        }
        // Grab nearby ground tool
        if (groundItems.length > 0) {
          let closest = null, closestDist = Infinity;
          for (const gi of groundItems) {
            const gPos = new THREE.Vector3();
            gi.group.getWorldPosition(gPos);
            const d = camera.position.distanceTo(gPos);
            if (d < 4 && d < closestDist) { closest = gi; closestDist = d; }
          }
          if (closest) grabGroundItem(closest, side);
        }
      } else {
        // Uncurl — drop held fish, barrel, log, or equipped tool
        if (heldFish && heldFish.side === side) { dropFish(side); }
        if (heldBarrel && heldBarrel.side === side) { dropBarrel(side); }
        if (heldLog && (heldLog.sideA === side || heldLog.sideB === side)) { dropLog(side); return; }
        if (!heldFish && !heldBarrel && !heldLog) { dropEquippedTool(side); }
      }
    });
  });
})();

// ── Equip clicks ──────────────────────────────────────────────────
document.getElementById('section-inventory').addEventListener('click', e => {
  const btn = e.target.closest('.inv-equip-btn');
  if (!btn) return;
  const name = btn.dataset.item;
  exitADS();
  if (state.equippedTool === name) {
    state.equippedTool = null;
    hands.dropItem(1);
  } else {
    state.equippedTool = name;
    hands.dropItem(1);
    const toolMesh = makeHandTool(name);
    hands.holdItem(1, toolMesh);
  }
  saveState();
});

// ── Supply Bin Panel ──────────────────────────────────────────────
const binPanel    = document.getElementById('bin-panel');
const binItemList = document.getElementById('bin-items-list');
document.getElementById('bin-close').addEventListener('click', () => { binPanel.style.display = 'none'; });

function openBinPanel() {
  renderBinItems();
  binPanel.style.display = 'block';
}
function renderBinItems() {
  if (!state.world.binItems || state.world.binItems.length === 0) {
    binItemList.innerHTML = '<p class="empty-note">Bin is empty.</p>';
    return;
  }
  binItemList.innerHTML = state.world.binItems.map(name =>
    `<div class="bin-item-row">
      <span class="bin-item-name">${name}</span>
      <button class="bin-take-btn" data-item="${name}">Take</button>
    </div>`
  ).join('');
}
binItemList.addEventListener('click', e => {
  const btn = e.target.closest('.bin-take-btn');
  if (!btn) return;
  const name = btn.dataset.item;
  const idx = state.world.binItems.indexOf(name);
  if (idx === -1) return;
  state.world.binItems.splice(idx, 1);
  // Ammo box — give 10 rounds instead of the box item
  const receiveName = name === 'Ammo Box (10)' ? 'Rifle Ammo' : name;
  const receiveQty  = name === 'Ammo Box (10)' ? 10 : 1;
  const existing = state.inventory.find(i => i.name === receiveName);
  if (existing) existing.quantity += receiveQty; else state.inventory.push({ name: receiveName, quantity: receiveQty });
  state.journal.push({ day: state.time.day, text: `Took ${name} from the supply bin.` });
  saveState();
  renderBinItems();
});

// ── Toast ─────────────────────────────────────────────────────────
const toast = document.getElementById('toast');
let toastTimer = null;
function showToast(msg) {
  toast.textContent = msg;
  toast.classList.add('visible');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toast.classList.remove('visible'), 2200);
}

// ── Interact Prompt ───────────────────────────────────────────────
const interactPrompt = document.getElementById('interact-prompt');

// ── Cooking system ────────────────────────────────────────────────
const cookingSlots = []; // { mesh, name, timer, done, spit }

const COOK_TIMES = {
  'Venison':      12,
  'Rabbit Meat':  8,
  'Squirrel Meat': 6,
  'Trout':        7,
  'Bass':         7,
  'Catfish':      7,
};
const COOKED_NAME = {
  'Venison':      'Cooked Venison',
  'Rabbit Meat':  'Cooked Rabbit',
  'Squirrel Meat':'Cooked Squirrel',
  'Trout':        'Cooked Trout',
  'Bass':         'Cooked Bass',
  'Catfish':      'Cooked Catfish',
};

// ── Canteen / Water ───────────────────────────────────────────────
// Canteen inventory item gains a .water field: 'empty' | 'raw' | 'boiling' | 'boiled'
function getCanteen() { return state.inventory.find(i => i.name === 'Canteen'); }

function fillCanteen() {
  const c = getCanteen();
  if (!c) { showToast('No canteen.'); return false; }
  if (!isNearRiver()) { showToast('Stand near the river to fill.'); return false; }
  c.water = 'raw';
  showToast('Canteen filled with river water. Boil it before drinking!');
  saveState();
  return true;
}

function boilCanteen() {
  const c = getCanteen();
  if (!c || c.water !== 'raw') return false;
  const fire = nearestLitFire(camera.position);
  if (!fire) { showToast('Need a lit fire.'); return false; }

  // Place canteen on fire as a cooking slot
  const spit = _makeCanteenOnFire(fire.pos);
  cookingSlots.push({ name: 'Canteen Water', timer: 10, done: false, spit, firePos: fire.pos });
  c.water = 'boiling';
  showToast('Boiling water... (~10s)');
  saveState();
  return true;
}

function _makeCanteenOnFire(firePos) {
  const g = new THREE.Group();
  // Simple canteen mesh sitting on fire
  const body = new THREE.Mesh(
    new THREE.CylinderGeometry(0.08, 0.08, 0.22, 8),
    new THREE.MeshLambertMaterial({ color: 0x556655 })
  );
  body.position.set(firePos.x, 0.35, firePos.z);
  g.add(body);
  // Cap
  const cap = new THREE.Mesh(
    new THREE.CylinderGeometry(0.03, 0.04, 0.05, 6),
    new THREE.MeshLambertMaterial({ color: 0x444444 })
  );
  cap.position.set(firePos.x, 0.47, firePos.z);
  g.add(cap);
  worldScene.add(g);
  return g;
}

function collectCanteenWater() {
  // Check if boiling canteen is done
  const slot = cookingSlots.find(s => s.name === 'Canteen Water' && s.done && s.firePos.distanceTo(camera.position) < 4);
  if (!slot) return false;
  const c = getCanteen();
  if (c) c.water = 'boiled';
  worldScene.remove(slot.spit);
  cookingSlots.splice(cookingSlots.indexOf(slot), 1);
  showToast('Water boiled! Safe to drink now.');
  saveState();
  return true;
}

function _anyFireNearby(pos, radius) {
  if (fireManager.nearFire(pos, radius)) return true;
  for (const [bb] of burningTrees) { if (bb.position.distanceTo(pos) < radius) return true; }
  for (const ft of fallenTrees) { if (ft.onFire) { const p = new THREE.Vector3(); ft.group.getWorldPosition(p); if (p.distanceTo(pos) < radius) return true; } }
  for (const cf of campfires) { if (cf.lit && cf.pos.distanceTo(pos) < radius) return true; }
  return false;
}

function splashWater() {
  const c = getCanteen();
  if (!c || (!c.water || c.water === 'empty' || c.water === 'boiling')) return false;
  if (!_anyFireNearby(camera.position, 10)) { showToast('No fire nearby.'); return false; }

  // Extinguish fires in radius
  const pos = camera.position.clone();
  const count = fireManager.extinguish(pos, 10);

  // Clear burning trees in range
  for (const [billboard, _elapsed] of [...burningTrees]) {
    if (billboard.position.distanceTo(pos) < 10) {
      billboard.userData.onFire = false;
      if (billboard.userData.fireAudioId) {
        fireAudio.stop(billboard.userData.fireAudioId);
        billboard.userData.fireAudioId = null;
      }
      burningTrees.delete(billboard);
    }
  }

  // Clear fallen tree fires in range
  for (const ft of fallenTrees) {
    if (!ft.onFire) continue;
    const p = new THREE.Vector3();
    ft.group.getWorldPosition(p);
    if (p.distanceTo(pos) < 10) ft.onFire = false;
  }

  // Extinguish campfires in range
  for (const cf of campfires) {
    if (!cf.lit) continue;
    if (cf.pos.distanceTo(pos) < 10) cf.lit = false;
  }

  c.water = 'empty';
  showToast('Water thrown! Fires doused.');
  saveState();
  return true;
}

function drinkCanteen() {
  const c = getCanteen();
  if (!c) return false;
  if (c.water === 'boiled') {
    state.player.thirst = Math.min(100, state.player.thirst + 40);
    c.water = 'empty';
    showToast('Drank clean water. (+40 thirst)');
    saveState();
    return true;
  }
  if (c.water === 'raw') {
    state.player.thirst = Math.min(100, state.player.thirst + 25);
    // Risk of sickness from raw water
    if (Math.random() < 0.4) {
      state.player.health = Math.max(0, state.player.health - 10);
      showToast('Drank raw water. (+25 thirst) Stomach hurts... (-10 health)');
    } else {
      showToast('Drank raw water. (+25 thirst) Got lucky this time...');
    }
    c.water = 'empty';
    saveState();
    return true;
  }
  showToast('Canteen is empty. Fill it at the river.');
  return false;
}

// ── Water Barrel ─────────────────────────────────────────────────
const BARREL_MAX = 5;
const barrelMeshes = []; // { mesh, data } — data refs state.world.barrels entry

function _makeBarrelMesh(x, z) {
  const g = new THREE.Group();
  const bodyMat = new THREE.MeshLambertMaterial({ color: 0x6b4226 });
  const rimMat  = new THREE.MeshLambertMaterial({ color: 0x3a2211 });
  // Main barrel body — 0.9m wide, 1.2m tall
  const body = new THREE.Mesh(new THREE.CylinderGeometry(0.42, 0.48, 1.2, 12), bodyMat);
  body.position.y = 0.6;
  g.add(body);
  // Metal bands
  const rim1 = new THREE.Mesh(new THREE.TorusGeometry(0.44, 0.035, 6, 16), rimMat);
  rim1.rotation.x = Math.PI / 2; rim1.position.y = 1.05;
  g.add(rim1);
  const rim2 = new THREE.Mesh(new THREE.TorusGeometry(0.47, 0.035, 6, 16), rimMat);
  rim2.rotation.x = Math.PI / 2; rim2.position.y = 0.6;
  g.add(rim2);
  const rim3 = new THREE.Mesh(new THREE.TorusGeometry(0.49, 0.035, 6, 16), rimMat);
  rim3.rotation.x = Math.PI / 2; rim3.position.y = 0.2;
  g.add(rim3);
  // Open top rim
  const topRim = new THREE.Mesh(new THREE.TorusGeometry(0.40, 0.04, 6, 16), rimMat);
  topRim.rotation.x = Math.PI / 2; topRim.position.y = 1.2;
  g.add(topRim);
  g.position.set(x, 0, z);
  worldScene.add(g);
  return g;
}

function placeBarrel() {
  const item = state.inventory.find(i => i.name === 'Barrel');
  if (!item) return false;
  item.quantity--;
  if (item.quantity <= 0) state.inventory = state.inventory.filter(i => i.name !== 'Barrel');
  const fwd = new THREE.Vector3();
  camera.getWorldDirection(fwd); fwd.y = 0; fwd.normalize();
  const x = camera.position.x + fwd.x * 2.5;
  const z = camera.position.z + fwd.z * 2.5;
  const data = { x, z, water: 0, boiled: false };
  state.world.barrels.push(data);
  const mesh = _makeBarrelMesh(x, z);
  barrelMeshes.push({ mesh, data });
  state.equippedTool = null;
  hands.dropItem(1);
  showToast('Barrel placed.');
  saveState();
  return true;
}

let heldBarrel = null; // { data, side }

function grabBarrel(b, side) {
  // Remove world mesh
  worldScene.remove(b.mesh);
  barrelMeshes.splice(barrelMeshes.indexOf(b), 1);
  // Remove from state array
  const si = state.world.barrels.indexOf(b.data);
  if (si !== -1) state.world.barrels.splice(si, 1);
  // Show small barrel in hand
  const handMesh = new THREE.Group();
  const body = new THREE.Mesh(
    new THREE.CylinderGeometry(0.06, 0.07, 0.14, 8),
    new THREE.MeshLambertMaterial({ color: 0x6b4226 })
  );
  body.position.y = 0.02;
  handMesh.add(body);
  const rim = new THREE.Mesh(
    new THREE.TorusGeometry(0.065, 0.008, 4, 8),
    new THREE.MeshLambertMaterial({ color: 0x3a2211 })
  );
  rim.rotation.x = Math.PI / 2; rim.position.y = 0.08;
  handMesh.add(rim);
  handMesh.position.set(0, 0.02, -0.08);

  hands.dropItem(side);
  hands.holdItem(side, handMesh);
  heldBarrel = { data: b.data, side };
  showToast(`Carrying barrel (${b.data.water}/${BARREL_MAX} water)`);
}

function dropBarrel(side) {
  if (!heldBarrel || heldBarrel.side !== side) return;
  hands.dropItem(side);
  // Place barrel at player's feet
  const fwd = new THREE.Vector3();
  camera.getWorldDirection(fwd); fwd.y = 0; fwd.normalize();
  const x = camera.position.x + fwd.x * 1.5;
  const z = camera.position.z + fwd.z * 1.5;
  heldBarrel.data.x = x;
  heldBarrel.data.z = z;
  state.world.barrels.push(heldBarrel.data);
  const mesh = _makeBarrelMesh(x, z);
  barrelMeshes.push({ mesh, data: heldBarrel.data });
  if (state.equippedTool) hands.holdItem(side, makeHandTool(state.equippedTool));
  showToast('Set barrel down.');
  heldBarrel = null;
  saveState();
}

function nearestBarrel(maxDist = 4) {
  let best = null, bestDist = Infinity;
  for (const b of barrelMeshes) {
    const d = camera.position.distanceTo(new THREE.Vector3(b.data.x, 0, b.data.z));
    if (d < maxDist && d < bestDist) { best = b; bestDist = d; }
  }
  return best;
}

function pourIntoBarrel() {
  const c = getCanteen();
  const b = nearestBarrel();
  if (!c || !b || (!c.water || c.water === 'empty' || c.water === 'boiling')) return false;
  if (b.data.water >= BARREL_MAX) { showToast('Barrel is full.'); return false; }
  b.data.water++;
  if (b.data.boiled) b.data.boiled = false; // mixing raw resets boiled
  c.water = 'empty';
  showToast(`Poured water into barrel. (${b.data.water}/${BARREL_MAX})`);
  saveState();
  return true;
}

function fillBarrelAtRiver() {
  const b = nearestBarrel();
  if (!b) return false;
  if (b.data.x < 88) { showToast('Barrel must be near the river.'); return false; }
  if (b.data.water >= BARREL_MAX) { showToast('Barrel is full.'); return false; }
  b.data.water = BARREL_MAX;
  showToast(`Barrel filled! (${BARREL_MAX}/${BARREL_MAX})`);
  saveState();
  return true;
}

function boilBarrel() {
  const b = nearestBarrel();
  if (!b || b.data.water <= 0 || b.data.boiled) return false;
  const fire = nearestLitFire(new THREE.Vector3(b.data.x, 0, b.data.z), 5);
  if (!fire) { showToast('Place barrel near a lit fire first.'); return false; }
  // Use cooking slot with barrel-specific name
  const boilTime = 8 + b.data.water * 4; // more water = longer
  cookingSlots.push({ name: 'Barrel Water', timer: boilTime, done: false, spit: null, firePos: fire.pos, barrelRef: b });
  showToast(`Boiling barrel... (~${boilTime}s)`);
  saveState();
  return true;
}

function collectBarrelWater() {
  const slot = cookingSlots.find(s => s.name === 'Barrel Water' && s.done);
  if (!slot) return false;
  if (slot.barrelRef) slot.barrelRef.data.boiled = true;
  cookingSlots.splice(cookingSlots.indexOf(slot), 1);
  showToast('Barrel water boiled! Safe to drink.');
  saveState();
  return true;
}

function fillCanteenFromBarrel() {
  const c = getCanteen();
  const b = nearestBarrel();
  if (!c || !b || b.data.water <= 0) return false;
  if (c.water && c.water !== 'empty') { showToast('Canteen already has water.'); return false; }
  b.data.water--;
  c.water = b.data.boiled ? 'boiled' : 'raw';
  if (b.data.water <= 0) b.data.boiled = false; // reset when empty
  showToast(`Filled canteen with ${b.data.boiled ? 'clean' : 'raw'} water. (${b.data.water}/${BARREL_MAX} left)`);
  saveState();
  return true;
}

function nearestLitFire(pos, radius = 4) {
  let best = null, bestDist = Infinity;
  for (const cf of campfires) {
    if (!cf.lit) continue;
    const d = pos.distanceTo(cf.pos);
    if (d < radius && d < bestDist) { best = cf; bestDist = d; }
  }
  return best;
}

function makeSpit(pos, firePos) {
  const g = new THREE.Group();
  const mat = new THREE.MeshLambertMaterial({ color: 0x5a3a1a });
  // Two Y sticks either side of fire
  [-0.35, 0.35].forEach(offset => {
    const stick = new THREE.Mesh(new THREE.CylinderGeometry(0.02, 0.02, 0.55, 5), mat);
    const dir = new THREE.Vector3(pos.x - firePos.x, 0, pos.z - firePos.z).normalize();
    const perp = new THREE.Vector3(-dir.z, 0, dir.x);
    stick.position.set(firePos.x + perp.x * offset, 0.28, firePos.z + perp.z * offset);
    g.add(stick);
  });
  // Horizontal skewer
  const skewer = new THREE.Mesh(new THREE.CylinderGeometry(0.015, 0.015, 0.8, 5), mat);
  skewer.rotation.z = Math.PI / 2;
  skewer.position.set(firePos.x, 0.5, firePos.z);
  g.add(skewer);
  // Meat chunk on skewer
  const meatMat = new THREE.MeshLambertMaterial({ color: 0x8b2020 });
  const meat = new THREE.Mesh(new THREE.BoxGeometry(0.18, 0.12, 0.12), meatMat);
  meat.position.set(firePos.x, 0.5, firePos.z);
  meat.userData.isMeatChunk = true;
  g.add(meat);
  g.userData.meatMesh = meat;
  worldScene.add(g);
  return g;
}

function placeMeatOnFire(itemName) {
  // Find closest lit fire
  const fire = nearestLitFire(camera.position);
  if (!fire) { showToast('No lit campfire nearby.'); return false; }

  // Remove from inventory
  const inv = state.inventory.find(i => i.name === itemName);
  if (!inv) return false;
  inv.quantity--;
  if (inv.quantity <= 0) state.inventory = state.inventory.filter(i => i.name !== itemName);

  const spit = makeSpit(camera.position, fire.pos);
  const cookTime = COOK_TIMES[itemName] || 10;
  cookingSlots.push({ name: itemName, timer: cookTime, done: false, spit, firePos: fire.pos });
  showToast(`Cooking ${itemName}... (~${cookTime}s)`);
  saveState();
  return true;
}

function updateCooking(delta) {
  for (const slot of cookingSlots) {
    if (slot.done) continue;
    slot.timer -= delta;
    // Rotate meat on spit
    if (slot.spit && slot.spit.userData.meatMesh) {
      slot.spit.userData.meatMesh.rotation.x += delta * 1.2;
    }
    // Darken meat as it cooks
    if (slot.spit && slot.spit.userData.meatMesh) {
      const t = Math.max(0, 1 - slot.timer / (COOK_TIMES[slot.name] || 10));
      slot.spit.userData.meatMesh.material.color.setRGB(0.54 - t * 0.2, 0.13 - t * 0.05, 0.13 - t * 0.05);
    }
    if (slot.timer <= 0) {
      slot.done = true;
      showToast(`${COOKED_NAME[slot.name] || 'Cooked Meat'} is ready! Press E to collect.`);
    }
  }
}

function collectCooked() {
  const ready = cookingSlots.filter(s => s.done && s.firePos.distanceTo(camera.position) < 4);
  if (ready.length === 0) return false;
  for (const slot of ready) {
    const cooked = COOKED_NAME[slot.name] || 'Cooked Meat';
    receiveItem(cooked, `Cooked ${slot.name}.`);
    state.skills.cooking = Math.min(99, (state.skills.cooking || 0) + 1);
    worldScene.remove(slot.spit);
    cookingSlots.splice(cookingSlots.indexOf(slot), 1);
    showToast(`Collected ${cooked}!`);
  }
  saveState();
  return true;
}

// ── Eating ────────────────────────────────────────────────────────
const EAT_VALUES = {
  'Cooked Venison':  35,
  'Cooked Rabbit':   25,
  'Cooked Squirrel': 18,
  'Cooked Trout':    22,
  'Cooked Bass':     22,
  'Cooked Catfish':  22,
  'Rabbit':          10,  // raw — less benefit, slight health risk
  'Venison':         12,
  'Squirrel Meat':    8,
  'Trout':           10,
  'Bass':            10,
  'Catfish':         10,
};

function tryEat() {
  // Prefer cooked food first
  let food = state.inventory.find(i => EAT_VALUES[i.name] && i.name.startsWith('Cooked'));
  if (!food) food = state.inventory.find(i => EAT_VALUES[i.name]);
  if (!food) return false;

  const val = EAT_VALUES[food.name];
  const isRaw = !food.name.startsWith('Cooked');
  state.player.hunger = Math.min(100, state.player.hunger + val);

  food.quantity--;
  if (food.quantity <= 0) state.inventory = state.inventory.filter(i => i !== food);

  if (isRaw) {
    if (Math.random() < 0.3) {
      state.player.health = Math.max(0, state.player.health - 8);
      showToast(`Ate raw ${food.name}. (+${val} hunger) Stomach hurts... (-8 health)`);
    } else {
      showToast(`Ate raw ${food.name}. (+${val} hunger)`);
    }
  } else {
    showToast(`Ate ${food.name}. (+${val} hunger)`);
  }
  saveState();
  return true;
}

// ── Carcasses & butchering ────────────────────────────────────────
const carcasses     = []; // { mesh, kind, cutsLeft }
const worldMeat     = []; // { mesh, name } — meat pieces on ground
const fallingAnimals = []; // { mesh, kind, loot, cuts, rotX, velY, done }

function updateFallingAnimals(delta) {
  for (let i = fallingAnimals.length - 1; i >= 0; i--) {
    const fa = fallingAnimals[i];
    if (fa.done) { fallingAnimals.splice(i, 1); continue; }
    // Tip over — rotate X toward PI/2
    fa.rotX += delta * 3.5;
    fa.mesh.rotation.x = Math.min(fa.rotX, Math.PI / 2);
    // Drop toward ground
    fa.velY -= 4 * delta;
    fa.mesh.position.y = Math.max(0.12, fa.mesh.position.y + fa.velY * delta);
    if (fa.mesh.position.y <= 0.12 && fa.rotX >= Math.PI / 2) {
      fa.mesh.rotation.x = Math.PI / 2;
      fa.mesh.position.y = 0.12;
      if (fa.mesh.userData.billboard) fa.mesh.userData.billboard.rotation.y = 0;
      carcasses.push({ mesh: fa.mesh, kind: fa.kind, cutsLeft: fa.cuts });
      fa.loot.forEach(item => receiveItem(item, null));
      showToast(`${fa.kind} down! Knife to butcher.`);
      fa.done = true;
    }
  }
}

function makeMeatMesh(name) {
  const color = name === 'Venison' ? 0x8b2020 : name === 'Hide' ? 0x7a5a30 : 0x9a4a3a;
  const g = new THREE.Group();
  const body = new THREE.Mesh(
    new THREE.BoxGeometry(0.22, 0.08, 0.14),
    new THREE.MeshLambertMaterial({ color })
  );
  g.add(body);
  return g;
}

function butcherCarcass(carcass) {
  const lootTable = {
    deer:     [...Array(18).fill('Venison'), 'Hide', 'Venison'],  // 20 cuts — ~2 game weeks of food
    rabbit:   ['Rabbit Meat', 'Hide'],
    squirrel: ['Squirrel Meat', 'Hide'],
  };
  const items = lootTable[carcass.kind] || ['Meat'];
  const item  = items[items.length - carcass.cutsLeft] || 'Venison';
  carcass.cutsLeft--;

  // Spawn meat piece on ground next to carcass
  const fm = makeMeatMesh(item);
  const angle = Math.random() * Math.PI * 2;
  fm.position.set(
    carcass.mesh.position.x + Math.cos(angle) * 0.5,
    0.05,
    carcass.mesh.position.z + Math.sin(angle) * 0.5
  );
  worldScene.add(fm);
  worldMeat.push({ mesh: fm, name: item });

  showToast(`Cut off: ${item} — curl hand to pick up`);
  triggerShake(0.03, 0.12);

  if (carcass.cutsLeft <= 0) {
    worldScene.remove(carcass.mesh);
    carcasses.splice(carcasses.indexOf(carcass), 1);
    showToast('Carcass fully butchered.');
  }
}

// ── Wildlife & Trapping ────────────────────────────────────────────
const wildlifeManager = new WildlifeManager(worldScene, camera);
const trapManager     = new TrapManager(worldScene);

// ── Fire system ───────────────────────────────────────────────────
const fireManager  = new FireManager(worldScene);
const fireAudio    = new FireAudio();
const burningTrees = new Map(); // billboard → seconds elapsed since ignition
let   _fireAudioId = 0;        // incrementing id for each fire sound instance

// match state
const matchState = { lit: false, burnRemaining: 0, mesh: null };

// ── World Lanterns ────────────────────────────────────────────────
const lanternMeshes = []; // { mesh, light, data } — data refs state.world.lanterns entry

function _makeLanternWorldMesh(x, z) {
  const g = new THREE.Group();
  // Post
  const post = new THREE.Mesh(new THREE.CylinderGeometry(0.025, 0.025, 0.9, 6),
    new THREE.MeshLambertMaterial({ color: 0x222222 }));
  post.position.y = 0.45; g.add(post);
  // Metal cage body (dark rings top+bottom)
  const rimMat = new THREE.MeshLambertMaterial({ color: 0x2a2a2a });
  const rimT = new THREE.Mesh(new THREE.CylinderGeometry(0.092, 0.092, 0.022, 8), rimMat);
  rimT.position.y = 1.11; g.add(rimT);
  const rimB = new THREE.Mesh(new THREE.CylinderGeometry(0.092, 0.092, 0.022, 8), rimMat);
  rimB.position.y = 0.89; g.add(rimB);
  // Glass panels — transparent so flame inside is visible
  const glassMat = new THREE.MeshLambertMaterial({ color: 0x664400, transparent: true, opacity: 0.25, side: THREE.DoubleSide });
  const glass = new THREE.Mesh(new THREE.CylinderGeometry(0.082, 0.082, 0.2, 8, 1, true), glassMat); // open-ended
  glass.position.y = 1.0; g.add(glass);
  // Inner flame glow — hidden when off
  const flameMat = new THREE.MeshBasicMaterial({ color: 0xff8800 });
  const flame = new THREE.Mesh(new THREE.SphereGeometry(0.038, 6, 5), flameMat);
  flame.position.y = 1.0;
  flame.visible = false;
  g.add(flame);
  // Cap
  const cap = new THREE.Mesh(new THREE.CylinderGeometry(0.1, 0.1, 0.025, 8),
    new THREE.MeshLambertMaterial({ color: 0x333333 }));
  cap.position.y = 1.125; g.add(cap);
  g.position.set(x, 0, z);
  g.userData.glassMat = glassMat;
  g.userData.flameMesh = flame;
  worldScene.add(g);
  return g;
}

function placeLantern() {
  const item = state.inventory.find(i => i.name === 'Lantern');
  if (!item) return false;
  item.quantity--;
  if (item.quantity <= 0) state.inventory = state.inventory.filter(i => i.name !== 'Lantern');
  const fwd = new THREE.Vector3();
  camera.getWorldDirection(fwd); fwd.y = 0; fwd.normalize();
  const x = camera.position.x + fwd.x * 1.8;
  const z = camera.position.z + fwd.z * 1.8;
  const data = { x, z, on: false };
  state.world.lanterns.push(data);
  const mesh = _makeLanternWorldMesh(x, z);
  lanternMeshes.push({ mesh, light: null, data });
  state.equippedTool = null;
  hands.dropItem(1);
  showToast('Lantern placed. Press F near it to toggle.');
  saveState();
  return true;
}

function nearestLantern(maxDist = 2.5) {
  let best = null, bestDist = Infinity;
  for (const l of lanternMeshes) {
    const d = camera.position.distanceTo(new THREE.Vector3(l.data.x, 0, l.data.z));
    if (d < maxDist && d < bestDist) { best = l; bestDist = d; }
  }
  return best;
}

function toggleNearLantern() {
  const l = nearestLantern();
  if (!l) return false;
  l.data.on = !l.data.on;
  const glassMat  = l.mesh.userData.glassMat;
  const flameMesh = l.mesh.userData.flameMesh;
  if (l.data.on) {
    if (!l.light) {
      l.light = new THREE.PointLight(0xffaa33, 0, 30);
      l.light.position.set(l.data.x, 1.0, l.data.z);
      worldScene.add(l.light);
    }
    l.light.intensity = 22;
    if (glassMat)  { glassMat.color.setHex(0xffaa22); glassMat.opacity = 0.35; }
    if (flameMesh) flameMesh.visible = true;
    showToast('Lantern on.');
  } else {
    if (l.light)   l.light.intensity = 0;
    if (glassMat)  { glassMat.color.setHex(0x664400); glassMat.opacity = 0.25; }
    if (flameMesh) flameMesh.visible = false;
    showToast('Lantern off.');
  }
  saveState();
  return true;
}

function igniteTree(billboard) {
  if (billboard.userData.onFire || billboard.userData.falling) return;
  billboard.userData.onFire = true;
  const treeH        = billboard.userData.treeHeight || 8;
  const startScale   = Math.max(0.5, treeH / 14);
  const fullScale    = Math.max(1.0, treeH / 6);
  const sourceRadius = treeH * 0.15;
  const audioId      = ++_fireAudioId;
  billboard.userData.fireAudioId = audioId;
  // Fire starts small at base and grows up the trunk over ~6s
  fireManager.ignite(
    billboard.position.clone(),
    { scale: startScale, growTo: fullScale, growRate: (fullScale - startScale) / 20, sourceRadius }
  );
  burningTrees.set(billboard, 0);
  fireAudio.start(audioId, billboard.position, 0.22);
  showToast('Tree is on fire!');
  state.journal.push({ day: state.time.day, text: 'Set a tree on fire.' });
}

/**
 * Manual match-to-tree ignition — 25% success, 75% fizzle.
 * Fizzle shows a tiny flame that dies out after ~2s.
 */
function tryIgniteTree(billboard) {
  if (billboard.userData.onFire || billboard.userData.falling) return;
  if (Math.random() < 0.25) {
    // Fizzle — tiny fire appears but doesn't catch
    const tinyScale = Math.max(0.3, (billboard.userData.treeHeight || 8) / 20);
    fireManager.ignite(
      billboard.position.clone(),
      { scale: tinyScale, fizzle: true }
    );
    showToast("Didn't catch — try again.");
  } else {
    igniteTree(billboard);
  }
}

function igniteFallenTree(ft) {
  if (!ft || ft.onFire) return;
  ft.onFire = true;

  const base = new THREE.Vector3();
  ft.group.getWorldPosition(base);
  const trunkLen  = ft.trunkLen  || 5;
  const trunkR    = ft.trunkR    || 0.2;
  const fallDir   = ft.fallDir   || 1;

  // Spread fire along the trunk — one segment every ~2.5m, staggered 1.2s apart
  const numSegs   = Math.max(2, Math.round(trunkLen / 2.5));
  let burnedOut   = 0;

  const onSegBurnOut = () => {
    burnedOut++;
    if (burnedOut >= numSegs) {
      ft.dispose();
      const idx = fallenTrees.indexOf(ft);
      if (idx !== -1) fallenTrees.splice(idx, 1);
      rebuildFallenMeshList();
    }
  };

  for (let i = 0; i < numSegs; i++) {
    const t       = i / Math.max(1, numSegs - 1);
    const offset  = trunkR + t * trunkLen;
    const firePos = new THREE.Vector3(
      base.x + offset * fallDir,
      0,
      base.z
    );
    const delay   = i * 1200;
    const audioId = ++_fireAudioId;
    setTimeout(() => {
      if (!ft.onFire) return; // fire was extinguished
      fireManager.ignite(
        firePos,
        { scale: 0.55, growTo: 0.85, growRate: 0.025, sourceRadius: 2.0 },
        () => { fireAudio.stop(audioId); onSegBurnOut(); }
      );
      fireAudio.start(audioId, firePos, 0.18);
    }, delay);
  }
}

function strikeLitMatch(side) {
  matchState.lit          = true;
  matchState.burnRemaining = 30;
  hands.dropItem(side);
  matchState.mesh = makeLitMatchTool();
  hands.holdItem(side, matchState.mesh);
  showToast('Match lit! Swing at a tree to set it on fire.');
  hands.reach(side);
}

// ── Campfire system ────────────────────────────────────────────────
const campfires = []; // { group, pos, lit, light, fireId }

function isNearAnyFire() {
  for (const cf of campfires) {
    if (cf.lit && camera.position.distanceTo(cf.pos) < 7) return true;
  }
  return fireManager.nearFire(camera.position, 6);
}

// ── Fire pit — multi-step build ────────────────────────────────────
function nearPitAtStage(stage) {
  return campfires.find(cf => cf.stage === stage && camera.position.distanceTo(cf.pos) < 3);
}

function digHole() {
  if (state.equippedTool !== 'Shovel') { showToast('Equip Shovel to dig.'); return; }
  const fwd = new THREE.Vector3();
  camera.getWorldDirection(fwd); fwd.y = 0; fwd.normalize();
  const pos = camera.position.clone().addScaledVector(fwd, 2.5);
  pos.y = 0;

  const g = new THREE.Group();
  const dirt = new THREE.Mesh(
    new THREE.CircleGeometry(0.58, 12),
    new THREE.MeshLambertMaterial({ color: 0x3d2b1a })
  );
  dirt.rotation.x = -Math.PI / 2; dirt.position.y = 0.01;
  g.add(dirt);
  // Small raised rim
  const rim = new THREE.Mesh(
    new THREE.TorusGeometry(0.58, 0.05, 5, 14),
    new THREE.MeshLambertMaterial({ color: 0x5a3a20 })
  );
  rim.rotation.x = -Math.PI / 2; rim.position.y = 0.03;
  g.add(rim);

  g.position.copy(pos);
  worldScene.add(g);
  campfires.push({ group: g, pos: pos.clone(), stage: 'dug', lit: false, light: null, fireId: null });
  hands.reach(1);
  showToast('Hole dug — place rocks around it');
  state.journal.push({ day: state.time.day, text: 'Dug a fire pit.' });
  saveState();
}

function addRocksToPit(cf) {
  // Gather rocks from the ground nearby — no inventory cost
  const ringMat = new THREE.MeshLambertMaterial({ color: 0x888877 });
  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * Math.PI * 2;
    const s = new THREE.Mesh(new THREE.SphereGeometry(0.14, 5, 4), ringMat);
    s.position.set(Math.cos(a) * 0.55, 0.08, Math.sin(a) * 0.55);
    s.scale.y = 0.55;
    cf.group.add(s);
  }
  cf.stage = 'rocked';
  showToast('Rocks placed — add 2 logs');
  saveState();
}

function addLogsToPit(cf) {
  const logs = state.inventory.find(i => i.name === 'Log');
  if (!logs || logs.quantity < 2) { showToast('Need 2 Logs.'); return; }
  logs.quantity -= 2;
  if (logs.quantity <= 0) state.inventory = state.inventory.filter(i => i.name !== 'Log');

  const ash = new THREE.Mesh(
    new THREE.CircleGeometry(0.45, 12),
    new THREE.MeshLambertMaterial({ color: 0x242420 })
  );
  ash.rotation.x = -Math.PI / 2; ash.position.y = 0.02;
  cf.group.add(ash);

  const logMat = new THREE.MeshLambertMaterial({ color: 0x6b4c2a });
  [0, 0.9].forEach((rotY, i) => {
    const log = new THREE.Mesh(new THREE.CylinderGeometry(0.058, 0.078, 1.0, 6), logMat);
    log.rotation.z = Math.PI / 2;
    log.rotation.y = rotY;
    log.position.y = 0.07 + i * 0.045;
    cf.group.add(log);
  });
  cf.stage = 'logged';
  consumeNearestFallenTree();
  consumeNearestFallenTree(); // 2 logs used
  showToast('Logs placed — light the fire!');
  saveState();
}

let _firePitCooldown = 0;

function handleFirePitInteract() {
  if (_firePitCooldown > 0) return false;
  // Stage 2: rocked → add logs
  const rocked = nearPitAtStage('rocked');
  if (rocked) { addLogsToPit(rocked); _firePitCooldown = 0.8; return true; }
  // Stage 1: dug → add rocks
  const dug = nearPitAtStage('dug');
  if (dug) { addRocksToPit(dug); _firePitCooldown = 0.8; return true; }
  // Stage 0: dig a new hole (shovel required)
  if (state.equippedTool === 'Shovel') { digHole(); _firePitCooldown = 0.8; return true; }
  return false;
}

// ── Primitive fire starting ────────────────────────────────────────
// Bow-drill: rub two sticks together. Rapid arm swings while near unlit fire.
const bowDrillState = { swings: 0, cooldown: 0 };

function tryBowDrill(side) {
  // Need 2 sticks in inventory, near an unlit fire pit
  const sticks = state.inventory.find(i => i.name === 'Stick');
  if (!sticks || sticks.quantity < 2) return false;
  const nearUnlit = campfires.find(cf => !cf.lit && cf.stage === 'logged' && camera.position.distanceTo(cf.pos) < 3);
  if (!nearUnlit) return false;

  bowDrillState.swings++;
  hands.chop(side);
  showToast(`Drilling... (${bowDrillState.swings}/8)`);

  if (bowDrillState.swings >= 8) {
    bowDrillState.swings = 0;
    // 70% success
    if (Math.random() < 0.7) {
      // Consume one stick as tinder
      sticks.quantity--;
      if (sticks.quantity <= 0) state.inventory = state.inventory.filter(i => i.name !== 'Stick');
      lightCampfireAt(nearUnlit.pos);
      showToast('Fire started with bow drill!');
      state.journal.push({ day: state.time.day, text: 'Started fire with a bow drill.' });
    } else {
      showToast('Almost... try again.');
    }
    saveState();
  }
  return true;
}

// Flint + stone: strike them together near unlit fire. Instant but needs Stone in inventory.
function tryFlintStrike() {
  const stone = state.inventory.find(i => i.name === 'Stone');
  if (!stone) return false;
  const nearUnlit = campfires.find(cf => !cf.lit && cf.stage === 'logged' && camera.position.distanceTo(cf.pos) < 3);
  if (!nearUnlit) return false;

  // 40% chance per strike
  if (Math.random() < 0.4) {
    lightCampfireAt(nearUnlit.pos);
    showToast('Sparked it with flint!');
    state.journal.push({ day: state.time.day, text: 'Started fire with flint and stone.' });
  } else {
    showToast('Sparks... not yet. Try again.');
  }
  saveState();
  return true;
}

function digFirePit() {
  if (!canDigFirePit()) { showToast('Need 2 Logs to build campfire.'); return; }
  const fwd = new THREE.Vector3();
  camera.getWorldDirection(fwd); fwd.y = 0; fwd.normalize();
  const pos = camera.position.clone().addScaledVector(fwd, 3.5);
  pos.y = 0;

  const logItem = state.inventory.find(i => i.name === 'Log');
  logItem.quantity -= 2;
  if (logItem.quantity <= 0) state.inventory = state.inventory.filter(i => i.name !== 'Log');

  const group = _makeCampfireGroup();
  group.position.copy(pos);
  worldScene.add(group);
  campfires.push({ group, pos: pos.clone(), lit: false, light: null, fireId: null });
  hands.reach(1);
  showToast('Fire pit ready — light it with a match!');
  state.journal.push({ day: state.time.day, text: 'Built a campfire.' });
  saveState();
}

function _makeCampfireGroup() {
  const g = new THREE.Group();
  const ringMat = new THREE.MeshLambertMaterial({ color: 0x888877 });
  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * Math.PI * 2;
    const stone = new THREE.Mesh(new THREE.SphereGeometry(0.14, 5, 4), ringMat);
    stone.position.set(Math.cos(a) * 0.62, 0.08, Math.sin(a) * 0.62);
    stone.scale.y = 0.55;
    stone.castShadow = true;
    g.add(stone);
  }
  const ash = new THREE.Mesh(
    new THREE.CircleGeometry(0.52, 12),
    new THREE.MeshLambertMaterial({ color: 0x242420 })
  );
  ash.rotation.x = -Math.PI / 2; ash.position.y = 0.02;
  g.add(ash);
  const logMat = new THREE.MeshLambertMaterial({ color: 0x6b4c2a });
  [-0.3, 0.3].forEach((offZ, i) => {
    const log = new THREE.Mesh(new THREE.CylinderGeometry(0.058, 0.078, 1.0, 6), logMat);
    log.rotation.z = Math.PI / 2;
    log.rotation.y = i * 0.9;
    log.position.y = 0.07 + i * 0.045;
    log.castShadow = true;
    g.add(log);
  });
  return g;
}

function lightCampfireAt(pos) {
  const cf = campfires.find(c => !c.lit && c.stage === 'logged' && c.pos.distanceTo(pos) < 2.5);
  if (!cf) return false;
  cf.lit = true;
  const audioId = ++_fireAudioId;
  cf.fireId = audioId;
  fireManager.ignite(
    cf.pos.clone(),
    { scale: 0.28, growTo: 0.38, growRate: 0.008, sourceRadius: 0.3 },
    () => {
      cf.lit = false; cf.fireId = null;
      if (cf.light) { worldScene.remove(cf.light); cf.light = null; }
      fireAudio.stop(audioId);
    }
  );
  const light = new THREE.PointLight(0xff6600, 6, 10);
  light.position.set(cf.pos.x, 0.8, cf.pos.z);
  worldScene.add(light);
  cf.light = light;
  fireAudio.start(audioId, cf.pos, 0.38);
  showToast('Campfire lit!');
  state.journal.push({ day: state.time.day, text: 'Lit the campfire.' });
  saveState();
  return true;
}

// ── Building system ────────────────────────────────────────────────
const buildPosts    = []; // { group, pos:Vector3, height, data }
const beamMeshes    = []; // { mesh, data } — data refs state.world.structures entry
const canvasMeshes  = []; // { mesh, data } — data refs state.world.structures entry
let _beamFirstPost = null;
let _canvasMode    = false;
const _canvasCorners = [];
let _buildCooldown = 0;

function _spawnPostMesh(x, z, height, data) {
  const pos = new THREE.Vector3(x, 0, z);
  const g = new THREE.Group();
  const mat = new THREE.MeshLambertMaterial({ color: 0x6b4c2a });
  const segments = Math.round(height / 1.5);
  for (let i = 0; i < segments; i++) {
    const r = i === 0 ? 0.13 : 0.11;
    const seg = new THREE.Mesh(new THREE.CylinderGeometry(r - 0.02, r, 1.5, 8), mat);
    seg.position.y = i * 1.5 + 0.75; seg.castShadow = true;
    g.add(seg);
  }
  const hole = new THREE.Mesh(new THREE.CircleGeometry(0.18, 8),
    new THREE.MeshLambertMaterial({ color: 0x2a1a0a }));
  hole.rotation.x = -Math.PI / 2; hole.position.y = 0.01;
  g.add(hole);
  g.position.copy(pos);
  worldScene.add(g);
  buildPosts.push({ group: g, pos: pos.clone(), height, data });
}

function _spawnBeamMesh(ax, ay, az, bx, by, bz, data) {
  const pA = new THREE.Vector3(ax, ay, az);
  const pB = new THREE.Vector3(bx, by, bz);
  const dist = pA.distanceTo(pB);
  const mid  = pA.clone().add(pB).multiplyScalar(0.5);
  const mat  = new THREE.MeshLambertMaterial({ color: 0x5a3a1a });
  const beam = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.09, dist, 8), mat);
  beam.position.copy(mid);
  beam.quaternion.setFromUnitVectors(new THREE.Vector3(0,1,0), pB.clone().sub(pA).normalize());
  beam.castShadow = true;
  worldScene.add(beam);
  if (data) beamMeshes.push({ mesh: beam, data });
  return beam;
}

function _spawnCanvasMesh(corners) {
  const [c0, c1, c2, c3] = corners.map(c => new THREE.Vector3(...c));
  const verts = new Float32Array([
    c0.x,c0.y,c0.z, c1.x,c1.y,c1.z, c2.x,c2.y,c2.z,
    c0.x,c0.y,c0.z, c2.x,c2.y,c2.z, c3.x,c3.y,c3.z,
  ]);
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(verts, 3));
  geo.computeVertexNormals();
  const mesh = new THREE.Mesh(geo, new THREE.MeshLambertMaterial({
    color: 0x8b7355, side: THREE.DoubleSide, transparent: true, opacity: 0.88,
  }));
  worldScene.add(mesh);
  return mesh;
}

function restoreStructures() {
  for (const s of state.world.structures) {
    if (s.type === 'post')   _spawnPostMesh(s.x, s.z, s.height, s);
    if (s.type === 'beam')   _spawnBeamMesh(s.ax, s.ay, s.az, s.bx, s.by, s.bz, s);
    if (s.type === 'canvas') { const m = _spawnCanvasMesh(s.corners); canvasMeshes.push({ mesh: m, data: s }); }
  }
  for (const t of state.world.tents) {
    const geo  = _makeTentGeometry();
    const mesh = new THREE.Mesh(geo, new THREE.MeshLambertMaterial({ color: 0x4a6741, side: THREE.DoubleSide }));
    mesh.position.set(t.x, 0, t.z);
    mesh.rotation.y = t.rot;
    mesh.castShadow = true;
    worldScene.add(mesh);
  }
  for (const b of state.world.beds) {
    _makeBedrollMesh(b.x, b.z);
  }
}

// ── Sync runtime state → state.world before every save ────────────
function syncWorldState() {
  // Campfires
  state.world.campfires = campfires.map(cf => ({
    x: cf.pos.x, z: cf.pos.z, stage: cf.stage || 'logged', lit: cf.lit,
  }));
  // Fallen trees
  state.world.fallenTrees = fallenTrees.map(ft => ({
    x: ft.group.position.x, z: ft.group.position.z,
    treeHeight: ft.trunkLen / 0.88, fallDir: ft.fallDir,
    logSections: ft.trunkMesh.userData.logSections,
    brokenBranches: ft.branches.map((b, i) => b.broken ? i : -1).filter(i => i >= 0),
  }));
  // Traps
  state.world.traps = trapManager.traps.map(t => ({
    type: t.type, x: t.x, z: t.z, rot: t.mesh.rotation.y,
    set: t.set, triggered: t.triggered, caught: t.caught, catchTimer: t.catchTimer,
  }));
  // Carcasses
  state.world.carcasses = carcasses.map(c => ({
    x: c.mesh.position.x, z: c.mesh.position.z, kind: c.kind, cutsLeft: c.cutsLeft,
  }));
  // World meat
  state.world.worldMeat = worldMeat.map(m => ({
    x: m.mesh.position.x, z: m.mesh.position.z, name: m.name,
  }));
  // World fish
  state.world.worldFish = worldFish.map(f => ({
    x: f.mesh.position.x, z: f.mesh.position.z, name: f.name,
  }));
  // Barrels
  state.world.barrels = barrelMeshes.map(b => ({
    x: b.data.x, z: b.data.z, water: b.data.water, boiled: b.data.boiled,
  }));
  // Lanterns
  state.world.lanterns = lanternMeshes.map(l => ({ x: l.data.x, z: l.data.z, on: l.data.on }));
}

// ── Restore all world objects from saved state ────────────────────
function restoreWorldState() {
  // Campfires
  for (const cf of state.world.campfires) {
    const pos = new THREE.Vector3(cf.x, 0, cf.z);
    const stage = cf.stage || 'logged';
    const g = new THREE.Group();

    // Build visual based on stage
    if (stage === 'dug') {
      const dirt = new THREE.Mesh(new THREE.CircleGeometry(0.58, 12),
        new THREE.MeshLambertMaterial({ color: 0x3d2b1a }));
      dirt.rotation.x = -Math.PI / 2; dirt.position.y = 0.01; g.add(dirt);
      const rim = new THREE.Mesh(new THREE.TorusGeometry(0.58, 0.05, 5, 14),
        new THREE.MeshLambertMaterial({ color: 0x5a3a20 }));
      rim.rotation.x = -Math.PI / 2; rim.position.y = 0.03; g.add(rim);
    } else if (stage === 'rocked' || stage === 'logged' || cf.lit) {
      // Rocks
      const ringMat = new THREE.MeshLambertMaterial({ color: 0x888877 });
      for (let i = 0; i < 8; i++) {
        const a = (i / 8) * Math.PI * 2;
        const s = new THREE.Mesh(new THREE.SphereGeometry(0.14, 5, 4), ringMat);
        s.position.set(Math.cos(a) * 0.55, 0.08, Math.sin(a) * 0.55);
        s.scale.y = 0.55; g.add(s);
      }
      if (stage === 'logged' || cf.lit) {
        const ash = new THREE.Mesh(new THREE.CircleGeometry(0.45, 12),
          new THREE.MeshLambertMaterial({ color: 0x242420 }));
        ash.rotation.x = -Math.PI / 2; ash.position.y = 0.02; g.add(ash);
        const logMat = new THREE.MeshLambertMaterial({ color: 0x6b4c2a });
        [0, 0.9].forEach((rotY, i) => {
          const log = new THREE.Mesh(new THREE.CylinderGeometry(0.058, 0.078, 1.0, 6), logMat);
          log.rotation.z = Math.PI / 2; log.rotation.y = rotY;
          log.position.y = 0.07 + i * 0.045; g.add(log);
        });
      }
    }

    g.position.copy(pos);
    worldScene.add(g);
    const cfObj = { group: g, pos: pos.clone(), stage, lit: false, light: null, fireId: null };
    campfires.push(cfObj);
    if (cf.lit) {
      // Re-light the fire
      cfObj.lit = true;
      cfObj.stage = 'logged';
      const audioId = ++_fireAudioId;
      cfObj.fireId = audioId;
      fireManager.ignite(pos.clone(),
        { scale: 0.28, growTo: 0.38, growRate: 0.008, sourceRadius: 0.3 },
        () => { cfObj.lit = false; cfObj.fireId = null; if (cfObj.light) { worldScene.remove(cfObj.light); cfObj.light = null; } fireAudio.stop(audioId); }
      );
      const light = new THREE.PointLight(0xff6622, 6, 16);
      light.position.set(pos.x, 1.2, pos.z);
      worldScene.add(light);
      cfObj.light = light;
      fireAudio.start(audioId, pos, 0.22);
    }
  }

  // Fallen trees
  if (state.world.fallenTrees) {
    for (const ft of state.world.fallenTrees) {
      const ft3 = new FallenTree(worldScene, ft.x, ft.z, ft.treeHeight, ft.fallDir);
      ft3.trunkMesh.userData.logSections = ft.logSections;
      if (ft.logSections <= 0) ft3.trunkMesh.visible = false;
      // Break saved branches
      if (ft.brokenBranches) {
        for (const bi of ft.brokenBranches) {
          if (ft3.branches[bi]) {
            ft3.branches[bi].broken = true;
            if (ft3.branches[bi].pivot.parent) ft3.branches[bi].pivot.parent.remove(ft3.branches[bi].pivot);
          }
        }
        ft3._rebuildMeshList();
      }
      // Also place a stump at the base
      const stump = new THREE.Mesh(
        new THREE.CylinderGeometry(0.25, 0.35, 0.45, 8),
        new THREE.MeshLambertMaterial({ color: 0x5a3a1a })
      );
      stump.position.set(ft.x, 0.22, ft.z);
      stump.castShadow = true;
      worldScene.add(stump);
      fallenTrees.push(ft3);
    }
    rebuildFallenMeshList();
  }

  // Traps
  if (state.world.traps) {
    for (const t of state.world.traps) {
      const trap = trapManager.place(t.type, t.x, t.z, t.rot);
      trap.set = t.set;
      trap.triggered = t.triggered;
      trap.caught = t.caught;
      trap.catchTimer = t.catchTimer;
      if (trap.triggered && trap.caught) trap.mesh.rotation.x = 0.35;
    }
  }

  // Carcasses
  if (state.world.carcasses) {
    for (const c of state.world.carcasses) {
      const kind = c.kind || 'deer';
      const color = kind === 'deer' ? 0x8b6914 : kind === 'rabbit' ? 0x9a8a6a : 0x7a6a4a;
      const mesh = new THREE.Mesh(
        new THREE.BoxGeometry(kind === 'deer' ? 1.2 : 0.5, 0.3, kind === 'deer' ? 0.6 : 0.3),
        new THREE.MeshLambertMaterial({ color })
      );
      mesh.position.set(c.x, 0.15, c.z);
      mesh.rotation.x = Math.PI / 2;
      worldScene.add(mesh);
      carcasses.push({ mesh, kind, cutsLeft: c.cutsLeft });
    }
  }

  // World meat
  if (state.world.worldMeat) {
    for (const m of state.world.worldMeat) {
      const mesh = makeMeatMesh(m.name);
      mesh.position.set(m.x, 0.04, m.z);
      worldScene.add(mesh);
      worldMeat.push({ mesh, name: m.name });
    }
  }

  // World fish
  if (state.world.worldFish) {
    for (const f of state.world.worldFish) {
      const color = FISH_COLORS[f.name] || 0x888866;
      const mesh = makeFishMesh(f.name);
      mesh.position.set(f.x, 0.12, f.z);
      mesh.rotation.set(0, Math.random() * Math.PI * 2, Math.PI / 2);
      worldScene.add(mesh);
      worldFish.push({ mesh, name: f.name });
    }
  }

  // Barrels
  if (state.world.barrels) {
    for (const b of state.world.barrels) {
      const mesh = _makeBarrelMesh(b.x, b.z);
      barrelMeshes.push({ mesh, data: b });
    }
  }
  // Lanterns
  if (state.world.lanterns) {
    for (const l of state.world.lanterns) {
      const mesh = _makeLanternWorldMesh(l.x, l.z);
      let light = null;
      if (l.on) {
        light = new THREE.PointLight(0xffcc66, 22, 30);
        light.position.set(l.x, 1.0, l.z);
        worldScene.add(light);
        if (mesh.userData.glassMat)  { mesh.userData.glassMat.color.setHex(0xffaa22); mesh.userData.glassMat.opacity = 0.35; }
        if (mesh.userData.flameMesh) mesh.userData.flameMesh.visible = true;
      }
      lanternMeshes.push({ mesh, light, data: l });
    }
  }
}

function nearestPost(maxDist = 3) {
  let best = null, bestDist = Infinity;
  for (const p of buildPosts) {
    const d = camera.position.distanceTo(p.pos);
    if (d < maxDist && d < bestDist) { best = p; bestDist = d; }
  }
  return best;
}

// Returns nearest standing tree as a beam anchor { pos, height, isTree: true }
function nearestTreeAnchor(maxDist = 3.5) {
  let best = null, bestDist = Infinity;
  for (const b of billboards) {
    if (b.userData.onFire || b.userData.falling || b.userData.isStump) continue;
    const d = camera.position.distanceTo(b.position);
    if (d < maxDist && d < bestDist) {
      best = { pos: b.position.clone(), height: 3.0, isTree: true, mesh: b };
      bestDist = d;
    }
  }
  return best;
}

// Returns nearest beam anchor — post or tree
function nearestAnchor(postDist = 2, treeDist = 3.5) {
  const post = nearestPost(postDist);
  const tree = nearestTreeAnchor(treeDist);
  if (post && tree) {
    const dp = camera.position.distanceTo(post.pos);
    const dt = camera.position.distanceTo(tree.pos);
    return dp <= dt ? post : tree;
  }
  return post || tree;
}

function placePost() {
  const logItem = state.inventory.find(i => i.name === 'Log');
  if (!logItem) { showToast('Need a Log to plant a post.'); return; }
  logItem.quantity--;
  if (logItem.quantity <= 0) state.inventory = state.inventory.filter(i => i.name !== 'Log');

  const fwd = new THREE.Vector3();
  camera.getWorldDirection(fwd); fwd.y = 0; fwd.normalize();
  const pos = camera.position.clone().addScaledVector(fwd, 2.0);
  pos.y = 0;

  const g = new THREE.Group();
  const mat = new THREE.MeshLambertMaterial({ color: 0x6b4c2a });
  const seg = new THREE.Mesh(new THREE.CylinderGeometry(0.1, 0.13, 1.5, 8), mat);
  seg.position.y = 0.75; seg.castShadow = true;
  g.add(seg);
  // Small hole ring at base
  const hole = new THREE.Mesh(new THREE.CircleGeometry(0.18, 8),
    new THREE.MeshLambertMaterial({ color: 0x2a1a0a }));
  hole.rotation.x = -Math.PI / 2; hole.position.y = 0.01;
  g.add(hole);
  g.position.copy(pos);
  worldScene.add(g);
  const postData = { type: 'post', x: pos.x, z: pos.z, height: 1.5 };
  buildPosts.push({ group: g, pos: pos.clone(), height: 1.5, data: postData });
  state.world.structures.push(postData);
  consumeNearestFallenTree();
  hands.reach(1);
  showToast('Post planted! Shovel+Log near post to stack higher.');
  state.skills.building = Math.min(99, (state.skills.building || 0) + 1);
  state.journal.push({ day: state.time.day, text: 'Planted a post.' });
  saveState();
}

function stackLog(post) {
  const logItem = state.inventory.find(i => i.name === 'Log');
  if (!logItem) { showToast('Need a Log.'); return; }
  if (post.height >= 6.0) { showToast('Post is at max height.'); return; }
  logItem.quantity--;
  if (logItem.quantity <= 0) state.inventory = state.inventory.filter(i => i.name !== 'Log');

  const SEG = 1.5;
  const mat = new THREE.MeshLambertMaterial({ color: 0x6b4c2a });
  const seg = new THREE.Mesh(new THREE.CylinderGeometry(0.09, 0.11, SEG, 8), mat);
  seg.position.y = post.height + SEG / 2; seg.castShadow = true;
  post.group.add(seg);
  post.height += SEG;

  if (post.data) post.data.height = post.height;
  else {
    const saved = state.world.structures.find(s => s.type === 'post' && Math.abs(s.x - post.pos.x) < 0.1 && Math.abs(s.z - post.pos.z) < 0.1);
    if (saved) saved.height = post.height;
  }
  consumeNearestFallenTree();
  hands.reach(1);
  showToast(`Post now ${post.height.toFixed(1)}m tall.`);
  state.skills.building = Math.min(99, (state.skills.building || 0) + 1);
  saveState();
}

// ── Height picker for beam endpoints ──────────────────────────────
let _heightPick = null; // { anchor, height, ring, phase: 'first'|'second' }
const _HEIGHT_STEP = 0.5;
const _HEIGHT_MIN  = 0.5;

function _makeHeightRing() {
  const geo = new THREE.TorusGeometry(0.35, 0.04, 8, 24);
  const mat = new THREE.MeshBasicMaterial({ color: 0xffcc00, transparent: true, opacity: 0.85 });
  const ring = new THREE.Mesh(geo, mat);
  ring.rotation.x = Math.PI / 2;
  worldScene.add(ring);
  return ring;
}

function startHeightPick(anchor, phase) {
  // Default height: post top or tree mid-trunk
  const defaultH = anchor.isTree ? 3.0 : anchor.height;
  const maxH = anchor.isTree ? 6.0 : anchor.height;
  const ring = _makeHeightRing();
  ring.position.set(anchor.pos.x, defaultH, anchor.pos.z);
  _heightPick = { anchor, height: defaultH, maxH, ring, phase };
  const label = anchor.isTree ? 'tree' : 'post';
  showToast(`Pick height on ${label}: 🔨 up, 🔥 down, ✓ confirm`);
}

function heightPickUp() {
  if (!_heightPick) return;
  _heightPick.height = Math.min(_heightPick.maxH, _heightPick.height + _HEIGHT_STEP);
  _heightPick.ring.position.y = _heightPick.height;
  showToast(`Height: ${_heightPick.height.toFixed(1)}m`);
}

function heightPickDown() {
  if (!_heightPick) return;
  _heightPick.height = Math.max(_HEIGHT_MIN, _heightPick.height - _HEIGHT_STEP);
  _heightPick.ring.position.y = _heightPick.height;
  showToast(`Height: ${_heightPick.height.toFixed(1)}m`);
}

function heightPickConfirm() {
  if (!_heightPick) return;
  const { anchor, height, ring, phase } = _heightPick;
  worldScene.remove(ring);
  // Store chosen height on the anchor
  const finalAnchor = { pos: anchor.pos.clone(), height, isTree: anchor.isTree, mesh: anchor.mesh };
  _heightPick = null;

  if (phase === 'first') {
    _beamFirstPost = finalAnchor;
    showToast('First point set — walk to another post or tree and press 🔨.');
  } else {
    completeBeam(finalAnchor);
  }
}

function cancelHeightPick() {
  if (!_heightPick) return;
  worldScene.remove(_heightPick.ring);
  _heightPick = null;
  showToast('Cancelled.');
}

function startBeam(anchor) {
  _beamFirstPost = anchor;
  const label = anchor.isTree ? 'tree' : 'post';
  showToast(`First ${label} selected — walk to another post or tree and press 🔨.`);
}

function completeBeam(secondPost) {
  const logItem = state.inventory.find(i => i.name === 'Log');
  if (!logItem) { showToast('Need a Log.'); _beamFirstPost = null; return; }

  const pA = _beamFirstPost.pos.clone(); pA.y = _beamFirstPost.height;
  const pB = secondPost.pos.clone();      pB.y = secondPost.height;
  const dist = pA.distanceTo(pB);
  if (dist > 14) { showToast('Posts too far apart.'); _beamFirstPost = null; return; }

  logItem.quantity--;
  if (logItem.quantity <= 0) state.inventory = state.inventory.filter(i => i.name !== 'Log');

  const beamData = { type: 'beam', ax: pA.x, ay: pA.y, az: pA.z, bx: pB.x, by: pB.y, bz: pB.z };
  const beam = _spawnBeamMesh(pA.x, pA.y, pA.z, pB.x, pB.y, pB.z, beamData);
  state.world.structures.push(beamData);
  _beamFirstPost = null;
  consumeNearestFallenTree();
  hands.reach(1);
  showToast('Beam placed!');
  state.skills.building = Math.min(99, (state.skills.building || 0) + 1);
  state.journal.push({ day: state.time.day, text: 'Placed a beam.' });
  saveState();
}

function startCanvas() {
  _canvasMode = true;
  _canvasCorners.length = 0;
  state.equippedTool = null;
  hands.dropItem(1);
  showToast('Walk to each post and press 🔨 — need 4 corners.');
}

function addCanvasCorner() {
  // Post top
  const post = nearestPost(3.5);
  if (post) {
    _canvasCorners.push(post.pos.clone().setY(post.height));
    showToast(`Corner ${_canvasCorners.length}/4 — post`);
    if (_canvasCorners.length >= 4) placeCanvas();
    return;
  }
  // Tree trunk
  const tree = billboards.find(b =>
    !b.userData.onFire && !b.userData.falling &&
    camera.position.distanceTo(b.position) < 3.5
  );
  if (tree) {
    _canvasCorners.push(new THREE.Vector3(tree.position.x, 2.5, tree.position.z));
    showToast(`Corner ${_canvasCorners.length}/4 — tree`);
    if (_canvasCorners.length >= 4) placeCanvas();
    return;
  }
  showToast('No anchor here — stand near a post or tree.');
}

function placeCanvas() {
  const item = state.inventory.find(i => i.name === 'Canvas');
  if (item) {
    item.quantity--;
    if (item.quantity <= 0) state.inventory = state.inventory.filter(i => i.name !== 'Canvas');
  }

  const [c0, c1, c2, c3] = _canvasCorners;
  const verts = new Float32Array([
    c0.x,c0.y,c0.z, c1.x,c1.y,c1.z, c2.x,c2.y,c2.z,
    c0.x,c0.y,c0.z, c2.x,c2.y,c2.z, c3.x,c3.y,c3.z,
  ]);
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(verts, 3));
  geo.computeVertexNormals();
  const mesh = new THREE.Mesh(geo, new THREE.MeshLambertMaterial({
    color: 0x8b7355, side: THREE.DoubleSide, transparent: true, opacity: 0.88,
  }));
  worldScene.add(mesh);

  const canvasEntry = { type: 'canvas', corners: _canvasCorners.map(c => [c.x, c.y, c.z]) };
  state.world.structures.push(canvasEntry);
  canvasMeshes.push({ mesh, data: canvasEntry });
  _canvasMode = false;
  _canvasCorners.length = 0;
  state.equippedTool = null;
  hands.dropItem(1);
  showToast('Canvas stretched!');
  state.skills.building = Math.min(99, (state.skills.building || 0) + 1);
  state.journal.push({ day: state.time.day, text: 'Stretched a canvas tarp.' });
  saveState();
}

function removeNearestCanvas() {
  if (canvasMeshes.length === 0) { showToast('No canvas placed.'); return; }
  let best = null, bestDist = Infinity;
  for (const cm of canvasMeshes) {
    const cs = cm.data.corners;
    const mx = cs.reduce((s, c) => s + c[0], 0) / cs.length;
    const mz = cs.reduce((s, c) => s + c[2], 0) / cs.length;
    const d = camera.position.distanceTo(new THREE.Vector3(mx, 0, mz));
    if (d < bestDist) { best = cm; bestDist = d; }
  }
  worldScene.remove(best.mesh);
  canvasMeshes.splice(canvasMeshes.indexOf(best), 1);
  const si = state.world.structures.indexOf(best.data);
  if (si !== -1) state.world.structures.splice(si, 1);
  const existing = state.inventory.find(i => i.name === 'Canvas');
  if (existing) existing.quantity++; else state.inventory.push({ name: 'Canvas', quantity: 1 });
  showToast('Canvas taken down — returned to inventory.');
  saveState();
}

function removeNearestStructure() {
  const RANGE = 5;
  let bestType = null, bestDist = RANGE, bestRef = null;

  // Check posts
  for (const p of buildPosts) {
    const d = camera.position.distanceTo(p.pos);
    if (d < bestDist) { bestDist = d; bestType = 'post'; bestRef = p; }
  }
  // Check beams
  for (const b of beamMeshes) {
    const d = camera.position.distanceTo(b.mesh.position);
    if (d < bestDist) { bestDist = d; bestType = 'beam'; bestRef = b; }
  }
  // Check canvas
  for (const cm of canvasMeshes) {
    const cs = cm.data.corners;
    const mx = cs.reduce((s, c) => s + c[0], 0) / cs.length;
    const mz = cs.reduce((s, c) => s + c[2], 0) / cs.length;
    const d = camera.position.distanceTo(new THREE.Vector3(mx, 0, mz));
    if (d < bestDist) { bestDist = d; bestType = 'canvas'; bestRef = cm; }
  }

  if (!bestRef) { showToast('No structure nearby.'); return; }

  if (bestType === 'post') {
    worldScene.remove(bestRef.group);
    buildPosts.splice(buildPosts.indexOf(bestRef), 1);
    const si = bestRef.data ? state.world.structures.indexOf(bestRef.data) : state.world.structures.findIndex(s => s.type === 'post' && Math.abs(s.x - bestRef.pos.x) < 0.1 && Math.abs(s.z - bestRef.pos.z) < 0.1);
    if (si !== -1) state.world.structures.splice(si, 1);
    const logItem = state.inventory.find(i => i.name === 'Log');
    const logsBack = Math.max(1, Math.round(bestRef.height / 1.5));
    if (logItem) logItem.quantity += logsBack; else state.inventory.push({ name: 'Log', quantity: logsBack });
    showToast(`Post removed — +${logsBack} Log${logsBack > 1 ? 's' : ''}.`);
  } else if (bestType === 'beam') {
    worldScene.remove(bestRef.mesh);
    beamMeshes.splice(beamMeshes.indexOf(bestRef), 1);
    const si = state.world.structures.indexOf(bestRef.data);
    if (si !== -1) state.world.structures.splice(si, 1);
    const logItem = state.inventory.find(i => i.name === 'Log');
    if (logItem) logItem.quantity++; else state.inventory.push({ name: 'Log', quantity: 1 });
    showToast('Beam removed — +1 Log.');
  } else if (bestType === 'canvas') {
    worldScene.remove(bestRef.mesh);
    canvasMeshes.splice(canvasMeshes.indexOf(bestRef), 1);
    const si = state.world.structures.indexOf(bestRef.data);
    if (si !== -1) state.world.structures.splice(si, 1);
    const existing = state.inventory.find(i => i.name === 'Canvas');
    if (existing) existing.quantity++; else state.inventory.push({ name: 'Canvas', quantity: 1 });
    showToast('Canvas taken down — returned to inventory.');
  }
  saveState();
}

function handleBuildInteract() {
  if (_buildCooldown > 0) return false;

  if (_canvasMode) { addCanvasCorner(); _buildCooldown = 0.5; return true; }

  // Height picker active — 🔨 = raise
  if (_heightPick) {
    heightPickUp(); _buildCooldown = 0.3; return true;
  }

  const nearPost   = nearestPost(2);
  const anchor     = nearestAnchor(2, 3.5);
  const hasLog     = !!state.inventory.find(i => i.name === 'Log');
  const hasShovel  = state.equippedTool === 'Shovel';
  const hasCanvas  = !!state.inventory.find(i => i.name === 'Canvas');

  // Beam: complete — enter height pick for second endpoint
  if (_beamFirstPost && anchor && hasLog && !hasShovel) {
    const sameTree = anchor.isTree && _beamFirstPost.isTree && anchor.mesh === _beamFirstPost.mesh;
    const samePost = !anchor.isTree && !_beamFirstPost.isTree && anchor.pos.distanceTo(_beamFirstPost.pos) < 0.2;
    if (sameTree || samePost) {
      _beamFirstPost = null; showToast('Beam cancelled.'); _buildCooldown = 0.4; return true;
    }
    startHeightPick(anchor, 'second'); _buildCooldown = 0.3; return true;
  }
  // Beam: start — enter height pick for first endpoint
  if (anchor && hasLog && !hasShovel) {
    startHeightPick(anchor, 'first'); _buildCooldown = 0.3; return true;
  }
  // Stack: near post + shovel + log (posts only, not trees)
  if (nearPost && hasLog && hasShovel) {
    stackLog(nearPost); _buildCooldown = 0.6; return true;
  }
  // New post: log in hand, no nearby post or tree, not near a fire pit needing logs
  if (hasLog && !anchor && !hasShovel && !nearPitAtStage('rocked')) {
    placePost(); _buildCooldown = 0.8; return true;
  }

  return false;
}

// ── Tent system ────────────────────────────────────────────────────
function placeTent() {
  const tentItem = state.inventory.find(i => i.name === 'Tent');
  if (!tentItem) return;
  const fwd = new THREE.Vector3();
  camera.getWorldDirection(fwd); fwd.y = 0; fwd.normalize();
  const pos = camera.position.clone().addScaledVector(fwd, 3.5);

  const geo = _makeTentGeometry();
  const mat = new THREE.MeshLambertMaterial({ color: 0x4a6741, side: THREE.DoubleSide });
  const mesh = new THREE.Mesh(geo, mat);
  const rot = Math.atan2(-fwd.x, -fwd.z);
  mesh.position.set(pos.x, 0, pos.z);
  mesh.rotation.y = rot;
  mesh.castShadow = true;
  worldScene.add(mesh);

  tentItem.quantity--;
  if (tentItem.quantity <= 0) state.inventory = state.inventory.filter(i => i.name !== 'Tent');
  state.world.tents.push({ x: pos.x, z: pos.z, rot });
  state.equippedTool = null;
  hands.dropItem(1);
  showToast('Tent set up!');
  state.journal.push({ day: state.time.day, text: 'Set up tent.' });
  saveState();
}

function _makeTentGeometry() {
  const w = 1.1, h = 1.5, d = 2.5;
  const v = new Float32Array([
    // Left roof panel
    -w, 0, -d,   0, h, -d,   0, h,  d,
    -w, 0, -d,   0, h,  d,  -w, 0,  d,
    // Right roof panel
     w, 0, -d,   0, h,  d,   0, h, -d,
     w, 0, -d,   w, 0,  d,   0, h,  d,
    // Front triangle
    -w, 0, -d,   w, 0, -d,   0, h, -d,
    // Back triangle
    -w, 0,  d,   0, h,  d,   w, 0,  d,
    // Floor
    -w, 0.01, -d,   w, 0.01, -d,   w, 0.01,  d,
    -w, 0.01, -d,   w, 0.01,  d,  -w, 0.01,  d,
  ]);
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(v, 3));
  geo.computeVertexNormals();
  return geo;
}

// ── Beds ──────────────────────────────────────────────────────────
function _makeBedrollMesh(x, z) {
  const g = new THREE.Group();
  // Bedroll — flat rounded rectangle on ground
  const mat = new THREE.MeshLambertMaterial({ color: 0x6a5a3a });
  const roll = new THREE.Mesh(new THREE.BoxGeometry(0.8, 0.06, 1.8), mat);
  roll.position.y = 0.03;
  roll.castShadow = true;
  g.add(roll);
  // Pillow
  const pillow = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.1, 0.3),
    new THREE.MeshLambertMaterial({ color: 0x7a6a4a }));
  pillow.position.set(0, 0.08, -0.65);
  g.add(pillow);
  g.position.set(x, 0, z);
  worldScene.add(g);
  return g;
}

function markBed() {
  const x = camera.position.x;
  const z = camera.position.z;
  state.world.beds.push({ x, z });
  _makeBedrollMesh(x, z);
  showToast('Bed spot marked!');
  state.journal.push({ day: state.time.day, text: 'Marked a sleeping spot.' });
  saveState();
}

document.getElementById('mark-bed-btn')?.addEventListener('click', () => markBed());
document.getElementById('mark-bed-btn')?.addEventListener('touchend', e => { e.preventDefault(); markBed(); });
document.getElementById('structure-remove-btn')?.addEventListener('click', () => removeNearestStructure());
document.getElementById('structure-remove-btn')?.addEventListener('touchend', e => { e.preventDefault(); removeNearestStructure(); });

// ── Sleep ──────────────────────────────────────────────────────────
const _sleepFade = document.getElementById('sleep-fade');
let _sleeping = false;

function nearestSleepSpot(maxDist = 4) {
  for (const t of state.world.tents) {
    const dx = camera.position.x - t.x;
    const dz = camera.position.z - t.z;
    if (Math.sqrt(dx * dx + dz * dz) < maxDist) return t;
  }
  for (const b of state.world.beds) {
    const dx = camera.position.x - b.x;
    const dz = camera.position.z - b.z;
    if (Math.sqrt(dx * dx + dz * dz) < maxDist) return b;
  }
  return null;
}

// Keep old name as alias for button label checks
function nearestTent(maxDist = 4) { return nearestSleepSpot(maxDist); }

function trySleep() {
  if (!nearestSleepSpot()) return false;
  if (_sleeping) return true;
  _sleeping = true;
  // Fade to black
  _sleepFade.style.display = 'block';
  requestAnimationFrame(() => { _sleepFade.style.opacity = '1'; });
  setTimeout(() => {
    // Advance time to 8am next day
    state.time.hour   = 8;
    state.time.minute = 0;
    state.time.day++;
    // Restore sleep stat fully, top up other vitals a bit
    state.player.sleep   = 100;
    state.player.stamina = Math.min(100, state.player.stamina + 40);
    state.player.warmth  = Math.min(100, state.player.warmth  + 20);
    state.player.health  = Math.min(100, state.player.health  + 20);
    const spot = nearestSleepSpot();
    const sleepText = (state.world.tents.some(t => Math.abs(t.x - spot.x) < 0.5 && Math.abs(t.z - spot.z) < 0.5))
      ? 'Slept in the tent. Woke refreshed.' : 'Slept on the bedroll. Woke up sore but rested.';
    state.journal.push({ day: state.time.day, text: sleepText });
    saveState();
    // Fade back in
    _sleepFade.style.transition = 'opacity 2s ease';
    _sleepFade.style.opacity = '0';
    setTimeout(() => {
      _sleepFade.style.display = 'none';
      _sleepFade.style.transition = 'opacity 1.5s ease';
      _sleeping = false;
      showToast('Morning. Day ' + state.time.day + '.');
    }, 2000);
  }, 1800);
  return true;
}

// ── Vitals drain ───────────────────────────────────────────────────
let _warnCooldown = 0;

function updateVitals(delta) {
  const p  = state.player;
  const h  = state.time.hour;
  const isNight = h < 5 || h > 21;
  const nearFire = isNearAnyFire();

  p.hunger  = Math.max(0, p.hunger  - 0.023 * delta);
  p.thirst  = Math.max(0, p.thirst  - 0.046 * delta);
  p.sleep   = Math.max(0, p.sleep   - 0.035 * delta);

  const moving = player.velocity.lengthSq() > 0.01;
  if (moving) p.stamina = Math.max(0,   p.stamina - 1.0 * delta);
  else        p.stamina = Math.min(100, p.stamina + 1.5 * delta);

  if (nearFire) {
    p.warmth = Math.min(100, p.warmth + 4.0 * delta);
  } else if (isNight) {
    p.warmth = Math.max(0, p.warmth - 0.1 * delta);
  } else {
    p.warmth = Math.min(100, p.warmth + 0.05 * delta);
  }

  if (p.hunger < 10 || p.thirst < 10) {
    p.health = Math.max(0, p.health - 0.03 * delta);
  } else if (p.hunger > 50 && p.thirst > 50 && p.warmth > 40) {
    p.health = Math.min(100, p.health + 0.15 * delta);
  }

  _warnCooldown = Math.max(0, _warnCooldown - delta);
  if (_warnCooldown <= 0) {
    if      (p.hunger  < 15) { showToast('You are hungry...');        _warnCooldown = 25; }
    else if (p.thirst  < 15) { showToast('You are thirsty...');       _warnCooldown = 25; }
    else if (p.warmth  < 15) { showToast('You are freezing cold...');  _warnCooldown = 20; }
    else if (p.sleep   < 15) { showToast('You are exhausted...');      _warnCooldown = 30; }
    else if (p.health  < 20) { showToast('Your health is critical!');  _warnCooldown = 15; }
  }
}

// ── Swing / Chop detection ────────────────────────────────────────
const _prevPadY = { 1: 0, '-1': 0 };
let _chopCooldown = 0;

function updateSwingChop(delta) {
  _chopCooldown = Math.max(0, _chopCooldown - delta);

  for (const side of [1, -1]) {
    const curY = hands._state[side].padY;
    const vel  = (curY - _prevPadY[side]) / Math.max(delta, 0.008);
    _prevPadY[side] = curY;

    // Match: swing to strike OR to touch fire to tree
    if (vel > 3 && _chopCooldown <= 0 && state.equippedTool === 'Matches') {
      if (!matchState.lit) {
        strikeLitMatch(side);
        _chopCooldown = 0.6;
      } else {
        // Touch lit match to unlit campfire first
        let litCampfire = false;
        for (const cf of campfires) {
          if (!cf.lit && cf.stage === 'logged' && camera.position.distanceTo(cf.pos) < 3) {
            lightCampfireAt(cf.pos); _chopCooldown = 0.5; litCampfire = true; break;
          }
        }
        if (litCampfire) continue;

        // Touch lit match to tree
        raycaster.setFromCamera(new THREE.Vector2(0, 0), camera);
        const tHits = raycaster.intersectObjects(billboards);
        if (tHits.length > 0 && tHits[0].distance < REACH + 1) {
          tryIgniteTree(tHits[0].object);
          _chopCooldown = 0.5;
          continue;
        }
        // Fallen trees — broad search
        if (fallenMeshes.length > 0) {
          const camDir = new THREE.Vector3();
          camera.getWorldDirection(camDir);
          let bestFt = null, bestDot = 0.4;
          for (const mesh of fallenMeshes) {
            const mp = new THREE.Vector3(); mesh.getWorldPosition(mp);
            const dir = mp.clone().sub(camera.position);
            const dist = dir.length();
            if (dist > REACH * 2) continue;
            const dot = dir.normalize().dot(camDir);
            if (dot > bestDot) { bestFt = mesh.userData.fallenTree; bestDot = dot; }
          }
          if (bestFt) { igniteFallenTree(bestFt); _chopCooldown = 0.5; }
        }
      }
      continue;
    }

    // Bow-drill fire starting — rapid swings near unlit fire with sticks
    if (vel > 3 && _chopCooldown <= 0 && !state.equippedTool) {
      const nearUnlit = campfires.find(cf => !cf.lit && cf.stage === 'logged' && camera.position.distanceTo(cf.pos) < 3);
      const sticks = state.inventory.find(i => i.name === 'Stick');
      if (nearUnlit && sticks && sticks.quantity >= 2) {
        if (tryBowDrill(side)) { _chopCooldown = 0.35; continue; }
      }
    }

    // Knife butcher — swing at carcass to cut pieces off
    if (vel > 3 && _chopCooldown <= 0 && state.equippedTool === 'Knife') {
      let nearCarcass = null, nearDist = Infinity;
      for (const c of carcasses) {
        const d = camera.position.distanceTo(c.mesh.position);
        if (d < 2.5 && d < nearDist) { nearCarcass = c; nearDist = d; }
      }
      if (nearCarcass) {
        hands.chop(side);
        _chopCooldown = 0.5;
        butcherCarcass(nearCarcass);
        continue;
      }
    }

    // Knife attack — swing at nearby animal
    if (vel > 3 && _chopCooldown <= 0 && state.equippedTool === 'Knife') {
      const KNIFE_REACH = 2.8;
      let hit = null, hitDist = Infinity;
      for (const a of wildlifeManager.animals) {
        if (a.dead) continue;
        const d = camera.position.distanceTo(a.mesh.position);
        if (d < KNIFE_REACH && d < hitDist) { hit = a; hitDist = d; }
      }
      if (hit) {
        hands.chop(side);
        triggerShake(0.05, 0.2);
        _chopCooldown = 0.6;
        // Deer needs 3 hits, small animals 1 hit
        if (!hit.hitPoints) hit.hitPoints = (hit.kind === 'deer' ? 3 : 1);
        hit.hitPoints--;
        hit.state = 'flee'; // bolt on hit
        if (hit.hitPoints <= 0) {
          const loot = hit.kind === 'deer' ? ['Venison', 'Venison', 'Hide'] :
                       hit.kind === 'rabbit' ? ['Rabbit Meat'] :
                       hit.kind === 'squirrel' ? ['Squirrel Meat'] : [];
          // Drop carcass permanently
          const carcass = hit.mesh;
          hit.dead = true;
          wildlifeManager.animals = wildlifeManager.animals.filter(a => a !== hit);
          carcass.rotation.x = Math.PI / 2;
          carcass.position.y = 0.12;
          if (carcass.userData.billboard) carcass.userData.billboard.rotation.y = 0;
          // Register as butcherable
          const cuts = hit.kind === 'deer' ? 20 : 2;
          carcasses.push({ mesh: carcass, kind: hit.kind, cutsLeft: cuts });
          loot.forEach(item => receiveItem(item, null));
          showToast(`Got ${loot.join(', ')}!`);
          state.skills.hunting = Math.min(99, (state.skills.hunting || 0) + 1);
          saveState();
        } else {
          showToast(`Hit! ${hit.hitPoints} more to bring it down.`);
        }
      }
    }

    // Axe swing on held log — mark or split
    if (vel > 3 && _chopCooldown <= 0 && state.equippedTool === 'Axe' && heldLog) {
      if (markLogCut()) { hands.chop(side); triggerShake(0.03, 0.12); _chopCooldown = 0.5; continue; }
    }

    // Swing threshold: pad moved downward quickly (vel > 3/s) while axe equipped
    if (vel > 3 && _chopCooldown <= 0 && state.equippedTool === 'Axe') {
      // Center-screen ray = what the player is looking at
      raycaster.setFromCamera(new THREE.Vector2(0, 0), camera);

      // Check fallen-tree trunk/branch first
      if (fallenMeshes.length > 0) {
        // Try exact center-screen hit first, then fall back to closest in front
        let targetMesh = null;
        const ftHits = raycaster.intersectObjects(fallenMeshes);
        if (ftHits.length > 0 && ftHits[0].distance < REACH * 1.8) {
          targetMesh = ftHits[0].object;
        } else {
          // Broadened: find closest fallen mesh that's roughly in front
          const camDir = new THREE.Vector3();
          camera.getWorldDirection(camDir);
          let bestDot = 0.4; // within ~65° of look direction
          for (const mesh of fallenMeshes) {
            const mPos = new THREE.Vector3();
            mesh.getWorldPosition(mPos);
            const toMesh = mPos.clone().sub(camera.position);
            const dist = toMesh.length();
            if (dist > REACH * 1.8) continue;
            const dot = toMesh.normalize().dot(camDir);
            if (dot > bestDot) { targetMesh = mesh; bestDot = dot; }
          }
        }
        if (targetMesh) {
          const ft = targetMesh.userData.fallenTree;
          if (ft) {
            const result = targetMesh.userData.isTrunk ? ft.chopTrunk() : ft.chopBranch(targetMesh);
            if (result) {
              if (typeof result === 'string') {
                receiveItem(result, 'Chopped a log section off the trunk.');
                // If trunk fully chopped, remove the whole fallen tree
                if (ft.trunkMesh.userData.logSections <= 0) {
                  ft.dispose();
                  const ftIdx = fallenTrees.indexOf(ft);
                  if (ftIdx !== -1) fallenTrees.splice(ftIdx, 1);
                  rebuildFallenMeshList();
                }
              }
              else { spawnWorldBranch(result.worldPos, result.len, result.r); rebuildFallenMeshList(); }
              saveState();
            }
            hands.chop(side);
            triggerShake(0.03, 0.14);
            _chopCooldown = 0.45;
            return;
          }
        }
      }

      // Check standing trees
      const treeHits = raycaster.intersectObjects(billboards);
      if (treeHits.length > 0 && treeHits[0].distance < REACH) {
        chopTreeHit(treeHits[0].object, side);
        _chopCooldown = 0.45;
      }
    }
  }
}

function chopTreeHit(tree, side) {
  const id = tree.userData.treeId;
  if (state.world.treeHealth[id] === undefined) state.world.treeHealth[id] = 5;
  state.world.treeHealth[id]--;
  tree.userData.shake    = 0.7;
  tree.userData.shakeAmp = 0.18;
  hands.chop(side);
  triggerShake(0.04, 0.18);
  if (state.world.treeHealth[id] <= 0) {
    receiveItem('Log', null);
    startFall(tree);
  }
  saveState();
}

// ── Camera Shake ──────────────────────────────────────────────────
let _shakeIntensity = 0, _shakeDuration = 0, _shakeTime = 0;
function triggerShake(intensity, duration) {
  _shakeIntensity = intensity;
  _shakeDuration  = duration;
  _shakeTime      = 0;
}

// ── Dust puffs ────────────────────────────────────────────────────
const dustPuffs = []; // { mesh, age, duration }

function spawnDust(x, z) {
  const mat = new THREE.MeshBasicMaterial({
    color: 0x8b7355, transparent: true, opacity: 0.55, depthWrite: false,
  });
  const mesh = new THREE.Mesh(new THREE.CylinderGeometry(0.1, 0.1, 0.15, 8), mat);
  mesh.position.set(x, 0.07, z);
  worldScene.add(mesh);
  dustPuffs.push({ mesh, age: 0, duration: 1.1 });
}

// ── Fallen Trees ──────────────────────────────────────────────────
const fallingTrees = []; // fall animation state
const fallenTrees  = []; // FallenTree instances

function easeTreeFall(t) {
  // Brief hesitation at start, then gravity-like acceleration
  if (t < 0.06) return t * 0.08;
  const t2 = (t - 0.06) / 0.94;
  return 0.06 * 0.08 + t2 * t2 * t2 * 0.9952;
}

function startFall(tree) {
  const H      = tree.userData.treeHeight || 10;
  const baseX  = tree.position.x;
  const baseZ  = tree.position.z;
  const dir    = Math.random() > 0.5 ? 1 : -1;

  // Stop billboard from facing camera
  tree.userData.falling = true;

  fallingTrees.push({ tree, H, baseX, baseZ, dir, progress: 0 });

  // Remove from billboards so it's no longer chopable or camera-tracked
  const idx = billboards.indexOf(tree);
  if (idx !== -1) billboards.splice(idx, 1);
}

function updateFallingTrees(delta) {
  for (let i = fallingTrees.length - 1; i >= 0; i--) {
    const ft = fallingTrees[i];
    ft.progress += delta / 1.1; // 1.1s fall duration

    if (ft.progress >= 1) {
      ft.progress = 1;
      // Final position: lying on ground
      completeFall(ft);
      fallingTrees.splice(i, 1);
      continue;
    }

    const theta = easeTreeFall(ft.progress) * Math.PI / 2;
    // Rotate around base: center moves on an arc
    ft.tree.position.x = ft.baseX + Math.sin(theta) * (ft.H * 0.5) * ft.dir;
    ft.tree.position.y = Math.cos(theta) * (ft.H * 0.5);
    ft.tree.rotation.z = theta * ft.dir;
    // Keep facing camera laterally while falling
    ft.tree.rotation.y = Math.atan2(
      camera.position.x - ft.baseX,
      camera.position.z - ft.baseZ
    );
  }
}

function completeFall(ft) {
  const wasOnFire = ft.tree.userData.onFire;

  // Remove billboard from scene
  worldScene.remove(ft.tree);

  // Stump — charred black if burned, brown if chopped
  const stump = new THREE.Mesh(
    new THREE.CylinderGeometry(0.25, 0.35, 0.45, 8),
    new THREE.MeshLambertMaterial({ color: wasOnFire ? 0x1a1008 : 0x5a3a1a })
  );
  stump.position.set(ft.baseX, 0.22, ft.baseZ);
  stump.castShadow = true;
  worldScene.add(stump);

  // 3D fallen tree
  const ft3 = new FallenTree(worldScene, ft.baseX, ft.baseZ, ft.H, ft.dir);
  fallenTrees.push(ft3);
  rebuildFallenMeshList();

  // Impact — shake + dust cloud
  triggerShake(0.18, 0.55);
  const impactX = ft.baseX + Math.sin(ft.dir * Math.PI / 2) * ft.H * 0.8;
  for (let d = 0; d < 5; d++) {
    spawnDust(
      impactX + (Math.random() - 0.5) * ft.H * 0.4,
      ft.baseZ  + (Math.random() - 0.5) * ft.H * 0.4
    );
  }

  // If tree was burning, the fallen log catches fire too
  if (wasOnFire) {
    setTimeout(() => igniteFallenTree(ft3), 600);
  }
}

// Flat list of all current fallen-tree interactive meshes for raycasting
let fallenMeshes = [];
function rebuildFallenMeshList() {
  fallenMeshes = fallenTrees.flatMap(ft => ft.getAllMeshes());
}

// ── World Items (physical branches / logs in scene) ───────────────
const worldItems    = []; // { mesh, vel, onGround, len, r }
let heldWorldItem   = null; // { mesh(hand), len, r, side }
let heldLog         = null; // { len, r, logMesh, sideA, sideB, cutMesh, cutT, cutSwings, _endA, _endB }

const LOG_VISUAL_LEN  = 0.8;  // fixed on-screen length while carrying
const LOG_CARRY_DIST  = 1.2;  // metres in front of camera

function spawnWorldBranch(worldPos, len, r) {
  const mat  = new THREE.MeshLambertMaterial({ color: 0x5a3a1a });
  const geo  = new THREE.CylinderGeometry(r * 0.35, r, len, 6);
  const mesh = new THREE.Mesh(geo, mat);
  mesh.position.set(worldPos.x, worldPos.y + 0.3, worldPos.z);
  mesh.rotation.set(Math.PI / 2, Math.random() * Math.PI, 0);
  mesh.castShadow = true;
  worldScene.add(mesh);
  worldItems.push({
    mesh,
    vel: new THREE.Vector3((Math.random() - 0.5) * 1.5, 2.0, (Math.random() - 0.5) * 1.5),
    onGround: false,
    len,
    r,
  });
}

function grabWorldItem(wi, side) {
  worldScene.remove(wi.mesh);
  worldItems.splice(worldItems.indexOf(wi), 1);

  const handMesh = new THREE.Mesh(
    new THREE.CylinderGeometry(wi.r * 0.3, wi.r * 0.5, Math.min(wi.len, 0.38), 6),
    new THREE.MeshLambertMaterial({ color: 0x5a3a1a })
  );
  handMesh.rotation.x = Math.PI / 2;
  handMesh.position.set(0, 0.02, -0.08);

  hands.dropItem(side);
  hands.holdItem(side, handMesh);
  heldWorldItem = { len: wi.len, r: wi.r, side };
  showToast('Branch grabbed — E near two trees to place');
}

function _makeHeldLogMesh(r) {
  const mat = new THREE.MeshLambertMaterial({ color: 0x5a3a1a });
  const geo = new THREE.CylinderGeometry(Math.min(r * 0.5, 0.06), Math.min(r * 0.8, 0.09), LOG_VISUAL_LEN, 8);
  const m = new THREE.Mesh(geo, mat);
  m.castShadow = true;
  worldScene.add(m);
  return m;
}

function grabLog(wi, side) {
  worldScene.remove(wi.mesh);
  worldItems.splice(worldItems.indexOf(wi), 1);

  hands.dropItem(side);
  hands.dropItem(side === 1 ? -1 : 1);

  const other = side === 1 ? -1 : 1;
  heldLog = { len: wi.len, r: wi.r, logMesh: _makeHeldLogMesh(wi.r), sideA: side, sideB: other, cutMesh: null, cutT: null, cutSwings: 0, _endA: null, _endB: null };
  showToast(`Holding log (${wi.len.toFixed(1)}m) — arm pads tilt ends. Axe marks cut. 🔨 plant post.`);
}

function grabFallenTrunk(ft, side) {
  const len = ft.trunkLen || 5;
  const r   = ft.trunkR   || 0.2;

  ft.dispose();
  const idx = fallenTrees.indexOf(ft);
  if (idx !== -1) fallenTrees.splice(idx, 1);
  rebuildFallenMeshList();

  hands.dropItem(side);
  hands.dropItem(side === 1 ? -1 : 1);

  const other = side === 1 ? -1 : 1;
  heldLog = { len, r, logMesh: _makeHeldLogMesh(r), sideA: side, sideB: other, cutMesh: null, cutT: null, cutSwings: 0, _endA: null, _endB: null };
  showToast(`Grabbed log (${len.toFixed(1)}m) — arm pads tilt ends. Axe marks cut. 🔨 plant post.`);
}

function dropLog(side) {
  if (!heldLog) return;
  if (side !== heldLog.sideA && side !== heldLog.sideB) return;

  // Remove cut mark
  if (heldLog.cutMesh) { worldScene.remove(heldLog.cutMesh); heldLog.cutMesh = null; }

  // Drop log at carry position, horizontal on ground
  const fwd = new THREE.Vector3(); camera.getWorldDirection(fwd); fwd.y = 0; fwd.normalize();
  const dropPos = camera.position.clone().addScaledVector(fwd, 1.5);
  dropPos.y = 0;
  const quat = heldLog.logMesh.quaternion.clone();
  worldScene.remove(heldLog.logMesh);

  const mat = new THREE.MeshLambertMaterial({ color: 0x5a3a1a });
  const geo = new THREE.CylinderGeometry(heldLog.r * 0.35, heldLog.r * 0.5, heldLog.len, 6);
  const mesh = new THREE.Mesh(geo, mat);
  mesh.position.copy(dropPos);
  mesh.rotation.set(Math.PI / 2, Math.random() * Math.PI, 0);
  worldScene.add(mesh);
  worldItems.push({ mesh, vel: new THREE.Vector3(0, 0, 0), onGround: true, len: heldLog.len, r: heldLog.r });

  if (state.equippedTool) hands.holdItem(heldLog.sideA, makeHandTool(state.equippedTool));
  heldLog = null;
  showToast('Log set down.');
}

function updateHeldLog() {
  if (!heldLog) return;

  // Camera-relative axes
  const fwd   = new THREE.Vector3(); camera.getWorldDirection(fwd);
  const right = new THREE.Vector3().crossVectors(fwd, camera.up).normalize();
  const upV   = new THREE.Vector3().crossVectors(right, fwd).normalize();

  // Arm pad offsets from each side
  const stA = hands._state[heldLog.sideA];
  const stB = hands._state[heldLog.sideB];

  // Fixed carry point in front of camera
  const centre = camera.position.clone()
    .addScaledVector(fwd,  LOG_CARRY_DIST)
    .addScaledVector(upV, -0.15);

  const half = LOG_VISUAL_LEN * 0.5;
  const tilt = 0.28;

  const endA = centre.clone()
    .addScaledVector(right, -half + stA.padX * tilt * heldLog.sideA)
    .addScaledVector(upV,    stA.padY * tilt);
  const endB = centre.clone()
    .addScaledVector(right,  half + stB.padX * tilt * heldLog.sideB)
    .addScaledVector(upV,    stB.padY * tilt);

  heldLog._endA = endA;
  heldLog._endB = endB;

  const dir = endB.clone().sub(endA);
  heldLog.logMesh.position.copy(endA.clone().add(endB).multiplyScalar(0.5));
  if (dir.length() > 0.01) {
    heldLog.logMesh.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir.normalize());
  }

  if (heldLog.cutMesh && heldLog.cutT !== null) {
    heldLog.cutMesh.position.copy(endA.clone().lerp(endB, heldLog.cutT));
    heldLog.cutMesh.quaternion.copy(heldLog.logMesh.quaternion);
  }
}

function markLogCut() {
  if (!heldLog || !heldLog._endA || !heldLog._endB) return false;
  const posA = heldLog._endA;
  const posB = heldLog._endB;
  const logVec = posB.clone().sub(posA);
  const logLen = logVec.length();
  if (logLen < 0.01) return false;
  const logDir = logVec.clone().normalize();

  // Use centre of the log as cut point (always marks the centre while axe swings)
  const t = 0.5;

  if (heldLog.cutT !== null && Math.abs(t - heldLog.cutT) < 0.2) {
    heldLog.cutSwings++;
    showToast(`Chopping... (${heldLog.cutSwings}/3)`);
    if (heldLog.cutSwings >= 3) { splitLog(t); }
  } else {
    heldLog.cutSwings = 1;
    heldLog.cutT = t;
    if (heldLog.cutMesh) worldScene.remove(heldLog.cutMesh);
    const r = Math.min(heldLog.r * 0.65, 0.07);
    const ring = new THREE.Mesh(
      new THREE.TorusGeometry(r, r * 0.15, 6, 16),
      new THREE.MeshBasicMaterial({ color: 0xffcc00 })
    );
    heldLog.cutMesh = ring;
    ring.position.copy(posA.clone().lerp(posB, t));
    ring.quaternion.copy(heldLog.logMesh.quaternion);
    worldScene.add(ring);
    showToast('Cut mark set — swing axe here 2 more times to split.');
  }
  return true;
}

function splitLog(t) {
  if (!heldLog || !heldLog._endA || !heldLog._endB) return;
  const posA = heldLog._endA;
  const posB = heldLog._endB;
  const splitPt = posA.clone().lerp(posB, t);
  const lenA = heldLog.len * t;
  const lenB = heldLog.len * (1 - t);
  const r = heldLog.r;

  if (heldLog.cutMesh) worldScene.remove(heldLog.cutMesh);
  worldScene.remove(heldLog.logMesh);

  const mat = new THREE.MeshLambertMaterial({ color: 0x5a3a1a });

  const fwdD = new THREE.Vector3(); camera.getWorldDirection(fwdD); fwdD.y = 0; fwdD.normalize();
  const basePos = camera.position.clone().addScaledVector(fwdD, 1.5);

  const mA = new THREE.Mesh(new THREE.CylinderGeometry(r * 0.35, r * 0.5, lenA, 6), mat.clone());
  mA.position.copy(basePos).addScaledVector(fwdD, -0.4);
  mA.position.y = 0.5;
  mA.rotation.set(Math.PI / 2, Math.random() * Math.PI, 0);
  worldScene.add(mA);
  worldItems.push({ mesh: mA, vel: new THREE.Vector3((Math.random()-0.5)*0.5, 1.0, (Math.random()-0.5)*0.5), onGround: false, len: lenA, r });

  const mB = new THREE.Mesh(new THREE.CylinderGeometry(r * 0.35, r * 0.5, lenB, 6), mat.clone());
  mB.position.copy(basePos).addScaledVector(fwdD, 0.4);
  mB.position.y = 0.5;
  mB.rotation.set(Math.PI / 2, Math.random() * Math.PI, 0);
  worldScene.add(mB);
  worldItems.push({ mesh: mB, vel: new THREE.Vector3((Math.random()-0.5)*0.5, 1.0, (Math.random()-0.5)*0.5), onGround: false, len: lenB, r });

  if (state.equippedTool) hands.holdItem(heldLog.sideA, makeHandTool(state.equippedTool));
  heldLog = null;
  triggerShake(0.05, 0.2);
  showToast('Log split!');
  saveState();
}

function placeWorldItem() {
  if (!heldWorldItem) return;

  // Find the two closest standing trees within 8m
  const nearby = billboards
    .filter(b => !b.userData.onFire && !b.userData.falling)
    .map(b => ({ b, d: camera.position.distanceTo(b.position) }))
    .filter(({ d }) => d < 8)
    .sort((a, c) => a.d - c.d)
    .slice(0, 2);

  if (nearby.length < 2) { showToast('Need two trees nearby to place this.'); return; }

  const pA   = nearby[0].b.position;
  const pB   = nearby[1].b.position;
  const dist = pA.distanceTo(pB);
  if (dist > 9) { showToast('Trees too far apart.'); return; }

  const mid = pA.clone().add(pB).multiplyScalar(0.5);
  mid.y = 2.0 + Math.random() * 0.5;

  const mat  = new THREE.MeshLambertMaterial({ color: 0x6b4c2a });
  const geo  = new THREE.CylinderGeometry(heldWorldItem.r * 0.5, heldWorldItem.r * 0.8, dist, 8);
  const beam = new THREE.Mesh(geo, mat);
  beam.position.copy(mid);
  // Align cylinder axis (Y) with direction between trees
  const dir = new THREE.Vector3(pB.x - pA.x, 0, pB.z - pA.z).normalize();
  beam.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir);
  beam.castShadow = true;
  worldScene.add(beam);

  hands.dropItem(heldWorldItem.side);
  if (state.equippedTool) hands.holdItem(heldWorldItem.side, makeHandTool(state.equippedTool));
  heldWorldItem = null;
  showToast('Branch laid between trees.');
  state.journal.push({ day: state.time.day, text: 'Laid a branch between two trees.' });
  saveState();
}

function placeHeldLogBetweenTrees() {
  if (!heldLog) return;
  // Gather all possible anchor points — posts and trees
  const anchors = [];
  for (const p of buildPosts) {
    anchors.push({ pos: p.pos, d: camera.position.distanceTo(p.pos) });
  }
  for (const b of billboards) {
    if (b.userData.onFire || b.userData.falling) continue;
    anchors.push({ pos: b.position, d: camera.position.distanceTo(b.position) });
  }
  anchors.sort((a, c) => a.d - c.d);
  const near = anchors.filter(a => a.d < 10).slice(0, 2);
  if (near.length < 2) { showToast('Need two posts or trees nearby to place this.'); return; }
  const pA = near[0].pos, pB = near[1].pos;
  if (pA.distanceTo(pB) > 14) { showToast('Anchors too far apart.'); return; }

  // Use exact arm height — read from the live held log mesh position
  const beamY = heldLog._endA && heldLog._endB
    ? (heldLog._endA.y + heldLog._endB.y) * 0.5
    : heldLog.logMesh.position.y;
  const mid = pA.clone().add(pB).multiplyScalar(0.5); mid.y = beamY;
  const dist = pA.distanceTo(pB);
  const dir = new THREE.Vector3(pB.x - pA.x, 0, pB.z - pA.z).normalize();

  if (heldLog.cutMesh) worldScene.remove(heldLog.cutMesh);
  worldScene.remove(heldLog.logMesh);

  const mat = new THREE.MeshLambertMaterial({ color: 0x6b4c2a });
  const beam = new THREE.Mesh(new THREE.CylinderGeometry(heldLog.r * 0.5, heldLog.r * 0.8, dist, 8), mat);
  beam.position.copy(mid);
  beam.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir);
  beam.castShadow = true;
  worldScene.add(beam);

  state.world.structures.push({ type: 'beam', ax: pA.x, ay: beamY, az: pA.z, bx: pB.x, by: beamY, bz: pB.z });
  if (state.equippedTool) hands.holdItem(heldLog.sideA, makeHandTool(state.equippedTool));
  heldLog = null;
  showToast('Log laid between trees.');
  state.journal.push({ day: state.time.day, text: 'Laid a log between two trees.' });
  saveState();
}

// ── Fallen tree drag (mobile push) ────────────────────────────────
function pushFallenTree() {
  let best = null, bestDist = Infinity;
  for (const ft of fallenTrees) {
    const p = new THREE.Vector3();
    ft.group.getWorldPosition(p);
    const d = camera.position.distanceTo(p);
    if (d < 5 && d < bestDist) { best = ft; bestDist = d; }
  }
  if (!best) return false;
  // Push away from player
  const dir = new THREE.Vector3();
  best.group.getWorldPosition(dir);
  dir.sub(camera.position); dir.y = 0; dir.normalize();
  best.group.position.x += dir.x * 1.2;
  best.group.position.z += dir.z * 1.2;
  showToast('Pushed the log.');
  return true;
}

function nearestFallenTree(maxDist = 5) {
  let best = null, bestDist = Infinity;
  for (const ft of fallenTrees) {
    const p = new THREE.Vector3();
    ft.group.getWorldPosition(p);
    const d = camera.position.distanceTo(p);
    if (d < maxDist && d < bestDist) { best = ft; bestDist = d; }
  }
  return best;
}

// When a Log is consumed for building, shrink/remove the nearest fallen tree
function consumeNearestFallenTree() {
  const ft = nearestFallenTree(12);
  if (!ft) return;
  const sections = ft.trunkMesh.userData.logSections;
  if (sections > 1) {
    ft.trunkMesh.userData.logSections--;
    // Visually shrink trunk
    ft.trunkMesh.scale.x *= 0.7;
  } else {
    // Remove entirely
    ft.dispose();
    const idx = fallenTrees.indexOf(ft);
    if (idx !== -1) fallenTrees.splice(idx, 1);
    rebuildFallenMeshList();
  }
}

// ── Grab system (desktop pointer-lock drag) ───────────────────────
let grabState = null; // { fallenTree, mesh }

window.addEventListener('mousemove', e => {
  if (!grabState) return;
  if (grabState.isTrunk) {
    // Drag whole fallen tree — convert mouse movement to world XZ
    const right = new THREE.Vector3();
    camera.getWorldDirection(right);
    const fwd = right.clone();
    right.crossVectors(right, camera.up).normalize();
    fwd.y = 0; fwd.normalize();
    grabState.fallenTree.group.position.x += (e.movementX * right.x + e.movementY * -fwd.x) * 0.04;
    grabState.fallenTree.group.position.z += (e.movementX * right.z + e.movementY * -fwd.z) * 0.04;
    return;
  }
  const result = grabState.fallenTree.applyDrag(grabState.mesh, e.movementX, e.movementY);
  if (result) {
    if (typeof result === 'string') receiveItem(result, 'broke a branch off');
    else { spawnWorldBranch(result.worldPos, result.len, result.r); rebuildFallenMeshList(); saveState(); }
  }
});
canvas.addEventListener('mouseup', () => {
  grabState = null;
});

// ── Items / loot ──────────────────────────────────────────────────
function receiveItem(name, logMsg) {
  if (!name) return;
  const existing = state.inventory.find(i => i.name === name);
  if (existing) existing.quantity++; else state.inventory.push({ name, quantity: 1 });
  if (name === 'Log')   state.skills.woodcutting = Math.min(99, state.skills.woodcutting + 1);
  if (logMsg) state.journal.push({ day: state.time.day, text: logMsg });
  saveState();
  rebuildFallenMeshList();
}

// ── Fishing system ────────────────────────────────────────────────
const FISH_TYPES = ['Trout', 'Bass', 'Catfish'];
const FISH_COLORS = { Trout: 0x8b6914, Bass: 0x4a6b3a, Catfish: 0x5a5a5a };
const fishState = { phase: 'idle', timer: 0, biteWindow: 0, lineGroup: null, bobberMesh: null, fishMesh: null, reelStart: null };
const worldFish = []; // { mesh, name } — fish lying in the world
let heldFish = null;  // { mesh (world), handMesh (hand scene), side, name }
let fishCooldown = 0; // prevents unhook from immediately re-casting

function isNearRiver() {
  return camera.position.x > 88;
}

function startCast() {
  if (fishState.phase !== 'idle') return;
  fishState.phase = 'casting';
  fishState.timer = 0.8;
  hands.reach(1);
  showToast('Casting line...');
}

function spawnFishingLine() {
  const group = new THREE.Group();

  // Line from player to water
  const waterX = 115 + (Math.random() - 0.5) * 20;
  const waterZ = camera.position.z + (Math.random() - 0.5) * 6;
  const waterY = 0.1;

  const lineGeo = new THREE.BufferGeometry().setFromPoints([
    new THREE.Vector3(camera.position.x, 1.2, camera.position.z),
    new THREE.Vector3(waterX, waterY, waterZ),
  ]);
  const lineMat = new THREE.LineBasicMaterial({ color: 0x888888 });
  group.add(new THREE.Line(lineGeo, lineMat));

  // Bobber
  const bobber = new THREE.Mesh(
    new THREE.SphereGeometry(0.08, 8, 6),
    new THREE.MeshLambertMaterial({ color: 0xff3300 })
  );
  bobber.position.set(waterX, waterY, waterZ);
  group.add(bobber);

  worldScene.add(group);
  fishState.lineGroup = group;
  fishState.bobberMesh = bobber;
}

function removeFishingLine() {
  if (fishState.lineGroup) {
    worldScene.remove(fishState.lineGroup);
    fishState.lineGroup = null;
    fishState.bobberMesh = null;
  }
}

function makeFishMesh(fishName) {
  const color = FISH_COLORS[fishName] || 0x888866;
  const group = new THREE.Group();

  // Body — elongated sphere
  const body = new THREE.Mesh(
    new THREE.SphereGeometry(0.12, 8, 6),
    new THREE.MeshLambertMaterial({ color })
  );
  body.scale.set(1, 0.5, 2.2);
  group.add(body);

  // Tail fin
  const tail = new THREE.Mesh(
    new THREE.ConeGeometry(0.08, 0.14, 4),
    new THREE.MeshLambertMaterial({ color })
  );
  tail.position.set(0, 0, 0.28);
  tail.rotation.x = Math.PI / 2;
  group.add(tail);

  // Eye
  const eye = new THREE.Mesh(
    new THREE.SphereGeometry(0.02, 4, 4),
    new THREE.MeshBasicMaterial({ color: 0x111111 })
  );
  eye.position.set(0.06, 0.02, -0.18);
  group.add(eye);

  return group;
}

function catchFish() {
  const fish = FISH_TYPES[Math.floor(Math.random() * FISH_TYPES.length)];
  receiveItem(fish, `Caught a ${fish}!`);
  state.skills.fishing = Math.min(99, (state.skills.fishing || 0) + 1);
  showToast(`Caught a ${fish}!`);

  // Attach fish mesh to bobber position
  if (fishState.bobberMesh && fishState.lineGroup) {
    const fm = makeFishMesh(fish);
    fm.position.copy(fishState.bobberMesh.position);
    fishState.lineGroup.add(fm);
    fishState.fishMesh = fm;
    fishState.caughtName = fish;
    fishState.reelStart = fishState.bobberMesh.position.clone();
  }
  saveState();
}

function updateFishing(delta) {
  if (fishCooldown > 0) fishCooldown -= delta;
  if (fishState.phase === 'idle') return;

  if (fishState.phase === 'casting') {
    fishState.timer -= delta;
    if (fishState.timer <= 0) {
      spawnFishingLine();
      fishState.phase = 'waiting';
      fishState.timer = 3 + Math.random() * 9; // 3-12s
      showToast('Line cast... waiting for a bite.');
    }
    return;
  }

  if (fishState.phase === 'waiting') {
    fishState.timer -= delta;
    // Gentle bobber float
    if (fishState.bobberMesh) {
      fishState.bobberMesh.position.y = 0.1 + Math.sin(Date.now() * 0.003) * 0.02;
    }
    if (fishState.timer <= 0) {
      fishState.phase = 'bite';
      fishState.biteWindow = 2.0;
      showToast("Something's biting! Press E!");
    }
    return;
  }

  if (fishState.phase === 'bite') {
    fishState.biteWindow -= delta;
    // Bobber dips aggressively
    if (fishState.bobberMesh) {
      fishState.bobberMesh.position.y = 0.1 - Math.abs(Math.sin(Date.now() * 0.015)) * 0.12;
    }
    if (fishState.biteWindow <= 0) {
      showToast('It got away...');
      fishState.phase = 'reeling';
      fishState.timer = 0.5;
    }
    return;
  }

  if (fishState.phase === 'reeling') {
    fishState.timer -= delta;
    // Animate fish swinging up toward player
    if (fishState.fishMesh && fishState.reelStart) {
      const t = 1 - Math.max(0, fishState.timer / 1.5);
      const target = new THREE.Vector3(camera.position.x, 1.5, camera.position.z);
      fishState.fishMesh.position.lerpVectors(fishState.reelStart, target, t);
      fishState.fishMesh.position.y += Math.sin(t * Math.PI) * 1.5; // arc upward
      fishState.fishMesh.rotation.z = Math.sin(Date.now() * 0.012) * 0.4; // wiggle
    }
    if (fishState.timer <= 0) {
      // Move fish to world scene so it survives line removal
      if (fishState.fishMesh) {
        const wp = new THREE.Vector3();
        fishState.fishMesh.getWorldPosition(wp);
        if (fishState.lineGroup) fishState.lineGroup.remove(fishState.fishMesh);
        fishState.fishMesh.position.copy(wp);
        worldScene.add(fishState.fishMesh);
      }
      removeFishingLine();
      fishState.reelStart = null;
      fishState.phase = 'showing';
      fishState.timer = 2.5;
    }
    return;
  }

  if (fishState.phase === 'showing') {
    // Hold fish in front of camera until player presses E to unhook
    if (fishState.fishMesh) {
      const fwd = new THREE.Vector3();
      camera.getWorldDirection(fwd);
      fwd.y = 0; fwd.normalize();
      fishState.fishMesh.position.set(
        camera.position.x + fwd.x * 1.2,
        1.3 + Math.sin(Date.now() * 0.004) * 0.05,
        camera.position.z + fwd.z * 1.2
      );
      fishState.fishMesh.rotation.y = Math.atan2(fwd.x, fwd.z);
      fishState.fishMesh.rotation.z = Math.sin(Date.now() * 0.01) * 0.3;
    }
    return;
  }
}

function placeFishNearPlayer(mesh) {
  const fwd = new THREE.Vector3();
  camera.getWorldDirection(fwd); fwd.y = 0; fwd.normalize();
  mesh.position.set(
    camera.position.x + fwd.x * 1.5 + (Math.random() - 0.5) * 0.6,
    0.12,
    camera.position.z + fwd.z * 1.5 + (Math.random() - 0.5) * 0.6
  );
  mesh.rotation.set(0, Math.random() * Math.PI * 2, Math.PI / 2);
}

function unhookFish() {
  if (!fishState.fishMesh) return;
  placeFishNearPlayer(fishState.fishMesh);
  worldFish.push({ mesh: fishState.fishMesh, name: fishState.caughtName || 'Fish' });
  fishState.fishMesh = null;
  fishState.caughtName = null;
  fishState.phase = 'idle';
  fishCooldown = 0.5;
  showToast('Fish unhooked.');
}

function grabFish(wf, side) {
  worldScene.remove(wf.mesh);
  worldFish.splice(worldFish.indexOf(wf), 1);

  // Drop whatever is in both hands, then hold fish in curled hand
  hands.dropItem(1);
  hands.dropItem(-1);

  // Small fish mesh for hand
  const handMesh = makeFishMesh(wf.name);
  handMesh.scale.setScalar(0.6);
  handMesh.position.set(0, 0.02, -0.1);

  hands.holdItem(side, handMesh);

  // Keep rod in the other hand if equipped
  const other = side === 1 ? -1 : 1;
  if (state.equippedTool) hands.holdItem(other, makeHandTool(state.equippedTool));

  heldFish = { worldMesh: wf.mesh, handMesh, side, name: wf.name };
  showToast(`Holding ${wf.name}`);
}

function dropFish(side) {
  if (!heldFish || heldFish.side !== side) return false;
  hands.dropItem(side);

  const fwd = new THREE.Vector3();
  camera.getWorldDirection(fwd); fwd.y = 0; fwd.normalize();
  const dropPos = new THREE.Vector3(
    camera.position.x + fwd.x * 1.2,
    0.05,
    camera.position.z + fwd.z * 1.2
  );

  if (heldFish.isMeat) {
    // Drop meat on ground
    const fm = makeMeatMesh(heldFish.name);
    fm.position.copy(dropPos);
    worldScene.add(fm);
    worldMeat.push({ mesh: fm, name: heldFish.name });
    showToast(`Set ${heldFish.name} down.`);
    heldFish = null;
    if (state.equippedTool) hands.holdItem(side, makeHandTool(state.equippedTool));
    return true;
  }

  // Re-create world fish mesh and place it
  const fm = makeFishMesh(heldFish.name);
  worldScene.add(fm);
  placeFishNearPlayer(fm);
  worldFish.push({ mesh: fm, name: heldFish.name });

  // Restore equipped tool in hand
  if (state.equippedTool) hands.holdItem(side, makeHandTool(state.equippedTool));
  showToast(`Set ${heldFish.name} down.`);
  heldFish = null;
  return true;
}

function handleFishingInteract() {
  if (fishState.phase === 'showing') {
    unhookFish();
    return true;
  }
  if (fishState.phase === 'bite') {
    // Caught it!
    catchFish();
    fishState.phase = 'reeling';
    fishState.timer = 1.5;
    return true;
  }
  if (fishState.phase === 'idle' && fishCooldown <= 0 && isNearRiver() && state.equippedTool === 'Fishing Rod') {
    startCast();
    return true;
  }
  return false;
}

// ── Trapping helpers ───────────────────────────────────────────────
function hasSticks(n) {
  const s = state.inventory.find(i => i.name === 'Stick');
  return s && s.quantity >= n;
}
function consumeSticks(n) {
  const s = state.inventory.find(i => i.name === 'Stick');
  if (!s) return;
  s.quantity -= n;
  if (s.quantity <= 0) state.inventory = state.inventory.filter(i => i.name !== 'Stick');
}

function canPlaceSnare()    { return hasSticks(2); }
function canPlaceDeadfall() { return hasSticks(4) && state.inventory.find(i => i.name === 'Stone'); }
function canPlaceFishTrap() { return hasSticks(6); }

function placeTrapInFront(type, sticksNeeded, stoneNeeded) {
  const fwd = new THREE.Vector3();
  camera.getWorldDirection(fwd); fwd.y = 0; fwd.normalize();
  const pos = camera.position.clone().addScaledVector(fwd, 2.5);
  const rot = Math.atan2(fwd.x, fwd.z);

  consumeSticks(sticksNeeded);
  if (stoneNeeded) {
    const s = state.inventory.find(i => i.name === 'Stone');
    if (s) { s.quantity--; if (s.quantity <= 0) state.inventory = state.inventory.filter(i => i.name !== 'Stone'); }
  }
  trapManager.place(type, pos.x, pos.z, rot);
  state.skills.trapping = Math.min(99, (state.skills.trapping || 0) + 1);
  state.journal.push({ day: state.time.day, text: `Set a ${type.replace('_', ' ')}.` });
  saveState();
  showToast(`${type.replace('_', ' ')} set!`);
  hands.reach(1);
}

function tryInteractTrap() {
  const nearby = trapManager.getNearby(camera.position);
  if (!nearby) return false;
  nearby.collect(receiveItem, showToast, state);
  saveState();
  return true;
}

// ── Raycaster ─────────────────────────────────────────────────────
const raycaster = new THREE.Raycaster();
const REACH     = 3.5;

function castFromScreen(clientX, clientY) {
  const rect = canvas.getBoundingClientRect();
  const nx   = ((clientX - rect.left) / rect.width)  *  2 - 1;
  const ny   = ((clientY - rect.top)  / rect.height) * -2 + 1;
  raycaster.setFromCamera(new THREE.Vector2(nx, ny), camera);
  return { nx, ny };
}

// ── Rifle / ADS ────────────────────────────────────────────────────
let _adsActive = false;
const _scopeOverlay = document.getElementById('scope-overlay');
const _FOV_NORMAL = 75;
const _FOV_SCOPE  = 22;

function hasScope() {
  return !!state.inventory.find(i => i.name === 'Rifle Scope');
}

function toggleADS() {
  if (state.equippedTool !== 'Rifle') return;
  if (!hasScope()) { showToast('Need a Rifle Scope — check the supply bin.'); return; }
  _adsActive = !_adsActive;
  if (_adsActive) {
    camera.fov = _FOV_SCOPE;
    camera.updateProjectionMatrix();
    if (_scopeOverlay) _scopeOverlay.style.display = 'block';
  } else {
    camera.fov = _FOV_NORMAL;
    camera.updateProjectionMatrix();
    if (_scopeOverlay) _scopeOverlay.style.display = 'none';
  }
}

function exitADS() {
  if (!_adsActive) return;
  _adsActive = false;
  camera.fov = _FOV_NORMAL;
  camera.updateProjectionMatrix();
  if (_scopeOverlay) _scopeOverlay.style.display = 'none';
}

function fireRifle() {
  if (state.equippedTool !== 'Rifle') return false;
  const ammo = state.inventory.find(i => i.name === 'Rifle Ammo');
  if (!ammo || ammo.quantity <= 0) { showToast('Out of ammo!'); return true; }

  ammo.quantity--;
  if (ammo.quantity <= 0) state.inventory = state.inventory.filter(i => i.name !== 'Rifle Ammo');

  // Muzzle flash — brief white point light at camera
  const flash = new THREE.PointLight(0xffffcc, 12, 4);
  flash.position.copy(camera.position);
  worldScene.add(flash);
  setTimeout(() => worldScene.remove(flash), 80);

  // Camera kick
  _shakeIntensity = 0.04; _shakeDuration = 0.18; _shakeTime = 0;

  // Raycast straight ahead (infinite range)
  raycaster.setFromCamera(new THREE.Vector2(0, 0), camera);

  // Check animals (infinite range — it's a rifle)
  const animalMeshes = wildlifeManager.animals.filter(a => !a.dead).map(a => a.mesh).filter(Boolean);
  const aHits = raycaster.intersectObjects(animalMeshes, true);
  if (aHits.length > 0) {
    const hitMesh = aHits[0].object;
    const animal  = wildlifeManager.animals.find(a => !a.dead && (a.mesh === hitMesh || (a.mesh && a.mesh.children.includes(hitMesh))));
    if (animal) {
      // Drop carcass (same as knife kill)
      const loot = animal.kind === 'deer'     ? ['Venison', 'Venison', 'Hide'] :
                   animal.kind === 'rabbit'   ? ['Rabbit Meat'] :
                   animal.kind === 'squirrel' ? ['Squirrel Meat'] : [];
      animal.dead = true;
      wildlifeManager.animals = wildlifeManager.animals.filter(a => a !== animal);
      const carcass = animal.mesh;
      const cuts = animal.kind === 'deer' ? 20 : 2;
      // Start fall animation — carcass/loot registered when it hits the ground
      fallingAnimals.push({ mesh: carcass, kind: animal.kind, loot, cuts, rotX: carcass.rotation.x, velY: 1.5, done: false });
      showToast(`Shot a ${animal.kind}!`);
      state.skills.hunting = Math.min(99, (state.skills.hunting || 0) + 2);
      state.journal.push({ day: state.time.day, text: `Shot a ${animal.kind} with the rifle.` });
      saveState();
      return true;
    }
  }

  // Gunshot scares all animals within 80 units
  wildlifeManager.animals.forEach(a => {
    if (!a.dead && camera.position.distanceTo(a.mesh.position) < 80) a.state = 'flee';
  });

  showToast('Missed.');
  return true;
}

// 💧 button — all water/barrel actions
function onWater() {
  if (!player.isLocked) return;
  // Held barrel — fill at river
  if (heldBarrel && isNearRiver() && heldBarrel.data.water < BARREL_MAX) {
    heldBarrel.data.water = BARREL_MAX;
    heldBarrel.data.boiled = false;
    showToast(`Barrel filled! (${BARREL_MAX}/${BARREL_MAX})`);
    saveState();
    return;
  }
  // Collect boiled barrel water
  if (collectBarrelWater()) return;
  // Placed barrel interactions
  const _barrel = nearestBarrel();
  if (_barrel) {
    const _bc = getCanteen();
    if (isNearRiver() && _barrel.data.x >= 88 && _barrel.data.water < BARREL_MAX) { fillBarrelAtRiver(); return; }
    if (_bc && (_bc.water === 'raw' || _bc.water === 'boiled') && _barrel.data.water < BARREL_MAX) { pourIntoBarrel(); return; }
    if (_barrel.data.water > 0 && !_barrel.data.boiled && nearestLitFire(new THREE.Vector3(_barrel.data.x, 0, _barrel.data.z), 5)) { boilBarrel(); return; }
    if (_bc && (!_bc.water || _bc.water === 'empty') && _barrel.data.water > 0) { fillCanteenFromBarrel(); return; }
  }
  // Canteen: boil, fill, drink, douse (boil before douse so it takes priority near fire)
  const _canteen = getCanteen();
  if (_canteen && _canteen.water === 'raw' && nearestLitFire(camera.position)) { boilCanteen(); return; }
  if (_canteen && isNearRiver() && (!_canteen.water || _canteen.water === 'empty')) { fillCanteen(); return; }
  if (_canteen && (_canteen.water === 'boiled' || _canteen.water === 'raw') && !_anyFireNearby(camera.position, 10) && !isNearRiver()) { drinkCanteen(); return; }
  if (_canteen && (_canteen.water === 'raw' || _canteen.water === 'boiled') && _anyFireNearby(camera.position, 10)) { splashWater(); return; }
  // Collect boiled canteen water from fire
  if (collectCanteenWater()) return;
  showToast('No water action available.');
}

// 🏕️ button — camp actions (sleep, eat, heal, lantern, bin)
function onCamp() {
  if (!player.isLocked) return;
  if (toggleNearLantern()) return;
  if (trySleep()) return;
  if (tryHeal()) return;
  if (tryEat()) return;
  if (camera.position.distanceTo(binMesh.position) < 5) { openBinPanel(); return; }
  showToast('No camp action available.');
}

function tryHeal() {
  if (state.player.health >= 100) return false;
  const kit = state.inventory.find(i => i.name === 'First Aid Kit');
  if (!kit) return false;
  kit.quantity--;
  if (kit.quantity <= 0) state.inventory = state.inventory.filter(i => i !== kit);
  state.player.health = Math.min(100, state.player.health + 30);
  state.skills.medicine = Math.min(99, (state.skills.medicine || 0) + 1);
  showToast('Used First Aid Kit. (+30 health)');
  saveState();
  return true;
}

// ✓ button — interact (rifle, fish, cook, flint, place, push)
function onInteract(clientX, clientY) {
  if (!player.isLocked) return;
  if (_heightPick) { heightPickConfirm(); return; }
  const { nx, ny } = castFromScreen(clientX, clientY);
  if (fireRifle()) return;

  if (handleFishingInteract()) return;
  if (collectCooked()) return;
  if (tryFlintStrike()) return;
  if (heldFish && nearestLitFire(camera.position) && COOK_TIMES[heldFish.name]) {
    const name = heldFish.name;
    hands.dropItem(heldFish.side);
    if (state.equippedTool) hands.holdItem(heldFish.side, makeHandTool(state.equippedTool));
    const fire = nearestLitFire(camera.position);
    const spit = makeSpit(camera.position, fire.pos);
    cookingSlots.push({ name, timer: COOK_TIMES[name], done: false, spit, firePos: fire.pos });
    showToast(`Cooking ${name}...`);
    heldFish = null;
    return;
  }

  const cookable = state.inventory.find(i => COOK_TIMES[i.name]);
  if (cookable && nearestLitFire(camera.position)) { placeMeatOnFire(cookable.name); return; }
  if (heldWorldItem) { placeWorldItem(); return; }
  if (heldLog) { placeHeldLogBetweenTrees(); return; }

  // Fallen tree — no-axe grab/tap/push
  if (fallenMeshes.length > 0) {
    const ftHits = raycaster.intersectObjects(fallenMeshes);
    if (ftHits.length > 0 && ftHits[0].distance < REACH * 1.8) {
      const mesh = ftHits[0].object;
      const ft   = mesh.userData.fallenTree;
      if (ft && state.equippedTool !== 'Axe') {
        if (mesh.userData.isTrunk) {
          pushFallenTree();
          hands.reach(nx >= 0 ? 1 : -1);
          return;
        }
        if (!player.isMobile) {
          grabState = { fallenTree: ft, mesh };
        } else {
          const result = ft.tapBranch(mesh);
          if (result) {
            if (typeof result === 'string') receiveItem(result, 'Broke a branch off by hand.');
            else { spawnWorldBranch(result.worldPos, result.len, result.r); rebuildFallenMeshList(); saveState(); }
          }
          else showToast('Keep hitting it...');
        }
        hands.reach(nx >= 0 ? 1 : -1);
        return;
      }
    }
  }

  // Standing trees — click just shows hint; actual chop is via arm swing
  const treeHits = raycaster.intersectObjects(billboards);
  if (treeHits.length > 0 && treeHits[0].distance < REACH) {
    if (state.equippedTool !== 'Axe') showToast('Equip an axe first.');
    else showToast('Swing your arm to chop.');
  }
}

function plantHeldLogAsPost() {
  if (!heldLog) return false;
  if (heldLog.cutMesh) { worldScene.remove(heldLog.cutMesh); heldLog.cutMesh = null; }
  worldScene.remove(heldLog.logMesh);

  const fwd = new THREE.Vector3();
  camera.getWorldDirection(fwd); fwd.y = 0; fwd.normalize();
  const pos = camera.position.clone().addScaledVector(fwd, 1.8);
  pos.y = 0;

  const height = Math.min(Math.max(heldLog.len, 1.2), 6.0);
  _spawnPostMesh(pos.x, pos.z, height);
  state.world.structures.push({ type: 'post', x: pos.x, z: pos.z, height });

  if (state.equippedTool) hands.holdItem(heldLog.sideA, makeHandTool(state.equippedTool));
  heldLog = null;
  hands.reach(1);
  state.skills.building = Math.min(99, (state.skills.building || 0) + 1);
  state.journal.push({ day: state.time.day, text: 'Planted a post.' });
  showToast('Post planted!');
  saveState();
  return true;
}

// 🔨 Build button — posts, beams, canvas, tent (or ADS when rifle equipped)
function onBuild() {
  if (!player.isLocked) return;
  if (state.equippedTool === 'Rifle')   { toggleADS();    return; }
  if (state.equippedTool === 'Lantern') { placeLantern(); return; }
  if (state.equippedTool === 'Barrel')  { placeBarrel();  return; }
  if (state.equippedTool === 'Canvas')  { startCanvas();  return; }
  if (state.equippedTool === 'Tent')    { placeTent();    return; }
  if (heldLog) { plantHeldLogAsPost(); return; }
  if (handleBuildInteract()) return;
  showToast('Nothing to build here.');
}

// 🔥 Fire button — fire pit stages only (or height-pick down)
function onFire() {
  if (!player.isLocked) return;
  if (_heightPick) { heightPickDown(); return; }
  if (handleFirePitInteract()) return;
  showToast('Need Shovel to dig pit, or be near a pit in progress.');
}

// 🪤 Trap button — place or collect traps (or cancel height pick / canvas mode)
function onTrap() {
  if (!player.isLocked) return;
  if (_heightPick) { cancelHeightPick(); return; }
  if (_canvasMode) { _canvasMode = false; _canvasCorners.length = 0; showToast('Canvas cancelled.'); return; }
  if (tryInteractTrap()) return;
  if (canPlaceFishTrap() && camera.position.x > 93) { placeTrapInFront('fish_trap', 6, false); return; }
  if (canPlaceDeadfall()) { placeTrapInFront('deadfall', 4, true); return; }
  if (canPlaceSnare())    { placeTrapInFront('snare', 2, false); return; }
  showToast('Nothing to trap here.');
}

canvas.addEventListener('mousedown', e => {
  if (!player.isLocked) return;
  const { nx } = castFromScreen(e.clientX, e.clientY);
  // Fallen tree drag-grab (no axe, desktop) — branches wobble, trunk drags whole tree
  if (fallenMeshes.length > 0 && state.equippedTool !== 'Axe') {
    const ftHits = raycaster.intersectObjects(fallenMeshes);
    if (ftHits.length > 0 && ftHits[0].distance < REACH * 1.8) {
      const mesh = ftHits[0].object;
      const ft   = mesh.userData.fallenTree;
      if (ft) {
        grabState = { fallenTree: ft, mesh, isTrunk: !!mesh.userData.isTrunk };
        hands.reach(nx >= 0 ? 1 : -1);
      }
    }
  }
});

canvas.addEventListener('click', e => onInteract(e.clientX, e.clientY));

// Mobile buttons — prevent double-fire (touchend + click both trigger on mobile)
function _wireBtn(id, fn) {
  const btn = document.getElementById(id);
  if (!btn) return;
  let _touchFired = false;
  btn.addEventListener('touchend', e => { e.preventDefault(); e.stopPropagation(); _touchFired = true; fn(); });
  btn.addEventListener('click',    e => { e.stopPropagation(); if (_touchFired) { _touchFired = false; return; } fn(); });
}
const _cx = () => { const r = canvas.getBoundingClientRect(); return r.left + r.width  / 2; };
const _cy = () => { const r = canvas.getBoundingClientRect(); return r.top  + r.height / 2; };
_wireBtn('action-btn', () => onInteract(_cx(), _cy()));
_wireBtn('build-btn',  () => onBuild());
_wireBtn('fire-btn',   () => onFire());
_wireBtn('trap-btn',   () => onTrap());
_wireBtn('water-btn',  () => onWater());
_wireBtn('camp-btn',   () => onCamp());

// Keyboard: E = interact, B = build, F = fire, T = trap, G = water, C = camp
window.addEventListener('keydown', e => {
  if (e.code === 'KeyE') { onInteract(_cx(), _cy()); return; }
  if (e.code === 'KeyB') { onBuild(); return; }
  if (e.code === 'KeyF') { onFire();  return; }
  if (e.code === 'KeyT') { onTrap();  return; }
  if (e.code === 'KeyG') { onWater(); return; }
  if (e.code === 'KeyC') { onCamp();  return; }
});

// ── Game Clock ────────────────────────────────────────────────────
const clock   = new THREE.Clock();
const _camFwd = new THREE.Vector3();
const GAME_MINUTES_PER_SECOND = 1; // 1 game minute per real second = 1 real minute per game hour, full day in 24 real minutes

// ── Game Loop ─────────────────────────────────────────────────────
function animate() {
  requestAnimationFrame(animate);
  const delta = Math.min(clock.getDelta(), 0.1);

  // Time
  state.time.minute += GAME_MINUTES_PER_SECOND * delta * 60 / 60;
  if (state.time.minute >= 60) {
    state.time.minute -= 60; state.time.hour++;
    if (state.time.hour >= 24) { state.time.hour = 0; state.time.day++; }
  }

  updateDayNight(state.time.hour + state.time.minute / 60);
  player.update(delta);
  if (_firePitCooldown > 0) _firePitCooldown -= delta;
  if (_buildCooldown > 0)   _buildCooldown   -= delta;

  // Spatial audio listener tracks camera
  camera.getWorldDirection(_camFwd);
  fireAudio.updateListener(camera.position, _camFwd);

  // Camera shake — applied after player.update so it rides on top
  if (_shakeTime < _shakeDuration) {
    _shakeTime += delta;
    const decay = 1 - _shakeTime / _shakeDuration;
    const s = _shakeIntensity * decay;
    camera.position.x += (Math.random() - 0.5) * s;
    camera.position.y += (Math.random() - 0.5) * s * 0.5;
    camera.position.z += (Math.random() - 0.5) * s;
  }

  hands.update(delta, player.velocity.lengthSq() > 0.01);
  updateHeldLog();
  updateSwingChop(delta);

  // Billboard facing + shake + ambient sway
  const elapsed = clock.getElapsedTime();
  for (const b of billboards) {
    b.rotation.y = Math.atan2(camera.position.x - b.position.x, camera.position.z - b.position.z);
    if (b.userData.shake > 0) {
      b.userData.shake -= delta;
      b.rotation.z = Math.sin(b.userData.shake * 28) * b.userData.shake * b.userData.shakeAmp;
    } else {
      const swayPhase = (b.userData.treeId || 0) * 0.93;
      b.rotation.z = Math.sin(elapsed * 0.65 + swayPhase) * 0.013
                   + Math.sin(elapsed * 1.1  + swayPhase * 1.4) * 0.006;
    }
  }

  // Dust puffs
  for (let di = dustPuffs.length - 1; di >= 0; di--) {
    const d = dustPuffs[di];
    d.age += delta;
    const t = d.age / d.duration;
    d.mesh.scale.set(1 + t * 6, 1 - t * 0.8, 1 + t * 6);
    d.mesh.material.opacity = 0.55 * (1 - t * t);
    if (d.age >= d.duration) { worldScene.remove(d.mesh); dustPuffs.splice(di, 1); }
  }

  // World item physics (branches falling to ground)
  for (const wi of worldItems) {
    if (wi.onGround) continue;
    wi.vel.y -= 9.8 * delta;
    wi.mesh.position.addScaledVector(wi.vel, delta);
    const floor = wi.r * 0.5 + 0.05;
    if (wi.mesh.position.y <= floor) {
      wi.mesh.position.y = floor;
      wi.vel.set(0, 0, 0);
      wi.onGround = true;
      wi.mesh.rotation.set(Math.PI / 2, wi.mesh.rotation.y, 0);
    }
  }

  // Fall animations
  updateFallingTrees(delta);
  updateFallingAnimals(delta);

  // Fallen tree physics
  for (const ft of fallenTrees) ft.update(delta);

  // Burning tree fall timer — base burns through after 8s → tree falls
  for (const [billboard, elapsed] of [...burningTrees]) {
    const t = elapsed + delta;
    burningTrees.set(billboard, t);
    // Scale audio volume with fire growth
    if (billboard.userData.fireAudioId) {
      const vol = 0.22 + Math.min(0.25, t / 8 * 0.25);
      fireAudio.setVolume(billboard.userData.fireAudioId, vol);
    }
    if (t >= 35 && !billboard.userData.falling) {
      burningTrees.delete(billboard);
      if (billboard.userData.fireAudioId) {
        fireAudio.stop(billboard.userData.fireAudioId);
        billboard.userData.fireAudioId = null;
      }
      startFall(billboard);
    }
  }

  // Campfire light flicker
  for (const cf of campfires) {
    if (cf.lit && cf.light) {
      cf.light.intensity = 9 + Math.sin(elapsed * 7.8) * 2.2 + Math.sin(elapsed * 4.3) * 1.1;
      cf.light.color.setHSL(0.05 + Math.sin(elapsed * 1.8) * 0.015, 1.0, 0.55);
    }
  }

  // Wildlife
  wildlifeManager.update(delta, camera.position);

  // Trapping (traps tick even with time frozen since timer uses real game hours)
  trapManager.update(delta, GAME_MINUTES_PER_SECOND, wildlifeManager);

  // Cooking
  updateCooking(delta);

  // Vitals drain
  updateVitals(delta);

  // Fishing
  updateFishing(delta);

  // River wave animation
  // model X = across river, model Y = along river, model Z = world Y (height)
  if (riverMesh) {
    const pos = riverMesh.geometry.attributes.position;
    const t = elapsed;
    for (let i = 0; i < pos.count; i++) {
      const x = pos.getX(i);          // across river (-15 to +15)
      const a = pos.getY(i);          // along river (-150 to +150)

      // Downstream current flow
      const flow = t * 8;

      // Edge calm factor — waves are smaller near banks, bigger in center
      const edgeFade = 1 - Math.pow(Math.abs(x) / 15, 2) * 0.6;

      // Layer multiple wave frequencies
      const h = (
        Math.sin(t * 0.9 + a * 0.045 + x * 0.08) * 0.10 +           // broad swell
        Math.sin(t * 1.6 + (a + flow) * 0.09 - x * 0.12) * 0.07 +   // medium chop moving downstream
        Math.sin(t * 2.8 + a * 0.15 + x * 0.2) * 0.035 +            // fine ripples
        Math.sin(t * 0.4 + a * 0.018) * 0.08 +                       // slow deep roll
        Math.sin(t * 3.5 + (a + flow * 0.5) * 0.22 + x * 0.3) * 0.02  // tiny surface chatter
      ) * edgeFade;

      pos.setZ(i, h);
    }
    pos.needsUpdate = true;
    riverMesh.geometry.computeVertexNormals();
  }

  // Fire system
  fireManager.update(delta, billboards, fallenTrees,
    b  => igniteTree(b),
    ft => igniteFallenTree(ft)
  );

  // Match burn timer + flame flicker
  if (matchState.lit) {
    matchState.burnRemaining -= delta;
    // Flicker the flame mesh
    if (matchState.mesh) {
      matchState.mesh.traverse(c => {
        if (c._isFlame) {
          c.scale.setScalar(0.85 + Math.sin(Date.now() * 0.018) * 0.15);
        }
      });
    }
    if (matchState.burnRemaining <= 0) {
      matchState.lit = false;
      hands.dropItem(1);
      if (state.equippedTool === 'Matches') hands.holdItem(1, makeHandTool('Matches'));
      matchState.mesh = null;
      showToast('Match burned out.');
    }
  }

  // Lantern flicker
  for (const l of lanternMeshes) {
    if (l.data.on && l.light) {
      const flicker = Math.sin(elapsed * 9.3) * 2.5 + Math.sin(elapsed * 4.1) * 1.5;
      l.light.intensity = 22 + flicker;
      if (l.mesh.userData.flameMesh) {
        const fs = 0.9 + Math.sin(elapsed * 13) * 0.1 + Math.sin(elapsed * 7) * 0.08;
        l.mesh.userData.flameMesh.scale.setScalar(fs);
        l.mesh.userData.flameMesh.material.color.setHSL(0.08 + Math.sin(elapsed * 5) * 0.02, 1, 0.55 + Math.sin(elapsed * 9) * 0.05);
      }
    }
  }

  // Proximity prompts
  const binDist = camera.position.distanceTo(binMesh.position);
  let promptText = '';
  if (heldLog) {
    promptText = heldLog.cutT !== null
      ? `Axe swing to cut (${heldLog.cutSwings}/3) — 🔨 plant post — E lay between trees — uncurl to drop`
      : 'Move arm pads to position — 🔨 plant as post — axe marks cut point — E lay between trees';
  } else if (heldWorldItem) {
    promptText = player.isMobile ? 'Tap to place branch between trees' : 'E — place branch between trees';
  } else if (_canvasMode) {
    const hasAnchor = nearestPost(3.5) || billboards.find(b => !b.userData.onFire && !b.userData.falling && camera.position.distanceTo(b.position) < 3.5);
    promptText = hasAnchor
      ? (player.isMobile ? `Tap — set corner ${_canvasCorners.length+1}/4` : `E — Set corner ${_canvasCorners.length+1}/4`)
      : `Canvas: move to post or tree (${_canvasCorners.length}/4 set)`;
  } else if (_beamFirstPost) {
    const np = nearestPost(3);
    promptText = np && np !== _beamFirstPost
      ? (player.isMobile ? 'Tap — complete beam here' : 'E — Place beam to this post')
      : (np === _beamFirstPost ? 'E again at same post — cancel beam' : 'Walk to second post to complete beam');
  } else if (nearestPost(3) && state.inventory.find(i => i.name === 'Log') && state.equippedTool !== 'Shovel') {
    promptText = player.isMobile ? 'Tap — start beam (2nd post to connect)' : 'E — Start beam between posts';
  } else if (nearestPost(3) && state.inventory.find(i => i.name === 'Log') && state.equippedTool === 'Shovel') {
    promptText = player.isMobile ? 'Tap — stack log on post' : 'E — Stack log on post';
  } else if (state.inventory.find(i => i.name === 'Log') && !nearestPost(3) && state.equippedTool !== 'Shovel' && !nearestLitFire(camera.position)) {
    promptText = player.isMobile ? 'Tap 🔨 to plant post' : 'B — Plant post';
  } else if (nearPitAtStage('logged') && matchState.lit) {
    promptText = 'Swing arm to light campfire';
  } else if (nearPitAtStage('logged') && state.inventory.find(i => i.name === 'Stone')) {
    promptText = player.isMobile ? 'Tap to strike flint' : 'E — Strike flint to light fire';
  } else if (nearPitAtStage('logged') && state.inventory.find(i => i.name === 'Stick' && i.quantity >= 2)) {
    promptText = 'Swing arm rapidly — bow drill (8 swings)';
  } else if (nearPitAtStage('logged')) {
    promptText = 'Fire pit ready — need match, flint, or bow drill';
  } else if (nearPitAtStage('rocked')) {
    const logs = state.inventory.find(i => i.name === 'Log');
    const have = logs ? logs.quantity : 0;
    promptText = have >= 2
      ? (player.isMobile ? 'Tap to place logs in pit' : 'E — Place logs in pit')
      : `Need 2 Logs — you have ${have} (chop trees with Axe)`;
  } else if (nearPitAtStage('dug')) {
    promptText = player.isMobile ? 'Tap to gather rocks and ring the pit' : 'E — Gather rocks and ring the pit';
  } else if (state.equippedTool === 'Shovel' && !state.inventory.find(i => i.name === 'Log')) {
    promptText = player.isMobile ? 'Tap to dig fire pit' : 'E — Dig fire pit';
  } else if (worldItems.some(wi => wi.onGround && camera.position.distanceTo(wi.mesh.position) < 3.5)) {
    promptText = 'Curl hand to grab log (both hands control ends)';
  } else if (cookingSlots.some(s => s.done && s.firePos.distanceTo(camera.position) < 4)) {
    promptText = player.isMobile ? 'Tap to collect cooked meat' : 'E — Collect cooked meat';
  } else if ((heldFish && COOK_TIMES[heldFish.name] || state.inventory.find(i => COOK_TIMES[i.name])) && nearestLitFire(camera.position)) {
    promptText = player.isMobile ? 'Tap ✓ to cook' : 'E — Put on fire to cook';
  } else if (fishState.phase === 'showing') {
    promptText = player.isMobile ? 'Tap to unhook fish' : 'E — Unhook fish';
  } else if (fishState.phase === 'waiting') {
    promptText = 'Waiting for a bite...';
  } else if (fishState.phase === 'bite') {
    promptText = player.isMobile ? "Tap now! Something's biting!" : "E — Reel it in!";
  } else if (fishState.phase !== 'idle') {
    promptText = '';
  } else if (state.equippedTool === 'Knife' && carcasses.some(c => camera.position.distanceTo(c.mesh.position) < 2.5)) {
    promptText = 'Swing arm to butcher';
  } else if (state.equippedTool === 'Knife' && wildlifeManager.animals.some(a => !a.dead && camera.position.distanceTo(a.mesh.position) < 2.8)) {
    promptText = 'Swing arm to attack';
  } else if (worldMeat.some(m => camera.position.distanceTo(m.mesh.position) < 3.5)) {
    promptText = 'Curl hand to pick up meat';
  } else if (isNearRiver() && state.equippedTool === 'Fishing Rod') {
    promptText = player.isMobile ? 'Tap to cast line' : 'E — Cast line';
  } else if ((() => { const t = trapManager.getNearby(camera.position); return t && t.triggered; })()) {
    promptText = player.isMobile ? 'Tap to check trap' : 'E — Check trap';
  } else if (trapManager.getNearby(camera.position)) {
    promptText = 'Trap is set — waiting...';
  } else if (canPlaceFishTrap() && camera.position.x > 93) {
    promptText = player.isMobile ? 'Tap to place fish trap (6 sticks)' : 'E — Place fish trap (6 sticks)';
  } else if (canPlaceDeadfall()) {
    promptText = player.isMobile ? 'Tap to set deadfall (4 sticks + stone)' : 'E — Set deadfall (4 sticks + stone)';
  } else if (canPlaceSnare()) {
    promptText = player.isMobile ? 'Tap to set snare (2 sticks)' : 'E — Set snare (2 sticks)';
  } else if (nearestLantern() && !heldBarrel) {
    const _nl = nearestLantern();
    promptText = _nl.data.on ? 'F — turn off lantern  |  Curl to pick up' : 'F — turn on lantern  |  Curl to pick up';
  } else if (nearestBarrel() && !heldBarrel) {
    promptText = 'Curl hand to pick up barrel';
  } else if (worldFish.some(wf => camera.position.distanceTo(wf.mesh.position) < 3.5)) {
    promptText = 'Curl hand to pick up fish';
  } else if (nearestTent()) {
    promptText = player.isMobile ? 'Tap ✓ to sleep' : 'E — Sleep in tent';
  } else if (binDist < 5) {
    promptText = player.isMobile ? 'Tap to open bin' : 'E — Open bin';
  } else if (matchState.lit) {
    for (const cf of campfires) {
      if (!cf.lit && cf.stage === 'logged' && camera.position.distanceTo(cf.pos) < 3) { promptText = 'Swing arm to light campfire'; break; }
    }
    if (!promptText) {
      for (const b of billboards) {
        if (b.userData.onFire || b.userData.falling) continue;
        if (camera.position.distanceTo(b.position) < 4) { promptText = 'Swing arm to set tree on fire'; break; }
      }
    }
    if (!promptText) {
      for (const ft of fallenTrees) {
        const p = new THREE.Vector3(); ft.group.getWorldPosition(p);
        if (!ft.onFire && camera.position.distanceTo(p) < 4) { promptText = 'Swing arm to set fallen tree on fire'; break; }
      }
    }
    if (!promptText) promptText = `Match burning — ${Math.ceil(matchState.burnRemaining)}s left`;
  } else if (state.equippedTool === 'Matches') {
    promptText = 'Swing arm to strike match';
  } else if (groundItems.length > 0) {
    for (const gi of groundItems) {
      const gPos = new THREE.Vector3();
      gi.group.getWorldPosition(gPos);
      if (camera.position.distanceTo(gPos) < 4) { promptText = `${gi.name} — Curl hand to pick up`; break; }
    }
  }
  interactPrompt.textContent = '';

  // Update button labels to show exactly what each button does right now
  const _actionBtn = document.getElementById('action-btn');
  const _buildBtn  = document.getElementById('build-btn');
  const _fireBtn   = document.getElementById('fire-btn');
  const _trapBtn   = document.getElementById('trap-btn');

  // ✓ button label — ORDER MUST MATCH onInteract() action chain
  if (_actionBtn) {
    let aLabel = '✓';
    if (_heightPick) aLabel = `✅ Set ${_heightPick.height.toFixed(1)}m`;
    else if (state.equippedTool === 'Rifle') {
      const ammoCount = (state.inventory.find(i => i.name === 'Rifle Ammo') || {}).quantity || 0;
      aLabel = ammoCount > 0 ? `🔫 Fire (${ammoCount})` : '🔫 No ammo';
    }
    else if (fishState.phase === 'showing') aLabel = '🐟 Take';
    else if (fishState.phase === 'bite')    aLabel = '🎣 REEL!';
    else if (fishState.phase === 'waiting') aLabel = '⏳ Wait';
    else if (fishState.phase !== 'idle')    aLabel = '🎣';
    else if (cookingSlots.some(s => s.done && s.name !== 'Canteen Water' && s.name !== 'Barrel Water' && s.firePos.distanceTo(camera.position) < 4)) aLabel = '🍖 Collect';
    else if (state.inventory.find(i => i.name === 'Stone') && campfires.some(cf => !cf.lit && cf.stage === 'logged' && camera.position.distanceTo(cf.pos) < 3)) aLabel = '✴️ Flint';
    else if (heldFish && COOK_TIMES[heldFish.name] && nearestLitFire(camera.position)) aLabel = '🍖 Cook';
    else if (state.inventory.find(i => COOK_TIMES[i.name]) && nearestLitFire(camera.position)) aLabel = '🍖 Cook';
    else if (heldWorldItem) aLabel = '🌿 Place';
    else if (heldLog) aLabel = '🪵 Lay between trees';
    else if (nearestFallenTree(5) && state.equippedTool !== 'Axe') aLabel = '🪵 Push';
    else if (isNearRiver() && state.equippedTool === 'Fishing Rod') aLabel = '🎣 Cast';
    _actionBtn.textContent = aLabel;
  }

  // 💧 water button label — ORDER MUST MATCH onWater() action chain
  const _waterBtn = document.getElementById('water-btn');
  if (_waterBtn) {
    let wLabel = '💧';
    const _wc = getCanteen();
    const _wb = nearestBarrel();
    if (heldBarrel && isNearRiver() && heldBarrel.data.water < BARREL_MAX) wLabel = '🪣 Fill barrel';
    else if (cookingSlots.some(s => s.name === 'Barrel Water' && s.done)) wLabel = '🪣 Collect';
    else if (_wb && isNearRiver() && _wb.data.x >= 88 && _wb.data.water < BARREL_MAX) wLabel = '🪣 Fill barrel';
    else if (_wb && _wc && (_wc.water === 'raw' || _wc.water === 'boiled') && _wb.data.water < BARREL_MAX) wLabel = '🪣 Pour';
    else if (_wb && _wb.data.water > 0 && !_wb.data.boiled && nearestLitFire(new THREE.Vector3(_wb.data.x, 0, _wb.data.z), 5)) wLabel = '🔥 Boil barrel';
    else if (_wb && _wb.data.water > 0 && _wc && (!_wc.water || _wc.water === 'empty')) wLabel = '🫗 Fill canteen';
    else if (_wc && _wc.water === 'raw' && nearestLitFire(camera.position)) wLabel = '🫗 Boil';
    else if (_wc && isNearRiver() && (!_wc.water || _wc.water === 'empty')) wLabel = '🫗 Fill';
    else if (_wc && (_wc.water === 'boiled' || _wc.water === 'raw') && !_anyFireNearby(camera.position, 10) && !isNearRiver()) wLabel = '🫗 Drink';
    else if (_wc && (_wc.water === 'raw' || _wc.water === 'boiled') && _anyFireNearby(camera.position, 10)) wLabel = '💧 Douse';
    else if (cookingSlots.some(s => s.done && s.name === 'Canteen Water' && s.firePos.distanceTo(camera.position) < 4)) wLabel = '🫗 Collect';
    _waterBtn.textContent = wLabel;
  }

  // 🏕️ camp button label — ORDER MUST MATCH onCamp() action chain
  const _campBtn = document.getElementById('camp-btn');
  if (_campBtn) {
    let cLabel = '🏕️';
    if (nearestLantern()) { const _nl2 = nearestLantern(); cLabel = _nl2.data.on ? '💡 Off' : '💡 On'; }
    else if (nearestTent()) cLabel = '😴 Sleep';
    else if (state.player.health < 100 && state.inventory.find(i => i.name === 'First Aid Kit')) cLabel = '🩹 Heal';
    else if (state.inventory.find(i => EAT_VALUES[i.name])) cLabel = '🍖 Eat';
    else if (binDist < 5) cLabel = '📦 Bin';
    _campBtn.textContent = cLabel;
  }

  // 🔨 build button label — ORDER MUST MATCH onBuild() action chain
  if (_buildBtn) {
    let bLabel = '🔨';
    if (state.equippedTool === 'Rifle') bLabel = _adsActive ? '🔭 Un-aim' : (hasScope() ? '🔭 Aim' : '🔫 (no scope)');
    else if (state.equippedTool === 'Lantern') bLabel = '🪔 Place';
    else if (state.equippedTool === 'Barrel')  bLabel = '🪣 Place barrel';
    else if (state.equippedTool === 'Canvas')  bLabel = '🏕️ Start';
    else if (state.equippedTool === 'Tent') bLabel = '⛺ Place tent';
    else if (heldLog) bLabel = '🪵 Plant post';
    // handleBuildInteract: canvasMode → heightPick → beam complete → beam start → stack → post
    else if (_canvasMode) bLabel = `📐 Corner ${_canvasCorners.length+1}/4`;
    else if (_heightPick) bLabel = '⬆ Higher';
    else if (_beamFirstPost && nearestAnchor(2, 3.5) && state.inventory.find(i => i.name === 'Log') && state.equippedTool !== 'Shovel') bLabel = '🪵 Beam';
    else if (nearestAnchor(2, 3.5) && state.inventory.find(i => i.name === 'Log') && state.equippedTool !== 'Shovel') bLabel = '🔩 Beam';
    else if (nearestPost(2) && state.inventory.find(i => i.name === 'Log') && state.equippedTool === 'Shovel') bLabel = '🪵 Stack';
    else if (state.inventory.find(i => i.name === 'Log') && state.equippedTool !== 'Shovel' && !nearPitAtStage('rocked')) bLabel = '🪵 Post';
    _buildBtn.textContent = bLabel;
  }

  // 🔥 fire button label
  // 🔥 fire button label — ORDER MUST MATCH onFire() action chain
  if (_fireBtn) {
    let fLabel = '🔥';
    if (_heightPick) fLabel = '⬇ Lower';
    // handleFirePitInteract: rocked → dug → shovel (logged is lit via arm swing, not 🔥)
    else if (nearPitAtStage('rocked')) {
      const logs = state.inventory.find(i => i.name === 'Log');
      fLabel = (logs && logs.quantity >= 2) ? '🪵 Add logs' : '🔥 Need logs';
    }
    else if (nearPitAtStage('dug'))    fLabel = '🪨 Add rocks';
    else if (state.equippedTool === 'Shovel') fLabel = '⛏️ Dig pit';
    _fireBtn.textContent = fLabel;
  }

  // 🪤 trap button label
  if (_trapBtn) {
    let tLabel = '🪤';
    if (_heightPick || _canvasMode) tLabel = '✕ Cancel';
    else {
      const nearTrap = trapManager.getNearby(camera.position);
      if (nearTrap && nearTrap.triggered) tLabel = '✅ Collect';
      else if (nearTrap) tLabel = '⏳ Waiting';
      else if (canPlaceFishTrap() && camera.position.x > 93) tLabel = '🐟 Fish trap';
      else if (canPlaceDeadfall()) tLabel = '🪨 Deadfall';
      else if (canPlaceSnare())    tLabel = '🔁 Snare';
    }
    _trapBtn.textContent = tLabel;
  }

  // DEBUG: show player X position
  const dbg = document.getElementById('debug-pos');
  if (dbg) dbg.textContent = `X=${camera.position.x.toFixed(1)} Z=${camera.position.z.toFixed(1)}`;

  updateUI(state);

  renderer.clear();
  renderer.render(worldScene, camera);
  hands.render(camera);
}

// Remove chopped trees (health 0) from billboards on load
for (let i = billboards.length - 1; i >= 0; i--) {
  const id = billboards[i].userData.treeId;
  if (state.world.treeHealth[id] !== undefined && state.world.treeHealth[id] <= 0) {
    worldScene.remove(billboards[i]);
    billboards.splice(i, 1);
  }
}
restoreStructures();
restoreWorldState();
animate();
