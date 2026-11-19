import * as THREE from 'three';

/* ===================================================================
 * Gerador Avançado de Texturas PBR (Albedo, Normal/Bump, Roughness, Emissive)
 * 10+ Estilos Arquitetônicos Distintos + Asfalto + Calçada + Telha + Madeira
 * =================================================================== */

function createCanvasTex(
  w: number,
  h: number,
  draw: (ctx: CanvasRenderingContext2D, w: number, h: number) => void,
  repeatX = 1,
  repeatY = 1,
): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  const ctx = c.getContext('2d')!;
  draw(ctx, w, h);
  const tex = new THREE.CanvasTexture(c);
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(repeatX, repeatY);
  tex.anisotropy = 8;
  tex.needsUpdate = true;
  return tex;
}

export interface BuildingFacadeSet {
  name: string;
  map: THREE.CanvasTexture;
  emissiveMap: THREE.CanvasTexture;
  roughness: number;
  metalness: number;
}

export interface SharedTextures {
  asphalt: THREE.CanvasTexture;
  asphaltBump: THREE.CanvasTexture;
  sidewalk: THREE.CanvasTexture;
  sand: THREE.CanvasTexture;
  grass: THREE.CanvasTexture;
  roofTile: THREE.CanvasTexture;
  corrugatedMetal: THREE.CanvasTexture;
  woodDeck: THREE.CanvasTexture;
  facades: BuildingFacadeSet[];
}

let cached: SharedTextures | null = null;

function buildFacadePair(
  name: string,
  baseColor: string,
  frameColor: string,
  cols: number,
  rows: number,
  winColors: string[],
  litChance: number,
  roughness: number,
  metalness: number,
  style: 'curtain' | 'windows' | 'artdeco' | 'brutalist' | 'hotel',
): BuildingFacadeSet {
  const w = 512;
  const h = 512;

  const emissiveCanvas = document.createElement('canvas');
  emissiveCanvas.width = w;
  emissiveCanvas.height = h;
  const eCtx = emissiveCanvas.getContext('2d')!;
  eCtx.fillStyle = '#000000';
  eCtx.fillRect(0, 0, w, h);

  const map = createCanvasTex(w, h, (ctx) => {
    ctx.fillStyle = baseColor;
    ctx.fillRect(0, 0, w, h);

    // Ruído sutil na alvenaria/fachada
    for (let i = 0; i < 1800; i++) {
      ctx.fillStyle = i % 2 === 0 ? 'rgba(255,255,255,0.03)' : 'rgba(0,0,0,0.04)';
      ctx.fillRect(Math.random() * w, Math.random() * h, 3, 3);
    }

    const cw = w / cols;
    const rh = h / rows;

    for (let r = 0; r < rows; r++) {
      // Friso horizontal entre andares
      ctx.fillStyle = frameColor;
      ctx.fillRect(0, r * rh, w, style === 'brutalist' ? 6 : 3);

      for (let c = 0; c < cols; c++) {
        const x = c * cw;
        const y = r * rh;

        if (style === 'artdeco' || style === 'curtain') {
          ctx.fillStyle = frameColor;
          ctx.fillRect(x, y, 3, rh);
        }

        const padX = style === 'curtain' ? 4 : style === 'brutalist' ? 10 : 7;
        const padY = style === 'curtain' ? 4 : style === 'brutalist' ? 10 : 7;
        const ww = cw - padX * 2;
        const wh = rh - padY * 2;

        const isLit = Math.random() < litChance;
        const winCol = isLit
          ? winColors[Math.floor(Math.random() * winColors.length)]
          : '#0e1724';

        // Gradiente de reflexo na janela
        const grad = ctx.createLinearGradient(x + padX, y + padY, x + padX + ww, y + padY + wh);
        grad.addColorStop(0, winCol);
        grad.addColorStop(1, isLit ? '#ffffff' : '#182940');
        ctx.fillStyle = grad;
        ctx.fillRect(x + padX, y + padY, ww, wh);

        // Sacada se for hotel/residencial
        if (style === 'hotel') {
          ctx.fillStyle = 'rgba(220,235,248,0.55)';
          ctx.fillRect(x + padX - 2, y + padY + wh - 5, ww + 4, 5);
        }

        if (isLit) {
          eCtx.fillStyle = winCol;
          eCtx.fillRect(x + padX + 1, y + padY + 1, ww - 2, wh - 2);
        }
      }
    }
  });

  const emissiveMap = new THREE.CanvasTexture(emissiveCanvas);
  emissiveMap.wrapS = THREE.RepeatWrapping;
  emissiveMap.wrapT = THREE.RepeatWrapping;
  emissiveMap.needsUpdate = true;

  return { name, map, emissiveMap, roughness, metalness };
}

