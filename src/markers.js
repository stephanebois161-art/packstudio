// Cotes à la demande : un clic sur l'emballage place une lettre (a, b, c…) à cet endroit.
// Chaque repère reste accroché à la même zone de l'emballage quand ses dimensions changent.
import * as THREE from 'three';

const LETTERS = 'abcdefghijklmnopqrstuvwxyz';
const ACCENT = 0x2b5cff;

// Pastille bleue avec la lettre, suivie de la valeur si elle est renseignée.
function badgeSprite(letter, value) {
  const text = value ? `${value} mm` : '';
  const c = document.createElement('canvas');
  const ctx = c.getContext('2d');
  const font = '700 44px Inter, system-ui, sans-serif';
  ctx.font = font;
  const badge = 68;
  const w = text ? badge + Math.ceil(ctx.measureText(text).width) + 26 : badge;
  c.width = w;
  c.height = 68;
  ctx.fillStyle = '#ffffff';
  ctx.strokeStyle = '#2b5cff';
  ctx.lineWidth = 4;
  ctx.beginPath();
  ctx.roundRect(2, 2, w - 4, 64, 16);
  ctx.fill();
  ctx.stroke();
  ctx.fillStyle = '#2b5cff';
  ctx.beginPath();
  ctx.roundRect(7, 7, 54, 54, 12);
  ctx.fill();
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillStyle = '#ffffff';
  ctx.font = '800 40px Inter, system-ui, sans-serif';
  ctx.fillText(letter, 34, 37);
  if (text) {
    ctx.font = font;
    ctx.fillStyle = '#12172a';
    ctx.fillText(text, badge + (w - badge) / 2, 36);
  }
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, depthTest: false }));
  const h = 0.16;
  sprite.scale.set((h * w) / 68, h, 1);
  sprite.renderOrder = 20;
  return sprite;
}

const dotGeometry = new THREE.SphereGeometry(0.025, 16, 12);
const dotMaterial = new THREE.MeshBasicMaterial({ color: ACCENT, depthTest: false });
const lineMaterial = new THREE.LineBasicMaterial({ color: ACCENT, depthTest: false });

