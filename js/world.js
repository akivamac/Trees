import * as THREE from 'three';
import { makeGroundTool } from './tools.js?v=5';

export function createWorld(scene) {
  // Sky & fog
  scene.background = new THREE.Color(0x87ceeb);
  scene.fog = new THREE.FogExp2(0x87ceeb, 0.012);

  // Lighting
  const ambient = new THREE.AmbientLight(0xfff5e0, 0.5);
  scene.add(ambient);

  const sun = new THREE.DirectionalLight(0xfff5e0, 1.2);
  sun.position.set(80, 120, 40);
  sun.castShadow = true;
  sun.shadow.mapSize.width = 2048;
  sun.shadow.mapSize.height = 2048;
  sun.shadow.camera.near = 0.5;
  sun.shadow.camera.far = 500;
  sun.shadow.camera.left   = -200;
  sun.shadow.camera.right  =  200;
  sun.shadow.camera.top    =  200;
  sun.shadow.camera.bottom = -200;
  scene.add(sun);

  buildGround(scene);
  const riverMesh = buildRiver(scene);
  buildRoad(scene);
  const binMesh = buildSupplyBin(scene);
  buildRocks(scene);
  buildUndergrowth(scene);
  buildDistantHills(scene);
  buildShoreline(scene);

  // Billboard list — filled async, used in main for rotation updates
  const billboards = [];
  loadAndPlaceTrees(scene, billboards);

  return { sun, ambient, billboards, binMesh, riverMesh };
}

/**
 * Place physical tool objects on the ground near the supply bin.
 * Returns array of { name, mesh } so main.js can raycast/proximity-check them.
 * Caller passes `pickedUp` (array of names already grabbed) to skip those.
 */
export function placeGroundTools(scene, pickedUp = []) {
  const BIN_X = 3, BIN_Z = -60;
  // Offsets around the bin: spread tools on the ground nearby
  const positions = [
    { name: 'Axe',         x: BIN_X - 1.5, z: BIN_Z + 1.5 },
    { name: 'Shovel',      x: BIN_X + 1.8, z: BIN_Z + 1.2 },
    { name: 'Fishing Rod', x: BIN_X - 0.4, z: BIN_Z + 2.2 },
    { name: 'Knife',       x: BIN_X + 0.8, z: BIN_Z + 2.0 },
  ];

  const groundItems = [];
  for (const { name, x, z } of positions) {
    if (pickedUp.includes(name)) continue;
    const g = makeGroundTool(name);
    g.position.set(x, 0, z);
    g.userData.groundTool = name;
    scene.add(g);
    // Collect all child meshes so we can raycast them
    const meshes = [];
    g.traverse(obj => { if (obj.isMesh) meshes.push(obj); });
    groundItems.push({ name, group: g, meshes });
  }
  return groundItems;
}

// ── Ground ─────────────────────────────────────────────────────────

