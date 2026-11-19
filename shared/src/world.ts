/* ===================================================================
 * Costa Aurora — layout determinístico compartilhado.
 * Cliente usa para gerar o mundo visual/físico; servidor usa para
 * spawns, validação de missões e alturas do terreno.
 * =================================================================== */

export const WORLD_HALF = 1400;
export const WORLD_SIZE = WORLD_HALF * 2;

/* ---------------- RNG / ruído ---------------- */
export function mulberry32(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
function hash2i(x: number, y: number, seed: number) {
  let h = Math.imul(x | 0, 374761393) ^ Math.imul(y | 0, 668265263) ^ Math.imul(seed | 0, 1274126177);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}
export function valueNoise(x: number, z: number, seed = 1) {
  const xi = Math.floor(x), zi = Math.floor(z);
  const xf = x - xi, zf = z - zi;
  const u = xf * xf * (3 - 2 * xf), v = zf * zf * (3 - 2 * zf);
  const a = hash2i(xi, zi, seed), b = hash2i(xi + 1, zi, seed);
  const c = hash2i(xi, zi + 1, seed), d = hash2i(xi + 1, zi + 1, seed);
  return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
}
export function fbm(x: number, z: number, oct = 4, seed = 1) {
  let s = 0, amp = 0.5, f = 1, n = 0;
  for (let i = 0; i < oct; i++) {
    s += amp * valueNoise(x * f, z * f, seed + i * 17);
    n += amp; amp *= 0.5; f *= 2;
  }
  return s / n;
}
export const clamp = (v: number, a: number, b: number) => (v < a ? a : v > b ? b : v);
export function smoothstep(e0: number, e1: number, x: number) {
  const t = clamp((x - e0) / (e1 - e0), 0, 1);
  return t * t * (3 - 2 * t);
}
export const lerp = (a: number, b: number, t: number) => a + (b - a) * t;

/* ---------------- Costa / ilhas ---------------- */
export function westCoastX(z: number) { return -870 + 25 * Math.sin(z * 0.004) + 12 * Math.sin(z * 0.013 + 1); }
export function southCoastZ(x: number) { return 790 + 20 * Math.sin(x * 0.005 + 2) + 10 * Math.sin(x * 0.017); }

export const ISLANDS = [
  { name: 'Ilha do Farol', x: -1160, z: 380, r: 95 },
  { name: 'Ilha Esmeralda', x: -1120, z: -720, r: 70 },
  { name: 'Ilha Sul', x: 300, z: 1110, r: 120 },
];

/** distância (m) até o mar; positiva em terra */
export function landDist(x: number, z: number) {
  let d = Math.min(x - westCoastX(z), southCoastZ(x) - z);
  for (const is of ISLANDS) {
    const id = is.r - Math.hypot(x - is.x, z - is.z);
    if (id > d) d = id;
  }
  return d;
}

/* ---------------- Regiões ---------------- */
export type RegionId = 'downtown' | 'residential' | 'luxury' | 'beach' | 'industrial' | 'airport' | 'rural' | 'mountains' | 'ocean' | 'island';
export const REGION_NAMES: Record<RegionId, string> = {
  downtown: 'Centro Financeiro', residential: 'Vila Aurora', luxury: 'Colinas do Mirante',
  beach: 'Praia Dourada', industrial: 'Porto Industrial', airport: 'Aeroporto Internacional',
  rural: 'Vale do Sertão', mountains: 'Serra Alta', ocean: 'Oceano Atlântico', island: 'Ilhas Aurora',
};
export function regionAt(x: number, z: number): RegionId {
  const d = landDist(x, z);
  const nearIsland = ISLANDS.some((i) => Math.hypot(x - i.x, z - i.z) < i.r + 20);
  if (d < 0) return 'ocean';
  if (nearIsland) return 'island';
  if (d < 140 && x < -600) return 'beach';
  if (d < 90) return 'beach';
  if (z < -1080 || x > 1250) return 'mountains';
  if (x > 440 && z < -400) return 'rural';
  if (x > 440 && z > 330) return 'industrial';
  if (x > 440) return 'airport';
  if (x < -420 && z < -380) return 'luxury';
  if (z < -420) return 'residential';
  if (Math.abs(x) <= 430 && Math.abs(z) <= 430) return 'downtown';
  if (x < -420) return 'beach';
  return 'residential';
}

/* ---------------- Altura bruta ---------------- */
export function rawHeight(x: number, z: number) {
  const d = landDist(x, z);
  let h: number;
  if (d > 60) h = 2;
  else if (d > 0) h = -0.6 + 2.6 * (d / 60);
  else h = Math.max(-16, -0.6 + d * 0.11);
  if (d > 40) {
    const inland = smoothstep(60, 220, d);
    // colinas de luxo (NO)
    const lux = 1 - Math.hypot(x + 660, z + 760) / 400;
    if (lux > 0) h += 42 * lux * lux * (3 - 2 * lux) * inland;
    // vale rural (NE)
    const rural = smoothstep(420, 560, x) * smoothstep(-400, -560, z);
    h += rural * (fbm(x * 0.0045, z * 0.0045, 4, 7) * 34 - 6) * inland;
    // serra ao norte
    const north = smoothstep(-1080, -1380, z);
    h += north * (80 + fbm(x * 0.006, z * 0.006, 5, 11) * 90);
    // serra a leste (apenas parte norte p/ não afetar aeroporto)
    const east = smoothstep(1230, 1390, x) * smoothstep(-260, -520, z);
    h += east * (60 + fbm(x * 0.007, z * 0.007, 4, 13) * 60);
    // ondulação leve geral fora da cidade
    const city = Math.abs(x) < 450 && z > -1000 && z < 650 ? 0 : 1;
    h += city * (fbm(x * 0.01, z * 0.01, 3, 3) - 0.5) * 2 * inland;
  }
  for (const is of ISLANDS) {
    const r = Math.hypot(x - is.x, z - is.z);
    if (r < is.r * 0.6) h += (1 - r / (is.r * 0.6)) * 14;
  }
  return h;
}

/* ---------------- Malha viária ---------------- */
export type RoadType = 'avenue' | 'street' | 'highway' | 'rural' | 'dirt' | 'bridge';
export interface RoadDef { type: RoadType; width: number; pts: [number, number][]; curved?: boolean; name?: string }
export interface RoadNode { id: number; x: number; z: number; edges: number[]; signal: boolean }
export interface RoadEdge {
  id: number; a: number; b: number; type: RoadType; width: number; name: string;
  /** pontos amostrados [x, y, z] */
  pts: [number, number, number][];
  length: number; speed: number;
}

const DX = [-360, -180, 0, 180, 360];
const RZ = [-500, -650, -800, -950];

function buildRoadDefs(): RoadDef[] {
  const r: RoadDef[] = [];
  const RB = 30; // raio da rotatória central
  const avenueW = 22, streetW = 14;
  const centerKey = (x: number, z: number) => x === 0 && z === 0;
  const ringPt = (fx: number, fz: number): [number, number] => {
    // ponto da rotatória na direção do vizinho
    const l = Math.hypot(fx, fz) || 1;
    return [Math.round((fx / l) * RB), Math.round((fz / l) * RB)];
  };
  const streetNames = ['Rua das Palmeiras', 'Av. Atlântica', 'Av. Central', 'Rua do Comércio', 'Av. Horizonte'];
  // Centro: grade com rotatória
  for (let j = 0; j < 5; j++) {
    for (let i = 0; i < 4; i++) {
      // horizontal
      let a: [number, number] = [DX[i], DX[j]], b: [number, number] = [DX[i + 1], DX[j]];
      if (centerKey(...a)) a = ringPt(b[0], b[1]);
      if (centerKey(...b)) b = ringPt(a[0], a[1]);
      r.push({ type: DX[j] === 0 ? 'avenue' : 'street', width: DX[j] === 0 ? avenueW : streetW, pts: [a, b], name: streetNames[j] });
      // vertical
      let c: [number, number] = [DX[j], DX[i]], d: [number, number] = [DX[j], DX[i + 1]];
      if (centerKey(...c)) c = ringPt(d[0], d[1]);
      if (centerKey(...d)) d = ringPt(c[0], c[1]);
      r.push({ type: DX[j] === 0 ? 'avenue' : 'street', width: DX[j] === 0 ? avenueW : streetW, pts: [c, d], name: DX[j] === 0 ? 'Av. Presidente' : 'Rua ' + (j + 1) });
    }
  }
  // anéis da rotatória
  const ring: [number, number][] = [[RB, 0], [0, RB], [-RB, 0], [0, -RB]];
  for (let k = 0; k < 4; k++) {
    const a = ring[k], b = ring[(k + 1) % 4];
    const ang = (k * Math.PI) / 2 + Math.PI / 4;
    r.push({ type: 'avenue', width: 14, curved: true, name: 'Rotatória da Praça Aurora',
      pts: [a, [Math.round(Math.cos(ang) * RB), Math.round(Math.sin(ang) * RB)], b] });
  }
  // Residencial
  for (let j = 0; j < RZ.length; j++) {
    for (let i = 0; i < 4; i++) {
      r.push({ type: 'street', width: 11, pts: [[DX[i], RZ[j]], [DX[i + 1], RZ[j]]], name: 'Rua dos Ipês' });
    }
  }
  for (let i = 0; i < 5; i++) {
    r.push({ type: 'street', width: 12, pts: [[DX[i], -360], [DX[i], -500]], name: 'Rua da Vila' });
    for (let j = 0; j < RZ.length - 1; j++) {
      const off = (i % 2 === 0 ? 1 : -1) * 22;
      r.push({ type: 'street', width: 11, curved: true, pts: [[DX[i], RZ[j]], [DX[i] + off, (RZ[j] + RZ[j + 1]) / 2], [DX[i], RZ[j + 1]]], name: 'Alameda das Flores' });
    }
  }
  // Colinas de luxo
  r.push({ type: 'street', width: 12, curved: true, name: 'Estrada do Mirante', pts: [[-360, -360], [-470, -430], [-560, -520]] });
  r.push({ type: 'street', width: 12, curved: true, name: 'Estrada do Mirante', pts: [[-560, -520], [-640, -640], [-570, -770], [-670, -870], [-560, -950], [-360, -950]] });
  // Costa oeste
  r.push({ type: 'avenue', width: 16, curved: true, name: 'Av. Beira-Mar', pts: [[-360, 0], [-560, 12], [-760, 0]] });
  r.push({ type: 'avenue', width: 16, curved: true, name: 'Rodovia Costeira', pts: [[-760, 0], [-795, -180], [-730, -380], [-560, -520]] });
  r.push({ type: 'avenue', width: 16, curved: true, name: 'Av. Beira-Mar', pts: [[-760, 0], [-795, 200], [-780, 420], [-640, 600]] });
  // Costa sul
  r.push({ type: 'avenue', width: 16, curved: true, name: 'Av. do Porto', pts: [[-640, 600], [-500, 615], [-360, 600]] });
  r.push({ type: 'avenue', width: 16, pts: [[-360, 600], [0, 600]], name: 'Av. do Porto' });
  r.push({ type: 'avenue', width: 16, pts: [[0, 600], [360, 600]], name: 'Av. do Porto' });
  r.push({ type: 'avenue', width: 16, pts: [[360, 600], [500, 600]], name: 'Av. do Porto' });
  for (const x of [-360, 0, 360]) r.push({ type: 'street', width: 14, pts: [[x, 360], [x, 600]], name: 'Rua do Sul' });
  // Industrial
  const IX = [500, 700, 900], IZ = [400, 600];
  for (const z of IZ) for (let i = 0; i < 2; i++) r.push({ type: 'street', width: 14, pts: [[IX[i], z], [IX[i + 1], z]], name: 'Rua dos Armazéns' });
  for (const x of IX) r.push({ type: 'street', width: 14, pts: [[x, 400], [x, 600]], name: 'Rua dos Contêineres' });
  r.push({ type: 'street', width: 14, curved: true, pts: [[360, 360], [430, 370], [500, 400]], name: 'Acesso Porto' });
  r.push({ type: 'street', width: 12, pts: [[700, 600], [700, 730]], name: 'Cais' });
  // Aeroporto
  r.push({ type: 'highway', width: 18, curved: true, name: 'Via Aeroporto', pts: [[360, 0], [450, 4], [520, 0]] });
  r.push({ type: 'highway', width: 18, curved: true, name: 'Via Aeroporto', pts: [[520, 0], [560, 70], [620, 130]] });
  r.push({ type: 'street', width: 14, pts: [[620, 130], [900, 130]], name: 'Terminal' });
  r.push({ type: 'street', width: 12, pts: [[520, 0], [520, 360 - 40]], name: 'Perimetral' });
  r.push({ type: 'street', width: 12, curved: true, pts: [[520, 320], [510, 370], [500, 400]], name: 'Perimetral' });
  // Rodovia para o interior
  r.push({ type: 'highway', width: 18, curved: true, name: 'Rodovia do Sertão', pts: [[360, -360], [480, -440], [620, -560]] });
  r.push({ type: 'rural', width: 11, curved: true, name: 'Estrada Velha', pts: [[620, -560], [820, -520], [1000, -650]] });
  r.push({ type: 'rural', width: 11, curved: true, name: 'Estrada da Serra', pts: [[1000, -650], [1150, -850], [1050, -1040], [800, -1130]] });
  r.push({ type: 'rural', width: 11, curved: true, name: 'Estrada do Lago', pts: [[800, -1130], [600, -1060], [360, -950]] });
  r.push({ type: 'dirt', width: 8, curved: true, name: 'Estrada de Terra', pts: [[620, -560], [700, -780], [760, -950], [800, -1130]] });
  // Ponte para a Ilha Sul
  r.push({ type: 'bridge', width: 14, curved: true, name: 'Ponte Aurora', pts: [[360, 600], [345, 760], [320, 900], [305, 1000]] });
  return r;
}

function catmull(p: [number, number][], step: number): [number, number][] {
  if (p.length < 3) {
    const [a, b] = p;
    const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
    const n = Math.max(1, Math.ceil(len / step));
    const out: [number, number][] = [];
    for (let i = 0; i <= n; i++) out.push([a[0] + ((b[0] - a[0]) * i) / n, a[1] + ((b[1] - a[1]) * i) / n]);
    return out;
  }
  const out: [number, number][] = [];
  for (let i = 0; i < p.length - 1; i++) {
    const p0 = p[Math.max(0, i - 1)], p1 = p[i], p2 = p[i + 1], p3 = p[Math.min(p.length - 1, i + 2)];
    const len = Math.hypot(p2[0] - p1[0], p2[1] - p1[1]);
    const n = Math.max(2, Math.ceil(len / step));
    for (let k = 0; k < n; k++) {
      const t = k / n, t2 = t * t, t3 = t2 * t;
      const f = (a: number, b: number, c: number, d: number) =>
        0.5 * (2 * b + (-a + c) * t + (2 * a - 5 * b + 4 * c - d) * t2 + (-a + 3 * b - 3 * c + d) * t3);
      out.push([f(p0[0], p1[0], p2[0], p3[0]), f(p0[1], p1[1], p2[1], p3[1])]);
    }
  }
  out.push(p[p.length - 1]);
  return out;
}

const SPEEDS: Record<RoadType, number> = { avenue: 16, street: 12, highway: 26, rural: 18, dirt: 11, bridge: 20 };

export interface RoadNetwork { nodes: RoadNode[]; edges: RoadEdge[] }
let _net: RoadNetwork | null = null;

export function getRoadNetwork(): RoadNetwork {
  if (_net) return _net;
  const defs = buildRoadDefs();
  const nodes: RoadNode[] = [];
  const key = new Map<string, number>();
  const nodeAt = (x: number, z: number) => {
    const k = `${Math.round(x)},${Math.round(z)}`;
    let id = key.get(k);
    if (id === undefined) {
      id = nodes.length;
      nodes.push({ id, x: Math.round(x), z: Math.round(z), edges: [], signal: false });
      key.set(k, id);
    }
    return id;
  };
  const edges: RoadEdge[] = [];
  for (const d of defs) {
    const s = d.curved ? catmull(d.pts, 8) : catmull([d.pts[0], d.pts[d.pts.length - 1]], 8);
    const a = nodeAt(s[0][0], s[0][1]);
    const b = nodeAt(s[s.length - 1][0], s[s.length - 1][1]);
    // alturas suavizadas
    const raw = s.map(([x, z]) => rawHeight(x, z));
    const sm = raw.map((_, i) => {
      let acc = 0, n = 0;
      for (let k = -4; k <= 4; k++) { const v = raw[i + k]; if (v !== undefined) { acc += v; n++; } }
      return acc / n;
    });
    const pts: [number, number, number][] = s.map(([x, z], i) => {
      let y = Math.max(sm[i], 1.2);
      if (d.type === 'bridge') {
        const t = i / (s.length - 1);
        y = Math.max(sm[i], 2 + Math.sin(t * Math.PI) * 9);
      }
      return [x, y, z];
    });
    let length = 0;
    for (let i = 1; i < pts.length; i++) length += Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][2] - pts[i - 1][2]);
    const id = edges.length;
    edges.push({ id, a, b, type: d.type, width: d.width, name: d.name ?? 'Estrada', pts, length, speed: SPEEDS[d.type] });
    nodes[a].edges.push(id);
    nodes[b].edges.push(id);
  }
  for (const n of nodes) n.signal = n.edges.length >= 4 && Math.abs(n.x) <= 400 && Math.abs(n.z) <= 1000 && !(Math.hypot(n.x, n.z) < 40);
  _net = { nodes, edges };
  return _net;
}

