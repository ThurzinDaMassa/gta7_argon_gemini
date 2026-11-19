import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as THREE from 'three';
import { VEHICLES, WEAPONS } from '../shared/src';

/* ===================================================================
 * Compilador Nativo de Modelos 3D Binários (.GLB — GLTF 2.0 Padrão Blender)
 * - Gera malhas orgânicas e automotivas suavizadas (LatheGeometry,
 *   ExtrudeGeometry com Bevel, Capsule, Sphere, Cylinder)
 * - Mescla buffers por material para reduzir draw calls (alta otimização)
 * - Salva 46+ arquivos .glb reais em client/public/models/ que podem ser
 *   abertos no Blender e são carregados pelo GLTFLoader do jogo!
 * =================================================================== */

const here = path.dirname(fileURLToPath(import.meta.url));
const OUT_DIR = path.resolve(here, '../client/public/models');
fs.mkdirSync(OUT_DIR, { recursive: true });

interface GlbPart {
  name: string;
  geometry: THREE.BufferGeometry;
  color: number;
  metallic: number;
  roughness: number;
  alpha?: number;
  emissive?: number;
}

/** Transforma uma BufferGeometry aplicando uma Matrix4 e garante atributos non-indexed + UVs planares triplanares */
function bakeGeometry(geo: THREE.BufferGeometry, matrix?: THREE.Matrix4): THREE.BufferGeometry {
  const g = geo.index ? geo.toNonIndexed() : geo.clone();
  if (matrix) g.applyMatrix4(matrix);
  g.computeVertexNormals();
  return g;
}

/** Mescla várias geometrias do mesmo material em uma única malha super otimizada com UVs automáticos (1 Draw Call por material) */
function mergeGeometries(geos: THREE.BufferGeometry[]): THREE.BufferGeometry {
  let totalVerts = 0;
  for (const g of geos) totalVerts += g.attributes.position.count;

  const positions = new Float32Array(totalVerts * 3);
  const normals = new Float32Array(totalVerts * 3);
  const uvs = new Float32Array(totalVerts * 2);
  let offset = 0;

  for (const g of geos) {
    const pos = g.attributes.position;
    const norm = g.attributes.normal;
    positions.set(pos.array as Float32Array, offset * 3);
    if (norm) normals.set(norm.array as Float32Array, offset * 3);
    offset += pos.count;
  }

  // Gera mapeamento UV triplanar automático baseado na normal dominante (garante texturas perfeitas no Three.js!)
  for (let i = 0; i < totalVerts; i++) {
    const x = positions[i * 3], y = positions[i * 3 + 1], z = positions[i * 3 + 2];
    const nx = Math.abs(normals[i * 3]), ny = Math.abs(normals[i * 3 + 1]), nz = Math.abs(normals[i * 3 + 2]);
    if (nx >= ny && nx >= nz) {
      uvs[i * 2] = z * 0.1;
      uvs[i * 2 + 1] = y * 0.1;
    } else if (nz >= nx && nz >= ny) {
      uvs[i * 2] = x * 0.1;
      uvs[i * 2 + 1] = y * 0.1;
    } else {
      uvs[i * 2] = x * 0.1;
      uvs[i * 2 + 1] = z * 0.1;
    }
  }

  const out = new THREE.BufferGeometry();
  out.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  out.setAttribute('normal', new THREE.BufferAttribute(normals, 3));
  out.setAttribute('uv', new THREE.BufferAttribute(uvs, 2));
  return out;
}

function hexToRgba(hex: number, alpha = 1.0): [number, number, number, number] {
  return [
    ((hex >> 16) & 0xff) / 255,
    ((hex >> 8) & 0xff) / 255,
    (hex & 0xff) / 255,
    alpha,
  ];
}

