// Emballages paramétriques : boîte pliante, sac et coffret.
// Dimensions, couleur, finition, logo et texte se règlent en direct.
import * as THREE from 'three';
import { makeDielineBuilders, DIELINE_ART, makeDimension, rect } from './dielines.js';

// Taille maximale de l'emballage dans la scène (en unités 3D).
export const SCENE_SIZE = 2.2;

// Faces de BoxGeometry : +x, -x, +y (dessus), -y (dessous), +z (avant), -z (arrière).
const FACE = { RIGHT: 0, LEFT: 1, TOP: 2, BOTTOM: 3, FRONT: 4, BACK: 5 };
const { RIGHT, LEFT, TOP, BOTTOM, FRONT, BACK } = FACE;

// Faces qui reçoivent le logo et le texte, selon le type et l'emplacement choisi.
const ART_FACES = {
  'boite-pliante': { front: [FRONT], 'front-back': [FRONT, BACK], all: [FRONT, BACK, LEFT, RIGHT, TOP] },
  sac: { front: [FRONT], 'front-back': [FRONT, BACK], all: [FRONT, BACK, LEFT, RIGHT] },
  coffret: { front: [TOP], 'front-back': [TOP, FRONT], all: [TOP, FRONT, BACK, LEFT, RIGHT] },
  // Présentoir : les zones sont gérées par panneau dans buildDisplay.
  presentoir: { front: ['fronton'], 'front-back': ['fronton', 'bord'], all: ['fronton', 'bord', 'dos'] },
};

export const TYPES = {
  'boite-pliante': {
    label: 'Boîte pliante',
    dims: { width: 120, depth: 80, height: 200 },
    placements: { front: 'Face avant', 'front-back': 'Faces avant et arrière', all: 'Toutes les faces visibles' },
  },
  sac: {
    label: 'Sac',
    dims: { width: 260, depth: 100, height: 320 },
    placements: { front: 'Face avant', 'front-back': 'Faces avant et arrière', all: 'Toutes les faces' },
  },
  coffret: {
    label: 'Coffret',
    dims: { width: 260, depth: 200, height: 90 },
    placements: { front: 'Dessus du couvercle', 'front-back': 'Dessus et face avant du couvercle', all: 'Couvercle entier' },
  },
  presentoir: {
    label: 'Présentoir',
    dims: { width: 300, depth: 250, height: 380 },
    placements: { front: 'Fronton', 'front-back': 'Fronton et bord avant', all: 'Fronton, bord avant et dos' },
  },
};

const FINISHES = {
  mat: { roughness: 0.78, clearcoat: 0, clearcoatRoughness: 0 },
  brillant: { roughness: 0.32, clearcoat: 1, clearcoatRoughness: 0.06 },
  kraft: { roughness: 0.95, clearcoat: 0, clearcoatRoughness: 0 },
};

export const DEFAULT_STATE = {
  type: 'boite-pliante',
  ...TYPES['boite-pliante'].dims, // width = longueur, depth = largeur, height = hauteur (mm)
  color: '#ffffff',
  finish: 'mat',
  logo: null, // HTMLImageElement
  logoName: '',
  logoScale: 0.55,
  placement: 'front',
  text: '',
  view2d: false, // boîte, sac, coffret : vue 2D (patron à plat)
  open: 0, // boîte et coffret : ouverture des rabats ou du couvercle (0 à 1)
  flat: false, // présentoir uniquement : vue dépliée à plat
};