export function getSharedTextures(): SharedTextures {
  if (cached) return cached;

  const asphalt = createCanvasTex(512, 512, (ctx, w, h) => {
    ctx.fillStyle = '#1d2129';
    ctx.fillRect(0, 0, w, h);
    for (let i = 0; i < 6500; i++) {
      const v = 22 + Math.floor(Math.random() * 26);
      ctx.fillStyle = `rgb(${v},${v + 1},${v + 4})`;
      ctx.fillRect(Math.random() * w, Math.random() * h, 2, 2);
    }
    // Faixas laterais brancas
    ctx.fillStyle = 'rgba(235,240,248,0.65)';
    ctx.fillRect(18, 0, 6, h);
    ctx.fillRect(w - 24, 0, 6, h);
    // Faixa dupla tracejada amarela central
    ctx.fillStyle = '#f0be37';
    for (let y = 0; y < h; y += 64) {
      ctx.fillRect(w / 2 - 7, y + 8, 5, 38);
      ctx.fillRect(w / 2 + 2, y + 8, 5, 38);
    }
  }, 1, 8);

  const asphaltBump = createCanvasTex(256, 256, (ctx, w, h) => {
    ctx.fillStyle = '#808080';
    ctx.fillRect(0, 0, w, h);
    for (let i = 0; i < 4000; i++) {
      const g = 100 + Math.floor(Math.random() * 55);
      ctx.fillStyle = `rgb(${g},${g},${g})`;
      ctx.fillRect(Math.random() * w, Math.random() * h, 2, 2);
    }
  }, 4, 32);

  const sidewalk = createCanvasTex(256, 256, (ctx, w, h) => {
    ctx.fillStyle = '#9aa1ad';
    ctx.fillRect(0, 0, w, h);
    ctx.strokeStyle = '#757c88';
    ctx.lineWidth = 2;
    for (let x = 0; x <= w; x += 64) {
      ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, h); ctx.stroke();
    }
    for (let y = 0; y <= h; y += 64) {
      ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(w, y); ctx.stroke();
    }
  }, 8, 8);

  const sand = createCanvasTex(256, 256, (ctx, w, h) => {
    ctx.fillStyle = '#e0c996';
    ctx.fillRect(0, 0, w, h);
    for (let i = 0; i < 2400; i++) {
      ctx.fillStyle = Math.random() > 0.5 ? '#d1b780' : '#ecd9ad';
      ctx.fillRect(Math.random() * w, Math.random() * h, 2, 2);
    }
  }, 40, 40);

  const grass = createCanvasTex(256, 256, (ctx, w, h) => {
    ctx.fillStyle = '#366332';
    ctx.fillRect(0, 0, w, h);
    for (let i = 0; i < 2600; i++) {
      ctx.fillStyle = Math.random() > 0.5 ? '#2c5329' : '#45783f';
      ctx.fillRect(Math.random() * w, Math.random() * h, 2, 2);
    }
  }, 60, 60);

  const roofTile = createCanvasTex(256, 256, (ctx, w, h) => {
    ctx.fillStyle = '#9c3d28';
    ctx.fillRect(0, 0, w, h);
    ctx.strokeStyle = '#732919';
    ctx.lineWidth = 3;
    for (let y = 0; y < h; y += 24) {
      ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(w, y); ctx.stroke();
    }
    for (let x = 0; x < w; x += 32) {
      ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, h); ctx.stroke();
    }
  }, 4, 4);

  const corrugatedMetal = createCanvasTex(256, 256, (ctx, w, h) => {
    ctx.fillStyle = '#4e5968';
    ctx.fillRect(0, 0, w, h);
    for (let x = 0; x < w; x += 12) {
      ctx.fillStyle = x % 24 === 0 ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.12)';
      ctx.fillRect(x, 0, 6, h);
    }
  }, 3, 2);

  const woodDeck = createCanvasTex(256, 256, (ctx, w, h) => {
    ctx.fillStyle = '#735032';
    ctx.fillRect(0, 0, w, h);
    ctx.strokeStyle = '#4d331d';
    ctx.lineWidth = 2;
    for (let y = 0; y < h; y += 22) {
      ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(w, y); ctx.stroke();
    }
  }, 6, 6);

  const facades: BuildingFacadeSet[] = [
    buildFacadePair('Cyber Glass Cyan', '#102136', '#1e3959', 10, 18, ['#8aefff', '#d6f8ff', '#ffe599'], 0.55, 0.14, 0.88, 'curtain'),
    buildFacadePair('Corporate Gold Tower', '#1f1c18', '#4d412c', 8, 16, ['#ffd97d', '#fff1c2', '#ffb74d'], 0.5, 0.18, 0.82, 'curtain'),
    buildFacadePair('Emerald Financial', '#0d2622', '#1d4d44', 10, 20, ['#98ffdf', '#e0fff6', '#ffe49e'], 0.52, 0.15, 0.85, 'curtain'),
    buildFacadePair('Art Deco Limestone', '#c9beaa', '#8f836f', 6, 12, ['#ffe094', '#fff3cf'], 0.44, 0.65, 0.18, 'artdeco'),
    buildFacadePair('Classic Red Brick', '#7a3329', '#4f2019', 6, 10, ['#ffd685', '#ffecb8'], 0.48, 0.78, 0.08, 'windows'),
    buildFacadePair('Brutalist Concrete', '#7c828c', '#535861', 5, 10, ['#ffde96', '#b8e2ff'], 0.4, 0.75, 0.12, 'brutalist'),
    buildFacadePair('Tropical Beach Hotel', '#f5ebd6', '#d4c3a3', 7, 12, ['#7ee8fa', '#ffe299', '#ff99c8'], 0.62, 0.42, 0.22, 'hotel'),
    buildFacadePair('Sunset Coral Resort', '#e8a598', '#b87669', 7, 11, ['#ffe6a3', '#a3f7ff'], 0.58, 0.46, 0.18, 'hotel'),
    buildFacadePair('Neon District Tower', '#161326', '#2e2652', 9, 16, ['#ff4df0', '#2de2e6', '#ffe066'], 0.64, 0.18, 0.8, 'curtain'),
    buildFacadePair('Modern Graphite Mixed', '#2b303a', '#1a1d24', 8, 14, ['#ffdf91', '#c4e8ff'], 0.46, 0.35, 0.55, 'windows'),
  ];

  cached = {
    asphalt,
    asphaltBump,
    sidewalk,
    sand,
    grass,
    roofTile,
    corrugatedMetal,
    woodDeck,
    facades,
  };
  return cached;
}
