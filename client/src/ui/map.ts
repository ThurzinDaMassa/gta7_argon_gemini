import * as THREE from 'three';
import {
  WORLD_HALF, POIS, PROPERTIES, MISSIONS,
  getRoadNetwork, westCoastX, southCoastZ, ISLANDS,
  type NetPlayer, type NetVehicle,
} from '../../../shared/src';

/* ===================================================================
 * Renderizador do Minimapa Radar (Rotacionado pela Câmera Estilo GTA V,
 * com Cone de Visão, Rosa dos Ventos N/S/L/O, Rota GPS e Blips) e
 * Mapa em Tela Cheia Interativo com Zoom, Pan e GPS Viário A*
 * =================================================================== */

export class MapRenderer {
  private miniCanvas: HTMLCanvasElement;
  private miniCtx: CanvasRenderingContext2D;
  private bigCanvas: HTMLCanvasElement;
  private bigCtx: CanvasRenderingContext2D;

  zoom = 1.0;
  panX = 0;
  panZ = 0;

  constructor(miniCanvas: HTMLCanvasElement, bigCanvas: HTMLCanvasElement) {
    this.miniCanvas = miniCanvas;
    this.miniCtx = miniCanvas.getContext('2d')!;
    this.bigCanvas = bigCanvas;
    this.bigCtx = bigCanvas.getContext('2d')!;
  }