// ---------- Textures ----------
let kraftCanvas = null;
function getKraftCanvas() {
  if (kraftCanvas) return kraftCanvas;
  const size = 256;
  kraftCanvas = document.createElement('canvas');
  kraftCanvas.width = kraftCanvas.height = size;
  const ctx = kraftCanvas.getContext('2d');
  ctx.fillStyle = '#b88a5c';
  ctx.fillRect(0, 0, size, size);
  const img = ctx.getImageData(0, 0, size, size);
  for (let i = 0; i < img.data.length; i += 4) {
    const n = (Math.random() - 0.5) * 26;
    img.data[i] += n;
    img.data[i + 1] += n;
    img.data[i + 2] += n * 0.8;
  }
  ctx.putImageData(img, 0, 0);
  for (let i = 0; i < 260; i++) {
    ctx.strokeStyle = Math.random() > 0.5 ? 'rgba(90,60,30,0.18)' : 'rgba(230,200,160,0.18)';
    ctx.lineWidth = Math.random() * 1.2 + 0.3;
    const x = Math.random() * size;
    const y = Math.random() * size;
    const a = Math.random() * Math.PI;
    const l = Math.random() * 14 + 4;
    ctx.beginPath();
    ctx.moveTo(x, y);
    ctx.lineTo(x + Math.cos(a) * l, y + Math.sin(a) * l);
    ctx.stroke();
  }
  return kraftCanvas;
}

function contrastColor(state) {
  if (state.finish === 'kraft') return '#3a2814';
  const c = new THREE.Color(state.color);
  const lum = 0.2126 * c.r + 0.7152 * c.g + 0.0722 * c.b;
  return lum > 0.45 ? '#141a2b' : '#ffffff';
}

// Dessine une face : fond (couleur ou kraft), intérieur assombri, pli de soufflet, logo et texte.
function drawFace(faceW, faceH, state, { art = false, interior = false, crease = false } = {}) {
  const res = 900 / Math.max(faceW, faceH);
  const cw = Math.max(8, Math.round(faceW * res));
  const ch = Math.max(8, Math.round(faceH * res));
  const canvas = document.createElement('canvas');
  canvas.width = cw;
  canvas.height = ch;
  const ctx = canvas.getContext('2d');

  ctx.fillStyle = state.finish === 'kraft' ? ctx.createPattern(getKraftCanvas(), 'repeat') : state.color;
  ctx.fillRect(0, 0, cw, ch);

  if (interior) {
    // Intérieur : un bord de carton puis un fond en creux (éclairci si la couleur est foncée).
    const dark = contrastColor(state) === '#ffffff';
    const inset = Math.min(cw, ch) * 0.045;
    const g = ctx.createRadialGradient(cw / 2, ch / 2, 0, cw / 2, ch / 2, Math.max(cw, ch) * 0.7);
    g.addColorStop(0, dark ? 'rgba(255,255,255,0.16)' : 'rgba(0,0,0,0.38)');
    g.addColorStop(1, dark ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.2)');
    ctx.fillStyle = g;
    ctx.fillRect(inset, inset, cw - 2 * inset, ch - 2 * inset);
    ctx.strokeStyle = dark ? 'rgba(255,255,255,0.3)' : 'rgba(0,0,0,0.3)';
    ctx.lineWidth = Math.max(2, inset * 0.18);
    ctx.strokeRect(inset, inset, cw - 2 * inset, ch - 2 * inset);
  }

  if (crease) {
    // Soufflet latéral du sac : pli central et triangle en bas.
    ctx.strokeStyle = 'rgba(0,0,0,0.16)';
    ctx.lineWidth = Math.max(2, cw * 0.012);
    ctx.beginPath();
    ctx.moveTo(cw / 2, 0);
    ctx.lineTo(cw / 2, ch - cw / 2);
    ctx.lineTo(0, ch);
    ctx.moveTo(cw / 2, ch - cw / 2);
    ctx.lineTo(cw, ch);
    ctx.stroke();
    const g = ctx.createLinearGradient(0, 0, cw, 0);
    g.addColorStop(0, 'rgba(0,0,0,0)');
    g.addColorStop(0.5, 'rgba(0,0,0,0.08)');
    g.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, cw, ch);
  }

  if (art) {
    const text = state.text.trim();
    const logo = state.logo;
    const m = Math.min(cw, ch);

    if (logo) {
      const zoneH = text ? ch * 0.62 : ch;
      const centerY = text ? ch * 0.42 : ch / 2;
      const maxW = cw * state.logoScale;
      const maxH = zoneH * state.logoScale;
      const ratio = Math.min(maxW / logo.naturalWidth, maxH / logo.naturalHeight);
      const w = logo.naturalWidth * ratio;
      const h = logo.naturalHeight * ratio;
      ctx.drawImage(logo, (cw - w) / 2, centerY - h / 2, w, h);
    }

    if (text) {
      let size = m * (logo ? 0.09 : 0.13);
      ctx.font = `700 ${size}px Inter, system-ui, sans-serif`;
      const maxTextW = cw * 0.86;
      const measured = ctx.measureText(text).width;
      if (measured > maxTextW) {
        size *= maxTextW / measured;
        ctx.font = `700 ${size}px Inter, system-ui, sans-serif`;
      }
      ctx.fillStyle = contrastColor(state);
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(text, cw / 2, logo ? ch * 0.82 : ch / 2);
    }
  }

  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 8;
  return tex;
}