/* ---------------- Índice espacial de segmentos ---------------- */
interface SegRef { e: number; i: number }
let _grid: Map<number, SegRef[]> | null = null;
const CELL = 40;
const ck = (cx: number, cz: number) => (cx + 1000) * 4000 + (cz + 1000);
function segGrid() {
  if (_grid) return _grid;
  const g = new Map<number, SegRef[]>();
  const net = getRoadNetwork();
  for (const e of net.edges) {
    const pad = e.width / 2 + 18;
    for (let i = 0; i < e.pts.length - 1; i++) {
      const a = e.pts[i], b = e.pts[i + 1];
      const x0 = Math.floor((Math.min(a[0], b[0]) - pad) / CELL), x1 = Math.floor((Math.max(a[0], b[0]) + pad) / CELL);
      const z0 = Math.floor((Math.min(a[2], b[2]) - pad) / CELL), z1 = Math.floor((Math.max(a[2], b[2]) + pad) / CELL);
      for (let cx = x0; cx <= x1; cx++) for (let cz = z0; cz <= z1; cz++) {
        const k = ck(cx, cz);
        let arr = g.get(k);
        if (!arr) g.set(k, (arr = []));
        arr.push({ e: e.id, i });
      }
    }
  }
  _grid = g;
  return g;
}