function makeGroundTexture(baseHex, darkHex, size = 512) {
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const ctx = c.getContext('2d');
  ctx.fillStyle = `#${baseHex.toString(16).padStart(6, '0')}`;
  ctx.fillRect(0, 0, size, size);
  // Small irregular leaf-litter / duff patches — varied colours, small radii
  const r0 = (baseHex >> 16) & 0xff, g0 = (baseHex >> 8) & 0xff, b0 = baseHex & 0xff;
  const r1 = (darkHex >> 16) & 0xff, g1 = (darkHex >> 8) & 0xff, b1 = darkHex & 0xff;
  for (let i = 0; i < 900; i++) {
    const x = Math.random() * size;
    const y = Math.random() * size;
    const t = Math.random();
    const r = 1.5 + Math.random() * 5;        // small — max 5px
    const rx = r * (0.5 + Math.random());
    const ry = r * (0.3 + Math.random() * 0.5);
    const cr = Math.round(r0 + (r1 - r0) * t);
    const cg = Math.round(g0 + (g1 - g0) * t);
    const cb = Math.round(b0 + (b1 - b0) * t);
    ctx.fillStyle = `rgba(${cr},${cg},${cb},${0.35 + Math.random() * 0.45})`;
    ctx.beginPath();
    ctx.ellipse(x, y, rx, ry, Math.random() * Math.PI, 0, Math.PI * 2);
    ctx.fill();
  }
  const tex = new THREE.CanvasTexture(c);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(18, 18);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

function buildGround(scene) {
  // Forest floor — green with duff/needle patches
  const forestTex = makeGroundTexture(0x4a7a2a, 0x28420f);
  const forest = new THREE.Mesh(
    new THREE.PlaneGeometry(500, 500, 50, 50),
    new THREE.MeshLambertMaterial({ map: forestTex })
  );
  forest.rotation.x = -Math.PI / 2;
  forest.position.set(-50, 0, 80);
  forest.receiveShadow = true;
  scene.add(forest);

  // Meadow (far west) — brighter grass
  const meadowTex = makeGroundTexture(0x5d9632, 0x3a6018);
  const meadow = new THREE.Mesh(
    new THREE.PlaneGeometry(120, 500, 20, 50),
    new THREE.MeshLambertMaterial({ map: meadowTex })
  );
  meadow.rotation.x = -Math.PI / 2;
  meadow.position.set(-250, 0.01, 80);
  meadow.receiveShadow = true;
  scene.add(meadow);

  // Riverbank — narrow sandy strip right at the waterline (X=93–100)
  const bankTex = makeGroundTexture(0x7a6040, 0x4a3820);
  const bank = new THREE.Mesh(
    new THREE.PlaneGeometry(7, 200),
    new THREE.MeshLambertMaterial({ map: bankTex })
  );
  bank.rotation.x = -Math.PI / 2;
  bank.position.set(96.5, 0.02, 0);
  bank.receiveShadow = true;
  scene.add(bank);
}

// ── Rocks ──────────────────────────────────────────────────────────

function buildRocks(scene) {
  const rng = seededRandom(13);
  const mats = [
    new THREE.MeshLambertMaterial({ color: 0x484840 }),
    new THREE.MeshLambertMaterial({ color: 0x3e3e38 }),
    new THREE.MeshLambertMaterial({ color: 0x525248 }),
  ];

  for (let i = 0; i < 200; i++) {
    const x = -180 + rng() * 270;
    const z = -75  + rng() * 340;
    if (x > 90) continue;
    if (Math.abs(x) < 3 && z < -50) continue; // keep road clear

    const big = rng() < 0.2;
    const r   = big ? 0.4 + rng() * 0.7 : 0.08 + rng() * 0.28;
    const geo = new THREE.DodecahedronGeometry(r, 0);
    // Squish to look flatter/more natural
    const rock = new THREE.Mesh(geo, mats[Math.floor(rng() * mats.length)]);
    rock.scale.y = 0.45 + rng() * 0.35;
    rock.scale.x = 0.8 + rng() * 0.4;
    rock.rotation.y = rng() * Math.PI * 2;
    rock.rotation.z = (rng() - 0.5) * 0.4;
    rock.position.set(x, r * rock.scale.y * 0.5, z);
    rock.castShadow = true;
    rock.receiveShadow = true;
    scene.add(rock);

    // Cluster: 1-3 small rocks nearby
    if (big) {
      const n = 1 + Math.floor(rng() * 3);
      for (let j = 0; j < n; j++) {
        const sr  = 0.06 + rng() * 0.14;
        const geo2 = new THREE.DodecahedronGeometry(sr, 0);
        const r2   = new THREE.Mesh(geo2, mats[Math.floor(rng() * mats.length)]);
        r2.scale.y = 0.5 + rng() * 0.3;
        r2.rotation.y = rng() * Math.PI * 2;
        r2.position.set(x + (rng() - 0.5) * r * 3, sr * r2.scale.y * 0.5, z + (rng() - 0.5) * r * 3);
        r2.castShadow = true;
        scene.add(r2);
      }
    }
  }
}

// ── Undergrowth ────────────────────────────────────────────────────

function buildUndergrowth(scene) {
  const rng = seededRandom(21);

  // Grass tuft colours — dark forest greens and olive
  const grassColors = [0x2d5e14, 0x3a6e1a, 0x4a7a20, 0x3d6618, 0x526b22];

  for (let i = 0; i < 800; i++) {
    const x = -180 + rng() * 265;
    const z = -72  + rng() * 335;
    if (x > 85) continue;
    if (Math.abs(x) < 4 && z < -52) continue;

    const color = grassColors[Math.floor(rng() * grassColors.length)];
    const mat   = new THREE.MeshLambertMaterial({ color, side: THREE.DoubleSide });
    const h     = 0.18 + rng() * 0.32;
    const w     = 0.12 + rng() * 0.22;

    // 3–5 blades per tuft, two crossed planes each
    const blades = 2 + Math.floor(rng() * 3);
    for (let b = 0; b < blades; b++) {
      const bx = x + (rng() - 0.5) * 0.4;
      const bz = z + (rng() - 0.5) * 0.4;
      for (let pass = 0; pass < 2; pass++) {
        const geo  = new THREE.PlaneGeometry(w, h);
        const mesh = new THREE.Mesh(geo, mat);
        mesh.rotation.y = (pass / 2) * Math.PI + rng() * 0.5;
        mesh.rotation.z = (rng() - 0.5) * 0.25; // slight tilt
        mesh.position.set(bx, h * 0.5, bz);
        scene.add(mesh);
      }
    }
  }
}

// ── Distant Hills ──────────────────────────────────────────────────

function buildDistantHills(scene) {
  // Silhouette ridge behind the forest (north/south ends + west)
  const hillMat = new THREE.MeshLambertMaterial({ color: 0x2d5a18, fog: true });
  const rng = seededRandom(99);

  const positions = [
    { x: -240, z:   0, w: 100 },
    { x: -200, z: 180, w: 80  },
    { x: -100, z: 320, w: 120 },
    { x:   50, z: 320, w: 100 },
    { x:    0, z:-140, w: 100 },
    { x: -150, z:-120, w: 80  },
  ];

  for (const { x, z, w } of positions) {
    const geo = new THREE.ConeGeometry(w * 0.5, 18 + rng() * 14, 10);
    const hill = new THREE.Mesh(geo, hillMat);
    hill.scale.x = 1.8 + rng();
    hill.scale.z = 1.4 + rng() * 0.6;
    hill.position.set(x, 2, z);
    hill.receiveShadow = true;
    scene.add(hill);
    // Second overlapping hill
    const geo2 = new THREE.ConeGeometry(w * 0.35, 12 + rng() * 10, 8);
    const hill2 = new THREE.Mesh(geo2, hillMat);
    hill2.scale.x = 1.5 + rng();
    hill2.scale.z = 1.2 + rng() * 0.5;
    hill2.position.set(x + (rng() - 0.5) * 30, 1, z + (rng() - 0.5) * 20);
    scene.add(hill2);
  }
}

// ── River ──────────────────────────────────────────────────────────

function buildRiver(scene) {
  // Deep base — dark still water beneath
  const base = new THREE.Mesh(
    new THREE.PlaneGeometry(34, 320),
    new THREE.MeshLambertMaterial({ color: 0x0d3d5e })
  );
  base.rotation.x = -Math.PI / 2;
  base.position.set(115, 0.03, 0);
  scene.add(base);

  // Animated surface — subdivided so vertices can wave
  const shimmer = new THREE.Mesh(
    new THREE.PlaneGeometry(30, 300, 24, 60),
    new THREE.MeshLambertMaterial({ color: 0x1e7ab8, transparent: true, opacity: 0.94 })
  );
  shimmer.rotation.x = -Math.PI / 2;
  shimmer.position.set(115, 0.06, 0);
  shimmer.geometry.attributes.position.usage = THREE.DynamicDrawUsage;
  scene.add(shimmer);

  // Foam / highlight strip at each bank edge
  for (const dx of [-16, 16]) {
    const foam = new THREE.Mesh(
      new THREE.PlaneGeometry(2, 300),
      new THREE.MeshLambertMaterial({ color: 0xc8e8f8, transparent: true, opacity: 0.72 })
    );
    foam.rotation.x = -Math.PI / 2;
    foam.position.set(115 + dx, 0.07, 0);
    scene.add(foam);
  }

  return shimmer;
}

// ── Shoreline ──────────────────────────────────────────────────────

function buildShoreline(scene) {
  // River shimmer spans X=100–130. West foam at X=99, east foam at X=131.
  // Near/west bank (player side) = X < 100.  Far/east bank = X > 130.

  const rockMat  = new THREE.MeshLambertMaterial({ color: 0x6a6458 });
  const sandMat  = new THREE.MeshLambertMaterial({ color: 0x9a8060 });
  const mudMat   = new THREE.MeshLambertMaterial({ color: 0x5a4830 });
  const waterMat = new THREE.MeshLambertMaterial({ color: 0x1e7ab8, transparent: true, opacity: 0.88 });
  const rng      = seededRandom(55);

  // River water: X=100–130. Sandy bank: X=93–100.
  // WEST bank rocks: X=93–100 (on sandy bank, right at waterline)
  for (let z = -140; z < 140; z += 3) {
    const patch = new THREE.Mesh(new THREE.CircleGeometry(1, 7), rng() < 0.6 ? sandMat : mudMat);
    patch.rotation.x = -Math.PI / 2;
    patch.scale.set(1.5 + rng() * 3, 1 + rng() * 2, 1);
    patch.position.set(93 + rng() * 6, 0.04, z + rng() * 2);
    scene.add(patch);

    if (rng() < 0.4) {
      const tongue = new THREE.Mesh(new THREE.CircleGeometry(1, 6), waterMat);
      tongue.rotation.x = -Math.PI / 2;
      tongue.scale.set(1 + rng() * 2, 0.6 + rng(), 1);
      tongue.position.set(96 + rng() * 3, 0.05, z + rng() * 3);
      scene.add(tongue);
    }

    const n = 1 + Math.floor(rng() * 2);
    for (let i = 0; i < n; i++) {
      const r = 0.25 + rng() * 0.5;
      const rock = new THREE.Mesh(new THREE.DodecahedronGeometry(r, 0), rockMat);
      rock.scale.set(0.9 + rng() * 0.4, 0.45 + rng() * 0.35, 1);
      rock.rotation.y = rng() * 6.28;
      rock.position.set(93 + rng() * 6, r * 0.4 + 0.12, z + rng() * 3);
      rock.castShadow = true;
      scene.add(rock);
    }
  }

  // EAST bank rocks: X=131–140 (past the far edge of the water)
  for (let z = -140; z < 140; z += 3) {
    const patch = new THREE.Mesh(new THREE.CircleGeometry(1, 7), rng() < 0.6 ? sandMat : mudMat);
    patch.rotation.x = -Math.PI / 2;
    patch.scale.set(1.5 + rng() * 3, 1 + rng() * 2, 1);
    patch.position.set(131 + rng() * 8, 0.04, z + rng() * 2);
    scene.add(patch);

    if (rng() < 0.4) {
      const tongue = new THREE.Mesh(new THREE.CircleGeometry(1, 6), waterMat);
      tongue.rotation.x = -Math.PI / 2;
      tongue.scale.set(1 + rng() * 2, 0.6 + rng(), 1);
      tongue.position.set(131 + rng() * 3, 0.05, z + rng() * 3);
      scene.add(tongue);
    }

    const n = 1 + Math.floor(rng() * 2);
    for (let i = 0; i < n; i++) {
      const r = 0.25 + rng() * 0.5;
      const rock = new THREE.Mesh(new THREE.DodecahedronGeometry(r, 0), rockMat);
      rock.scale.set(0.9 + rng() * 0.4, 0.45 + rng() * 0.35, 1);
      rock.rotation.y = rng() * 6.28;
      rock.position.set(131 + rng() * 8, r * 0.4 + 0.12, z + rng() * 3);
      rock.castShadow = true;
      scene.add(rock);
    }
  }
}

// ── Road ───────────────────────────────────────────────────────────

function buildRoad(scene) {
  const road = new THREE.Mesh(
    new THREE.PlaneGeometry(6, 40),
    new THREE.MeshLambertMaterial({ color: 0x8b7355 })
  );
  road.rotation.x = -Math.PI / 2;
  road.position.set(0, 0.02, -80);
  scene.add(road);
}

// ── Supply Bin ─────────────────────────────────────────────────────

function buildSupplyBin(scene) {
  const body = new THREE.Mesh(
    new THREE.BoxGeometry(2.5, 1.2, 1.5),
    new THREE.MeshLambertMaterial({ color: 0x8b6914 })
  );
  body.position.set(3, 0.6, -60);
  body.castShadow = true;
  body.userData.isBin = true;
  scene.add(body);

  const lid = new THREE.Mesh(
    new THREE.BoxGeometry(2.6, 0.15, 1.6),
    new THREE.MeshLambertMaterial({ color: 0x6b4f10 })
  );
  lid.position.set(3, 1.275, -60);
  scene.add(lid);

  return body;
}

// ── Tree Photo Billboards ──────────────────────────────────────────

async function loadAndPlaceTrees(scene, billboards) {
  try {
    const [sheet1, sheet2, sheet3] = await Promise.allSettled([
      sliceContactSheet('trees_contact_sheet.png',   { rows: 3, skipFirstCell: true }),
      sliceContactSheet('trees_contact_sheet_2.png', { rows: 2, skipFirstCell: false, cleanBottom: true }),
      sliceContactSheet('trees_contact_sheet_3.png', { rows: 3, skipFirstCell: false, cleanBottom: 'all' }),
    ]);

    const textures = [
      ...(sheet1.status === 'fulfilled' ? sheet1.value : []),
      ...(sheet2.status === 'fulfilled' ? sheet2.value : []),
      ...(sheet3.status === 'fulfilled' ? sheet3.value : []),
    ];

    if (textures.length === 0) throw new Error('No textures loaded');
    placeTreeBillboards(scene, textures, billboards);
  } catch (e) {
    console.warn('Tree photo load failed, using fallback geometry:', e);
    placeFallbackTrees(scene);
  }
}

function loadImage(src) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => resolve(img);
    img.onerror = reject;
    img.src = src;
  });
}

