import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { VEHICLES, WEAPONS, type Appearance } from '../../../shared/src';

/* ===================================================================
 * Pipeline de Modelos 3D (.GLB Blender-Compatible + GLTFLoader Cache):
 * - Pré-carrega os 45 arquivos .glb otimizados de /models/*.glb
 *   (16 veículos, 23 armas, cabeça/torso humanoide, rodas, helicóptero)
 * - Clona as geometrias compartilhadas da GPU (Zero realocação de Buffer!)
 * - Mantém articulação esquelética completa para animações de 3ª pessoa,
 *   rodas giratórias/esterçáveis, pintura automotiva Clearcoat e luzes
 * =================================================================== */

export const gltfLoader = new GLTFLoader();
const glbCache = new Map<string, THREE.Group>();

export async function preloadAllGlbModels(onProgress?: (loaded: number, total: number, name: string) => void): Promise<void> {
  const files: string[] = [
    'char_head.glb',
    'char_torso.glb',
    'prop_wheel.glb',
    'prop_helicopter.glb',
    'prop_palm.glb',
    'prop_tree.glb',
    'prop_streetlight.glb',
    'prop_lighthouse.glb',
    'bldg_stepped.glb',
    'bldg_cylinder.glb',
    'bldg_pyramid.glb',
    'bldg_modern.glb',
    'bldg_house.glb',
    'bldg_mansion.glb',
    'bldg_barn.glb',
    ...Object.keys(VEHICLES).map((id) => `veh_${id}.glb`),
    ...Object.keys(WEAPONS).filter((id) => id !== 'fists').map((id) => `wpn_${id}.glb`),
  ];

  let loaded = 0;
  await Promise.all(
    files.map(async (file) => {
      try {
        const gltf = await gltfLoader.loadAsync(`/models/${file}`);
        glbCache.set(file, gltf.scene);
      } catch {
        // Fallback procedural automático caso algum asset seja omitido
      } finally {
        loaded++;
        onProgress?.(loaded, files.length, file);
      }
    }),
  );
}

export function getCachedGlb(filename: string): THREE.Group | undefined {
  return glbCache.get(filename);
}

const SKIN_COLORS = [0xf7d7c4, 0xe8b89a, 0xd49a73, 0xb87b52, 0x8f5838, 0x6b3e26, 0x4b2b1a, 0x361e12];
const HAIR_COLORS = [0x171413, 0x3b2618, 0x6e4222, 0xb88635, 0xd6b865, 0x992316, 0x99a3ad, 0x1e66b0];
const CLOTH_COLORS = [0x18202c, 0x2c3e50, 0xd23b2f, 0x2468cc, 0x219e55, 0xf0c419, 0xecf0f1, 0x8e44ad, 0xe67e22, 0x16a085, 0x5d4a2e, 0x101216];

export interface HumanoidRig {
  root: THREE.Group;
  hips: THREE.Group;
  spine: THREE.Group;
  torso: THREE.Object3D;
  head: THREE.Group;
  armL: THREE.Group;
  foreArmL: THREE.Group;
  armR: THREE.Group;
  foreArmR: THREE.Group;
  legL: THREE.Group;
  shinL: THREE.Group;
  legR: THREE.Group;
  shinR: THREE.Group;
  weaponMount: THREE.Group;
  muzzleFlash: THREE.Mesh;
  mixer: THREE.AnimationMixer;
  nameTag?: THREE.Sprite;
  currentAnim: string;
  animTime: number;
  aimPitch: number;
  flashTimer: number;
}

