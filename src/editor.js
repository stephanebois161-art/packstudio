// Éditeur 3D : réglages, export PNG et demande de devis.
import { MathUtils } from 'three';
import { createStage } from './stage.js';
import { createPackaging, DEFAULT_STATE, TYPES, SCENE_SIZE, displayLayout, mountedDisplayHeight } from './box.js';
import { ease } from './dielines.js';
import { createMarkers } from './markers.js';

const $ = (sel) => document.querySelector(sel);
const $$ = (sel) => [...document.querySelectorAll(sel)];

const COLORS = [
  ['#ffffff', 'Blanc'],
  ['#f4efe6', 'Crème'],
  ['#12172a', 'Noir'],
  ['#2b5cff', 'Bleu'],
  ['#0f6b5c', 'Vert sapin'],
  ['#e8b4b8', 'Rose poudré'],
  ['#d9472b', 'Rouge'],
  ['#f2c230', 'Jaune'],
];
const FINISH_LABELS = { mat: 'Mat', brillant: 'Brillant', kraft: 'Kraft naturel' };

// Mesures détaillées du présentoir (en plus de A, B, H), avec leurs limites en mm.
const DETAILS = [
  ['headerH', 'Hauteur du fronton'],
  ['headerW', 'Largeur du fronton'],
  ['backH', 'Hauteur du dos du bac'],
  ['frontH', 'Hauteur du bord avant'],
  ['glue', 'Largeur des pattes de collage'],
];
const LIMITS = { headerH: [20, 1000], headerW: [80, 1200], backH: [30, 600], frontH: [10, 300], glue: [5, 80] };
const detailLabel = (key) => DETAILS.find(([k]) => k === key)?.[1] ?? '';
// Mesure détaillée proposée en premier selon la partie cliquée.
const PART_DETAILS = { fronton: ['headerH', 'headerW'], dos: ['backH'], bord: ['frontH'], patte: ['glue'] };
// Côté : hauteur du dos près de l'arrière, du bord avant près de l'avant (t = 0 arrière, 1 avant).
const sideDetail = (t) => (t == null ? [] : t < 0.3 ? ['backH'] : t > 0.7 ? ['frontH'] : []);

const typeOf = (key) => key.split(':')[0];

// ---------- Scène ----------
const stage = createStage($('#editor-canvas'));
const box = createPackaging();
stage.scene.add(box.group);
const state = box.state;
const isDisplay = () => state.type === 'presentoir';
// Vue à plat : présentoir déplié, ou patron 2D des autres emballages.
const isFlatView = () => (isDisplay() ? state.flat : state.view2d);
const dimsTitle = (type) => (type === 'presentoir' ? 'Mesures principales' : 'Mesures internes');

function displayDetails() {
  const L = displayLayout(state);
  return [
    ...DETAILS.map(([k, label]) => [label, `${Math.round(L[k])} mm`]),
    ['Format à plat', `${L.flatW} × ${L.flatL} mm`],
  ];
}

// Vue courante : les lettres sont rattachées à une vue (ex. présentoir monté ou déplié).
function viewKey() {
  if (isDisplay()) return `presentoir:${state.flat ? 'plat' : 'monte'}`;
  return `${state.type}:${state.view2d ? '2d' : '3d'}`;
}
function viewLabel(key) {
  const [type, view] = key.split(':');
  const extra = { plat: 'déplié', monte: 'monté', '2d': 'à plat (2D)', '3d': 'en 3D' }[view];
  return TYPES[type].label + (extra ? ` ${extra}` : '');
}

function fillList(list, rows) {
  list.replaceChildren(
    ...rows.map(([k, v]) => {
      const li = document.createElement('li');
      const a = document.createElement('span');
      const b = document.createElement('span');
      a.textContent = k;
      b.textContent = v;
      li.append(a, b);
      return li;
    })
  );
}

const ui = {
  seeMounted: $$('.see-mounted'),
  seeFlat: $('#see-flat'),
  bar: $('#vp-bar'),
  views: $$('[data-view]'),
  open: $('#vp-open'),
  dims: $('#vp-dims'),
};