// cleanBottom: true = erase root balls on saplings (fill<0.55) only
//              'all' = erase on every segment (for sheets where all trees have dirt/grass bases)
async function sliceContactSheet(src, { rows = 3, skipFirstCell = false, cleanBottom = false } = {}) {
  const img = await loadImage(src);
  const W = img.width;
  const H = img.height;
  const rowH = H / rows;
  const labelOffset = rowH * 0.08;

  const allTrees = [];

  for (let row = 0; row < rows; row++) {
    const ch = Math.round(rowH - labelOffset);
    const canvas = document.createElement('canvas');
    canvas.width  = W;
    canvas.height = ch;
    const ctx = canvas.getContext('2d');
    ctx.drawImage(img, 0, Math.round(row * rowH + labelOffset), W, Math.round(rowH - labelOffset),
                       0, 0, W, ch);
    removeWhiteBackground(ctx, W, ch);

    // First sheet: col 0, row 0 has real sky — erase it
    if (skipFirstCell && row === 0) ctx.clearRect(0, 0, Math.round(W / 4), ch);

    const segments = detectTreeSegments(ctx, W, ch);
    const imageData = ctx.getImageData(0, 0, W, ch);

    // Per-segment root ball / dirt base removal — must happen before texture is created
    if (cleanBottom) {
      for (let si = 0; si < segments.length; si++) {
        const seg  = segments[si];
        const fill = measureVerticalFill(imageData.data, seg.left, seg.right, W, ch);
        if (cleanBottom === 'all' || fill < 0.55) {
          eraseRootBall(imageData.data, seg.left, seg.right, W, ch);
        }
      }
      ctx.putImageData(imageData, 0, 0);
    }

    const tex = new THREE.CanvasTexture(canvas);
    tex.colorSpace = THREE.SRGBColorSpace;

    for (let si = 0; si < segments.length; si++) {
      const seg    = segments[si];
      const u0     = seg.left  / W;
      const u1     = seg.right / W;
      const aspect = (seg.right - seg.left) / ch;
      const fill   = measureVerticalFill(imageData.data, seg.left, seg.right, W, ch);
      // vBase: fraction of canvas empty below actual content — used to ground the tree
      const vBase  = contentBottomGap(imageData.data, seg.left, seg.right, W, ch);
      allTrees.push({ tex, u0, u1, aspect, fill, vBase });
    }
  }

  return allTrees;
}