/** Serializa uma lista de partes 3D em um arquivo binário GLB (glTF 2.0) 100% compatível com Blender e Three.js GLTFLoader */
function writeGlbFile(filename: string, parts: GlbPart[]): number {
  const bufferViews: any[] = [];
  const accessors: any[] = [];
  const materials: any[] = [];
  const primitives: any[] = [];
  const binChunks: Buffer[] = [];
  let byteOffset = 0;

  for (let i = 0; i < parts.length; i++) {
    const part = parts[i];
    const posAttr = part.geometry.attributes.position;
    const normAttr = part.geometry.attributes.normal;
    const uvAttr = part.geometry.attributes.uv;
    const count = posAttr.count;

    const posArray = new Float32Array(posAttr.array.buffer, posAttr.array.byteOffset, count * 3);
    const normArray = new Float32Array(normAttr.array.buffer, normAttr.array.byteOffset, count * 3);
    const uvArray = uvAttr
      ? new Float32Array(uvAttr.array.buffer, uvAttr.array.byteOffset, count * 2)
      : new Float32Array(count * 2);

    let minX = Infinity, minY = Infinity, minZ = Infinity;
    let maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity;
    for (let k = 0; k < count * 3; k += 3) {
      const x = posArray[k], y = posArray[k + 1], z = posArray[k + 2];
      if (x < minX) minX = x; if (x > maxX) maxX = x;
      if (y < minY) minY = y; if (y > maxY) maxY = y;
      if (z < minZ) minZ = z; if (z > maxZ) maxZ = z;
    }

    const posBuf = Buffer.from(posArray.buffer, posArray.byteOffset, posArray.byteLength);
    const normBuf = Buffer.from(normArray.buffer, normArray.byteOffset, normArray.byteLength);
    const uvBuf = Buffer.from(uvArray.buffer, uvArray.byteOffset, uvArray.byteLength);

    const posViewIdx = bufferViews.length;
    bufferViews.push({ buffer: 0, byteOffset, byteLength: posBuf.byteLength, target: 34962 });
    binChunks.push(posBuf);
    byteOffset += posBuf.byteLength;

    const normViewIdx = bufferViews.length;
    bufferViews.push({ buffer: 0, byteOffset, byteLength: normBuf.byteLength, target: 34962 });
    binChunks.push(normBuf);
    byteOffset += normBuf.byteLength;

    const uvViewIdx = bufferViews.length;
    bufferViews.push({ buffer: 0, byteOffset, byteLength: uvBuf.byteLength, target: 34962 });
    binChunks.push(uvBuf);
    byteOffset += uvBuf.byteLength;

    const posAccIdx = accessors.length;
    accessors.push({
      bufferView: posViewIdx,
      componentType: 5126,
      count,
      type: 'VEC3',
      min: [minX, minY, minZ],
      max: [maxX, maxY, maxZ],
    });

    const normAccIdx = accessors.length;
    accessors.push({
      bufferView: normViewIdx,
      componentType: 5126,
      count,
      type: 'VEC3',
    });

    const uvAccIdx = accessors.length;
    accessors.push({
      bufferView: uvViewIdx,
      componentType: 5126,
      count,
      type: 'VEC2',
    });

    const matIdx = materials.length;
    const matDef: any = {
      name: part.name,
      pbrMetallicRoughness: {
        baseColorFactor: hexToRgba(part.color, part.alpha ?? 1.0),
        metallicFactor: part.metallic,
        roughnessFactor: part.roughness,
      },
    };
    if ((part.alpha ?? 1.0) < 1.0) matDef.alphaMode = 'BLEND';
    if (part.emissive !== undefined) {
      const [er, eg, eb] = hexToRgba(part.emissive);
      matDef.emissiveFactor = [er, eg, eb];
    }
    materials.push(matDef);

    primitives.push({
      attributes: { POSITION: posAccIdx, NORMAL: normAccIdx, TEXCOORD_0: uvAccIdx },
      material: matIdx,
      mode: 4,
    });
  }

  // Padding 4-byte alignment
  const binPad = (4 - (byteOffset % 4)) % 4;
  if (binPad > 0) {
    binChunks.push(Buffer.alloc(binPad));
    byteOffset += binPad;
  }
  const binBuffer = Buffer.concat(binChunks);

  const gltfJson = {
    asset: { version: '2.0', generator: 'GTA 7 Online Blender-Compatible GLB Pipeline' },
    scene: 0,
    scenes: [{ name: 'Scene', nodes: [0] }],
    nodes: [{ name: filename.replace('.glb', ''), mesh: 0 }],
    meshes: [{ name: filename.replace('.glb', ''), primitives }],
    materials,
    accessors,
    bufferViews,
    buffers: [{ byteLength: binBuffer.byteLength }],
  };

  let jsonStr = JSON.stringify(gltfJson);
  const jsonPad = (4 - (Buffer.byteLength(jsonStr, 'utf8') % 4)) % 4;
  jsonStr += ' '.repeat(jsonPad);
  const jsonBuffer = Buffer.from(jsonStr, 'utf8');

  const totalLength = 12 + 8 + jsonBuffer.byteLength + 8 + binBuffer.byteLength;
  const header = Buffer.alloc(12);
  header.writeUInt32LE(0x46546c67, 0); // 'glTF'
  header.writeUInt32LE(2, 4);          // version 2
  header.writeUInt32LE(totalLength, 8);

  const jsonHeader = Buffer.alloc(8);
  jsonHeader.writeUInt32LE(jsonBuffer.byteLength, 0);
  jsonHeader.writeUInt32LE(0x4e4f534a, 4); // 'JSON'

  const binHeader = Buffer.alloc(8);
  binHeader.writeUInt32LE(binBuffer.byteLength, 0);
  binHeader.writeUInt32LE(0x004e4942, 4); // 'BIN\0'

  const glb = Buffer.concat([header, jsonHeader, jsonBuffer, binHeader, binBuffer]);
  const outPath = path.join(OUT_DIR, filename);
  fs.writeFileSync(outPath, glb);
  return glb.byteLength;
}

function tf(x: number, y: number, z: number, rx = 0, ry = 0, rz = 0, sx = 1, sy = 1, sz = 1): THREE.Matrix4 {
  const m = new THREE.Matrix4();
  const q = new THREE.Quaternion().setFromEuler(new THREE.Euler(rx, ry, rz));
  m.compose(new THREE.Vector3(x, y, z), q, new THREE.Vector3(sx, sy, sz));
  return m;
}

/* ===================================================================
 * 1. GERADOR DE CHASSIS E CARROCERIAS AUTOMOTIVAS ESCULPIDAS (16 VEÍCULOS)
 * Usa ExtrudeGeometry com Perfil Lateral Aerodinâmico + Bevel Suave!
 * =================================================================== */