export interface RoadHit { dist: number; y: number; edge: RoadEdge; t: number; i: number; px: number; pz: number }
/** segmento de estrada mais próximo dentro de maxDist */
export function nearestRoad(x: number, z: number, maxDist = 30): RoadHit | null {
  const g = segGrid();
  const arr = g.get(ck(Math.floor(x / CELL), Math.floor(z / CELL)));
  if (!arr) return null;
  const net = getRoadNetwork();
  let best: RoadHit | null = null;
  for (const s of arr) {
    const e = net.edges[s.e];
    const a = e.pts[s.i], b = e.pts[s.i + 1];
    const dx = b[0] - a[0], dz = b[2] - a[2];
    const l2 = dx * dx + dz * dz || 1;
    const t = clamp(((x - a[0]) * dx + (z - a[2]) * dz) / l2, 0, 1);
    const px = a[0] + dx * t, pz = a[2] + dz * t;
    const dist = Math.hypot(x - px, z - pz);
    if (dist <= maxDist && (!best || dist < best.dist)) best = { dist, y: lerp(a[1], b[1], t), edge: e, t, i: s.i, px, pz };
  }
  return best;
}

/** Altura final do terreno (com estradas aplainadas) */
export function terrainHeight(x: number, z: number) {
  const raw = rawHeight(x, z);
  const hit = nearestRoad(x, z, 34);
  if (!hit || hit.edge.type === 'bridge') return raw;
  const hw = hit.edge.width / 2;
  const t = 1 - smoothstep(hw + 1.5, hw + 16, hit.dist);
  return lerp(raw, hit.y - 0.05, t);
}