function refresh(patch) {
  box.update(patch);
  stage.focus(box.sceneHeight());
  const display = isDisplay();
  markers.relayout();
  renderCotes();
  syncDetails();
  // Bouton « Voir le résultat monté » / « Revoir à plat » (présentoir uniquement).
  ui.seeMounted.forEach((b) => (b.hidden = !display || !state.flat));
  ui.seeFlat.hidden = !display || state.flat;
  // Barre 3D / 2D et curseur d'ouverture (boîte, sac, coffret).
  ui.bar.hidden = display;
  ui.views.forEach((b) => b.setAttribute('aria-pressed', String((b.dataset.view === '2d') === !!state.view2d)));
  ui.open.hidden = display || state.view2d || state.type === 'sac';
  const flat = box.flatSize();
  let dims = `A ${state.width} × B ${state.depth} × H ${state.height} mm`;
  if (display && state.flat) {
    const L = displayLayout(state);
    dims = `Déplié : ${L.flatW} × ${L.flatL} mm`;
  } else if (display) dims = `${state.width} × ${state.depth} × ${state.height} mm`;
  else if (state.view2d && flat) dims = `Format à plat : ${flat.w} × ${flat.l} mm`;
  ui.dims.textContent = dims;
}

function applyFlat(flat) {
  $$('[data-flat]').forEach((x) => x.setAttribute('aria-pressed', String((x.dataset.flat === 'yes') === flat)));
  refresh({ flat });
  stage.setPreset(isDisplay() && flat ? 'top' : 'home');
}

// ---------- Précisions (lettres libres) ----------
const markers = createMarkers(stage, box, {
  viewKey,
  onChange: (added) => {
    renderCotes();
    if (!added) return;
    // Une lettre libre est une simple précision : on invite à la décrire.
    toast(`Précision ${added.letter} ajoutée : décrivez-la`);
    const field = document.querySelector(`[data-cote="${added.id}"] .plabel`);
    field?.focus({ preventScroll: true });
    field?.closest('.cote-row')?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  },
  // Clic sur le patron ou la maquette : choix entre une mesure principale (A, B, H) et une précision.
  onPick: (hit, e) => openPick(e, hit),
  // Clic sur une étiquette de cote du patron : saisie directe de la mesure.
  onDim: (letter, e) => openPick(e, null, { A: 'width', B: 'depth', H: 'height' }[letter]),
});
// Lettres de l'emballage choisi (toutes ses vues).
const myMarkers = () => markers.list.filter((m) => typeOf(m.key) === state.type);

// ---------- Fenêtre de saisie au clic ----------
// Mesures principales A, B, H (le présentoir parle de profondeur et de hauteur totale).
function mainDims(type = state.type) {
  const display = type === 'presentoir';
  return [
    ['width', 'A', 'dim-a', 'Largeur'],
    ['depth', 'B', 'dim-b', display ? 'Profondeur' : 'Longueur'],
    ['height', 'H', 'dim-h', display ? 'Hauteur totale' : 'Hauteur'],
  ];
}

// Partie de l'emballage touchée par le clic, et position le long d'un côté (0 = arrière, 1 = avant).
function partOf(hit) {
  let o = hit?.object;
  while (o && !o.userData.part) o = o.parent;
  if (!o) return {};
  let t = null;
  if (o.userData.zRange) {
    const [z0, z1] = o.userData.zRange;
    t = (o.worldToLocal(hit.point.clone()).z - z0) / (z1 - z0);
  }
  return { part: o.userData.part, t };
}
const pick = $('#pick');
let pickHit = null;

function openPick(e, hit, key = null) {
  pickHit = hit;
  if (key) showDimInput(key);
  else showPickMenu();
  // Positionne la fenêtre près du clic, sans déborder de la vue.
  const vr = $('.viewport').getBoundingClientRect();
  pick.hidden = false;
  const x = Math.min(e.clientX - vr.left + 12, vr.width - pick.offsetWidth - 12);
  const y = Math.min(e.clientY - vr.top + 12, vr.height - pick.offsetHeight - 12);
  pick.style.left = `${Math.max(12, x)}px`;
  pick.style.top = `${Math.max(12, y)}px`;
}

function closePick() {
  pick.hidden = true;
  pickHit = null;
}