// Scan each x column for non-transparent pixels, then find contiguous content segments
function detectTreeSegments(ctx, w, h) {
  const data = ctx.getImageData(0, 0, w, h).data;

  const hasContent = new Uint8Array(w);
  for (let x = 0; x < w; x++) {
    for (let y = 0; y < h; y++) {
      if (data[(y * w + x) * 4 + 3] > 10) { hasContent[x] = 1; break; }
    }
  }

  const segments = [];
  let inSeg = false, start = 0;

  for (let x = 0; x <= w; x++) {
    const content = x < w && hasContent[x];
    if (!inSeg && content) {
      inSeg = true; start = x;
    } else if (inSeg && !content) {
      // Measure the gap — small gaps inside a canopy don't split the tree
      let gapEnd = x;
      while (gapEnd < w && !hasContent[gapEnd]) gapEnd++;
      const gapLen = gapEnd - x;
      if (gapLen > 15 || gapEnd === w) {
        // Real separator — record this tree with small pixel padding
        segments.push({
          left:  Math.max(0,     start - 4),
          right: Math.min(w - 1, x - 1 + 4),
        });
        inSeg = false;
        x = gapEnd - 1; // skip the gap
      }
      // else: tiny gap within canopy, keep going
    }
  }

  return segments;
}

// Returns the fraction of row height occupied by actual content (0..1)
function measureVerticalFill(data, x0, x1, w, h) {
  let topY = h, bottomY = 0;
  for (let y = 0; y < h; y++) {
    for (let x = x0; x <= x1; x++) {
      if (data[(y * w + x) * 4 + 3] > 10) {
        if (y < topY)    topY    = y;
        if (y > bottomY) bottomY = y;
        break;
      }
    }
  }
  return topY < bottomY ? (bottomY - topY) / h : 0;
}

