// Page d'accueil : boîte 3D de démonstration qui tourne.
import { createStage } from './stage.js';
import { createFoldingBox } from './box.js';

// Logo de démonstration dessiné en code.
function demoLogo() {
  const c = document.createElement('canvas');
  c.width = c.height = 400;
  const ctx = c.getContext('2d');
  ctx.fillStyle = '#2b5cff';
  ctx.beginPath();
  ctx.arc(200, 200, 170, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = '#ffffff';
  ctx.lineWidth = 22;
  ctx.lineJoin = 'round';
  ctx.beginPath();
  ctx.moveTo(200, 100);
  ctx.lineTo(290, 150);
  ctx.lineTo(290, 250);
  ctx.lineTo(200, 300);
  ctx.lineTo(110, 250);
  ctx.lineTo(110, 150);
  ctx.closePath();
  ctx.moveTo(110, 150);
  ctx.lineTo(200, 200);
  ctx.lineTo(290, 150);
  ctx.moveTo(200, 200);
  ctx.lineTo(200, 300);
  ctx.stroke();
  const img = new Image();
  img.src = c.toDataURL();
  return img;
}

const canvas = document.getElementById('hero-canvas');
const stage = createStage(canvas, { autoRotate: true, interactive: true });
stage.controls.enableZoom = false;
stage.camera.position.multiplyScalar(1.05);

const box = createFoldingBox({ color: '#ffffff', finish: 'mat', text: 'Votre marque', placement: 'front-back' });
stage.scene.add(box.group);
stage.focus(box.sceneHeight());

const logo = demoLogo();
logo.onload = () => box.update({ logo, logoScale: 0.5 });
document.fonts?.ready.then(() => box.update());