function showPickMenu() {
  // Présentoir : la mesure de la partie cliquée d'abord (fronton, dos, bord avant, côté, pattes).
  let details = [];
  if (isDisplay()) {
    const { part, t } = partOf(pickHit);
    details = part === 'cote' ? sideDetail(t) : PART_DETAILS[part] ?? [];
  }
  const detailBtn = (k) =>
    `<button class="pick-opt pick-detail" data-k="${k}"><span class="dimtag dim-x">↕</span>${detailLabel(k)}<b>${currentValue(k)} mm</b></button>`;
  pick.innerHTML =
    '<p class="pick-title">Préciser une dimension</p>' +
    details.map(detailBtn).join('') +
    mainDims().map(
      ([k, l, c, label]) =>
        `<button class="pick-opt" data-k="${k}"><span class="dimtag ${c}">${l}</span>${label}<b>${state[k]} mm</b></button>`
    ).join('') +
    '<button class="pick-opt pick-other" data-k="other">＋ Autre précision<small>ajoute une lettre à cet endroit</small></button>';
  pick.querySelectorAll('.pick-opt').forEach((b) =>
    b.addEventListener('click', () => {
      const k = b.dataset.k;
      if (k === 'other') {
        const hit = pickHit;
        closePick();
        if (hit) markers.add(hit);
      } else if (b.classList.contains('pick-detail')) showDetailInput(k);
      else showDimInput(k);
    })
  );
}

// Champ de saisie de la fenêtre : OK ou Entrée valide, Échap ferme.
function bindPickInput(ok) {
  const input = pick.querySelector('input');
  pick.querySelector('button').addEventListener('click', () => ok(input));
  input.addEventListener('keydown', (ev) => {
    if (ev.key === 'Enter') ok(input);
    if (ev.key === 'Escape') closePick();
  });
  setTimeout(() => {
    input.focus();
    input.select();
  });
}

// Saisie d'une mesure détaillée du présentoir.
function showDetailInput(key) {
  const label = detailLabel(key);
  const [min, max] = LIMITS[key];
  pick.innerHTML = `<p class="pick-title"><span class="dimtag dim-x">↕</span>${label}</p>
    <div class="pick-row"><div class="num"><input type="number" min="${min}" max="${max}" step="1" value="${currentValue(key)}" aria-label="${label} en mm" /><span>mm</span></div>
    <button class="btn btn-primary btn-sm">OK</button></div>
    <p class="note">Entre ${min} et ${max} mm${key === 'frontH' || key === 'glue' ? ', sans dépasser la hauteur du dos' : ''}</p>`;
  bindPickInput((input) => {
    applyMeasure(key, Number(input.value));
    closePick();
    toast(`${label} : ${currentValue(key)} mm`);
  });
}

function showDimInput(key) {
  const [, letter, cls, label] = mainDims().find(([k]) => k === key);
  const src = document.querySelector(`input[type=number][data-dim="${key}"]`);
  pick.innerHTML = `<p class="pick-title"><span class="dimtag ${cls}">${letter}</span>${label} <small>${isDisplay() ? 'mesure principale' : 'mesure interne'}</small></p>
    <div class="pick-row"><div class="num"><input type="number" min="${src.min}" max="${src.max}" step="1" value="${state[key]}" aria-label="${label} en mm" /><span>mm</span></div>
    <button class="btn btn-primary btn-sm">OK</button></div>
    <p class="note">Entre ${src.min} et ${src.max} mm</p>`;
  bindPickInput((input) => {
    // Même champ que dans le panneau : une seule valeur, deux façons de la saisir.
    src.value = input.value;
    src.dispatchEvent(new Event('change'));
    closePick();
    toast(`${letter} · ${label} : ${state[key]} mm`);
  });
}

document.addEventListener('pointerdown', (ev) => {
  if (!pick.hidden && !pick.contains(ev.target)) closePick();
});