// ---------- Briques 3D ----------
const edgeMaterial = new THREE.LineBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.1 });

function makeMaterial(map, finish) {
  const f = FINISHES[finish] ?? FINISHES.mat;
  return new THREE.MeshPhysicalMaterial({
    map,
    roughness: f.roughness,
    clearcoat: f.clearcoat,
    clearcoatRoughness: f.clearcoatRoughness,
  });
}

// Pavé texturé, dimensions en mm, centré sur l'origine.
function cuboid(W, H, D, k, state, { art = [], interior = [], crease = [] } = {}) {
  const sizes = [[D, H], [D, H], [W, D], [W, D], [W, H], [W, H]];
  const mats = sizes.map(([fw, fh], i) =>
    makeMaterial(
      drawFace(fw, fh, state, { art: art.includes(i), interior: interior.includes(i), crease: crease.includes(i) }),
      state.finish
    )
  );
  const geo = new THREE.BoxGeometry(W * k, H * k, D * k);
  const mesh = new THREE.Mesh(geo, mats);
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  const group = new THREE.Group();
  group.add(mesh, new THREE.LineSegments(new THREE.EdgesGeometry(geo), edgeMaterial));
  return group;
}

function disposeTree(root) {
  root.traverse((o) => {
    // Les sprites partagent une géométrie commune à three.js : on ne la libère pas.
    if (!o.isSprite) o.geometry?.dispose();
    const mats = Array.isArray(o.material) ? o.material : [o.material];
    mats.forEach((m) => {
      if (!m || m.userData.shared) return;
      m.map?.dispose();
      m.dispose();
    });
  });
}

// Joue latérale du présentoir : trapèze qui descend du dos vers l'avant.
function displaySide(D, backH, frontH, T, k, state) {
  const shape = new THREE.Shape();
  shape.moveTo((-D / 2) * k, 0);
  shape.lineTo((D / 2) * k, 0);
  shape.lineTo((D / 2) * k, frontH * k);
  shape.lineTo((-D / 2) * k, backH * k);
  shape.closePath();
  const geo = new THREE.ExtrudeGeometry(shape, { depth: T * k, bevelEnabled: false });
  geo.translate(0, 0, (-T / 2) * k);
  // UV normalisées pour que la couleur ou le kraft couvrent toute la joue.
  const pos = geo.attributes.position;
  const uv = geo.attributes.uv;
  for (let i = 0; i < pos.count; i++) {
    uv.setXY(i, (pos.getX(i) / k + D / 2) / D, pos.getY(i) / k / backH);
  }
  uv.needsUpdate = true;
  geo.rotateY(-Math.PI / 2); // l'axe du trapèze suit la profondeur
  const mesh = new THREE.Mesh(geo, makeMaterial(drawFace(D, backH, state), state.finish));
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  const g = new THREE.Group();
  g.add(mesh, new THREE.LineSegments(new THREE.EdgesGeometry(geo, 30), edgeMaterial));
  return g;
}