export function createNameSprite(text: string, color = '#ffffff'): THREE.Sprite {
  const c = document.createElement('canvas');
  c.width = 256;
  c.height = 64;
  const ctx = c.getContext('2d')!;
  ctx.fillStyle = 'rgba(7, 11, 18, 0.78)';
  ctx.beginPath();
  ctx.roundRect(16, 10, 224, 44, 14);
  ctx.fill();
  ctx.strokeStyle = 'rgba(245, 185, 66, 0.85)';
  ctx.lineWidth = 2.5;
  ctx.stroke();
  ctx.font = 'bold 22px Segoe UI, system-ui, sans-serif';
  ctx.fillStyle = color;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(text.slice(0, 18), 128, 32);

  const tex = new THREE.CanvasTexture(c);
  const mat = new THREE.SpriteMaterial({ map: tex, transparent: true, depthTest: false });
  const sp = new THREE.Sprite(mat);
  sp.scale.set(1.65, 0.41, 1);
  sp.position.set(0, 2.18, 0);
  return sp;
}

export function buildHumanoid(app: Appearance, username?: string): HumanoidRig {
  const root = new THREE.Group();
  const hips = new THREE.Group();
  hips.position.y = 0.94;
  root.add(hips);

  const spine = new THREE.Group();
  hips.add(spine);

  const skinMat = new THREE.MeshStandardMaterial({ color: SKIN_COLORS[app.skin % SKIN_COLORS.length], roughness: 0.56, metalness: 0.04 });
  const topMat = new THREE.MeshStandardMaterial({ color: CLOTH_COLORS[app.topColor % CLOTH_COLORS.length], roughness: 0.66, metalness: 0.08 });
  const shirtInnerMat = new THREE.MeshStandardMaterial({ color: 0xeaeef5, roughness: 0.75 });
  const legMat = new THREE.MeshStandardMaterial({ color: CLOTH_COLORS[app.legsColor % CLOTH_COLORS.length], roughness: 0.78 });
  const shoeMat = new THREE.MeshStandardMaterial({ color: CLOTH_COLORS[app.shoesColor % CLOTH_COLORS.length], roughness: 0.42, metalness: 0.12 });
  const soleMat = new THREE.MeshStandardMaterial({ color: 0xf2f4f7, roughness: 0.6 });
  const hairMat = new THREE.MeshStandardMaterial({ color: HAIR_COLORS[app.hairColor % HAIR_COLORS.length], roughness: 0.82 });
  const beltMat = new THREE.MeshStandardMaterial({ color: 0x1a1c20, roughness: 0.4, metalness: 0.4 });

  // Pélvis e Cinto
  const pelvis = new THREE.Mesh(new THREE.BoxGeometry(0.36, 0.16, 0.23), legMat);
  pelvis.position.y = 0.02;
  pelvis.castShadow = true;
  hips.add(pelvis);

  const belt = new THREE.Mesh(new THREE.BoxGeometry(0.375, 0.05, 0.24), beltMat);
  belt.position.y = 0.09;
  hips.add(belt);

  // Tronco: Usa o modelo GLB esculpido (char_torso.glb) se carregado, aplicando as cores personalizadas do jogador
  const torsoW = app.body === 'fem' ? 0.37 : 0.43;
  let torsoObj: THREE.Object3D;
  const cachedTorso = glbCache.get('char_torso.glb');
  if (cachedTorso) {
    torsoObj = cachedTorso.clone(true);
    if (app.body === 'fem') torsoObj.scale.set(0.9, 0.98, 0.94);
    torsoObj.traverse((node) => {
      if (node instanceof THREE.Mesh) {
        node.castShadow = true;
        if (node.material?.name === 'TopCloth') node.material = topMat;
        else if (node.material?.name === 'InnerShirt') node.material = shirtInnerMat;
      }
    });
    spine.add(torsoObj);
  } else {
    const torso = new THREE.Mesh(new THREE.BoxGeometry(torsoW, 0.52, 0.24), topMat);
    torso.position.y = 0.35;
    torso.castShadow = true;
    spine.add(torso);
    torsoObj = torso;
  }

  // Cabeça: Usa o modelo GLB esculpido (char_head.glb) + cabelo e acessórios personalizados
  const head = new THREE.Group();
  head.position.y = 0.63;
  spine.add(head);

  const cachedHead = glbCache.get('char_head.glb');
  if (cachedHead) {
    const headClone = cachedHead.clone(true);
    headClone.traverse((node) => {
      if (node instanceof THREE.Mesh) {
        node.castShadow = true;
        if (node.material?.name === 'Skin') node.material = skinMat;
      }
    });
    head.add(headClone);
  } else {
    const skull = new THREE.Mesh(new THREE.SphereGeometry(0.142, 20, 18), skinMat);
    skull.position.y = 0.16;
    skull.castShadow = true;
    head.add(skull);
  }

  // Estilos de Cabelo Volumétricos
  if (app.hair > 0) {
    const capHair = new THREE.Mesh(
      new THREE.SphereGeometry(0.152, 16, 14, 0, Math.PI * 2, 0, Math.PI * 0.6),
      hairMat,
    );
    capHair.position.y = 0.175;
    head.add(capHair);

    if (app.hair % 3 === 1) {
      const quiff = new THREE.Mesh(new THREE.BoxGeometry(0.18, 0.075, 0.18), hairMat);
      quiff.position.set(0, 0.29, 0.04);
      quiff.rotation.x = -0.25;
      head.add(quiff);
    } else if (app.hair % 3 === 2) {
      const tail = new THREE.Mesh(new THREE.CapsuleGeometry(0.045, 0.16, 6, 10), hairMat);
      tail.position.set(0, 0.12, -0.15);
      tail.rotation.x = 0.35;
      head.add(tail);
    }
  }

  // Acessórios (Óculos Aviador / Boné)
  if (app.accessory === 1 || app.accessory === 2) {
    const frameMat = new THREE.MeshStandardMaterial({ color: 0xd4af37, metalness: 0.9, roughness: 0.15 });
    const lensMat = new THREE.MeshStandardMaterial({ color: 0x0a1018, metalness: 0.95, roughness: 0.08 });
    for (const s of [-1, 1]) {
      const lens = new THREE.Mesh(new THREE.BoxGeometry(0.075, 0.046, 0.015), lensMat);
      lens.position.set(s * 0.048, 0.175, 0.142);
      head.add(lens);
    }
    const bar = new THREE.Mesh(new THREE.BoxGeometry(0.19, 0.01, 0.018), frameMat);
    bar.position.set(0, 0.192, 0.143);
    head.add(bar);
  } else if (app.accessory >= 3) {
    const capCrown = new THREE.Mesh(new THREE.SphereGeometry(0.156, 16, 12, 0, Math.PI * 2, 0, Math.PI * 0.52), topMat);
    capCrown.position.y = 0.19;
    const visor = new THREE.Mesh(new THREE.BoxGeometry(0.18, 0.016, 0.14), topMat);
    visor.position.set(0, 0.21, 0.15);
    visor.rotation.x = 0.12;
    head.add(capCrown, visor);
  }

  // Braço Esquerdo Articulado
  const armL = new THREE.Group();
  armL.position.set(-(torsoW / 2 + 0.065), 0.56, 0);
  const upperArmL = new THREE.Mesh(new THREE.CapsuleGeometry(0.056, 0.21, 6, 10), topMat);
  upperArmL.position.y = -0.12;
  upperArmL.castShadow = true;
  armL.add(upperArmL);

  const foreArmL = new THREE.Group();
  foreArmL.position.set(0, -0.25, 0);
  const lowerArmL = new THREE.Mesh(new THREE.CapsuleGeometry(0.048, 0.2, 6, 10), skinMat);
  lowerArmL.position.y = -0.11;
  lowerArmL.castShadow = true;
  const handL = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.08, 0.08), skinMat);
  handL.position.set(0, -0.24, 0.01);
  foreArmL.add(lowerArmL, handL);
  armL.add(foreArmL);
  spine.add(armL);

  // Braço Direito Articulado + Suporte de Arma GLB + Muzzle Flash
  const armR = new THREE.Group();
  armR.position.set(torsoW / 2 + 0.065, 0.56, 0);
  const upperArmR = new THREE.Mesh(new THREE.CapsuleGeometry(0.056, 0.21, 6, 10), topMat);
  upperArmR.position.y = -0.12;
  upperArmR.castShadow = true;
  armR.add(upperArmR);

  const foreArmR = new THREE.Group();
  foreArmR.position.set(0, -0.25, 0);
  const lowerArmR = new THREE.Mesh(new THREE.CapsuleGeometry(0.048, 0.2, 6, 10), skinMat);
  lowerArmR.position.y = -0.11;
  lowerArmR.castShadow = true;
  const handR = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.08, 0.08), skinMat);
  handR.position.set(0, -0.24, 0.01);

  const weaponMount = new THREE.Group();
  weaponMount.position.set(0, -0.24, 0.06);

  const flashMat = new THREE.MeshBasicMaterial({ color: 0xffd24d, transparent: true, opacity: 0.92 });
  const muzzleFlash = new THREE.Mesh(new THREE.ConeGeometry(0.09, 0.28, 8), flashMat);
  muzzleFlash.rotation.x = Math.PI / 2;
  muzzleFlash.position.set(0, 0.06, 0.55);
  muzzleFlash.visible = false;
  weaponMount.add(muzzleFlash);

  foreArmR.add(lowerArmR, handR, weaponMount);
  armR.add(foreArmR);
  spine.add(armR);

  // Pernas Articuladas
  const buildLeg = (sideX: number) => {
    const leg = new THREE.Group();
    leg.position.set(sideX, 0, 0);
    const thigh = new THREE.Mesh(new THREE.CapsuleGeometry(0.076, 0.3, 6, 12), legMat);
    thigh.position.y = -0.19;
    thigh.castShadow = true;
    leg.add(thigh);

    const shin = new THREE.Group();
    shin.position.set(0, -0.4, 0);
    const calf = new THREE.Mesh(new THREE.CapsuleGeometry(0.064, 0.3, 6, 12), legMat);
    calf.position.y = -0.18;
    calf.castShadow = true;

    const shoe = new THREE.Mesh(new THREE.BoxGeometry(0.125, 0.085, 0.25), shoeMat);
    shoe.position.set(0, -0.39, 0.045);
    shoe.castShadow = true;
    const sole = new THREE.Mesh(new THREE.BoxGeometry(0.132, 0.028, 0.26), soleMat);
    sole.position.set(0, -0.425, 0.045);

    shin.add(calf, shoe, sole);
    leg.add(shin);
    hips.add(leg);
    return { leg, shin };
  };

  const L = buildLeg(-0.11);
  const R = buildLeg(0.11);

  const mixer = new THREE.AnimationMixer(root);
  let nameTag: THREE.Sprite | undefined;
  if (username) {
    nameTag = createNameSprite(username);
    root.add(nameTag);
  }

  return {
    root,
    hips,
    spine,
    torso: torsoObj,
    head,
    armL,
    foreArmL,
    armR,
    foreArmR,
    legL: L.leg,
    shinL: L.shin,
    legR: R.leg,
    shinR: R.shin,
    weaponMount,
    muzzleFlash,
    mixer,
    nameTag,
    currentAnim: 'idle',
    animTime: 0,
    aimPitch: 0,
    flashTimer: 0,
  };
}