// Erase the root ball / grass base from a single tree segment.
// Guard: only erases if the bottom zone is at least 1.4× wider than the trunk above it.
function eraseRootBall(data, x0, x1, w, h) {
  // Find content bounding box
  let topY = h, bottomY = -1;
  for (let y = 0; y < h; y++) {
    for (let x = x0; x <= x1; x++) {
      if (data[(y * w + x) * 4 + 3] > 10) {
        if (y < topY)    topY    = y;
        if (y > bottomY) bottomY = y;
        break;
      }
    }
  }
  if (bottomY < 0 || bottomY <= topY) return;

  const contentH = bottomY - topY;

  // Max width in bottom 20% of content = ball/grass width
  const ballZoneStart = Math.floor(bottomY - contentH * 0.20);
  let ballWidth = 0;
  for (let y = ballZoneStart; y <= bottomY; y++) {
    let ww = 0;
    for (let x = x0; x <= x1; x++) {
      if (data[(y * w + x) * 4 + 3] > 10) ww++;
    }
    if (ww > ballWidth) ballWidth = ww;
  }

  // Avg width in the 20–50% zone above the ball = trunk width
  const stemZoneTop    = Math.floor(bottomY - contentH * 0.50);
  const stemZoneBottom = ballZoneStart;
  let stemTotal = 0, stemRows = 0;
  for (let y = stemZoneTop; y <= stemZoneBottom; y++) {
    let ww = 0;
    for (let x = x0; x <= x1; x++) {
      if (data[(y * w + x) * 4 + 3] > 10) ww++;
    }
    stemTotal += ww; stemRows++;
  }
  const trunkWidth = stemRows > 0 ? stemTotal / stemRows : ballWidth;

  // Only proceed if bottom is clearly wider than the trunk — real ball/grass
  if (ballWidth < trunkWidth * 1.4) return;

  // Scan upward from bottom; erase until width drops to ≤ 30% of ball width (the stem)
  for (let y = bottomY; y >= topY; y--) {
    let ww = 0;
    for (let x = x0; x <= x1; x++) {
      if (data[(y * w + x) * 4 + 3] > 10) ww++;
    }
    if (ww > 0 && ww < ballWidth * 0.30) break;
    for (let x = x0; x <= x1; x++) data[(y * w + x) * 4 + 3] = 0;
  }
}