export function createMarkers(stage, packaging, { viewKey, onChange, onPick, onDim }) {
  const canvas = stage.renderer.domElement;
  const group = new THREE.Group();
  stage.scene.add(group);
  const list = []; // { letter, key, n, normal, value, obj, sprite, line, dot }
  let enabled = true;

  const raycaster = new THREE.Raycaster();
  const ndc = new THREE.Vector2();

  function bounds() {
    return new THREE.Box3().setFromObject(packaging.group);
  }

  // Les lettres repartent de « a » pour chaque emballage.
  let nextId = 1;
  const typeOf = (key) => key.split(':')[0];
  function nextLetter() {
    const type = typeOf(viewKey());
    const used = new Set(list.filter((m) => typeOf(m.key) === type).map((m) => m.letter));
    for (let i = 0; ; i++) {
      for (const l of LETTERS) {
        const name = i ? l + i : l;
        if (!used.has(name)) return name;
      }
    }
  }

  function place(m, box) {
    const size = box.getSize(new THREE.Vector3());
    const p = new THREE.Vector3(
      box.min.x + m.n.x * size.x,
      box.min.y + m.n.y * size.y,
      box.min.z + m.n.z * size.z
    );
    const tip = p.clone().add(m.normal.clone().multiplyScalar(0.2));
    m.dot.position.copy(p);
    m.sprite.position.copy(tip);
    m.line.geometry.setFromPoints([p, tip]);
    m.obj.visible = m.key === viewKey();
  }

  function build(m) {
    m.obj = new THREE.Group();
    m.dot = new THREE.Mesh(dotGeometry, dotMaterial);
    m.dot.renderOrder = 19;
    m.line = new THREE.Line(new THREE.BufferGeometry(), lineMaterial);
    m.line.renderOrder = 19;
    m.sprite = badgeSprite(m.letter, m.value);
    m.obj.add(m.dot, m.line, m.sprite);
    group.add(m.obj);
  }

  function disposeSprite(sprite) {
    sprite.material.map.dispose();
    sprite.material.dispose();
  }

  function relayout() {
    const box = bounds();
    list.forEach((m) => place(m, box));
  }

  function add(hit) {
    const box = bounds();
    const size = box.getSize(new THREE.Vector3());
    const ratio = (v, min, len) => (len > 1e-6 ? (v - min) / len : 0);
    const n = new THREE.Vector3(
      ratio(hit.point.x, box.min.x, size.x),
      ratio(hit.point.y, box.min.y, size.y),
      ratio(hit.point.z, box.min.z, size.z)
    );
    const normal = hit.face
      ? hit.face.normal.clone().transformDirection(hit.object.matrixWorld)
      : new THREE.Vector3(0, 1, 0);
    // Garde l'étiquette au-dessus du sol.
    if (normal.y < -0.3) normal.set(0, 1, 0);
    // Partie de l'emballage cliquée (fronton, dos, fond…), si elle est connue.
    let o = hit.object;
    while (o && !o.userData.part) o = o.parent;
    const part = o?.userData.part ?? null;
    // Position du clic le long de la partie (0 = arrière, 1 = avant), pour les côtés du présentoir.
    let partT = null;
    if (o?.userData.zRange) {
      const [z0, z1] = o.userData.zRange;
      const local = o.worldToLocal(hit.point.clone());
      partT = Math.min(1, Math.max(0, (local.z - z0) / (z1 - z0)));
    }
    const m = { id: nextId++, letter: nextLetter(), key: viewKey(), n, normal, value: '', part, partT };
    build(m);
    place(m, box);
    list.push(m);
    onChange?.(m);
  }

  function setValue(id, value) {
    const m = list.find((x) => x.id === id);
    if (!m) return;
    m.value = value;
    m.obj.remove(m.sprite);
    disposeSprite(m.sprite);
    m.sprite = badgeSprite(m.letter, m.value);
    m.obj.add(m.sprite);
    place(m, bounds());
  }

  function remove(id) {
    const i = list.findIndex((x) => x.id === id);
    if (i < 0) return;
    const [m] = list.splice(i, 1);
    group.remove(m.obj);
    disposeSprite(m.sprite);
    m.line.geometry.dispose();
    onChange?.();
  }

  function clear() {
    [...list].forEach((m) => remove(m.id));
  }

  // Un clic court (sans glisser) place une lettre ; glisser fait toujours tourner la vue.
  let down = null;
  canvas.addEventListener('pointerdown', (e) => {
    down = { x: e.clientX, y: e.clientY, t: performance.now() };
  });
  // Seuls les objets réellement affichés comptent (lignes de pli, cotes 2D… peuvent être masquées).
  const shown = (o) => {
    for (; o; o = o.parent) if (!o.visible) return false;
    return true;
  };

  canvas.addEventListener('pointerup', (e) => {
    if (!down) return;
    const moved = Math.hypot(e.clientX - down.x, e.clientY - down.y);
    const quick = performance.now() - down.t < 500;
    down = null;
    if (moved > 5 || !quick) return;
    const r = canvas.getBoundingClientRect();
    ndc.set(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
    raycaster.setFromCamera(ndc, stage.camera);
    const hits = raycaster.intersectObject(packaging.group, true).filter((h) => shown(h.object));
    // Clic sur une étiquette de cote du patron (A, B, H) : saisie directe de cette mesure.
    const dimHit = hits.find((h) => h.object.userData.dim);
    if (dimHit && onDim) return onDim(dimHit.object.userData.dim, e);
    if (!enabled) return;
    const hit = hits.find((h) => h.object.isMesh);
    if (!hit) return;
    // L'éditeur peut d'abord proposer un choix (mesure principale ou précision) ; sinon, lettre directe.
    if (onPick) onPick(hit, e);
    else add(hit);
  });

  return {
    list,
    add,
    relayout,
    setValue,
    remove,
    clear,
    setEnabled(on) {
      enabled = on;
    },
    setVisible(on) {
      group.visible = on;
    },
  };
}