/* ---------------- Pontos de interesse ---------------- */
export type PoiKind = 'spawn' | 'hospital' | 'police' | 'gunshop' | 'clothes' | 'customs' | 'dealer' | 'gas' | 'garage' | 'property' | 'landmark' | 'mission' | 'restaurant' | 'marina' | 'store';
export interface Poi { id: string; kind: PoiKind; name: string; x: number; z: number }

export const POIS: Poi[] = [
  { id: 'hosp_central', kind: 'hospital', name: 'Hospital Aurora', x: 120, z: -120 },
  { id: 'hosp_rural', kind: 'hospital', name: 'Posto de Saúde do Sertão', x: 990, z: -620 },
  { id: 'police_central', kind: 'police', name: 'Delegacia Central', x: -120, z: 120 },
  { id: 'gun_1', kind: 'gunshop', name: 'Arsenal Aurora', x: 210, z: 95 },
  { id: 'gun_2', kind: 'gunshop', name: 'Arsenal do Porto', x: 600, z: 470 },
  { id: 'clothes_1', kind: 'clothes', name: 'Moda Costa', x: -95, z: -210 },
  { id: 'customs_1', kind: 'customs', name: 'Aurora Customs', x: 210, z: 215 },
  { id: 'customs_2', kind: 'customs', name: 'Oficina do Sertão', x: 840, z: -505 },
  { id: 'dealer_1', kind: 'dealer', name: 'Prestige Motors', x: -210, z: 215 },
  { id: 'gas_1', kind: 'gas', name: 'Posto Aurora', x: 395, z: -380 },
  { id: 'gas_2', kind: 'gas', name: 'Posto Beira-Mar', x: -745, z: -60 },
  { id: 'gas_3', kind: 'gas', name: 'Posto da Serra', x: 1020, z: -680 },
  { id: 'rest_1', kind: 'restaurant', name: 'Quiosque Sol', x: -820, z: 120 },
  { id: 'rest_2', kind: 'restaurant', name: 'Café Central', x: 95, z: 205 },
  { id: 'store_1', kind: 'store', name: 'Mercado 24h', x: -200, z: -575 },
  { id: 'marina_1', kind: 'marina', name: 'Marina Dourada', x: -860, z: 520 },
  { id: 'lm_plaza', kind: 'landmark', name: 'Praça Aurora', x: 0, z: 0 },
  { id: 'lm_mirante', kind: 'landmark', name: 'Mirante das Colinas', x: -640, z: -650 },
  { id: 'lm_farol', kind: 'landmark', name: 'Farol', x: -1160, z: 380 },
  { id: 'lm_runway', kind: 'landmark', name: 'Pista Principal', x: 880, z: -110 },
];