export function triggerMuzzleFlash(rig: HumanoidRig) {
  rig.muzzleFlash.visible = true;
  rig.muzzleFlash.rotation.z = Math.random() * Math.PI * 2;
  rig.flashTimer = 0.055;
}

export function attachWeaponVisual(rig: HumanoidRig, weaponId: string) {
  for (let i = rig.weaponMount.children.length - 1; i >= 0; i--) {
    const ch = rig.weaponMount.children[i];
    if (ch !== rig.muzzleFlash) rig.weaponMount.remove(ch);
  }
  if (!weaponId || weaponId === 'fists') return;
  const def = WEAPONS[weaponId];
  if (!def) return;

  // Carrega o modelo GLB real da arma (wpn_<id>.glb) do cache pré-carregado pelo GLTFLoader!
  const cachedWpn = glbCache.get(`wpn_${weaponId}.glb`);
  if (cachedWpn) {
    const wpnClone = cachedWpn.clone(true);
    wpnClone.traverse((node) => {
      if (node instanceof THREE.Mesh) node.castShadow = true;
    });
    const barrelLen = def.category === 'sniper' ? 0.68 : def.category === 'rifle' ? 0.46 : 0.25;
    rig.muzzleFlash.position.set(0, 0.07, 0.35 + barrelLen * 0.8);
    rig.weaponMount.add(wpnClone);
    return;
  }

  // Fallback instantâneo
  const gunMetal = new THREE.MeshStandardMaterial({ color: 0x1c2026, metalness: 0.88, roughness: 0.22 });
  const box = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.08, 0.35), gunMetal);
  box.position.set(0, 0.05, 0.16);
  rig.weaponMount.add(box);
}