function renderCotes() {
  const list = $('#cotes-list');
  const current = viewKey();
  const existing = new Map([...list.children].map((r) => [Number(r.dataset.cote), r]));
  const mine = myMarkers();
  const rows = mine.map((m) => {
    let row = existing.get(m.id);
    if (!row) {
      row = document.createElement('div');
      row.className = 'param-row cote-row';
      row.dataset.cote = m.id;
      row.innerHTML = `<span class="letter"></span><label><input type="text" class="plabel" maxlength="40" /><small></small></label>
        <div class="num"><input type="number" min="0" step="1" placeholder="—" /><span>mm</span></div>
        <button class="del" title="Supprimer cette cote" aria-label="Supprimer">×</button>`;
      row.querySelector('.letter').textContent = m.letter;
      const label = row.querySelector('.plabel');
      label.placeholder = `Ce que mesure ${m.letter} (ex. : languette)`;
      label.setAttribute('aria-label', `Description de la précision ${m.letter}`);
      label.value = m.label ?? '';
      label.addEventListener('input', () => (m.label = label.value));
      const input = row.querySelector('input[type=number]');
      input.setAttribute('aria-label', `Dimension ${m.letter} en mm`);
      input.addEventListener('input', () => markers.setValue(m.id, input.value.trim()));
      input.addEventListener('change', () => {
        markers.setValue(m.id, input.value.trim());
        input.value = m.value;
      });
      row.querySelector('.del').addEventListener('click', () => markers.remove(m.id));
    }
    row.querySelector('small').textContent = m.key === current ? viewLabel(m.key) : `${viewLabel(m.key)} · autre vue`;
    row.classList.toggle('off', m.key !== current);
    return row;
  });
  list.replaceChildren(...rows);
  $('#cotes-empty').hidden = mine.length > 0;
  $('#cotes-clear').hidden = mine.length === 0;
}

// Valeur actuelle d'une mesure détaillée du présentoir.
const currentValue = (key) => Math.round(displayLayout(state)[key]);

// Applique un jeu de mesures au présentoir. Bord avant et pattes ne dépassent pas la hauteur du dos.
function applyDisplay(d) {
  d.frontH = Math.min(d.frontH, d.backH);
  d.glue = Math.min(d.glue, d.backH);
  Object.keys(d).forEach((k) => (d[k] = Math.round(d[k])));
  refresh({ display: d, width: d.W, depth: d.D, height: d.backH + d.headerH });
}

// Applique une mesure détaillée du présentoir (fronton, dos, bord avant, pattes).
function applyMeasure(key, raw) {
  const [min, max] = LIMITS[key];
  const value = MathUtils.clamp(Math.round(raw), min, max);
  if (!Number.isFinite(value)) return;
  const { W, D, backH, headerH, frontH, glue, headerW } = displayLayout(state);
  applyDisplay({ W, D, backH, headerH, frontH, glue, headerW, [key]: value });
  syncSliders();
}

// ---------- Détail du présentoir (panneau) ----------
const detailInputs = {};
DETAILS.forEach(([key, label]) => {
  const [min, max] = LIMITS[key];
  const row = document.createElement('div');
  row.className = 'dim-row detail-row';
  row.innerHTML = `<label for="d-${key}">${label}</label><span></span>
    <div class="num"><input type="number" id="d-${key}" min="${min}" max="${max}" step="1" /><span>mm</span></div>`;
  const input = row.querySelector('input');
  detailInputs[key] = input;
  input.addEventListener('input', () => {
    const v = Number(input.value);
    if (input.value !== '' && v >= min && v <= max) applyMeasure(key, v);
  });
  input.addEventListener('change', () => {
    applyMeasure(key, Number(input.value) || min);
    input.value = currentValue(key);
  });
  $('#detail-list').append(row);
});

function syncDetails() {
  if (!isDisplay()) return;
  DETAILS.forEach(([key]) => {
    const input = detailInputs[key];
    if (document.activeElement !== input) input.value = currentValue(key);
  });
}

function syncSliders() {
  ['width', 'depth', 'height'].forEach((k) => $$(`[data-dim="${k}"]`).forEach((el) => (el.value = state[k])));
}

$('#cotes-clear').addEventListener('click', () => myMarkers().forEach((m) => markers.remove(m.id)));

$('#annotate').addEventListener('click', (e) => {
  const on = e.currentTarget.getAttribute('aria-pressed') !== 'true';
  e.currentTarget.setAttribute('aria-pressed', String(on));
  markers.setEnabled(on);
  $('.viewport').classList.toggle('annotate', on);
  $('#vp-hint').textContent = on
    ? 'Cliquez pour placer une lettre · Glissez pour tourner'
    : 'Glissez pour tourner · Molette pour zoomer';
});
$('.viewport').classList.add('annotate');