function generateVehicleChassisGlb(modelId: string): number {
  const def = VEHICLES[modelId];
  const W = def.width;
  const H = def.height;
  const L = def.length;
  const r = Math.max(0.28, def.wheelRadius);
  const baseY = def.category === 'boat' ? 0.1 : r * 0.72;

  const bodyGeos: THREE.BufferGeometry[] = [];
  const glassGeos: THREE.BufferGeometry[] = [];
  const trimGeos: THREE.BufferGeometry[] = [];
  const chromeGeos: THREE.BufferGeometry[] = [];
  const headGeos: THREE.BufferGeometry[] = [];
  const tailGeos: THREE.BufferGeometry[] = [];

  if (def.category === 'boat') {
    // Casco hidrodinâmico chanfrado com Bevel
    const hullShape = new THREE.Shape();
    hullShape.moveTo(-L * 0.46, 0.05);
    hullShape.lineTo(L * 0.25, 0.02);
    hullShape.quadraticCurveTo(L * 0.48, 0.15, L * 0.5, H * 0.48);
    hullShape.lineTo(-L * 0.45, H * 0.46);
    hullShape.closePath();

    const hullExt = new THREE.ExtrudeGeometry(hullShape, {
      depth: W * 0.82,
      bevelEnabled: true,
      bevelSegments: 4,
      steps: 1,
      bevelSize: 0.12,
      bevelThickness: 0.12,
    });
    hullExt.rotateY(-Math.PI / 2);
    hullExt.translate(W * 0.41, 0, 0);
    bodyGeos.push(bakeGeometry(hullExt));

    // Para-brisa náutico curvado
    glassGeos.push(bakeGeometry(new THREE.BoxGeometry(W * 0.74, H * 0.3, 0.08), tf(0, H * 0.58, L * 0.1, -0.5, 0, 0)));
    // Estofamento e motor de popa
    trimGeos.push(bakeGeometry(new THREE.BoxGeometry(W * 0.7, H * 0.24, L * 0.34), tf(0, H * 0.4, -L * 0.15)));
    trimGeos.push(bakeGeometry(new THREE.BoxGeometry(0.42, 0.56, 0.44), tf(0, H * 0.32, -L * 0.47)));
  } else {
    // Perfil lateral automotivo realista (Silhueta com capô, para-brisa inclinado, teto e traseira)
    const isSport = def.category === 'super' || def.category === 'sports';
    const isBoxy = def.category === 'truck' || def.category === 'bus' || def.category === 'van' || def.category === 'ambulance';
    const isPickup = def.category === 'pickup' || def.category === 'tractor';

    const sideProfile = new THREE.Shape();
    const hLow = H * 0.44;
    const hTop = H * 0.92;

    if (isBoxy) {
      sideProfile.moveTo(-L * 0.48, baseY);
      sideProfile.lineTo(L * 0.48, baseY);
      sideProfile.lineTo(L * 0.48, baseY + hLow);
      sideProfile.lineTo(L * 0.42, baseY + hTop);
      sideProfile.lineTo(-L * 0.47, baseY + hTop);
      sideProfile.closePath();
    } else if (isPickup) {
      sideProfile.moveTo(-L * 0.48, baseY);
      sideProfile.lineTo(L * 0.48, baseY);
      sideProfile.lineTo(L * 0.46, baseY + hLow * 0.95);
      sideProfile.lineTo(L * 0.24, baseY + hLow);
      sideProfile.lineTo(L * 0.14, baseY + hTop);
      sideProfile.lineTo(-L * 0.14, baseY + hTop);
      sideProfile.lineTo(-L * 0.16, baseY + hLow);
      sideProfile.lineTo(-L * 0.48, baseY + hLow);
      sideProfile.closePath();
    } else {
      // Perfil Fastback / Coupé / Sedã com curvas suaves
      const noseY = isSport ? baseY + hLow * 0.55 : baseY + hLow * 0.78;
      const hoodEndZ = isSport ? L * 0.22 : L * 0.24;
      const roofFrontZ = isSport ? L * 0.04 : L * 0.09;
      const roofRearZ = isSport ? -L * 0.22 : -L * 0.25;
      const trunkZ = -L * 0.42;

      sideProfile.moveTo(-L * 0.48, baseY + 0.05);
      sideProfile.lineTo(L * 0.48, baseY + 0.04);
      sideProfile.quadraticCurveTo(L * 0.5, noseY, L * 0.44, baseY + hLow * 0.92);
      sideProfile.lineTo(hoodEndZ, baseY + hLow);
      sideProfile.lineTo(roofFrontZ, baseY + hTop);
      sideProfile.lineTo(roofRearZ, baseY + hTop);
      sideProfile.lineTo(trunkZ, baseY + hLow * 1.04);
      sideProfile.lineTo(-L * 0.48, baseY + hLow * 0.92);
      sideProfile.closePath();
    }

    // Extrusão com Bevel 3D (bordas arredondadas como no Blender Bevel Modifier!)
    const bevel = Math.min(0.11, W * 0.06);
    const bodyDepth = W - bevel * 2;
    const carBodyGeo = new THREE.ExtrudeGeometry(sideProfile, {
      depth: bodyDepth,
      bevelEnabled: true,
      bevelSegments: 4,
      steps: 2,
      bevelSize: bevel,
      bevelThickness: bevel,
    });
    // Rotaciona para alinhar eixo Z como frente (+Z) e X como largura
    carBodyGeo.rotateY(Math.PI / 2);
    carBodyGeo.translate(-bodyDepth / 2, 0, 0);
    bodyGeos.push(bakeGeometry(carBodyGeo));

    // Vidros laterais, para-brisa e vigia traseiro
    const cabZ = isPickup ? 0 : -L * 0.06;
    const cabL = isBoxy ? L * 0.84 : isPickup ? L * 0.3 : isSport ? L * 0.42 : L * 0.48;
    const cabY = baseY + hLow + (hTop - hLow) * 0.48;
    const cabH = (hTop - hLow) * 0.82;
    glassGeos.push(bakeGeometry(new THREE.BoxGeometry(W * 0.87, cabH, cabL * 0.86), tf(0, cabY, cabZ)));
    glassGeos.push(bakeGeometry(
      new THREE.BoxGeometry(W * 0.81, cabH * 0.95, 0.08),
      tf(0, cabY, cabZ + cabL * 0.52, isSport ? -0.58 : -0.42, 0, 0),
    ));

    // Retrovisores esculpidos e maçanetas cromadas
    for (const s of [-1, 1]) {
      bodyGeos.push(bakeGeometry(new THREE.SphereGeometry(0.08, 10, 8), tf(s * (W * 0.53), baseY + hLow + 0.06, L * 0.14, 0, 0, 0, 1.3, 0.75, 1.1)));
      chromeGeos.push(bakeGeometry(new THREE.CapsuleGeometry(0.016, 0.11, 4, 8), tf(s * (W * 0.502), baseY + hLow * 0.78, -0.04, Math.PI / 2, 0, 0)));
    }

    // Aerofólio esportivo
    if (isSport) {
      trimGeos.push(bakeGeometry(new THREE.BoxGeometry(W * 0.92, 0.045, 0.25), tf(0, baseY + hLow + 0.28, -L * 0.44, 0.12, 0, 0)));
      for (const s of [-1, 1]) {
        trimGeos.push(bakeGeometry(new THREE.BoxGeometry(0.045, 0.22, 0.14), tf(s * W * 0.3, baseY + hLow + 0.16, -L * 0.43)));
      }
    }

    // Saia inferior, difusor traseiro, grade frontal e ponteiras de escapamento
    trimGeos.push(bakeGeometry(new THREE.BoxGeometry(W * 0.94, 0.12, L * 0.94), tf(0, baseY + 0.06, 0)));
    trimGeos.push(bakeGeometry(new THREE.BoxGeometry(W * 0.54, hLow * 0.38, 0.08), tf(0, baseY + hLow * 0.42, L * 0.485)));
    chromeGeos.push(bakeGeometry(new THREE.BoxGeometry(W * 0.57, hLow * 0.42, 0.06), tf(0, baseY + hLow * 0.42, L * 0.482)));

    for (const s of [-1, 1]) {
      headGeos.push(bakeGeometry(new THREE.BoxGeometry(0.26, 0.11, 0.08), tf(s * W * 0.34, baseY + hLow * 0.62, L * 0.482)));
      tailGeos.push(bakeGeometry(new THREE.BoxGeometry(0.3, 0.11, 0.08), tf(s * W * 0.33, baseY + hLow * 0.65, -L * 0.482)));
      chromeGeos.push(bakeGeometry(new THREE.CylinderGeometry(0.044, 0.044, 0.18, 12), tf(s * W * 0.26, baseY + 0.12, -L * 0.49, Math.PI / 2, 0, 0)));
    }
  }

  const parts: GlbPart[] = [
    { name: 'BodyPaint', geometry: mergeGeometries(bodyGeos), color: def.colors[0], metallic: 0.75, roughness: 0.18 },
    { name: 'Glass', geometry: mergeGeometries(glassGeos), color: 0x0d1b2a, metallic: 0.15, roughness: 0.08, alpha: 0.82 },
    { name: 'DarkTrim', geometry: mergeGeometries(trimGeos), color: 0x161920, metallic: 0.25, roughness: 0.65 },
  ];
  if (chromeGeos.length) parts.push({ name: 'Chrome', geometry: mergeGeometries(chromeGeos), color: 0xe2e8f0, metallic: 0.95, roughness: 0.1 });
  if (headGeos.length) parts.push({ name: 'Headlights', geometry: mergeGeometries(headGeos), color: 0xfff8dc, metallic: 0.1, roughness: 0.1, emissive: 0xffe28a });
  if (tailGeos.length) parts.push({ name: 'Taillights', geometry: mergeGeometries(tailGeos), color: 0xff1e27, metallic: 0.1, roughness: 0.15, emissive: 0xd91018 });

  return writeGlbFile(`veh_${modelId}.glb`, parts);
}