// Dimensions de chaque panneau du présentoir (mm).
// Proportions automatiques à partir de L × l × H, sauf si des cotes précises sont fixées dans s.display.
export function displayLayout(s) {
  const { width, depth, height } = s;
  const autoBack = Math.min(height * 0.42, depth * 1.2);
  const auto = {
    W: width,
    D: depth,
    backH: autoBack,
    headerH: height - autoBack,
    frontH: Math.max(15, Math.min(height * 0.1, autoBack * 0.5)),
    glue: Math.min(20, width * 0.08),
    headerW: width,
  };
  const p = s.display ? { ...auto, ...s.display } : auto;
  const frontH = Math.min(p.frontH, p.backH); // le bord avant ne dépasse pas le dos
  const glue = Math.min(p.glue, p.backH); // les pattes tiennent à côté du dos
  return {
    ...p,
    frontH,
    glue,
    H: p.backH + p.headerH,
    flatW: Math.round(Math.max(p.W + 2 * p.backH, p.headerW)),
    flatL: Math.round(p.headerH + p.backH + p.D + frontH),
  };
}

// ---------- Présentoir déplié (à plat) ----------
const foldMaterial = new THREE.LineDashedMaterial({ color: 0x2b5cff, dashSize: 0.04, gapSize: 0.03 });
const cutMaterial = new THREE.LineBasicMaterial({ color: 0x12172a, transparent: true, opacity: 0.55 });

function flatLine(points, material) {
  const geo = new THREE.BufferGeometry().setFromPoints(points);
  const line = new THREE.Line(geo, material);
  if (material.isLineDashedMaterial) line.computeLineDistances();
  return line;
}

// Polygone à plat (points en mm dans le plan x / z), texture étirée sur sa boîte englobante.
function flatPolygon(pts, k, state, { art = false, flip = false, part = null } = {}) {
  const xs = pts.map((p) => p[0]);
  const zs = pts.map((p) => p[1]);
  const [x0, x1, z0, z1] = [Math.min(...xs), Math.max(...xs), Math.min(...zs), Math.max(...zs)];
  const shape = new THREE.Shape(pts.map(([x, z]) => new THREE.Vector2(x * k, -z * k)));
  const geo = new THREE.ShapeGeometry(shape);
  const pos = geo.attributes.position;
  const uv = geo.attributes.uv;
  for (let i = 0; i < pos.count; i++) {
    const u = (pos.getX(i) / k - x0) / (x1 - x0);
    const v = (-pos.getY(i) / k - z0) / (z1 - z0); // 0 = loin, 1 = près
    uv.setXY(i, flip ? 1 - u : u, flip ? v : 1 - v);
  }
  uv.needsUpdate = true;
  geo.rotateX(-Math.PI / 2);
  const mat = makeMaterial(drawFace(x1 - x0, z1 - z0, state, { art }), state.finish);
  mat.side = THREE.DoubleSide;
  const mesh = new THREE.Mesh(geo, mat);
  mesh.position.y = 0.003;
  mesh.receiveShadow = true;
  const g = new THREE.Group();
  const outline = pts.map(([x, z]) => new THREE.Vector3(x * k, 0.006, z * k));
  outline.push(outline[0].clone());
  g.add(mesh, flatLine(outline, cutMaterial));
  g.userData.part = part;
  return g;
}

