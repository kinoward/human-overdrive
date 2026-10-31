import * as THREE from 'three';

function createSign(text: string, caption: string, color: string, width: number, height: number, vertical = false) {
  const canvas = document.createElement('canvas');
  canvas.width = vertical ? 256 : 1024;
  canvas.height = vertical ? 1024 : 384;
  const ctx = canvas.getContext('2d')!;
  ctx.fillStyle = '#081216';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.strokeStyle = color;
  ctx.lineWidth = vertical ? 3 : 4;
  ctx.strokeRect(13, 13, canvas.width - 26, canvas.height - 26);
  ctx.fillStyle = color;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.shadowColor = color;
  ctx.shadowBlur = 10;
  if (vertical) {
    const size = Math.min(165, 700 / text.length);
    ctx.font = `600 ${size}px "Overdrive Scene", "PingFang SC", "Microsoft YaHei", sans-serif`;
    const step = 760 / text.length;
    [...text].forEach((letter, index) => ctx.fillText(letter, 128, 100 + step * (index + 0.5)));
    ctx.shadowBlur = 0;
    ctx.font = '500 17px sans-serif';
    ctx.fillText(caption, 128, 936);
    ctx.fillRect(104, 962, 48, 3);
  } else {
    ctx.font = `600 ${Math.min(176, 850 / text.length)}px "Overdrive Scene", "PingFang SC", "Microsoft YaHei", sans-serif`;
    ctx.fillText(text, 512, 165);
    ctx.shadowBlur = 0;
    ctx.font = '500 29px "Overdrive Scene", "PingFang SC", sans-serif';
    ctx.fillStyle = '#b9c8c7';
    ctx.fillText(caption, 512, 292);
    ctx.fillStyle = color;
    ctx.fillRect(64, 330, 60, 5);
    ctx.fillRect(900, 330, 60, 5);
  }
  ctx.globalAlpha = 0.06;
  ctx.fillStyle = '#000';
  for (let y = 0; y < canvas.height; y += 4) ctx.fillRect(0, y, canvas.width, 1);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = 4;
  const material = new THREE.MeshStandardMaterial({ map: texture, emissiveMap: texture, emissive: '#ffffff', emissiveIntensity: 1.65, roughness: 0.42, metalness: 0.1, side: THREE.DoubleSide });
  const mesh = new THREE.Mesh(new THREE.PlaneGeometry(width, height), material);
  mesh.name = text;
  return mesh;
}

function createPoster(width: number, height: number) {
  const canvas = document.createElement('canvas');
  canvas.width = 768; canvas.height = 1280;
  const ctx = canvas.getContext('2d')!;
  ctx.fillStyle = '#0e252c'; ctx.fillRect(0, 0, 768, 1280);
  const gradient = ctx.createLinearGradient(80, 100, 680, 1100);
  gradient.addColorStop(0, '#ffb57b'); gradient.addColorStop(0.5, '#dd785d'); gradient.addColorStop(1, '#9b5f58');
  ctx.fillStyle = gradient;
  ctx.beginPath(); ctx.arc(440, 493, 256, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = '#173740';
  ctx.beginPath(); ctx.arc(540, 433, 244, 0, Math.PI * 2); ctx.fill();
  ctx.strokeStyle = '#83bcc0'; ctx.lineWidth = 2;
  for (let i = 0; i < 18; i++) {
    const y = 627 + i * 22;
    ctx.beginPath(); ctx.moveTo(0, y); ctx.quadraticCurveTo(320, y - 170 - i * 4, 768, y - 70); ctx.stroke();
  }
  ctx.fillStyle = '#d6d9c5';
  ctx.font = '600 89px "Overdrive Scene", "PingFang SC", sans-serif';
  ctx.textBaseline = 'middle';
  ctx.fillText('明日', 68, 124); ctx.fillText('已至', 68, 225);
  ctx.font = '400 23px "Overdrive Scene", "PingFang SC", sans-serif';
  ctx.fillText('新感官 · 新城市', 72, 1064);
  ctx.font = '500 15px "Overdrive Scene", "PingFang SC", sans-serif';
  ctx.fillText('垣城神经网络  /  第七代城市连接计划', 72, 1116);
  ctx.fillStyle = '#80bfc7'; ctx.fillRect(72, 1160, 620, 2);
  ctx.font = '500 22px sans-serif'; ctx.fillText('2077', 72, 1205);
  ctx.font = '400 14px "Overdrive Scene", "PingFang SC", sans-serif'; ctx.fillText('让每一个夜晚，超越想象。', 379, 1205);
  ctx.fillStyle = 'rgba(0,0,0,0.12)';
  for (let y = 0; y < 1280; y += 5) ctx.fillRect(0, y, 768, 1);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace; texture.anisotropy = 8;
  return new THREE.Mesh(new THREE.PlaneGeometry(width, height), new THREE.MeshStandardMaterial({ map: texture, emissiveMap: texture, emissive: '#ffffff', emissiveIntensity: 1.1, roughness: 0.55, metalness: 0.15, side: THREE.DoubleSide }));
}

export function createCyberSignage() {
  const materials = new Map<string, THREE.Material>();
  const getSign = (text: string, caption: string, color: string, width: number, height: number, vertical = false) => {
    const key = `${text}:${caption}:${color}:${vertical}`;
    let material = materials.get(key);
    if (!material) {
      const template = createSign(text, caption, color, 1, 1, vertical);
      material = template.material;
      template.geometry.dispose();
      materials.set(key, material);
    }
    const mesh = new THREE.Mesh(new THREE.PlaneGeometry(width, height), material);
    mesh.name = text; mesh.userData.cyberVisual = true;
    return mesh;
  };
  const getPoster = (width: number, height: number) => {
    let material = materials.get('城市海报');
    if (!material) {
      const template = createPoster(1, 1);
      material = template.material;
      template.geometry.dispose();
      materials.set('城市海报', material);
    }
    const mesh = new THREE.Mesh(new THREE.PlaneGeometry(width, height), material);
    mesh.name = '城市原创海报'; mesh.userData.cyberVisual = true;
    return mesh;
  };
  const dispose = () => {
    const textures = new Set<THREE.Texture>();
    for (const material of materials.values()) {
      for (const value of Object.values(material)) if (value instanceof THREE.Texture) textures.add(value);
      material.dispose();
    }
    textures.forEach(texture => texture.dispose());
    materials.clear();
  };
  return { sign: getSign, poster: getPoster, dispose };
}