// ---------- Dimensions ----------
$$('[data-dim]').forEach((input) => {
  input.value = state[input.dataset.dim];
  const apply = (commit) => {
    const key = input.dataset.dim;
    let v = Number(input.value);
    if (!Number.isFinite(v)) return;
    const min = Number(input.min);
    const max = Number(input.max);
    if (commit) v = MathUtils.clamp(Math.round(v), min, max);
    else if (v < min || v > max) return; // saisie en cours dans le champ numérique
    $$(`[data-dim="${key}"]`).forEach((el) => el !== input && (el.value = v));
    if (commit) input.value = v;
    if (isDisplay() && state.display) {
      // Cotes précises en place : on ajuste les panneaux concernés.
      const d = { ...state.display };
      if (key === 'width') {
        if (d.headerW === d.W) d.headerW = v;
        d.W = v;
      } else if (key === 'depth') d.D = v;
      else {
        // Hauteur totale = dos + fronton : on garde leurs proportions.
        d.backH = Math.round((d.backH * v) / (d.backH + d.headerH));
        d.headerH = v - d.backH;
      }
      applyDisplay(d);
    } else refresh({ [key]: v });
  };
  input.addEventListener('input', () => apply(input.type === 'range'));
  input.addEventListener('change', () => apply(true));
});

// ---------- Type d'emballage ----------
function setType(type) {
  if (!TYPES[type]) type = 'boite-pliante';
  const def = TYPES[type];
  const display = type === 'presentoir';
  $$('[data-type]').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.type === type)));
  $('#view-group').hidden = !display;
  // Boîte, sac, coffret : « Mesures internes » A, B, H (comme sur le patron 2D).
  $('#dims-title').textContent = dimsTitle(type);
  const dimLabels = mainDims(type).map(([, l, c, label]) => `<span class="dimtag ${c}">${l}</span>${label}`);
  $('#detail-group').hidden = !display;
  $$('#dims-group .dim-row label').forEach((l, i) => (l.innerHTML = dimLabels[i]));
  $('#cotes-title').textContent = 'Précisions';
  $('#cotes-note').textContent = display
    ? "Les mesures se règlent ci-dessus, ou en cliquant sur le présentoir ou sur ses cotes A, B, H en vue dépliée. Pour toute autre information (emplacement d'un visuel, encoche…), cliquez sur le présentoir puis « Autre précision » : une lettre apparaît à cet endroit."
    : "Les mesures A, B, H se règlent ci-dessus, ou en cliquant sur le patron 2D. Pour toute autre dimension (languette, fenêtre, emplacement du logo…), cliquez sur l'emballage puis « Autre précision » : une lettre apparaît à cet endroit.";
  $('#vp-hint').textContent = 'Cliquez pour préciser une dimension · Glissez pour tourner';
  closePick();
  // Libellés d'emplacement propres au type.
  [...$('#placement').options].forEach((o) => (o.textContent = def.placements[o.value]));
  // Dimensions par défaut du type.
  Object.entries(def.dims).forEach(([key, v]) => $$(`[data-dim="${key}"]`).forEach((el) => (el.value = v)));
  refresh({ type, ...def.dims, display: null });
  stage.setPreset(isFlatView() ? 'top' : 'home');
  const url = new URL(location.href);
  url.searchParams.set('type', type);
  history.replaceState(null, '', url);
}
$$('[data-type]').forEach((b) => b.addEventListener('click', () => setType(b.dataset.type)));

// ---------- Animation de pliage (boîte, sac, coffret : 3D ↔ 2D ; présentoir : voir monté) ----------
let folding = false;
// Plie ou déplie en `duration` ms : fold(t) reçoit l'avancement (0 → 1), done() s'exécute à la fin.
function animateFold(duration, fold, done) {
  folding = true;
  markers.setVisible(false);
  markers.setEnabled(false);
  const start = performance.now();
  requestAnimationFrame(function step(now) {
    const t = Math.min(1, (now - start) / duration);
    fold(t);
    if (t < 1) return requestAnimationFrame(step);
    done();
    markers.setVisible(true);
    markers.setEnabled($('#annotate').getAttribute('aria-pressed') === 'true');
    folding = false;
  });
}