export function animateHumanoid(rig: HumanoidRig, anim: string, dt: number, aimPitch = 0) {
  rig.animTime += dt;
  rig.mixer.update(dt);
  if (rig.flashTimer > 0) {
    rig.flashTimer -= dt;
    if (rig.flashTimer <= 0) rig.muzzleFlash.visible = false;
  }

  const t = rig.animTime;
  const k = Math.min(1, dt * 16);
  const damp = (cur: number, target: number) => cur + (target - cur) * k;

  if (anim === 'dead') {
    rig.hips.rotation.x = damp(rig.hips.rotation.x, -Math.PI / 2);
    rig.hips.position.y = damp(rig.hips.position.y, 0.22);
    return;
  }

  let targetHipsY = 0.94;
  let targetHipsRotX = 0;
  let targetHipsRotY = 0;
  let targetSpineRotX = 0;
  let targetArmLX = 0, targetArmLZ = 0, targetForeLX = -0.15;
  let targetArmRX = 0, targetArmRZ = 0, targetForeRX = -0.15;
  let targetLegLX = 0, targetShinLX = 0.05;
  let targetLegRX = 0, targetShinRX = 0.05;

  if (anim === 'drive') {
    targetHipsY = 0.56;
    targetLegLX = -1.15; targetShinLX = 1.05;
    targetLegRX = -1.15; targetShinRX = 1.05;
    targetArmLX = -0.85; targetForeLX = -0.45;
    targetArmRX = -0.85; targetForeRX = -0.45;
  } else if (anim === 'swim' || anim === 'dive') {
    targetHipsRotX = 1.18;
    targetHipsY = 0.35;
    const s = Math.sin(t * 5.2);
    targetArmLX = -1.3 + s * 0.65;
    targetArmRX = -1.3 - s * 0.65;
    targetLegLX = -s * 0.45;
    targetLegRX = s * 0.45;
    targetShinLX = 0.3;
    targetShinRX = 0.3;
  } else if (anim === 'jump' || anim === 'fall') {
    targetLegLX = -0.45; targetShinLX = 0.75;
    targetLegRX = 0.25; targetShinRX = 0.55;
    targetArmLX = -0.5; targetArmLZ = 0.25;
    targetArmRX = -0.5; targetArmRZ = -0.25;
  } else if (anim === 'wave') {
    targetArmRX = -2.35;
    targetArmRZ = Math.sin(t * 7.5) * 0.35 + 0.28;
    targetForeRX = -0.4;
  } else if (anim === 'cheer') {
    targetArmLX = -2.55; targetArmRX = -2.55;
    targetHipsY = 0.94 + Math.abs(Math.sin(t * 6.5)) * 0.12;
  } else if (anim === 'dance') {
    targetHipsRotY = Math.sin(t * 5.2) * 0.38;
    targetArmLX = -1.1 + Math.sin(t * 8) * 0.6;
    targetArmRX = -1.1 - Math.sin(t * 8) * 0.6;
    targetLegLX = Math.sin(t * 5.2) * 0.35;
    targetLegRX = -Math.sin(t * 5.2) * 0.35;
    targetShinLX = Math.max(0, Math.cos(t * 5.2) * 0.5);
    targetShinRX = Math.max(0, -Math.cos(t * 5.2) * 0.5);
  } else {
    const isCrouch = anim === 'crouch' || anim === 'crouchWalk';
    if (isCrouch) {
      targetHipsY = 0.68;
      targetSpineRotX = 0.22;
      targetLegLX = -0.55; targetShinLX = 0.95;
      targetLegRX = -0.55; targetShinRX = 0.95;
    }

    if (anim === 'walk' || anim === 'run' || anim === 'sprint' || anim === 'crouchWalk') {
      const freq = anim === 'sprint' ? 12.5 : anim === 'run' ? 9.2 : 6.2;
      const amp = anim === 'sprint' ? 0.85 : anim === 'run' ? 0.62 : 0.42;
      const phase = t * freq;
      const s = Math.sin(phase);
      const c = Math.cos(phase);

      targetSpineRotX += anim === 'sprint' ? 0.18 : anim === 'run' ? 0.1 : 0.04;
      targetHipsY += Math.abs(c) * (anim === 'sprint' ? 0.065 : 0.038);

      targetLegLX += s * amp;
      targetLegRX += -s * amp;
      targetShinLX += Math.max(0, -c) * amp * 1.15;
      targetShinRX += Math.max(0, c) * amp * 1.15;

      targetArmLX = -s * amp * 0.72;
      targetForeLX = -0.45 - Math.max(0, s) * 0.35;
      targetArmRX = s * amp * 0.72;
      targetForeRX = -0.45 - Math.max(0, -s) * 0.35;
    } else {
      const breath = Math.sin(t * 2.3) * 0.035;
      targetArmLX = breath;
      targetArmRX = -breath;
      targetForeLX = -0.18;
      targetForeRX = -0.18;
    }

    if (anim === 'aim') {
      targetArmRX = -1.48 - aimPitch * 0.75;
      targetForeRX = -0.12;
      targetArmLX = -1.25 - aimPitch * 0.65;
      targetArmLZ = -0.38;
      targetForeLX = -0.35;
    }
  }

  rig.hips.position.y = damp(rig.hips.position.y, targetHipsY);
  rig.hips.rotation.x = damp(rig.hips.rotation.x, targetHipsRotX);
  rig.hips.rotation.y = damp(rig.hips.rotation.y, targetHipsRotY);
  rig.spine.rotation.x = damp(rig.spine.rotation.x, targetSpineRotX);

  rig.armL.rotation.x = damp(rig.armL.rotation.x, targetArmLX);
  rig.armL.rotation.z = damp(rig.armL.rotation.z, targetArmLZ);
  rig.foreArmL.rotation.x = damp(rig.foreArmL.rotation.x, targetForeLX);

  rig.armR.rotation.x = damp(rig.armR.rotation.x, targetArmRX);
  rig.armR.rotation.z = damp(rig.armR.rotation.z, targetArmRZ);
  rig.foreArmR.rotation.x = damp(rig.foreArmR.rotation.x, targetForeRX);

  rig.legL.rotation.x = damp(rig.legL.rotation.x, targetLegLX);
  rig.shinL.rotation.x = damp(rig.shinL.rotation.x, targetShinLX);

  rig.legR.rotation.x = damp(rig.legR.rotation.x, targetLegRX);
  rig.shinR.rotation.x = damp(rig.shinR.rotation.x, targetShinRX);
}

