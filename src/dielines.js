// Patrons (gabarits) pliables : boîte linéaire à pattes opposées, sac et coffret.
// Chaque emballage est construit à plat puis plié par charnières :
//   setState(t, o)  t = 0 → à plat (vue 2D, côté imprimé visible), t = 1 → monté
//                   o = 0 → fermé, o = 1 → ouvert (rabats ou couvercle)
// Dimensions internes : A = largeur (face avant), B = longueur (côté), H = hauteur, en mm.
import * as THREE from 'three';

export const DIM_COLORS = { A: '#5b4ee0', B: '#e8702a', H: '#14a389' };

const UP = { '-z': [0, -1], '+z': [0, 1], '-x': [-1, 0], '+x': [1, 0] };
export const ease = (t) => (t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2);
const clamp01 = (v) => THREE.MathUtils.clamp(v, 0, 1);
const phase = (t, a, b) => ease(clamp01((t - a) / (b - a)));
export const rect =(x0, z0, x1, z1) => [[x0, z0], [x1, z0], [x1, z1], [x0, z1]];

const dimLineMats = Object.fromEntries(
  Object.entries(DIM_COLORS).map(([key, c]) => [key, new THREE.LineBasicMaterial({ color: c, depthTest: false })])
);
Object.values(dimLineMats).forEach((m) => (m.userData.shared = true));

// Étiquette de cote colorée : « A  80 mm ».
function dimLabel(letter, value) {
  const c = document.createElement('canvas');
  const ctx = c.getContext('2d');
  const text = `${Math.round(value)} mm`;
  ctx.font = '700 42px Inter, system-ui, sans-serif';
  const w = 64 + Math.ceil(ctx.measureText(text).width) + 24;
  c.width = w;
  c.height = 64;
  const color = DIM_COLORS[letter];
  ctx.fillStyle = '#ffffff';
  ctx.strokeStyle = color;
  ctx.lineWidth = 4;
  ctx.beginPath();
  ctx.roundRect(2, 2, w - 4, 60, 30);
  ctx.fill();
  ctx.stroke();
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.arc(32, 32, 24, 0, Math.PI * 2);
  ctx.fill();
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillStyle = '#fff';
  ctx.font = '800 32px Inter, system-ui, sans-serif';
  ctx.fillText(letter, 32, 34);
  ctx.fillStyle = color;
  ctx.font = '700 42px Inter, system-ui, sans-serif';
  ctx.fillText(text, 64 + (w - 64) / 2, 34);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, depthTest: false }));
  sprite.scale.set((0.15 * w) / 64, 0.15, 1);
  sprite.renderOrder = 15;
  return sprite;
}

// Cote complète (ligne, traits d'extrémité, étiquette cliquable) entre deux points 3D.
export function makeDimension(letter, A, B, value) {
  const g = new THREE.Group();
  const dir = B.clone().sub(A).normalize();
  const perp = new THREE.Vector3(-dir.z, 0, dir.x).multiplyScalar(0.03);
  const mat = dimLineMats[letter];
  const seg = (p, q) => {
    const l = new THREE.Line(new THREE.BufferGeometry().setFromPoints([p, q]), mat);
    l.renderOrder = 14;
    g.add(l);
  };
  seg(A, B);
  seg(A.clone().add(perp), A.clone().sub(perp));
  seg(B.clone().add(perp), B.clone().sub(perp));
  const label = dimLabel(letter, value);
  label.userData.dim = letter; // cliquable : ouvre la saisie de cette mesure
  label.position.copy(A.clone().add(B).multiplyScalar(0.5)).setY(A.y + 0.03);
  g.add(label);
  return g;
}