  drawMinimap(
    selfPos: THREE.Vector3,
    selfYaw: number,
    camYaw: number,
    players: Map<string, NetPlayer>,
    vehicles: Map<string, NetVehicle>,
    gpsRoute: [number, number, number][],
    activeCheckpoint: { x: number; z: number; r: number } | null,
    policePositions: { x: number; z: number; active: boolean }[] = [],
  ) {
    const ctx = this.miniCtx;
    const w = this.miniCanvas.width;
    const h = this.miniCanvas.height;
    const scale = 0.28; // pixels por metro

    ctx.clearRect(0, 0, w, h);
    ctx.save();
    ctx.translate(w / 2, h / 2);

    // Rotaciona o radar para que a direção para onde a câmera olha fique SEMPRE PARA CIMA (Norte da tela)
    const radarRot = camYaw + Math.PI;
    ctx.save();
    ctx.rotate(radarRot);

    // Fundo oceano
    ctx.fillStyle = '#0a2036';
    ctx.fillRect(-w, -h, w * 2, h * 2);

    const toLocal = (wx: number, wz: number): [number, number] => [
      (wx - selfPos.x) * scale,
      (wz - selfPos.z) * scale,
    ];

    // Continente principal
    ctx.fillStyle = '#1f3728';
    const [cx0, cz0] = toLocal(westCoastX(selfPos.z), -WORLD_HALF);
    const [cx1, cz1] = toLocal(WORLD_HALF, southCoastZ(selfPos.x));
    ctx.fillRect(cx0, cz0, cx1 - cx0, cz1 - cz0);

    // Malha viária ao redor do jogador
    const net = getRoadNetwork();
    ctx.lineCap = 'round';
    for (const e of net.edges) {
      const p0 = e.pts[0];
      if (Math.hypot(p0[0] - selfPos.x, p0[2] - selfPos.z) > 620) continue;
      ctx.strokeStyle = e.type === 'highway' ? '#c9982c' : e.type === 'dirt' ? '#705438' : '#738094';
      ctx.lineWidth = Math.max(1.8, e.width * scale * 0.52);
      ctx.beginPath();
      for (let i = 0; i < e.pts.length; i++) {
        const [lx, lz] = toLocal(e.pts[i][0], e.pts[i][2]);
        if (i === 0) ctx.moveTo(lx, lz);
        else ctx.lineTo(lx, lz);
      }
      ctx.stroke();
    }

    // Rota GPS em Ciano/Roxo brilhante
    if (gpsRoute.length > 1) {
      ctx.strokeStyle = '#2de2e6';
      ctx.lineWidth = 3.6;
      ctx.beginPath();
      for (let i = 0; i < gpsRoute.length; i++) {
        const [lx, lz] = toLocal(gpsRoute[i][0], gpsRoute[i][2]);
        if (i === 0) ctx.moveTo(lx, lz);
        else ctx.lineTo(lx, lz);
      }
      ctx.stroke();
    }

    // POIs
    for (const poi of POIS) {
      const [lx, lz] = toLocal(poi.x, poi.z);
      if (Math.hypot(lx, lz) > w * 0.62) continue;
      ctx.fillStyle = poi.kind === 'hospital' ? '#ff385c' : poi.kind === 'police' ? '#3b82f6' : '#2de2e6';
      ctx.beginPath();
      ctx.arc(lx, lz, 3.2, 0, Math.PI * 2);
      ctx.fill();
    }

    // Missões disponíveis
    for (const m of MISSIONS) {
      const [lx, lz] = toLocal(m.giver.x, m.giver.z);
      if (Math.hypot(lx, lz) > w * 0.62) continue;
      ctx.fillStyle = '#f5b942';
      ctx.beginPath();
      ctx.arc(lx, lz, 4.2, 0, Math.PI * 2);
      ctx.fill();
    }

    // Veículos próximos
    ctx.fillStyle = '#d8e1eb';
    for (const v of vehicles.values()) {
      const [lx, lz] = toLocal(v.p[0], v.p[2]);
      if (Math.hypot(lx, lz) > w * 0.55) continue;
      ctx.fillRect(lx - 2, lz - 2, 4, 4);
    }

    // Viaturas policiais em perseguição (piscando vermelho/azul)
    const flashBlue = Math.floor(performance.now() / 220) % 2 === 0;
    for (const pol of policePositions) {
      if (!pol.active) continue;
      const [lx, lz] = toLocal(pol.x, pol.z);
      if (Math.hypot(lx, lz) > w * 0.6) continue;
      ctx.fillStyle = flashBlue ? '#3b82f6' : '#ff294d';
      ctx.beginPath();
      ctx.arc(lx, lz, 4.5, 0, Math.PI * 2);
      ctx.fill();
    }

    // Outros jogadores online
    for (const p of players.values()) {
      const [lx, lz] = toLocal(p.p[0], p.p[2]);
      if (Math.hypot(lx, lz) > w * 0.62) continue;
      ctx.fillStyle = '#ff7b00';
      ctx.beginPath();
      ctx.arc(lx, lz, 4.4, 0, Math.PI * 2);
      ctx.fill();
    }

    // Checkpoint ativo (preso na borda do radar caso esteja longe)
    if (activeCheckpoint) {
      let [lx, lz] = toLocal(activeCheckpoint.x, activeCheckpoint.z);
      const dist = Math.hypot(lx, lz);
      const maxR = w * 0.44;
      if (dist > maxR) {
        lx = (lx / dist) * maxR;
        lz = (lz / dist) * maxR;
      }
      ctx.fillStyle = '#38e54d';
      ctx.strokeStyle = '#071409';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(lx, lz, 5.5, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
    }

    ctx.restore(); // Fim da camada rotacionada do mapa

    // Cone de visão da câmera (sempre apontando para cima no radar)
    const grad = ctx.createRadialGradient(0, 0, 4, 0, 0, 58);
    grad.addColorStop(0, 'rgba(255, 255, 255, 0.25)');
    grad.addColorStop(1, 'rgba(255, 255, 255, 0.0)');
    ctx.fillStyle = grad;
    ctx.beginPath();
    ctx.moveTo(0, 0);
    ctx.arc(0, 0, 58, -Math.PI * 0.72, -Math.PI * 0.28);
    ctx.closePath();
    ctx.fill();

    // Seta do jogador local (orientada conforme diferença entre yaw do personagem e yaw da câmera)
    ctx.save();
    ctx.rotate(radarRot - selfYaw + Math.PI);
    ctx.fillStyle = '#ffffff';
    ctx.strokeStyle = '#090d14';
    ctx.lineWidth = 1.8;
    ctx.beginPath();
    ctx.moveTo(0, -8);
    ctx.lineTo(5.5, 6.5);
    ctx.lineTo(0, 3.5);
    ctx.lineTo(-5.5, 6.5);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
    ctx.restore();

    // Indicador de Norte (N) na borda do minimapa
    const northAngle = radarRot - Math.PI / 2;
    const nr = w * 0.44;
    const nx = Math.cos(northAngle) * nr;
    const ny = Math.sin(northAngle) * nr;
    ctx.fillStyle = '#0b0f18';
    ctx.beginPath();
    ctx.arc(nx, ny, 9, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#f5b942';
    ctx.font = 'bold 10px Segoe UI, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('N', nx, ny);

    ctx.restore();
  }

  drawBigMap(
    selfPos: THREE.Vector3,
    players: Map<string, NetPlayer>,
    gpsRoute: [number, number, number][],
    activeCheckpoint: { x: number; z: number; r: number } | null,
  ) {
    const ctx = this.bigCtx;
    const w = this.bigCanvas.width;
    const h = this.bigCanvas.height;

    const toPx = (wx: number, wz: number): [number, number] => {
      const nx = ((wx - this.panX) * this.zoom + WORLD_HALF) / (WORLD_HALF * 2);
      const nz = ((wz - this.panZ) * this.zoom + WORLD_HALF) / (WORLD_HALF * 2);
      return [nx * w, nz * h];
    };

    ctx.fillStyle = '#091d33';
    ctx.fillRect(0, 0, w, h);

    // Continente Costa Aurora
    ctx.fillStyle = '#233d2c';
    const [x0, z0] = toPx(-870, -WORLD_HALF);
    const [x1, z1] = toPx(WORLD_HALF, 790);
    ctx.fillRect(x0, z0, x1 - x0, z1 - z0);

    // Faixa de areia costeira
    ctx.fillStyle = '#cbb482';
    ctx.fillRect(x0, z0, 22 * this.zoom, z1 - z0);
    ctx.fillRect(x0, z1 - 18 * this.zoom, x1 - x0, 18 * this.zoom);

    // Ilhas
    for (const is of ISLANDS) {
      const [ix, iz] = toPx(is.x, is.z);
      const ir = (is.r / (WORLD_HALF * 2)) * w * this.zoom;
      ctx.fillStyle = '#2d5236';
      ctx.beginPath();
      ctx.arc(ix, iz, ir, 0, Math.PI * 2);
      ctx.fill();
    }

    // Pista do Aeroporto
    const [rx, rz] = toPx(880, -110);
    ctx.fillStyle = '#3b4454';
    ctx.fillRect(rx - 75 * this.zoom, rz - 8 * this.zoom, 150 * this.zoom, 16 * this.zoom);

    // Malha viária completa
    const net = getRoadNetwork();
    for (const e of net.edges) {
      ctx.strokeStyle = e.type === 'highway' ? '#e5ae39' : e.type === 'dirt' ? '#8c6947' : '#8592a6';
      ctx.lineWidth = (e.type === 'highway' || e.type === 'avenue' ? 3.2 : 1.9) * this.zoom;
      ctx.beginPath();
      for (let i = 0; i < e.pts.length; i++) {
        const [px, pz] = toPx(e.pts[i][0], e.pts[i][2]);
        if (i === 0) ctx.moveTo(px, pz);
        else ctx.lineTo(px, pz);
      }
      ctx.stroke();
    }

    // Rota GPS
    if (gpsRoute.length > 1) {
      ctx.strokeStyle = '#2de2e6';
      ctx.lineWidth = 4.2 * this.zoom;
      ctx.beginPath();
      for (let i = 0; i < gpsRoute.length; i++) {
        const [px, pz] = toPx(gpsRoute[i][0], gpsRoute[i][2]);
        if (i === 0) ctx.moveTo(px, pz);
        else ctx.lineTo(px, pz);
      }
      ctx.stroke();
    }

    // Propriedades
    for (const pr of PROPERTIES) {
      const [px, pz] = toPx(pr.x, pr.z);
      ctx.fillStyle = '#38e54d';
      ctx.fillRect(px - 4.5, pz - 4.5, 9, 9);
    }

    // POIs com rótulo
    ctx.font = 'bold 11px Segoe UI, sans-serif';
    for (const poi of POIS) {
      const [px, pz] = toPx(poi.x, poi.z);
      ctx.fillStyle = poi.kind === 'hospital' ? '#ff385c' : poi.kind === 'police' ? '#3b82f6' : '#2de2e6';
      ctx.beginPath();
      ctx.arc(px, pz, 5, 0, Math.PI * 2);
      ctx.fill();
    }

    // Missões
    for (const m of MISSIONS) {
      const [px, pz] = toPx(m.giver.x, m.giver.z);
      ctx.fillStyle = '#f5b942';
      ctx.beginPath();
      ctx.arc(px, pz, 6.5, 0, Math.PI * 2);
      ctx.fill();
    }

    if (activeCheckpoint) {
      const [px, pz] = toPx(activeCheckpoint.x, activeCheckpoint.z);
      ctx.strokeStyle = '#38e54d';
      ctx.lineWidth = 3.5;
      ctx.beginPath();
      ctx.arc(px, pz, 10, 0, Math.PI * 2);
      ctx.stroke();
    }

    // Jogadores online
    for (const p of players.values()) {
      const [px, pz] = toPx(p.p[0], p.p[2]);
      ctx.fillStyle = '#ff7b00';
      ctx.beginPath();
      ctx.arc(px, pz, 5.5, 0, Math.PI * 2);
      ctx.fill();
    }

    // Jogador local
    const [sx, sz] = toPx(selfPos.x, selfPos.z);
    ctx.fillStyle = '#ffffff';
    ctx.beginPath();
    ctx.arc(sx, sz, 7, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = '#000';
    ctx.lineWidth = 2.5;
    ctx.stroke();
  }

  canvasClickToWorld(ev: MouseEvent): [number, number] {
    const rect = this.bigCanvas.getBoundingClientRect();
    const u = (ev.clientX - rect.left) / rect.width;
    const v = (ev.clientY - rect.top) / rect.height;
    const wx = ((u * (WORLD_HALF * 2) - WORLD_HALF) / this.zoom) + this.panX;
    const wz = ((v * (WORLD_HALF * 2) - WORLD_HALF) / this.zoom) + this.panZ;
    return [wx, wz];
  }
}