// Returns the fraction of canvas height that is empty below the actual content.
// Used to shift the billboard plane down so the tree base sits at ground level.
function contentBottomGap(data, x0, x1, w, h) {
  for (let y = h - 1; y >= 0; y--) {
    for (let x = x0; x <= x1; x++) {
      if (data[(y * w + x) * 4 + 3] > 10) return (h - 1 - y) / h;
    }
  }
  return 0;
}

function removeWhiteBackground(ctx, w, h) {
  const imgData = ctx.getImageData(0, 0, w, h);
  const d = imgData.data;
  for (let i = 0; i < d.length; i += 4) {
    const r = d[i], g = d[i + 1], b = d[i + 2];
    const brightness = (r + g + b) / 3;
    // Also check how "grey/white" the pixel is (low saturation = likely background)
    const max = Math.max(r, g, b);
    const min = Math.min(r, g, b);
    const saturation = max === 0 ? 0 : (max - min) / max;

    if (brightness > 230 && saturation < 0.15) {
      d[i + 3] = 0; // fully transparent
    } else if (brightness > 180 && saturation < 0.12) {
      // Feather anti-aliased edges — fade out as brightness approaches 230
      d[i + 3] = Math.round(((230 - brightness) / 50) * 255);
    }
  }
  ctx.putImageData(imgData, 0, 0);
}