/* ===================================================================
 * Veículos 3D Carregados a partir dos Arquivos .GLB (veh_<model>.glb + prop_wheel.glb)
 * =================================================================== */
export interface VehicleRig {
  root: THREE.Group;
  bodyGroup: THREE.Group;
  bodyMat: THREE.MeshPhysicalMaterial;
  wheels: THREE.Object3D[];
  tailLightMat: THREE.MeshStandardMaterial;
  headLightMat: THREE.MeshStandardMaterial;
  sirenBar?: THREE.Mesh;
}

export function buildVehicleMesh(modelId: string, colorHex: number): VehicleRig {
  const def = VEHICLES[modelId] ?? VEHICLES.aurelia;
  const root = new THREE.Group();
  const bodyGroup = new THREE.Group();
  root.add(bodyGroup);

  const bodyMat = new THREE.MeshPhysicalMaterial({
    color: colorHex,
    metalness: 0.75,
    roughness: 0.16,
    clearcoat: 1.0,
    clearcoatRoughness: 0.08,
  });
  const headLightMat = new THREE.MeshStandardMaterial({ color: 0xfff9e6, emissive: 0xffe49e, emissiveIntensity: 1.8 });
  const tailLightMat = new THREE.MeshStandardMaterial({ color: 0xff1e27, emissive: 0xcc1018, emissiveIntensity: 1.1 });

  const W = def.width;
  const H = def.height;
  const L = def.length;
  const wheels: THREE.Object3D[] = [];

  // 1. Carrega o chassi esculpido com Bevel 3D do arquivo .glb (veh_<modelId>.glb)
  const cachedVeh = glbCache.get(`veh_${def.id}.glb`);
  if (cachedVeh) {
    const vehClone = cachedVeh.clone(true);
    vehClone.traverse((node) => {
      if (node instanceof THREE.Mesh) {
        node.castShadow = true;
        node.receiveShadow = true;
        const mName = node.material?.name;
        if (mName === 'BodyPaint') node.material = bodyMat;
        else if (mName === 'Headlights') node.material = headLightMat;
        else if (mName === 'Taillights') node.material = tailLightMat;
      }
    });
    bodyGroup.add(vehClone);
  } else {
    const fallbackBox = new THREE.Mesh(new THREE.BoxGeometry(W, H * 0.65, L), bodyMat);
    fallbackBox.position.y = H * 0.45;
    fallbackBox.castShadow = true;
    bodyGroup.add(fallbackBox);
  }

  // Giroflex Policial / Ambulância
  let sirenBar: THREE.Mesh | undefined;
  if (def.category === 'police' || def.category === 'ambulance') {
    const sMat = new THREE.MeshStandardMaterial({ color: 0xff1e38, emissive: 0x1e6bff, emissiveIntensity: 2.0 });
    sirenBar = new THREE.Mesh(new THREE.BoxGeometry(W * 0.58, 0.11, 0.22), sMat);
    sirenBar.position.set(0, H + 0.06, -0.05);
    bodyGroup.add(sirenBar);
  }

  if (def.category === 'boat') {
    return { root, bodyGroup, bodyMat, wheels, tailLightMat, headLightMat, sirenBar };
  }

  // 2. Rodas 3D carregadas de prop_wheel.glb (com pneu, aro metálico e pinça de freio)
  const r = Math.max(0.28, def.wheelRadius);
  const wx = W * 0.48;
  const wz = L * 0.32;
  const wheelCoords: [number, number, number][] = [
    [-wx, r, wz],
    [wx, r, wz],
    [-wx, r, -wz],
    [wx, r, -wz],
  ];

  const cachedWheel = glbCache.get('prop_wheel.glb');
  for (const [x, y, z] of wheelCoords) {
    const wg = new THREE.Group();
    wg.position.set(x, y, z);
    if (cachedWheel) {
      const wc = cachedWheel.clone(true);
      wc.scale.set(0.35, r, r);
      wc.traverse((node) => {
        if (node instanceof THREE.Mesh) node.castShadow = true;
      });
      wg.add(wc);
    } else {
      const tire = new THREE.Mesh(new THREE.CylinderGeometry(r, r, 0.26, 20), new THREE.MeshStandardMaterial({ color: 0x161920 }));
      tire.rotation.z = Math.PI / 2;
      wg.add(tire);
    }
    root.add(wg);
    wheels.push(wg);
  }

  return { root, bodyGroup, bodyMat, wheels, tailLightMat, headLightMat, sirenBar };
}