export function makeDielineBuilders({ drawFace, makeMaterial, contrastColor, SCENE_SIZE }) {
  const cutMat = new THREE.LineBasicMaterial({ color: 0x12172a, transparent: true, opacity: 0.4 });
  const foldMat = new THREE.LineDashedMaterial({ color: 0x2b5cff, dashSize: 0.035, gapSize: 0.025 });
  [cutMat, foldMat].forEach((m) => (m.userData.shared = true));

  // Matériaux unis (carton brut à l'intérieur, couleur sans décor à l'extérieur) : ils ne dépendent que de
  // la couleur et de la finition, on les garde d'une reconstruction à l'autre.
  let plainCache = null;
  function plainMaterials(s) {
    const key = `${s.color}|${s.finish}`;
    if (plainCache?.key === key) return plainCache;
    plainCache?.mats.forEach((m) => (m.map?.dispose(), m.dispose()));
    const insideMat = makeMaterial(drawFace(300, 300, { ...s, color: '#f3f1ec' }), s.finish === 'kraft' ? 'kraft' : 'mat');
    insideMat.side = THREE.FrontSide;
    const plainMat = makeMaterial(drawFace(300, 300, s), s.finish);
    plainMat.side = THREE.BackSide;
    const mats = [insideMat, plainMat];
    mats.forEach((m) => (m.userData.shared = true));
    plainCache = { key, insideMat, plainMat, mats };
    return plainCache;
  }

  // ---------- Panneau : face extérieure imprimée (dessous à plat), face intérieure en carton brut ----------
  function makePanelFactory(s, k) {
    const { insideMat, plainMat } = plainMaterials(s);

    // inset : nombre de « couches » vers l'intérieur. Un rabat replié contre une paroi est légèrement
    // décalé pour rester caché derrière elle (sinon les deux surfaces se confondent et le rabat transparaît).
    return function panel(pts, { art = false, up = '-z', part = null, crease = false, inset = 0 } = {}) {
      const [ua, uc] = UP[up];
      const right = [uc, -ua]; // « droite » vue depuis l'extérieur
      const proj = ([x, z]) => [x * right[0] + z * right[1], x * ua + z * uc];
      const P = pts.map(proj);
      const u0 = Math.min(...P.map((p) => p[0]));
      const u1 = Math.max(...P.map((p) => p[0]));
      const v0 = Math.min(...P.map((p) => p[1]));
      const v1 = Math.max(...P.map((p) => p[1]));

      const geo = new THREE.ShapeGeometry(new THREE.Shape(pts.map(([x, z]) => new THREE.Vector2(x * k, -z * k))));
      const pos = geo.attributes.position;
      const uv = geo.attributes.uv;
      for (let i = 0; i < pos.count; i++) {
        const [pu, pv] = proj([pos.getX(i) / k, -pos.getY(i) / k]);
        uv.setXY(i, (pu - u0) / (u1 - u0 || 1), (pv - v0) / (v1 - v0 || 1));
      }
      uv.needsUpdate = true;
      geo.rotateX(-Math.PI / 2);

      let outMat = plainMat;
      if (art || crease) {
        outMat = makeMaterial(drawFace(u1 - u0, v1 - v0, s, { art, crease }), s.finish);
        outMat.side = THREE.BackSide;
      }
      const outside = new THREE.Mesh(geo, outMat);
      const inside = new THREE.Mesh(geo, insideMat);
      outside.receiveShadow = inside.receiveShadow = true;
      const outline = pts.map(([x, z]) => new THREE.Vector3(x * k, -0.0015, z * k));
      outline.push(outline[0].clone());
      const g = new THREE.Group();
      const contour = new THREE.Line(new THREE.BufferGeometry().setFromPoints(outline), cutMat);
      // Rabats intérieurs : leur contour ne sert qu'au patron 2D. En 3D, collés contre une paroi ou le
      // couvercle, il transparaîtrait à travers.
      contour.userData.innerContour = inset !== 0;
      g.add(outside, inside, contour);
      g.userData.part = part;
      g.position.y = inset * 0.006; // +y local = côté intérieur du carton
      return g;
    };
  }

  function hinge(parent, x, z, k) {
    const h = new THREE.Group();
    h.position.set(x * k, 0, z * k);
    parent.add(h);
    return h;
  }

  function foldLine(parent, a, b, k) {
    const geo = new THREE.BufferGeometry().setFromPoints([
      new THREE.Vector3(a[0] * k, -0.003, a[1] * k),
      new THREE.Vector3(b[0] * k, -0.003, b[1] * k),
    ]);
    const line = new THREE.Line(geo, foldMat);
    line.computeLineDistances();
    line.userData.fold = true;
    parent.add(line);
  }

  // ---------- Assemblage commun : orientation, échelle 2D / 3D, centrage, cotes ----------
  function finish(content, k, fold, q1, dims) {
    const g = new THREE.Group();
    g.add(content);
    // À plat, côté imprimé en haut : retourné autour de l'axe vertical du patron, pour garder le haut en haut.
    const q0 = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 0, 1), Math.PI);
    const box3 = new THREE.Box3();
    const size = new THREE.Vector3();
    const folds = [];
    const meshes = [];
    content.traverse((o) => {
      if (o.userData.fold || o.userData.innerContour) folds.push(o);
      if (o.isMesh) meshes.push(o);
    });

    function place(t, o, scale) {
      fold(t, o);
      content.quaternion.slerpQuaternions(q0, q1, ease(t));
      content.scale.setScalar(scale);
      content.position.set(0, 0, 0);
      box3.setFromObject(content); // met à jour les matrices au passage
      const cx = (box3.min.x + box3.max.x) / 2;
      const cz = (box3.min.z + box3.max.z) / 2;
      // À plat, le patron est un peu décalé vers le bas de l'écran pour laisser la place au badge en haut.
      content.position.set(-cx, -box3.min.y + 0.002, -cz + 0.18 * (1 - ease(t)));
      content.updateMatrixWorld(true);
      return box3.max.y - box3.min.y;
    }

    // Échelle à plat : le patron entier tient dans la même zone que le présentoir déplié.
    place(0, 0, 1);
    box3.getSize(size); // place() vient de calculer la boîte englobante
    const flatScale = 3.1 / Math.max(size.x, size.z);
    // Format à plat du patron (mm), largeur × hauteur telles qu'affichées en 2D.
    const flatSize = { w: Math.round(size.x / k), l: Math.round(size.z / k) };
    place(0, 0, flatScale);

    // Cotes A, B, H sur le patron à plat (positions calculées à plat, côté imprimé).
    const dimGroup = new THREE.Group();
    g.add(dimGroup);
    const toWorld = (x, z) => content.localToWorld(new THREE.Vector3(x * k, 0, z * k)).setY(0.02);
    dims.forEach(([letter, a, b, value]) => dimGroup.add(makeDimension(letter, toWorld(...a), toWorld(...b), value)));

    function setState(t, o = 0) {
      const scale = flatScale + (1 - flatScale) * ease(t);
      const h = place(t, o, scale);
      dimGroup.visible = t === 0;
      folds.forEach((f) => (f.visible = t === 0));
      meshes.forEach((m) => (m.castShadow = t > 0));
      return h;
    }

    return { group: g, setState, flatSize };
  }

  const Q_STANDING = new THREE.Quaternion()
    .setFromAxisAngle(new THREE.Vector3(0, 1, 0), Math.PI)
    .multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), Math.PI / 2));
  const Q_FLAT = new THREE.Quaternion();

  // Cotes A, B (au-dessus du patron, à la hauteur yDim) et H (à droite de la patte de collage).
  const bodyDims = (A, B, H, glue, yDim) => [
    ['A', [-A / 2, yDim], [A / 2, yDim], A],
    ['B', [A / 2, yDim], [A / 2 + B, yDim], B],
    ['H', [A / 2 + B + glue + 25, -H / 2], [A / 2 + B + glue + 25, H / 2], H],
  ];

  // ---------- Boîte linéaire à pattes opposées ----------
  function buildBox(s, art) {
    const A = s.width;
    const B = s.depth;
    const H = s.height;
    const k = SCENE_SIZE / Math.max(A, B, H);
    const tuck = Math.min(18, B * 0.35);
    const dust = Math.min(B * 0.7, A * 0.45);
    const bevel = B * 0.35; // biseau des rabats anti-poussière (sert aussi au calcul d'ouverture)
    const glue = Math.min(15, B * 0.4);
    const panel = makePanelFactory(s, k);
    const has = (n) => art.includes(n);
    const content = new THREE.Group();

    // Corps : [dos A][côté B][face A][côté B][patte de collage], face au centre.
    content.add(panel(rect(-A / 2, -H / 2, A / 2, H / 2), { art: has('front'), part: 'front' }));
    const sR = hinge(content, A / 2, 0, k);
    sR.add(panel(rect(0, -H / 2, B, H / 2), { art: has('sideR'), part: 'side' }));
    const gl = hinge(sR, B, 0, k);
    gl.add(panel([[0, -H / 2 + 3], [glue, -H / 2 + 3 + glue * 0.5], [glue, H / 2 - 3 - glue * 0.5], [0, H / 2 - 3]], { part: 'glue', inset: 1 }));
    const sL = hinge(content, -A / 2, 0, k);
    sL.add(panel(rect(-B, -H / 2, 0, H / 2), { art: has('sideL'), part: 'side' }));
    const bk = hinge(sL, -B, 0, k);
    bk.add(panel(rect(-A, -H / 2, 0, H / 2), { art: has('back'), part: 'back' }));

    // Rabats de fermeture : le haut sur le dos, le bas sur la face (pattes opposées).
    const tuckShape = (w, sgn) => [
      [-w / 2, 0], [w / 2, 0], [w / 2 - 2, sgn * tuck * 0.55], [w / 2 - tuck * 0.5, sgn * tuck],
      [-w / 2 + tuck * 0.5, sgn * tuck], [-w / 2 + 2, sgn * tuck * 0.55],
    ];
    const lidTop = hinge(bk, -A / 2, -H / 2, k);
    lidTop.add(panel(rect(-A / 2, -B, A / 2, 0), { art: has('lidTop'), up: '+z', part: 'lid' }));
    const tuckTop = hinge(lidTop, 0, -B, k);
    tuckTop.add(panel(tuckShape(A - 2, -1), { part: 'tuck', inset: 1 }));
    const lidBot = hinge(content, 0, H / 2, k);
    lidBot.add(panel(rect(-A / 2, 0, A / 2, B), { part: 'lid' }));
    const tuckBot = hinge(lidBot, 0, B, k);
    tuckBot.add(panel(tuckShape(A - 2, 1), { part: 'tuck', inset: 1 }));

    // Rabats anti-poussière sur les côtés (haut et bas).
    // Biseau toujours du côté de la charnière du rabat de fermeture (arrière en haut, avant en bas),
    // pour que le rabat passe sans toucher. sgn : -1 = haut, +1 = bas. biselDir : sens du biseau en x local.
    const dustShape = (sgn, biselDir) => {
      const b = biselDir * (B / 2 - 1); // extrémité biseautée
      const f = -b; // extrémité droite
      return [[f, 0], [b, 0], [b - biselDir * bevel, sgn * dust], [f + biselDir * 3, sgn * dust], [f, sgn * dust * 0.85]];
    };
    const dusts = [];
    // Repères locaux : sur le côté droit, l'arrière est vers +x ; sur le côté gauche (en miroir), vers -x.
    for (const [parent, cx, backDir] of [[sR, B / 2, 1], [sL, -B / 2, -1]]) {
      const top = hinge(parent, cx, -H / 2, k);
      top.add(panel(dustShape(-1, backDir), { part: 'dust', inset: 1 }));
      const bot = hinge(parent, cx, H / 2, k);
      bot.add(panel(dustShape(1, -backDir), { part: 'dust', inset: 1 }));
      dusts.push([top, bot]);
    }

    // Lignes de pliage (vue 2D).
    [A / 2, -A / 2, A / 2 + B, -A / 2 - B].forEach((x) => foldLine(content, [x, -H / 2], [x, H / 2], k));
    foldLine(content, [-A / 2 - B - A, -H / 2], [-A / 2 - B, -H / 2], k);
    foldLine(content, [-A / 2, H / 2], [A / 2, H / 2], k);
    [[A / 2, A / 2 + B], [-A / 2 - B, -A / 2]].forEach(([x0, x1]) => {
      foldLine(content, [x0, -H / 2], [x1, -H / 2], k);
      foldLine(content, [x0, H / 2], [x1, H / 2], k);
    });

    function fold(t, o) {
      const body = (Math.PI / 2) * phase(t, 0, 0.55);
      const flaps = (Math.PI / 2) * phase(t, 0.45, 1);
      sR.rotation.z = body;
      gl.rotation.z = body;
      sL.rotation.z = -body;
      bk.rotation.z = -body;
      // Ouverture : le couvercle se soulève (angle theta depuis la position fermée) et les rabats
      // anti-poussière ne montent (angle phi) qu'autant que la place sous le couvercle le permet.
      // Avec le biseau, un rabat à la distance d de la charnière ne dépasse pas d·(dust / bevel)·sin(phi) ;
      // le couvercle y est à d·sin(theta). Il faut donc sin(phi) ≤ (bevel / dust)·sin(theta).
      const lidMax = Math.PI / 2 + (t === 1 ? 0.45 : 0); // au-delà de la verticale, il bascule vers l'arrière
      const theta = o * lidMax;
      const ratio = bevel / dust;
      const phiUnder = Math.asin(Math.min(1, 0.85 * ratio * Math.sin(Math.min(theta, Math.PI / 2))));
      let phi = phiUnder;
      if (theta > Math.PI / 2) {
        // Couvercle passé derrière le dos : les rabats peuvent se redresser et s'écarter un peu vers l'extérieur.
        const u = (theta - Math.PI / 2) / (lidMax - Math.PI / 2);
        phi = phiUnder + (Math.PI / 2 + 0.22 - phiUnder) * u;
      }
      const scale = flaps / (Math.PI / 2); // pendant l'animation de pliage
      dusts.forEach(([top, bot]) => {
        top.rotation.x = flaps - phi * scale;
        bot.rotation.x = -flaps;
      });
      lidTop.rotation.x = flaps - theta * scale;
      // La languette reste verticale, plaquée contre l'intérieur de la face avant, pendant que le couvercle
      // se lève (repli = 90° + theta, sinon son extrémité pivoterait vers l'extérieur). Elle ne se déplie
      // qu'une fois sortie : quand le bord du couvercle est plus haut que sa longueur, B·sin(theta) ≥ languette.
      const thetaClear = Math.asin(Math.min(1, (tuck * 1.1) / B));
      const tuckOpen = clamp01((theta - thetaClear) / 0.7);
      tuckTop.rotation.x = (flaps + theta * scale) * (1 - tuckOpen);
      lidBot.rotation.x = -flaps;
      tuckBot.rotation.x = -flaps;
    }

    return finish(content, k, fold, Q_STANDING, bodyDims(A, B, H, glue, -(H / 2 + B + tuck + 25)));
  }

  // ---------- Sac à soufflets ----------
  function buildBag(s, art) {
    const A = s.width;
    const B = s.depth;
    const H = s.height;
    const handleMm = Math.min(H * 0.3, A * 0.35);
    const k = SCENE_SIZE / Math.max(A, B, H + handleMm);
    const band = Math.min(30, H * 0.12);
    const glue = Math.min(18, B * 0.3);
    const botFlap = B * 0.6;
    const panel = makePanelFactory(s, k);
    const has = (n) => art.includes(n);
    const content = new THREE.Group();

    const front = new THREE.Group();
    content.add(front);
    front.add(panel(rect(-A / 2, -H / 2, A / 2, H / 2), { art: has('front'), part: 'front' }));
    const sR = hinge(content, A / 2, 0, k);
    sR.add(panel(rect(0, -H / 2, B, H / 2), { art: has('sideR'), crease: true, part: 'side' }));
    const gl = hinge(sR, B, 0, k);
    gl.add(panel(rect(0, -H / 2, glue, H / 2), { part: 'glue', inset: 1 }));
    const sL = hinge(content, -A / 2, 0, k);
    sL.add(panel(rect(-B, -H / 2, 0, H / 2), { art: has('sideL'), crease: true, part: 'side' }));
    const bk = hinge(sL, -B, 0, k);
    bk.add(panel(rect(-A, -H / 2, 0, H / 2), { art: has('back'), part: 'back' }));

    // Rempli du haut (replié vers l'intérieur) et rabats du fond.
    const bands = [];
    const bottoms = [];
    for (const [parent, cx, w] of [[content, 0, A], [sR, B / 2, B], [sL, -B / 2, B], [bk, -A / 2, A]]) {
      const top = hinge(parent, cx, -H / 2, k);
      // Rempli retourné à 180° : son côté « intérieur » regarde la paroi, d'où le décalage négatif.
      top.add(panel(rect(-w / 2, -band, w / 2, 0), { part: 'band', inset: -1 }));
      bands.push(top);
      const bot = hinge(parent, cx, H / 2, k);
      const depth = w === A ? botFlap : B / 2;
      bot.add(panel(rect(-w / 2, 0, w / 2, depth), { part: 'bottom', inset: w === A ? 1 : 2 }));
      bottoms.push(bot);
      foldLine(parent, [cx - w / 2, -H / 2], [cx + w / 2, -H / 2], k);
      foldLine(parent, [cx - w / 2, H / 2], [cx + w / 2, H / 2], k);
    }
    [A / 2, -A / 2, A / 2 + B, -A / 2 - B].forEach((x) => foldLine(content, [x, -H / 2], [x, H / 2], k));

    // Poignées en cordelette (apparaissent une fois le sac monté).
    const handleMat = new THREE.MeshStandardMaterial({ color: contrastColor(s), roughness: 0.7 });
    const handles = [];
    const hw = A * 0.2 * k;
    const hh = handleMm * k;
    for (const [parent, cx] of [[front, 0], [bk, -A / 2]]) {
      const zTop = (-H / 2) * k;
      const y = 0.012; // côté intérieur
      const curve = new THREE.CubicBezierCurve3(
        new THREE.Vector3(cx * k - hw, y, zTop + 0.06),
        new THREE.Vector3(cx * k - hw, y, zTop - hh / 0.75),
        new THREE.Vector3(cx * k + hw, y, zTop - hh / 0.75),
        new THREE.Vector3(cx * k + hw, y, zTop + 0.06)
      );
      const tube = new THREE.Mesh(new THREE.TubeGeometry(curve, 48, 0.016, 10, false), handleMat);
      tube.castShadow = true;
      parent.add(tube);
      handles.push(tube);
    }

    function fold(t) {
      const body = (Math.PI / 2) * phase(t, 0, 0.55);
      const flaps = phase(t, 0.45, 1);
      sR.rotation.z = body;
      gl.rotation.z = body;
      sL.rotation.z = -body;
      bk.rotation.z = -body;
      bands.forEach((b) => (b.rotation.x = Math.PI * flaps));
      bottoms.forEach((b) => (b.rotation.x = (-Math.PI / 2) * flaps));
      handles.forEach((h) => (h.visible = t > 0.97));
    }

    return finish(content, k, fold, Q_STANDING, bodyDims(A, B, H, glue, -(H / 2 + band + 25)));
  }

  // ---------- Coffret : fond + couvercle, deux plateaux montés ----------
  function buildCoffret(s, art) {
    const A = s.width;
    const B = s.depth;
    const H = s.height;
    const k = SCENE_SIZE / Math.max(A, B, H * 1.6);
    const panel = makePanelFactory(s, k);
    const has = (n) => art.includes(n);
    const content = new THREE.Group();

    // Plateau : fond w × d, quatre parois de hauteur h, pattes d'angle sur les parois avant / arrière.
    function tray(parent, w, d, h, lid) {
      const walls = [];
      const tabs = [];
      parent.add(panel(rect(-w / 2, -d / 2, w / 2, d / 2), { art: lid && has('lidTop'), up: '-z', part: lid ? 'lid' : 'base' }));
      const tab = Math.min(15, d * 0.2);
      const sides = [
        // [x, z, axe, signe, points, haut du texte, nom de l'art]
        ['front', 0, d / 2, 'x', -1, rect(-w / 2, 0, w / 2, h), lid ? '-z' : '+z', 'lidFront'],
        ['back', 0, -d / 2, 'x', 1, rect(-w / 2, -h, w / 2, 0), lid ? '+z' : '-z', null],
        ['right', w / 2, 0, 'z', 1, rect(0, -d / 2, h, d / 2), lid ? '-x' : '+x', null],
        ['left', -w / 2, 0, 'z', -1, rect(-h, -d / 2, 0, d / 2), lid ? '+x' : '-x', null],
      ];
      for (const [name, x, z, axis, sgn, pts, up, artName] of sides) {
        const hg = hinge(parent, x, z, k);
        const isArt = lid && (artName ? has(artName) : has('lidAll'));
        hg.add(panel(pts, { art: isArt, up, part: lid ? 'lidWall' : 'wall' }));
        walls.push([hg, axis, sgn]);
        foldLine(parent, axis === 'x' ? [-w / 2, z] : [x, -d / 2], axis === 'x' ? [w / 2, z] : [x, d / 2], k);
        if (axis === 'x') {
          // Pattes d'angle collées à l'intérieur des parois latérales.
          for (const ts of [1, -1]) {
            const th = hinge(hg, ts * (w / 2), 0, k);
            const zz = name === 'front' ? [0, h] : [-h, 0];
            th.add(panel([[0, zz[0] + 2], [ts * tab, zz[0] + 4], [ts * tab, zz[1] - 4], [0, zz[1] - 2]], { part: 'tab', inset: 1 }));
            tabs.push([th, ts]);
          }
        }
      }
      return (f) => {
        walls.forEach(([hg, axis, sgn]) => {
          if (axis === 'x') hg.rotation.x = sgn * f;
          else hg.rotation.z = sgn * f;
        });
        tabs.forEach(([th, ts]) => (th.rotation.z = ts * f));
      };
    }

    const foldBase = tray(content, A, B, H, false);
    // Jeu entre fond et couvercle : 2 mm, et assez pour que les pattes intérieures du couvercle
    // (décalées d'une couche) restent à l'extérieur du fond, même sur un très grand coffret.
    const gap = Math.max(2, 0.01 / k);
    const lidW = A + 2 * gap;
    const lidD = B + 2 * gap;
    const lidH = Math.min(Math.max(H * 0.35, 15), H * 0.6);
    const lidPiece = new THREE.Group();
    content.add(lidPiece);
    const foldLid = tray(lidPiece, lidW, lidD, lidH, true);
    const flatX = A / 2 + H + 30 + lidH + lidW / 2;

    function fold(t, o) {
      const f = (Math.PI / 2) * phase(t, 0, 0.6);
      foldBase(f);
      foldLid(f);
      // Le couvercle se retourne (autour de l'axe avant-arrière, l'avant reste devant) et vient se poser sur le fond.
      // Montage en deux temps : le couvercle se retourne au-dessus du fond (p), puis descend tout droit (d).
      // S'il descendait en tournant encore, un de ses bords plongerait dans les parois du fond.
      const clear = lidH + 3; // hauteur qui dégage entièrement les parois du fond
      // Montage : le couvercle monte et se retourne sur place, à côté du fond (p), glisse au-dessus (s),
      // puis descend tout droit (d). À côté du fond, même en tournant, il ne peut pas le toucher.
      const up = phase(t, 0.45, 0.6);
      const p = phase(t, 0.45, 0.72);
      const s = phase(t, 0.72, 0.88);
      const d = phase(t, 0.88, 1);
      const hover = (H + 1 + clear) * up;
      // En tournant, un coin descend d'au plus (demi-largeur + hauteur)·sin(angle) : il reste au-dessus du sol.
      const arc = Math.max(0, (lidW / 2 + lidH) * Math.sin(Math.PI * p) - hover + 2);
      // Ouverture (une fois posé seulement) : il monte d'abord tout droit jusqu'à dégager le fond, puis recule
      // en s'inclinant, assez haut pour que l'arrière du couvercle ne plonge pas dans le fond.
      const oo = o * d;
      const lift = clamp01(oo / 0.3);
      const back = clamp01((oo - 0.3) / 0.7);
      const raise = clear * lift + Math.max((H * 0.9 - clear) * back, (lidD / 2) * Math.sin(0.35 * back));
      lidPiece.rotation.set(-0.35 * back, 0, Math.PI * p);
      lidPiece.position.set(
        flatX * k * (1 - s),
        (hover - clear * d + arc + raise) * k,
        -back * B * k * 0.25
      );
    }

    // Cotes du fond (dimensions internes).
    return finish(content, k, fold, Q_FLAT, [
      ['A', [-A / 2, -(B / 2 + H + 25)], [A / 2, -(B / 2 + H + 25)], A],
      ['B', [-A / 2 - H - 25, -B / 2], [-A / 2 - H - 25, B / 2], B],
      ['H', [A / 2 + 25, B / 2], [A / 2 + 25, B / 2 + H], H],
    ]);
  }

  return { 'boite-pliante': buildBox, sac: buildBag, coffret: buildCoffret };
}

// Zones imprimées (logo et texte) selon l'emplacement choisi.
export const DIELINE_ART = {
  'boite-pliante': { front: ['front'], 'front-back': ['front', 'back'], all: ['front', 'back', 'sideL', 'sideR', 'lidTop'] },
  sac: { front: ['front'], 'front-back': ['front', 'back'], all: ['front', 'back', 'sideL', 'sideR'] },
  coffret: { front: ['lidTop'], 'front-back': ['lidTop', 'lidFront'], all: ['lidTop', 'lidFront', 'lidAll'] },
};