// Patron à plat, articulé : setFold(0) = à plat, setFold(1) = monté (pour l'animation de pliage).
function buildDisplayFlat(s, zones) {
  const L = displayLayout(s);
  const { W, D, backH, frontH, headerH, headerW, glue } = L;
  const kF = 3.1 / Math.max(L.flatW, L.flatL); // échelle à plat (marge pour les cotes)
  const kM = SCENE_SIZE / Math.max(W, headerW, D, L.H); // échelle une fois monté
  const k = kF;
  const g = new THREE.Group();
  const content = new THREE.Group();
  g.add(content);

  const zBack = -D / 2 - backH; // pli fronton / dos
  const zTop = zBack - headerH; // bord haut du fronton
  const zFront = D / 2 + frontH; // bord du rebord avant
  const xL = -W / 2;
  const xR = W / 2;
  const hx = headerW / 2;
  const fold = Math.min(hx, W / 2);

  // Fond (fixe).
  content.add(flatPolygon(rect(xL, -D / 2, xR, D / 2), k, s, { part: 'fond' }));

  // Dos + fronton : pivotent sur l'arête arrière du fond.
  const backPivot = new THREE.Group();
  backPivot.position.z = (-D / 2) * k;
  content.add(backPivot);
  backPivot.add(flatPolygon(rect(xL, -backH, xR, 0), k, s, { part: 'dos' }));
  backPivot.add(flatPolygon(rect(-hx, -backH - headerH, hx, -backH), k, s, { art: zones.includes('fronton'), part: 'fronton' }));

  // Bord avant : pivote sur l'arête avant du fond.
  const lipPivot = new THREE.Group();
  lipPivot.position.z = (D / 2) * k;
  content.add(lipPivot);
  lipPivot.add(flatPolygon(rect(xL, 0, xR, frontH), k, s, { art: zones.includes('bord'), flip: true, part: 'bord' }));

  // Côtés (trapèzes) sur les arêtes latérales du fond, pattes de collage sur les côtés du dos.
  const sides = [];
  const flaps = [];
  const inset = Math.min(3, backH * 0.05);
  const bevel = Math.min(glue * 0.6, backH * 0.2);
  for (const sgn of [1, -1]) {
    const sp = new THREE.Group();
    sp.position.x = sgn * (W / 2) * k;
    content.add(sp);
    const side = flatPolygon([[0, -D / 2], [sgn * backH, -D / 2], [sgn * frontH, D / 2], [0, D / 2]], k, s, { part: 'cote' });
    side.userData.zRange = [(-D / 2) * k, (D / 2) * k]; // de l'arrière (dos) vers l'avant (bord)
    sp.add(side);
    sides.push([sp, sgn]);

    const fp = new THREE.Group();
    fp.position.x = sgn * (W / 2) * k;
    backPivot.add(fp);
    fp.add(flatPolygon([[0, -backH + inset], [sgn * glue, -backH + inset + bevel], [sgn * glue, -inset - bevel], [0, -inset]], k, s, { part: 'patte' }));
    flaps.push([fp, sgn]);
  }

  // Lignes de pliage (pointillés bleus), visibles seulement à plat.
  const folds = new THREE.Group();
  const P = (x, z) => new THREE.Vector3(x * k, 0.008, z * k);
  [
    [P(-fold, zBack), P(fold, zBack)],
    [P(xL, -D / 2), P(xR, -D / 2)],
    [P(xL, D / 2), P(xR, D / 2)],
    [P(xL, -D / 2), P(xL, D / 2)],
    [P(xR, -D / 2), P(xR, D / 2)],
    [P(xL, zBack), P(xL, -D / 2)],
    [P(xR, zBack), P(xR, -D / 2)],
  ].forEach((pts) => folds.add(flatLine(pts, foldMaterial)));
  content.add(folds);

  // Cotes principales A (largeur), B (profondeur), H (hauteur totale), cliquables, visibles à plat.
  const dims = new THREE.Group();
  const D3 = (x, z) => new THREE.Vector3(x * k, 0.02, z * k);
  const off = 0.2 / k; // décalage des cotes (mm)
  const xLeft = -Math.max(W / 2 + backH, hx) - off;
  const xRight = Math.max(W / 2 + glue, hx) + off;
  dims.add(makeDimension('A', D3(xL, zFront + off), D3(xR, zFront + off), W));
  dims.add(makeDimension('B', D3(xLeft, -D / 2), D3(xLeft, D / 2), D));
  dims.add(makeDimension('H', D3(xRight, zTop), D3(xRight, -D / 2), L.H));
  content.add(dims);

  const flatZ = (-(zTop + zFront) / 2) * kF;
  function setFold(t) {
    const a = (t * Math.PI) / 2;
    backPivot.rotation.x = a;
    lipPivot.rotation.x = -a;
    sides.forEach(([p, sgn]) => (p.rotation.z = sgn * a));
    flaps.forEach(([p, sgn]) => (p.rotation.z = sgn * a));
    folds.visible = t === 0;
    dims.visible = t === 0;
    content.scale.setScalar(1 + (kM / kF - 1) * t);
    content.position.z = flatZ * (1 - t);
    content.traverse((o) => o.isMesh && (o.castShadow = t > 0));
  }
  setFold(0);
  return { group: g, height: 0, setFold };
}