export interface PropertyDef { id: string; name: string; kind: 'apartment' | 'house' | 'mansion' | 'garage' | 'warehouse' | 'business'; price: number; x: number; z: number; garageSlots: number; income?: number }
export const PROPERTIES: PropertyDef[] = [
  { id: 'apt_centro', name: 'Apartamento Torre Horizonte', kind: 'apartment', price: 85_000, x: 100, z: -100 + 205, garageSlots: 2 },
  { id: 'apt_beira', name: 'Apartamento Beira-Mar', kind: 'apartment', price: 120_000, x: -730, z: 160, garageSlots: 2 },
  { id: 'house_vila', name: 'Casa na Vila Aurora', kind: 'house', price: 60_000, x: -95, z: -575, garageSlots: 2 },
  { id: 'house_ipes', name: 'Sobrado dos Ipês', kind: 'house', price: 72_000, x: 265, z: -725, garageSlots: 3 },
  { id: 'mansion_mirante', name: 'Mansão do Mirante', kind: 'mansion', price: 450_000, x: -600, z: -700, garageSlots: 6 },
  { id: 'garage_porto', name: 'Garagem do Porto', kind: 'garage', price: 40_000, x: 800, z: 500, garageSlots: 8 },
  { id: 'warehouse_1', name: 'Galpão Logístico', kind: 'warehouse', price: 150_000, x: 600, z: 530, garageSlots: 4, income: 900 },
  { id: 'biz_cafe', name: 'Café Central (empresa)', kind: 'business', price: 95_000, x: 95, z: 205, garageSlots: 0, income: 600 },
  { id: 'farm_1', name: 'Fazenda Boa Vista', kind: 'house', price: 180_000, x: 820, z: -820, garageSlots: 4, income: 400 },
];

