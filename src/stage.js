// Scène 3D partagée : rendu, lumières, sol, caméra et contrôles.
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';

// Positions de caméra : vue 3/4 classique, et vue de dessus pour les patrons à plat.
const PRESETS = {
  home: new THREE.Vector3(4.3, 3.0, 5.6),
  top: new THREE.Vector3(0, 6.6, 1.6),
};

export function createStage(canvas, { autoRotate = false, interactive = true } = {}) {
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.toneMapping = THREE.NeutralToneMapping ?? THREE.NoToneMapping;
  renderer.outputColorSpace = THREE.SRGBColorSpace;

  const scene = new THREE.Scene();
  const pmrem = new THREE.PMREMGenerator(renderer);
  scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
  scene.environmentIntensity = 0.75;

  const camera = new THREE.PerspectiveCamera(32, 1, 0.1, 100);
  let preset = 'home';
  camera.position.copy(PRESETS.home);

  const controls = new OrbitControls(camera, canvas);
  controls.enableDamping = true;
  controls.dampingFactor = 0.08;
  controls.enablePan = false;
  controls.minDistance = 2.6;
  controls.maxDistance = 16;
  controls.maxPolarAngle = Math.PI / 2 - 0.04;
  controls.target.set(0, 0.8, 0);
  controls.enabled = interactive;
  controls.autoRotate = autoRotate;
  controls.autoRotateSpeed = 1.4;

  const sun = new THREE.DirectionalLight(0xffffff, 1.6);
  sun.position.set(3, 7, 4);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  Object.assign(sun.shadow.camera, { left: -4, right: 4, top: 4, bottom: -4, near: 1, far: 20 });
  sun.shadow.radius = 6;
  sun.shadow.bias = -0.0005;
  scene.add(sun);

  const ground = new THREE.Mesh(
    new THREE.PlaneGeometry(30, 30),
    new THREE.ShadowMaterial({ opacity: 0.14 })
  );
  ground.rotation.x = -Math.PI / 2;
  ground.receiveShadow = true;
  scene.add(ground);

  const container = canvas.parentElement;
  function resize() {
    const w = container.clientWidth;
    const h = container.clientHeight;
    if (!w || !h) return;
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
  }
  new ResizeObserver(resize).observe(container);
  resize();

  renderer.setAnimationLoop(() => {
    controls.update();
    renderer.render(scene, camera);
  });

  // Centre la caméra sur l'emballage (hauteur en unités de scène).
  function focus(height) {
    controls.target.set(0, height / 2, 0);
  }

  function presetPosition(name) {
    if (name === 'top') {
      // Vue de dessus : recule la caméra pour que tout le patron tienne à l'écran.
      const d = Math.max(7.6, 8 / camera.aspect);
      return new THREE.Vector3(0, d * 0.97, d * 0.24);
    }
    return PRESETS[name].clone();
  }

  // Annule l'élan d'une rotation à la souris (sinon la vue continue de tourner après un changement de vue).
  function stopInertia() {
    const damping = controls.enableDamping;
    controls.enableDamping = false;
    controls.update();
    controls.enableDamping = damping;
  }

  function resetView() {
    stopInertia();
    camera.position.copy(presetPosition(preset));
    controls.update();
  }

  // Déplace la caméra en douceur vers une vue (pendant une animation).
  function flyTo(name, duration, targetY = 0) {
    stopInertia();
    const from = camera.position.clone();
    const to = presetPosition(name);
    const tFrom = controls.target.clone();
    const tTo = new THREE.Vector3(0, targetY, 0);
    const start = performance.now();
    preset = name;
    function step(now) {
      const t = Math.min(1, (now - start) / duration);
      const e = t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2;
      camera.position.lerpVectors(from, to, e);
      controls.target.lerpVectors(tFrom, tTo, e);
      if (t < 1) requestAnimationFrame(step);
    }
    requestAnimationFrame(step);
  }

  function setPreset(name) {
    if (!PRESETS[name]) return;
    preset = name;
    resetView();
  }

  // Exporte la vue actuelle en PNG haute définition.
  function snapshot({ scale = 2, transparent = false, maxWidth = 0 } = {}) {
    const prev = renderer.getPixelRatio();
    renderer.setPixelRatio(scale);
    renderer.render(scene, camera);
    const src = renderer.domElement;
    let w = src.width;
    let h = src.height;
    if (maxWidth && w > maxWidth) {
      h = Math.round((h * maxWidth) / w);
      w = maxWidth;
    }
    const out = document.createElement('canvas');
    out.width = w;
    out.height = h;
    const ctx = out.getContext('2d');
    if (!transparent) {
      const g = ctx.createLinearGradient(0, 0, 0, h);
      g.addColorStop(0, '#f7f9fd');
      g.addColorStop(1, '#e9eef8');
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, w, h);
    }
    ctx.drawImage(src, 0, 0, w, h);
    renderer.setPixelRatio(prev);
    resize();
    renderer.render(scene, camera);
    return out.toDataURL('image/png');
  }

  return { renderer, scene, camera, controls, focus, resetView, setPreset, flyTo, snapshot };
}