// Présentoir de comptoir : bac à côtés inclinés + fronton haut au dos.
function buildDisplay(s, zones) {
  if (s.flat) return buildDisplayFlat(s, zones);
  const T = 3; // épaisseur du carton (mm)
  const { W, D, H, backH, frontH, headerH, headerW } = displayLayout(s);
  const k = SCENE_SIZE / Math.max(W, headerW, D, H);
  const g = new THREE.Group();
  const add = (obj, part, x, y, z) => {
    obj.position.set(x * k, y * k, z * k);
    obj.userData.part = part;
    g.add(obj);
  };

  // Fond, dos du bac, fronton, bord avant.
  add(cuboid(W, T, D, k, s), 'fond', 0, T / 2, 0);
  add(cuboid(W, backH, T, k, s, { art: zones.includes('dos') ? [BACK] : [] }), 'dos', 0, backH / 2, -D / 2 + T / 2);
  add(cuboid(headerW, headerH, T, k, s, { art: zones.includes('fronton') ? [FRONT] : [] }), 'fronton', 0, backH + headerH / 2, -D / 2 + T / 2);
  add(cuboid(W - 2 * T, frontH, T, k, s, { art: zones.includes('bord') ? [FRONT] : [] }), 'bord', 0, frontH / 2, D / 2 - T / 2);

  // Joues latérales.
  for (const side of [1, -1]) {
    const panel = displaySide(D, backH, frontH, T, k, s);
    panel.userData.zRange = [(-D / 2) * k, (D / 2) * k]; // de l'arrière (dos) vers l'avant (bord)
    add(panel, 'cote', side * (W / 2 - T / 2), 0, 0);
  }

  return { group: g, height: H * k };
}

// Hauteur (unités 3D) du présentoir une fois monté, pour cadrer la caméra.
export function mountedDisplayHeight(s) {
  const L = displayLayout(s);
  return (L.H * SCENE_SIZE) / Math.max(L.W, L.headerW, L.D, L.H);
}

// Matériaux partagés : jamais libérés lors d'une reconstruction.
[edgeMaterial, foldMaterial, cutMaterial].forEach((m) => (m.userData.shared = true));

// Boîte, sac et coffret : patrons pliables (vue 2D à plat ou 3D montée).
const DIELINES = makeDielineBuilders({ drawFace, makeMaterial, contrastColor, SCENE_SIZE });
const BUILDERS = { ...DIELINES, presentoir: buildDisplay };

export function createPackaging(initial = {}) {
  const state = { ...DEFAULT_STATE, ...initial };
  const group = new THREE.Group();
  let current = null;
  let height = 1;
  let setFold = null; // présentoir
  let setState = null; // boîte, sac, coffret
  let flatSize = null;

  function update(patch = {}) {
    Object.assign(state, patch);
    if (current) {
      group.remove(current);
      disposeTree(current);
    }
    const type = BUILDERS[state.type] ? state.type : 'boite-pliante';
    const artMap = DIELINE_ART[type] ?? ART_FACES[type];
    const art = artMap[state.placement] ?? artMap.front;
    const built = BUILDERS[type](state, art);
    current = built.group;
    setFold = built.setFold ?? null;
    setState = built.setState ?? null;
    flatSize = built.flatSize ?? null;
    height = setState ? setState(state.view2d ? 0 : 1, state.open) : built.height;
    group.add(current);
  }

  update();

  return {
    group,
    state,
    update,
    sceneHeight: () => height,
    // Format à plat du patron (mm), pour boîte, sac et coffret.
    flatSize: () => flatSize,
    // Animation de pliage : 0 = à plat, 1 = monté.
    setFold: (t) => {
      if (setState) height = setState(t, state.open);
      else setFold?.(t);
    },
    // Ouverture des rabats ou du couvercle sans tout reconstruire (vue 3D).
    setOpen: (o) => {
      state.open = o;
      if (setState) height = setState(state.view2d ? 0 : 1, o);
    },
  };
}

// Ancien nom, conservé pour la page d'accueil.
export const createFoldingBox = createPackaging;