export const SPAWN_POINTS: [number, number][] = [
  [12, 48], [-48, 14], [48, -14], [-14, -48], [55, 55], [-55, -55], [55, -55], [-55, 55],
];

/** Vagas de estacionamento determinísticas ao longo das estradas */
export interface ParkingSpot { x: number; y: number; z: number; yaw: number; region: RegionId }
let _parking: ParkingSpot[] | null = null;
export function getParkingSpots(): ParkingSpot[] {
  if (_parking) return _parking;
  const out: ParkingSpot[] = [];
  const net = getRoadNetwork();
  for (const e of net.edges) {
    if (e.type === 'bridge' || e.type === 'highway') continue;
    const every = e.type === 'rural' || e.type === 'dirt' ? 160 : 70;
    let acc = 30;
    for (let i = 1; i < e.pts.length; i++) {
      const a = e.pts[i - 1], b = e.pts[i];
      const seg = Math.hypot(b[0] - a[0], b[2] - a[2]);
      acc += seg;
      if (acc >= every && i < e.pts.length - 2) {
        acc = 0;
        const dx = (b[0] - a[0]) / seg, dz = (b[2] - a[2]) / seg;
        const off = e.width / 2 - 1.6;
        // lado direito no sentido a->b: normal = (-dz, dx)
        const x = b[0] - dz * off, z = b[2] + dx * off;
        out.push({ x, y: b[1], z, yaw: Math.atan2(dx, dz), region: regionAt(x, z) });
      }
    }
  }
  _parking = out;
  return out;
}