function setView(to2d) {
  if (folding || isDisplay() || !!state.view2d === to2d) return;
  const duration = 1600;
  // Hauteur approximative une fois monté, pour viser le centre de l'emballage.
  const mountedY = (SCENE_SIZE * state.height) / Math.max(state.width, state.depth, state.height) / 2;
  stage.flyTo(to2d ? 'top' : 'home', duration, to2d ? 0 : mountedY);
  animateFold(
    duration,
    (t) => box.setFold(to2d ? 1 - t : t),
    () => {
      refresh({ view2d: to2d });
      stage.setPreset(to2d ? 'top' : 'home');
    }
  );
}
$$('[data-view]').forEach((b) => b.addEventListener('click', () => setView(b.dataset.view === '2d')));

const openRange = $('#open-range');
openRange.addEventListener('input', () => {
  box.setOpen(Number(openRange.value));
  stage.focus(box.sceneHeight());
  markers.relayout();
});

$$('[data-flat]').forEach((b) => b.addEventListener('click', () => applyFlat(b.dataset.flat === 'yes')));

function showMounted() {
  if (folding || !isDisplay() || !state.flat) return;
  const duration = 2000;
  stage.flyTo('home', duration, mountedDisplayHeight(state) / 2);
  animateFold(
    duration,
    (t) => box.setFold(ease(t)),
    () => {
      applyFlat(false);
      toast('Voici votre présentoir monté, à vos dimensions');
    }
  );
}
$$('.see-mounted').forEach((b) => b.addEventListener('click', showMounted));
$('#see-flat').addEventListener('click', () => applyFlat(true));


// ---------- Couleur ----------
const swatches = $('#swatches');
COLORS.forEach(([hex, name]) => {
  const b = document.createElement('button');
  b.className = 'swatch';
  b.style.background = hex;
  b.title = name;
  b.setAttribute('aria-label', name);
  b.dataset.color = hex;
  b.addEventListener('click', () => setColor(hex));
  swatches.append(b);
});
const custom = document.createElement('label');
custom.className = 'swatch swatch-custom';
custom.title = 'Couleur personnalisée';
custom.innerHTML = '<input type="color" aria-label="Couleur personnalisée" />';
custom.querySelector('input').addEventListener('input', (e) => setColor(e.target.value));
swatches.append(custom);

function setColor(hex) {
  $$('.swatch').forEach((s) => s.setAttribute('aria-pressed', String(s.dataset.color === hex)));
  if (!COLORS.some(([c]) => c === hex)) custom.setAttribute('aria-pressed', 'true');
  refresh({ color: hex });
}

// ---------- Finition ----------
$$('[data-finish]').forEach((b) =>
  b.addEventListener('click', () => {
    $$('[data-finish]').forEach((x) => x.setAttribute('aria-pressed', String(x === b)));
    const kraft = b.dataset.finish === 'kraft';
    swatches.classList.toggle('disabled', kraft);
    $('#kraft-note').hidden = !kraft;
    refresh({ finish: b.dataset.finish });
  })
);

// ---------- Logo ----------
const logoInput = $('#logo-input');
const drop = $('#drop');

function loadLogo(file) {
  if (!file || !file.type.startsWith('image/')) return toast('Format non pris en charge : choisissez une image.');
  const reader = new FileReader();
  reader.onload = () => {
    const img = new Image();
    img.onload = () => {
      $('#logo-thumb').src = reader.result;
      $('#logo-name').textContent = file.name;
      $('#logo-file').classList.add('on');
      drop.hidden = true;
      refresh({ logo: img, logoName: file.name });
    };
    img.src = reader.result;
  };
  reader.readAsDataURL(file);
}
logoInput.addEventListener('change', () => loadLogo(logoInput.files[0]));
['dragenter', 'dragover'].forEach((ev) =>
  drop.addEventListener(ev, (e) => { e.preventDefault(); drop.classList.add('drag'); })
);
['dragleave', 'drop'].forEach((ev) =>
  drop.addEventListener(ev, (e) => { e.preventDefault(); drop.classList.remove('drag'); })
);
drop.addEventListener('drop', (e) => loadLogo(e.dataTransfer.files[0]));
$('#logo-remove').addEventListener('click', () => {
  logoInput.value = '';
  $('#logo-file').classList.remove('on');
  drop.hidden = false;
  refresh({ logo: null, logoName: '' });
});