function placeTreeBillboards(scene, treeInfos, billboards) {
  const rng = seededRandom(42);
  let treeId = 0;

  for (let i = 0; i < 1800; i++) {
    const x = -180 + rng() * 268;   // x: -180 to 88
    const z = -70  + rng() * 330;   // z: -70  to 260

    if (x >  88) continue;
    if (Math.abs(x) < 2 && z < -55) continue;

    const info = treeInfos[Math.floor(rng() * treeInfos.length)];

    // Scale height by how much of the sheet row the content fills:
    // fill > 0.5 → full-grown tree (8–16 m), else sapling (1–3 m)
    const isSapling = (info.fill !== undefined && info.fill < 0.5);
    const height = isSapling ? 1 + rng() * 2 : 8 + rng() * 8;

    const mat = new THREE.MeshBasicMaterial({
      map: info.tex,
      transparent: true,
      alphaTest: 0.08,
      side: THREE.DoubleSide,
      depthWrite: false,
    });

    // Plane sized to match this tree's cell aspect ratio
    const geo = new THREE.PlaneGeometry(height * info.aspect, height);

    // Remap UVs so only this tree's column [u0..u1] is shown
    const uvAttr = geo.attributes.uv;
    for (let v = 0; v < uvAttr.count; v++) {
      const u = uvAttr.getX(v);
      uvAttr.setX(v, info.u0 + u * (info.u1 - info.u0));
    }
    uvAttr.needsUpdate = true;

    const mesh = new THREE.Mesh(geo, mat);
    // Shift plane down by the empty gap below content so tree base aligns with ground
    mesh.position.set(x, height / 2 - (info.vBase || 0) * height, z);
    mesh.userData.treeId = treeId++;
    mesh.userData.treeHeight = height;
    scene.add(mesh);
    billboards.push(mesh);
  }
}

// Fallback if image fails to load
function placeFallbackTrees(scene) {
  const trunkMat  = new THREE.MeshLambertMaterial({ color: 0x6b4c2a });
  const foliageMat = new THREE.MeshLambertMaterial({ color: 0x2d5a1b });
  const rng = seededRandom(42);

  for (let i = 0; i < 800; i++) {
    const x = -180 + rng() * 268;
    const z = -70  + rng() * 330;
    if (x > 88) continue;

    const h = 8 + rng() * 8;
    const trunk = new THREE.Mesh(new THREE.CylinderGeometry(0.18, 0.28, h * 0.35, 7), trunkMat);
    trunk.position.set(x, h * 0.175, z);
    scene.add(trunk);

    for (let t = 0; t < 3; t++) {
      const cone = new THREE.Mesh(new THREE.ConeGeometry(2 - t * 0.4, 3, 8), foliageMat);
      cone.position.set(x, h * 0.35 + t * 1.8, z);
      scene.add(cone);
    }
  }
}

// Seeded RNG (mulberry32) for consistent tree placement
function seededRandom(seed) {
  return function () {
    seed |= 0; seed = seed + 0x6d2b79f5 | 0;
    let t = Math.imul(seed ^ seed >>> 15, 1 | seed);
    t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
    return ((t ^ t >>> 14) >>> 0) / 4294967296;
  };
}