/** A* sobre a malha viária: retorna lista de pontos [x,y,z] */
export function findRoute(fx: number, fz: number, tx: number, tz: number): [number, number, number][] {
  const net = getRoadNetwork();
  const nearestNode = (x: number, z: number) => {
    let best = 0, bd = Infinity;
    for (const n of net.nodes) { const d = (n.x - x) ** 2 + (n.z - z) ** 2; if (d < bd) { bd = d; best = n.id; } }
    return best;
  };
  const s = nearestNode(fx, fz), t = nearestNode(tx, tz);
  const g = new Map<number, number>([[s, 0]]);
  const came = new Map<number, { n: number; e: number }>();
  const open = new Set<number>([s]);
  const h = (id: number) => Math.hypot(net.nodes[id].x - net.nodes[t].x, net.nodes[id].z - net.nodes[t].z);
  const f = new Map<number, number>([[s, h(s)]]);
  while (open.size) {
    let cur = -1, cf = Infinity;
    for (const o of open) { const v = f.get(o) ?? Infinity; if (v < cf) { cf = v; cur = o; } }
    if (cur === t) break;
    open.delete(cur);
    for (const eid of net.nodes[cur].edges) {
      const e = net.edges[eid];
      const nb = e.a === cur ? e.b : e.a;
      const ng = (g.get(cur) ?? Infinity) + e.length;
      if (ng < (g.get(nb) ?? Infinity)) {
        g.set(nb, ng); f.set(nb, ng + h(nb)); came.set(nb, { n: cur, e: eid }); open.add(nb);
      }
    }
  }
  const out: [number, number, number][] = [];
  let c = t;
  const chain: { n: number; e: number }[] = [];
  while (came.has(c)) { const p = came.get(c)!; chain.unshift({ n: c, e: p.e }); c = p.n; }
  out.push([net.nodes[s].x, 2, net.nodes[s].z]);
  for (const step of chain) {
    const e = net.edges[step.e];
    const pts = e.b === step.n ? e.pts : [...e.pts].reverse();
    out.push(...pts);
  }
  return out;
}