const logoScale = $('#logo-scale');
logoScale.value = state.logoScale;
logoScale.addEventListener('input', () => refresh({ logoScale: Number(logoScale.value) }));
$('#text-input').addEventListener('input', (e) => refresh({ text: e.target.value }));
$('#placement').addEventListener('change', (e) => refresh({ placement: e.target.value }));

// ---------- Vue ----------
$('#reset-view').addEventListener('click', () => stage.resetView());
$('#auto-rotate').addEventListener('click', (e) => {
  const on = e.currentTarget.getAttribute('aria-pressed') !== 'true';
  e.currentTarget.setAttribute('aria-pressed', String(on));
  stage.controls.autoRotate = on;
});

// ---------- Téléchargement ----------
function download() {
  const url = stage.snapshot({ scale: 3, transparent: $('#transparent').checked });
  const a = document.createElement('a');
  a.href = url;
  a.download = `maquette-${state.type}-${state.width}x${state.depth}x${state.height}mm.png`;
  a.click();
  toast('Maquette téléchargée ✓');
}
$$('[data-action="download"]').forEach((b) => b.addEventListener('click', download));

// ---------- Devis ----------
const dialog = $('#quote');

function summary() {
  const def = TYPES[state.type];
  const flat = box.flatSize();
  const extra = isDisplay() ? displayDetails() : flat ? [['Format à plat', `${flat.w} × ${flat.l} mm`]] : [];
  const cotes = myMarkers().map((m) => [
    `Précision ${m.letter} – ${m.label?.trim() || 'sans description'} (${viewLabel(m.key)})`,
    m.value ? `${m.value} mm` : '—',
  ]);
  return [
    ['Type', def.label],
    [dimsTitle(state.type), `A ${state.width} × B ${state.depth} × H ${state.height} mm`],
    ...extra,
    ['Finition', FINISH_LABELS[state.finish]],
    ['Couleur', state.finish === 'kraft' ? 'Kraft naturel' : state.color.toUpperCase()],
    ['Logo', state.logoName || 'Aucun'],
    ['Texte', state.text.trim() || 'Aucun'],
    ['Emplacement', def.placements[state.placement]],
    ...cotes,
  ];
}

function openQuote() {
  $('#recap-img').src = stage.snapshot({ scale: 1, maxWidth: 600 });
  fillList($('#recap-list'), summary());
  $('#quote-fields').hidden = false;
  $('#quote-success').hidden = true;
  dialog.showModal();
}
$$('[data-action="quote"]').forEach((b) => b.addEventListener('click', openQuote));
$('#quote-close').addEventListener('click', () => dialog.close());
$('#quote-done').addEventListener('click', () => dialog.close());
dialog.addEventListener('click', (e) => { if (e.target === dialog) dialog.close(); });

$('#quote-form').addEventListener('submit', (e) => {
  e.preventDefault();
  const data = Object.fromEntries(new FormData(e.target));
  const request = {
    ...data,
    maquette: Object.fromEntries(summary()),
    image: $('#recap-img').src,
    date: new Date().toISOString(),
  };
  // À brancher : envoi réel (e-mail, service de formulaires ou serveur).
  console.info('Demande de devis prête à être envoyée :', { ...request, image: '[image PNG]' });
  $('#quote-fields').hidden = true;
  $('#quote-success').hidden = false;
  e.target.reset();
});

// ---------- Utilitaires ----------
let toastTimer;
function toast(msg) {
  const t = $('#toast');
  t.textContent = msg;
  t.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.remove('show'), 2200);
}

// ---------- Démarrage ----------
setColor(DEFAULT_STATE.color);
setType(new URLSearchParams(location.search).get('type') || DEFAULT_STATE.type);
document.fonts?.ready.then(() => refresh());
if (location.hash === '#devis') setTimeout(openQuote, 400);