/* ===================================================================
 * 2. GERADOR DE ARMAS 3D (.GLB) — 23 ARMAS DETALHADAS
 * =================================================================== */
function generateWeaponGlb(weaponId: string): number {
  const def = WEAPONS[weaponId];
  const metalGeos: THREE.BufferGeometry[] = [];
  const gripGeos: THREE.BufferGeometry[] = [];
  const chromeGeos: THREE.BufferGeometry[] = [];

  if (def.category === 'melee') {
    if (weaponId === 'knife') {
      gripGeos.push(bakeGeometry(new THREE.CapsuleGeometry(0.018, 0.11, 6, 12), tf(0, 0, 0, Math.PI / 2, 0, 0)));
      chromeGeos.push(bakeGeometry(new THREE.ConeGeometry(0.022, 0.24, 4), tf(0, 0, 0.18, Math.PI / 2, 0, 0, 0.35, 1, 1)));
    } else if (weaponId === 'hammer') {
      gripGeos.push(bakeGeometry(new THREE.CylinderGeometry(0.018, 0.022, 0.65, 12), tf(0, 0, 0.25, Math.PI / 2, 0, 0)));
      metalGeos.push(bakeGeometry(new THREE.BoxGeometry(0.18, 0.08, 0.08), tf(0, 0, 0.56)));
    } else {
      // Taco de beisebol torneado com LatheGeometry
      const pts = [
        new THREE.Vector2(0.024, 0),
        new THREE.Vector2(0.016, 0.04),
        new THREE.Vector2(0.018, 0.35),
        new THREE.Vector2(0.036, 0.72),
        new THREE.Vector2(0.028, 0.78),
        new THREE.Vector2(0, 0.8),
      ];
      const lathe = new THREE.LatheGeometry(pts, 18);
      lathe.rotateX(Math.PI / 2);
      gripGeos.push(bakeGeometry(lathe));
    }
  } else if (def.category === 'throwable') {
    metalGeos.push(bakeGeometry(new THREE.SphereGeometry(0.055, 16, 14), tf(0, 0, 0.06, 0, 0, 0, 0.9, 1.25, 0.9)));
    chromeGeos.push(bakeGeometry(new THREE.CylinderGeometry(0.02, 0.02, 0.04, 10), tf(0, 0.07, 0.06)));
  } else if (def.category === 'pistol') {
    gripGeos.push(bakeGeometry(new THREE.BoxGeometry(0.036, 0.115, 0.052), tf(0, 0, 0, -0.24, 0, 0)));
    metalGeos.push(bakeGeometry(new THREE.BoxGeometry(0.042, 0.05, 0.24), tf(0, 0.062, 0.09)));
    chromeGeos.push(bakeGeometry(new THREE.CylinderGeometry(0.012, 0.012, 0.26, 14), tf(0, 0.065, 0.11, Math.PI / 2, 0, 0)));
  } else if (def.category === 'smg') {
    gripGeos.push(bakeGeometry(new THREE.BoxGeometry(0.038, 0.11, 0.05), tf(0, -0.01, 0.02, -0.2, 0, 0)));
    metalGeos.push(bakeGeometry(new THREE.BoxGeometry(0.052, 0.085, 0.38), tf(0, 0.06, 0.14)));
    gripGeos.push(bakeGeometry(new THREE.BoxGeometry(0.032, 0.17, 0.045), tf(0, -0.04, 0.18, 0.12, 0, 0)));
    chromeGeos.push(bakeGeometry(new THREE.CylinderGeometry(0.014, 0.014, 0.24, 14), tf(0, 0.065, 0.36, Math.PI / 2, 0, 0)));
  } else if (def.category === 'shotgun') {
    gripGeos.push(bakeGeometry(new THREE.BoxGeometry(0.046, 0.085, 0.24), tf(0, 0.03, -0.06, -0.1, 0, 0)));
    metalGeos.push(bakeGeometry(new THREE.BoxGeometry(0.054, 0.08, 0.32), tf(0, 0.06, 0.18)));
    metalGeos.push(bakeGeometry(new THREE.CylinderGeometry(0.018, 0.018, 0.54, 16), tf(0, 0.075, 0.46, Math.PI / 2, 0, 0)));
    gripGeos.push(bakeGeometry(new THREE.CylinderGeometry(0.026, 0.026, 0.19, 14), tf(0, 0.035, 0.42, Math.PI / 2, 0, 0)));
  } else {
    // Rifles, Snipers e Pesadas
    const barrelLen = def.category === 'sniper' ? 0.68 : 0.46;
    gripGeos.push(bakeGeometry(new THREE.BoxGeometry(0.048, 0.085, 0.22), tf(0, 0.04, -0.06)));
    metalGeos.push(bakeGeometry(new THREE.BoxGeometry(0.058, 0.095, 0.42), tf(0, 0.065, 0.22)));
    gripGeos.push(bakeGeometry(new THREE.BoxGeometry(0.036, 0.17, 0.065), tf(0, -0.03, 0.24, 0.22, 0, 0)));
    metalGeos.push(bakeGeometry(new THREE.CylinderGeometry(0.015, 0.015, barrelLen, 16), tf(0, 0.075, 0.42 + barrelLen * 0.4, Math.PI / 2, 0, 0)));
    if (def.category === 'sniper' || weaponId === 'mrifle') {
      chromeGeos.push(bakeGeometry(new THREE.CylinderGeometry(0.024, 0.024, 0.26, 16), tf(0, 0.135, 0.22, Math.PI / 2, 0, 0)));
    }
  }

  const parts: GlbPart[] = [];
  if (metalGeos.length) parts.push({ name: 'GunMetal', geometry: mergeGeometries(metalGeos), color: 0x1c2026, metallic: 0.88, roughness: 0.22 });
  if (gripGeos.length) parts.push({ name: 'GripWoodPolymer', geometry: mergeGeometries(gripGeos), color: def.category === 'shotgun' || def.category === 'melee' ? 0x6e4325 : 0x2c3038, metallic: 0.1, roughness: 0.65 });
  if (chromeGeos.length) parts.push({ name: 'ChromeSteel', geometry: mergeGeometries(chromeGeos), color: 0xc2ccd6, metallic: 0.94, roughness: 0.14 });

  return writeGlbFile(`wpn_${weaponId}.glb`, parts);
}

/* ===================================================================
 * 3. GERADOR DE PROPS & MODELOS DO MUNDO (.GLB)
 * - Roda Automotiva Esportiva (prop_wheel.glb)
 * - Palmeira Tropical Curvada (prop_palm.glb)
 * - Poste de Luz Urbano (prop_streetlight.glb)
 * - Helicóptero Costeiro (prop_helicopter.glb)
 * =================================================================== */
function generatePropsGlb(): Record<string, number> {
  const sizes: Record<string, number> = {};

  // Roda esportiva unitária (raio 1.0 normalizado para escala dinâmica)
  const tireGeo = bakeGeometry(new THREE.CylinderGeometry(1.0, 1.0, 0.75, 24), tf(0, 0, 0, 0, 0, Math.PI / 2));
  const rimGeo = bakeGeometry(new THREE.CylinderGeometry(0.68, 0.68, 0.78, 16), tf(0, 0, 0, 0, 0, Math.PI / 2));
  const caliperGeo = bakeGeometry(new THREE.BoxGeometry(0.8, 0.42, 0.34), tf(0, 0.25, -0.25));
  sizes['prop_wheel.glb'] = writeGlbFile('prop_wheel.glb', [
    { name: 'TireRubber', geometry: tireGeo, color: 0x15181f, metallic: 0.15, roughness: 0.75 },
    { name: 'AlloyRim', geometry: rimGeo, color: 0xe2e8f0, metallic: 0.95, roughness: 0.12 },
    { name: 'BrakeCaliper', geometry: caliperGeo, color: 0xe0201b, metallic: 0.4, roughness: 0.35 },
  ]);

  // Helicóptero Costeiro
  const heliBody = mergeGeometries([
    bakeGeometry(new THREE.CapsuleGeometry(1.15, 3.2, 10, 16), tf(0, 0, 0, Math.PI / 2, 0, 0)),
    bakeGeometry(new THREE.CylinderGeometry(0.22, 0.45, 5.2, 12), tf(0, 0.25, -3.8, Math.PI / 2, 0, 0)),
  ]);
  const heliGlass = bakeGeometry(new THREE.SphereGeometry(1.12, 16, 14), tf(0, 0.1, 1.35));
  sizes['prop_helicopter.glb'] = writeGlbFile('prop_helicopter.glb', [
    { name: 'HeliFuselage', geometry: heliBody, color: 0x192536, metallic: 0.78, roughness: 0.2 },
    { name: 'HeliCanopy', geometry: heliGlass, color: 0x0b1624, metallic: 0.15, roughness: 0.1, alpha: 0.82 },
  ]);

  // Cabeça Humanoide Esculpida (Crânio, Mandíbula, Nariz, Orelhas, Pescoço)
  const headSkin = mergeGeometries([
    bakeGeometry(new THREE.SphereGeometry(0.142, 22, 20), tf(0, 0.16, 0, 0, 0, 0, 0.94, 1.08, 0.98)),
    bakeGeometry(new THREE.CylinderGeometry(0.062, 0.074, 0.11, 14), tf(0, 0.04, 0)),
    bakeGeometry(new THREE.ConeGeometry(0.022, 0.056, 10), tf(0, 0.155, 0.145, Math.PI / 2, 0, 0)),
    bakeGeometry(new THREE.SphereGeometry(0.028, 10, 10), tf(-0.136, 0.16, 0, 0, 0, 0, 0.48, 1.1, 0.8)),
    bakeGeometry(new THREE.SphereGeometry(0.028, 10, 10), tf(0.136, 0.16, 0, 0, 0, 0, 0.48, 1.1, 0.8)),
  ]);
  const headEyes = mergeGeometries([
    bakeGeometry(new THREE.SphereGeometry(0.015, 10, 10), tf(-0.048, 0.175, 0.134)),
    bakeGeometry(new THREE.SphereGeometry(0.015, 10, 10), tf(0.048, 0.175, 0.134)),
  ]);
  sizes['char_head.glb'] = writeGlbFile('char_head.glb', [
    { name: 'Skin', geometry: headSkin, color: 0xd49a73, metallic: 0.04, roughness: 0.56 },
    { name: 'Eyes', geometry: headEyes, color: 0x11161f, metallic: 0.1, roughness: 0.15 },
  ]);

  // Torso Humanoide Esculpido com Jaqueta Anatômica (Lathe/Extrude com Bevel)
  const torsoShape = new THREE.Shape();
  torsoShape.moveTo(-0.18, 0.08);
  torsoShape.lineTo(0.18, 0.08);
  torsoShape.lineTo(0.22, 0.56);
  torsoShape.lineTo(-0.22, 0.56);
  torsoShape.closePath();
  const torsoExt = new THREE.ExtrudeGeometry(torsoShape, {
    depth: 0.18,
    bevelEnabled: true,
    bevelSegments: 3,
    steps: 1,
    bevelSize: 0.035,
    bevelThickness: 0.035,
  });
  torsoExt.translate(0, 0, -0.09);
  const jacketGeo = mergeGeometries([
    bakeGeometry(torsoExt),
    bakeGeometry(new THREE.CylinderGeometry(0.1, 0.135, 0.08, 14), tf(0, 0.61, 0)),
  ]);
  const innerShirtGeo = bakeGeometry(new THREE.BoxGeometry(0.17, 0.47, 0.252), tf(0, 0.34, 0.005));
  sizes['char_torso.glb'] = writeGlbFile('char_torso.glb', [
    { name: 'TopCloth', geometry: jacketGeo, color: 0x2468cc, metallic: 0.08, roughness: 0.68 },
    { name: 'InnerShirt', geometry: innerShirtGeo, color: 0xecf0f6, metallic: 0.05, roughness: 0.78 },
  ]);

  // Palmeira Tropical Costeira
  const palmTrunk = bakeGeometry(new THREE.CylinderGeometry(0.16, 0.32, 6.8, 10), tf(0, 3.4, 0, 0.06, 0, 0));
  const palmLeaves: THREE.BufferGeometry[] = [];
  for (let i = 0; i < 7; i++) {
    const a = (i / 7) * Math.PI * 2;
    palmLeaves.push(bakeGeometry(
      new THREE.ConeGeometry(0.55, 2.8, 5),
      tf(Math.cos(a) * 1.1, 6.6, Math.sin(a) * 1.1, Math.sin(a) * 1.15, a, -Math.cos(a) * 1.15),
    ));
  }
  sizes['prop_palm.glb'] = writeGlbFile('prop_palm.glb', [
    { name: 'Bark', geometry: palmTrunk, color: 0x5c3e26, metallic: 0.05, roughness: 0.9 },
    { name: 'PalmFronds', geometry: mergeGeometries(palmLeaves), color: 0x2e8538, metallic: 0.08, roughness: 0.7 },
  ]);

  // Poste de Iluminação Pública
  const poleBody = mergeGeometries([
    bakeGeometry(new THREE.CylinderGeometry(0.08, 0.14, 7.2, 10), tf(0, 3.6, 0)),
    bakeGeometry(new THREE.BoxGeometry(1.1, 0.12, 0.14), tf(-0.45, 7.15, 0)),
  ]);
  const poleLamp = bakeGeometry(new THREE.BoxGeometry(0.55, 0.12, 0.32), tf(-0.8, 7.08, 0));
  sizes['prop_streetlight.glb'] = writeGlbFile('prop_streetlight.glb', [
    { name: 'SteelPole', geometry: poleBody, color: 0x282e38, metallic: 0.75, roughness: 0.32 },
    { name: 'LampHead', geometry: poleLamp, color: 0xfff5d6, metallic: 0.1, roughness: 0.15, emissive: 0xffd27d },
  ]);

  // Árvore Frondosa / Pinheiro (prop_tree.glb)
  const treeTrunk = bakeGeometry(new THREE.CylinderGeometry(0.24, 0.42, 4.6, 10), tf(0, 2.3, 0));
  const treeCrown = mergeGeometries([
    bakeGeometry(new THREE.DodecahedronGeometry(2.6, 1), tf(0, 4.8, 0, 0, 0, 0, 1.15, 0.88, 1.15)),
    bakeGeometry(new THREE.DodecahedronGeometry(1.85, 1), tf(0, 6.6, 0, 0, 0.5, 0, 0.9, 0.95, 0.9)),
  ]);
  sizes['prop_tree.glb'] = writeGlbFile('prop_tree.glb', [
    { name: 'Bark', geometry: treeTrunk, color: 0x5c3e26, metallic: 0.05, roughness: 0.9 },
    { name: 'Foliage', geometry: treeCrown, color: 0x2b6e32, metallic: 0.05, roughness: 0.78 },
  ]);

  // 4 Arquiteturas de Arranha-Céus Chanfrados em Bevel 3D (normalizados 1x1x1 para escalar por quarteirão)
  // 1) bldg_stepped.glb — Arranha-céu Escalonado com Pináculo
  const stepFacade = mergeGeometries([
    bakeGeometry(new THREE.BoxGeometry(1.0, 0.55, 1.0), tf(0, 0.275, 0)),
    bakeGeometry(new THREE.BoxGeometry(0.76, 0.28, 0.76), tf(0, 0.69, 0)),
    bakeGeometry(new THREE.BoxGeometry(0.52, 0.17, 0.52), tf(0, 0.915, 0)),
  ]);
  const stepTrim = mergeGeometries([
    bakeGeometry(new THREE.BoxGeometry(1.06, 0.06, 1.06), tf(0, 0.03, 0)),
    bakeGeometry(new THREE.BoxGeometry(0.82, 0.025, 0.82), tf(0, 0.55, 0)),
    bakeGeometry(new THREE.BoxGeometry(0.58, 0.025, 0.58), tf(0, 0.83, 0)),
    bakeGeometry(new THREE.CylinderGeometry(0.008, 0.022, 0.18, 8), tf(0, 1.09, 0)),
  ]);
  sizes['bldg_stepped.glb'] = writeGlbFile('bldg_stepped.glb', [
    { name: 'Facade', geometry: stepFacade, color: 0xffffff, metallic: 0.6, roughness: 0.25 },
    { name: 'Trim', geometry: stepTrim, color: 0x2c3340, metallic: 0.4, roughness: 0.6 },
  ]);

  // 2) bldg_cylinder.glb — Torre Corporativa Octogonal/Cilíndrica com Heliponto
  const cylFacade = bakeGeometry(new THREE.CylinderGeometry(0.46, 0.5, 1.0, 16), tf(0, 0.5, 0));
  const cylTrim = mergeGeometries([
    bakeGeometry(new THREE.CylinderGeometry(0.53, 0.54, 0.06, 16), tf(0, 0.03, 0)),
    bakeGeometry(new THREE.CylinderGeometry(0.38, 0.38, 0.03, 16), tf(0, 1.015, 0)),
  ]);
  sizes['bldg_cylinder.glb'] = writeGlbFile('bldg_cylinder.glb', [
    { name: 'Facade', geometry: cylFacade, color: 0xffffff, metallic: 0.7, roughness: 0.2 },
    { name: 'Trim', geometry: cylTrim, color: 0x2c3340, metallic: 0.4, roughness: 0.6 },
  ]);

  // 3) bldg_pyramid.glb — Edifício com Coroa Piramidal e Colunas Laterais
  const pyrFacade = mergeGeometries([
    bakeGeometry(new THREE.BoxGeometry(1.0, 0.9, 1.0), tf(0, 0.45, 0)),
    bakeGeometry(new THREE.ConeGeometry(0.65, 0.16, 4), tf(0, 0.98, 0, 0, Math.PI / 4, 0)),
  ]);
  const pyrTrim = mergeGeometries([
    bakeGeometry(new THREE.BoxGeometry(1.06, 0.06, 1.06), tf(0, 0.03, 0)),
    bakeGeometry(new THREE.BoxGeometry(1.04, 0.03, 1.04), tf(0, 0.9, 0)),
  ]);
  sizes['bldg_pyramid.glb'] = writeGlbFile('bldg_pyramid.glb', [
    { name: 'Facade', geometry: pyrFacade, color: 0xffffff, metallic: 0.6, roughness: 0.25 },
    { name: 'Trim', geometry: pyrTrim, color: 0xf5b942, metallic: 0.85, roughness: 0.2, emissive: 0x5c420e },
  ]);

  // 4) bldg_modern.glb — Torre com Marquise Comercial e HVAC no Topo
  const modFacade = bakeGeometry(new THREE.BoxGeometry(1.0, 1.0, 1.0), tf(0, 0.5, 0));
  const modTrim = mergeGeometries([
    bakeGeometry(new THREE.BoxGeometry(1.08, 0.07, 1.08), tf(0, 0.035, 0)),
    bakeGeometry(new THREE.BoxGeometry(0.35, 0.04, 0.35), tf(-0.18, 1.02, 0)),
    bakeGeometry(new THREE.BoxGeometry(0.25, 0.035, 0.25), tf(0.2, 1.017, 0.12)),
  ]);
  sizes['bldg_modern.glb'] = writeGlbFile('bldg_modern.glb', [
    { name: 'Facade', geometry: modFacade, color: 0xffffff, metallic: 0.5, roughness: 0.3 },
    { name: 'Trim', geometry: modTrim, color: 0x2c3340, metallic: 0.4, roughness: 0.6 },
  ]);

  // 5) bldg_house.glb — Casa Residencial Completa com Telhado Cerâmico, Chaminé e Varanda
  const houseWalls = mergeGeometries([
    bakeGeometry(new THREE.BoxGeometry(1.0, 1.0, 1.0), tf(0, 0.5, 0)),
    bakeGeometry(new THREE.BoxGeometry(0.14, 0.45, 0.14), tf(0.28, 1.15, -0.15)),
  ]);
  const houseRoof = mergeGeometries([
    bakeGeometry(new THREE.ConeGeometry(0.82, 0.48, 4), tf(0, 1.24, 0, 0, Math.PI / 4, 0)),
    bakeGeometry(new THREE.BoxGeometry(0.58, 0.06, 0.28), tf(0, 0.03, 0.64)),
  ]);
  sizes['bldg_house.glb'] = writeGlbFile('bldg_house.glb', [
    { name: 'Facade', geometry: houseWalls, color: 0xe6d7c3, metallic: 0.05, roughness: 0.82 },
    { name: 'Roof', geometry: houseRoof, color: 0x9c3d28, metallic: 0.08, roughness: 0.75 },
  ]);

  // 6) bldg_mansion.glb — Mansão das Colinas com Ala Superior em Balanço
  const manWalls = mergeGeometries([
    bakeGeometry(new THREE.BoxGeometry(26, 8.8, 16), tf(0, 4.4, 0)),
    bakeGeometry(new THREE.BoxGeometry(16, 4.6, 14), tf(-3, 11.1, 0)),
  ]);
  const manPool = mergeGeometries([
    bakeGeometry(new THREE.BoxGeometry(14, 0.35, 19), tf(19, 0.18, 0)),
    bakeGeometry(new THREE.BoxGeometry(10, 0.52, 15), tf(19, 0.26, 0)),
  ]);
  sizes['bldg_mansion.glb'] = writeGlbFile('bldg_mansion.glb', [
    { name: 'MansionWhite', geometry: manWalls, color: 0xf7f5f0, metallic: 0.12, roughness: 0.32 },
    { name: 'PoolWater', geometry: manPool, color: 0x14d4f4, metallic: 0.2, roughness: 0.1, emissive: 0x095c70 },
  ]);

  // 7) bldg_barn.glb — Fazenda / Celeiro Rural + Silo Metálico com Domo
  const barnRed = mergeGeometries([
    bakeGeometry(new THREE.BoxGeometry(22, 10, 14), tf(0, 5, 0)),
    bakeGeometry(new THREE.ConeGeometry(14, 4.6, 4), tf(0, 12.3, 0, 0, Math.PI / 4, 0)),
  ]);
  const barnSilo = mergeGeometries([
    bakeGeometry(new THREE.CylinderGeometry(3.6, 3.6, 19, 16), tf(15, 9.5, 0)),
    bakeGeometry(new THREE.SphereGeometry(3.6, 16, 12, 0, Math.PI * 2, 0, Math.PI / 2), tf(15, 19, 0)),
  ]);
  sizes['bldg_barn.glb'] = writeGlbFile('bldg_barn.glb', [
    { name: 'BarnWood', geometry: barnRed, color: 0x9e2a22, metallic: 0.08, roughness: 0.82 },
    { name: 'SiloSteel', geometry: barnSilo, color: 0xcfd6df, metallic: 0.72, roughness: 0.28 },
  ]);

  // 8) prop_lighthouse.glb — Farol Costeiro da Ilha
  const lhTower = bakeGeometry(new THREE.CylinderGeometry(2.3, 3.9, 28, 18), tf(0, 14, 0));
  const lhBeacon = bakeGeometry(new THREE.CylinderGeometry(2.5, 2.5, 3.2, 16), tf(0, 29.5, 0));
  sizes['prop_lighthouse.glb'] = writeGlbFile('prop_lighthouse.glb', [
    { name: 'TowerWhite', geometry: lhTower, color: 0xf5f5f5, metallic: 0.1, roughness: 0.55 },
    { name: 'BeaconLight', geometry: lhBeacon, color: 0xffd24d, metallic: 0.1, roughness: 0.1, emissive: 0xffaa00 },
  ]);

  return sizes;
}

/* ===================================================================
 * EXECUÇÃO DO PIPELINE
 * =================================================================== */
let totalFiles = 0;
let totalBytes = 0;

for (const vid of Object.keys(VEHICLES)) {
  totalBytes += generateVehicleChassisGlb(vid);
  totalFiles++;
}

for (const wid of Object.keys(WEAPONS)) {
  if (wid === 'fists') continue;
  totalBytes += generateWeaponGlb(wid);
  totalFiles++;
}

const propSizes = generatePropsGlb();
for (const sz of Object.values(propSizes)) {
  totalBytes += sz;
  totalFiles++;
}

console.log(`[GLB COMPILER] Gerados ${totalFiles} arquivos .glb otimizados em ${OUT_DIR} (${Math.round(totalBytes / 1024)} KB totais)`);
