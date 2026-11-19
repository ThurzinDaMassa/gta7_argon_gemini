import * as THREE from 'three';
import {
  WORLD_SIZE, WATER_LEVEL, ISLANDS, POIS, PROPERTIES, MISSIONS,
  terrainHeight, regionAt, getRoadNetwork, mulberry32, nearestRoad,
  type Weather,
} from '../../../shared/src';
import { getSharedTextures } from './textures';
import { getCachedGlb } from './models';

/* ===================================================================
 * Construtor Completo de Costa Aurora (Ultra-Detalhado + Otimizado):
 * - 10 Estilos Arquitetônicos com Texturas PBR e Emissive Noturno
 * - Arranha-céus Escalonados, Torres Cilíndricas, Helipontos, Antenas,
 *   Toldos, Outdoors Luminosos, Palmeiras com Folhagem Tropical,
 *   Postes de Luz e Semáforos
 * - Chuva Realista em Traços (Streak Lines), Respingos no Chão,
 *   Relâmpagos em Tempestade e Asfalto Molhado Reflexivo
 * =================================================================== */

export interface BuildingColliderBox {
  x: number;
  y: number;
  z: number;
  hx: number;
  hy: number;
  hz: number;
}

export class CostaAuroraWorld {
  scene: THREE.Scene;
  sunLight!: THREE.DirectionalLight;
  hemiLight!: THREE.HemisphereLight;
  waterMesh!: THREE.Mesh;
  asphaltMat!: THREE.MeshStandardMaterial;
  facadeMaterials: THREE.MeshStandardMaterial[] = [];

  // Chuva Realista (Traços de gotas + Respingos no solo)
  rainStreaks!: THREE.LineSegments;
  rainSplashes!: THREE.Points;
  lightningFlash = 0;

  colliders: BuildingColliderBox[] = [];
  missionRings = new Map<string, THREE.Mesh>();
  activeCheckpointMesh: THREE.Mesh | null = null;
  gpsLine: THREE.Line | null = null;
  helicopterGroup!: THREE.Group;
  heliRotor!: THREE.Object3D;

  private time = 0;

  constructor(scene: THREE.Scene) {
    this.scene = scene;
  }

  buildAll(onProgress?: (msg: string) => void) {
    const tex = getSharedTextures();

    onProgress?.('Configurando iluminação física PBR, sombras e atmosfera...');
    this.buildLightsAndSky();

    onProgress?.('Esculpindo terreno 3D, praias costeiras, serras e ilhas...');
    this.buildTerrain();

    onProgress?.('Renderizando Oceano Atlântico com ondas dinâmicas...');
    this.buildOcean();

    onProgress?.('Pavimentando avenidas, calçadas, rotatória e pontes...');
    this.buildRoadMeshes(tex);

    onProgress?.('Construindo variedade arquitetônica (10 estilos PBR, helipontos, hotéis, mansões)...');
    this.buildDistricts(tex);

    onProgress?.('Plantando palmeiras tropicais, pinheiros, florestas e postes urbanos...');
    this.buildVegetationAndStreetFurniture();

    onProgress?.('Posicionando marcadores de missões, lojas e propriedades...');
    this.buildWorldMarkers();

    onProgress?.('Ativando sistema de chuva realista, relâmpagos e helicóptero costeiro...');
    this.buildRealisticWeatherAndHeli();
  }

  private buildLightsAndSky() {
    this.scene.background = new THREE.Color(0x63a4e8);
    this.scene.fog = new THREE.FogExp2(0x82b5e8, 0.00046);

    this.hemiLight = new THREE.HemisphereLight(0xe4f1ff, 0x3b4936, 0.82);
    this.scene.add(this.hemiLight);

    this.sunLight = new THREE.DirectionalLight(0xfff4db, 1.75);
    this.sunLight.position.set(260, 420, 180);
    this.sunLight.castShadow = true;
    this.sunLight.shadow.mapSize.set(2048, 2048);
    this.sunLight.shadow.camera.near = 10;
    this.sunLight.shadow.camera.far = 1100;
    const d = 220;
    this.sunLight.shadow.camera.left = -d;
    this.sunLight.shadow.camera.right = d;
    this.sunLight.shadow.camera.top = d;
    this.sunLight.shadow.camera.bottom = -d;
    this.sunLight.shadow.bias = -0.0004;
    this.scene.add(this.sunLight);
    this.scene.add(this.sunLight.target);
  }

  private buildTerrain() {
    const segs = 190;
    const geo = new THREE.PlaneGeometry(WORLD_SIZE, WORLD_SIZE, segs, segs);
    geo.rotateX(-Math.PI / 2);

    const pos = geo.attributes.position as THREE.BufferAttribute;
    const colors = new Float32Array(pos.count * 3);
    const c = new THREE.Color();

    for (let i = 0; i < pos.count; i++) {
      const x = pos.getX(i);
      const z = pos.getZ(i);
      const y = terrainHeight(x, z);
      pos.setY(i, y);

      const reg = regionAt(x, z);
      if (y < 0.85) {
        c.setHex(0xdfc792); // faixa de areia
      } else if (reg === 'beach') {
        c.setHex(0xe8d3a3);
      } else if (reg === 'downtown' || reg === 'industrial' || reg === 'airport') {
        c.setHex(0x525863); // piso urbano
      } else if (reg === 'mountains' || y > 35) {
        c.setHex(0x616860); // rocha da serra
      } else if (reg === 'rural') {
        c.setHex(0x4a7836); // pastagem rural
      } else {
        c.setHex(0x3b6c37); // grama residencial
      }
      colors[i * 3] = c.r;
      colors[i * 3 + 1] = c.g;
      colors[i * 3 + 2] = c.b;
    }

    geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    geo.computeVertexNormals();

    const mat = new THREE.MeshStandardMaterial({
      vertexColors: true,
      roughness: 0.88,
      metalness: 0.04,
    });
    const mesh = new THREE.Mesh(geo, mat);
    mesh.receiveShadow = true;
    this.scene.add(mesh);
  }

  private buildOcean() {
    const geo = new THREE.PlaneGeometry(WORLD_SIZE * 1.65, WORLD_SIZE * 1.65, 84, 84);
    geo.rotateX(-Math.PI / 2);
    const mat = new THREE.MeshPhysicalMaterial({
      color: 0x0b598a,
      roughness: 0.14,
      metalness: 0.55,
      clearcoat: 0.9,
      clearcoatRoughness: 0.12,
      transparent: true,
      opacity: 0.9,
    });
    this.waterMesh = new THREE.Mesh(geo, mat);
    this.waterMesh.position.y = WATER_LEVEL;
    this.scene.add(this.waterMesh);
  }

  private buildRoadMeshes(tex: ReturnType<typeof getSharedTextures>) {
    const net = getRoadNetwork();
    this.asphaltMat = new THREE.MeshStandardMaterial({
      map: tex.asphalt,
      bumpMap: tex.asphaltBump,
      bumpScale: 0.04,
      roughness: 0.78,
      metalness: 0.12,
    });
    const dirtMat = new THREE.MeshStandardMaterial({
      color: 0x7c5a38,
      bumpMap: tex.asphaltBump,
      bumpScale: 0.06,
      roughness: 0.94,
    });

    for (const edge of net.edges) {
      const hw = edge.width / 2;
      const positions: number[] = [];
      const uvs: number[] = [];
      const indices: number[] = [];
      let distAcc = 0;

      for (let i = 0; i < edge.pts.length; i++) {
        const p = edge.pts[i];
        const prev = edge.pts[Math.max(0, i - 1)];
        const next = edge.pts[Math.min(edge.pts.length - 1, i + 1)];
        if (i > 0) distAcc += Math.hypot(p[0] - prev[0], p[2] - prev[2]);

        let dx = next[0] - prev[0];
        let dz = next[2] - prev[2];
        const len = Math.hypot(dx, dz) || 1;
        dx /= len;
        dz /= len;
        const nx = -dz;
        const nz = dx;

        const y = p[1] + 0.08;
        positions.push(p[0] - nx * hw, y, p[2] - nz * hw);
        positions.push(p[0] + nx * hw, y, p[2] + nz * hw);
        uvs.push(0, distAcc / 16, 1, distAcc / 16);

        if (i < edge.pts.length - 1) {
          const base = i * 2;
          indices.push(base, base + 1, base + 2, base + 1, base + 3, base + 2);
        }
      }

      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
      g.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
      g.setIndex(indices);
      g.computeVertexNormals();

      const m = new THREE.Mesh(g, edge.type === 'dirt' ? dirtMat : this.asphaltMat);
      m.receiveShadow = true;
      this.scene.add(m);
    }

    // Praça Central Aurora com Fonte e Obelisco Dourado
    const plazaY = terrainHeight(0, 0);
    const plaza = new THREE.Mesh(
      new THREE.CylinderGeometry(19, 20, 0.55, 32),
      new THREE.MeshStandardMaterial({ map: tex.sidewalk, roughness: 0.55 }),
    );
    plaza.position.set(0, plazaY + 0.25, 0);
    plaza.receiveShadow = true;

    const fountainRing = new THREE.Mesh(
      new THREE.CylinderGeometry(7.2, 7.6, 1.1, 24),
      new THREE.MeshStandardMaterial({ color: 0xd5dce6, roughness: 0.4 }),
    );
    fountainRing.position.set(0, plazaY + 0.8, 0);

    const monument = new THREE.Mesh(
      new THREE.ConeGeometry(2.4, 18, 8),
      new THREE.MeshPhysicalMaterial({ color: 0xf5b942, metalness: 0.88, roughness: 0.16, clearcoat: 1 }),
    );
    monument.position.set(0, plazaY + 9.5, 0);
    monument.castShadow = true;
    this.scene.add(plaza, fountainRing, monument);
  }

  private addCollider(x: number, yCenter: number, z: number, w: number, h: number, d: number) {
    this.colliders.push({ x, y: yCenter, z, hx: w / 2, hy: h / 2, hz: d / 2 });
  }

  private buildDistricts(tex: ReturnType<typeof getSharedTextures>) {
    const rnd = mulberry32(2026);

    // Cria materiais PBR com emissiveMap para cada uma das 10 fachadas
    this.facadeMaterials = tex.facades.map((f) => {
      const m = new THREE.MeshStandardMaterial({
        map: f.map,
        emissiveMap: f.emissiveMap,
        emissive: new THREE.Color(0xffffff),
        emissiveIntensity: 0.22,
        roughness: f.roughness,
        metalness: f.metalness,
      });
      return m;
    });

    const concreteTrim = new THREE.MeshStandardMaterial({ color: 0x2c3340, roughness: 0.65, metalness: 0.2 });
    const neonMats = [
      new THREE.MeshBasicMaterial({ color: 0x2de2e6 }),
      new THREE.MeshBasicMaterial({ color: 0xf5b942 }),
      new THREE.MeshBasicMaterial({ color: 0xff3877 }),
    ];

    // 4.1 Centro Financeiro — Arranha-céus carregados dos arquivos .GLB (bldg_stepped, bldg_cylinder, bldg_pyramid, bldg_modern)
    const bldgGlbNames = ['bldg_stepped.glb', 'bldg_cylinder.glb', 'bldg_pyramid.glb', 'bldg_modern.glb'];
    const blockCenters = [-270, -90, 90, 270];
    let bIndex = 0;
    for (const bx of blockCenters) {
      for (const bz of blockCenters) {
        const by = terrainHeight(bx, bz);
        const blockPad = new THREE.Mesh(
          new THREE.BoxGeometry(156, 0.28, 156),
          new THREE.MeshStandardMaterial({ map: tex.sidewalk, roughness: 0.72 }),
        );
        blockPad.position.set(bx, by + 0.14, bz);
        blockPad.receiveShadow = true;
        this.scene.add(blockPad);

        const subOffsets: [number, number][] = [[-42, -42], [42, -42], [-42, 42], [42, 42]];
        for (const [ox, oz] of subOffsets) {
          const x = bx + ox;
          const z = bz + oz;
          if (Math.hypot(x, z) < 58) continue;

          bIndex++;
          const y = terrainHeight(x, z);
          const h = 34 + Math.floor(rnd() * 96);
          const w = 26 + Math.floor(rnd() * 14);
          const d = 26 + Math.floor(rnd() * 14);
          const mat = this.facadeMaterials[bIndex % this.facadeMaterials.length];
          const glbName = bldgGlbNames[bIndex % bldgGlbNames.length];
          const cachedBldg = getCachedGlb(glbName);

          if (cachedBldg) {
            const bldg = cachedBldg.clone(true);
            bldg.position.set(x, y, z);
            bldg.scale.set(w, h, d);
            bldg.traverse((node) => {
              if (node instanceof THREE.Mesh) {
                node.castShadow = true;
                node.receiveShadow = true;
                if (node.material?.name === 'Facade') node.material = mat;
              }
            });
            this.scene.add(bldg);
          } else {
            const tower = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
            tower.position.set(x, y + h / 2, z);
            tower.castShadow = true;
            this.scene.add(tower);
          }

          const neonBand = new THREE.Mesh(
            new THREE.BoxGeometry(w + 0.5, 0.85, d + 0.5),
            neonMats[bIndex % neonMats.length],
          );
          neonBand.position.set(x, y + h * 0.88, z);
          this.scene.add(neonBand);

          this.addCollider(x, y + h / 2, z, w, h, d);
        }
      }
    }

    // 4.2 Região Residencial (Vila Aurora) — Casas carregadas de bldg_house.glb
    const houseColors = [0xe6d7c3, 0xf2ebe1, 0xcad6e2, 0xe3b5a4, 0xc8e0c5, 0xf0d8a8];
    const tileRoofMat = new THREE.MeshStandardMaterial({ map: tex.roofTile, roughness: 0.75 });
    const woodMat = new THREE.MeshStandardMaterial({ map: tex.woodDeck, roughness: 0.8 });
    const cachedHouse = getCachedGlb('bldg_house.glb');

    for (let x = -330; x <= 330; x += 64) {
      for (let z = -535; z >= -920; z -= 64) {
        if (nearestRoad(x, z, 20)) continue;
        const y = terrainHeight(x, z);
        const hMat = new THREE.MeshStandardMaterial({
          color: houseColors[Math.floor(rnd() * houseColors.length)],
          roughness: 0.82,
        });
        const w = 13 + rnd() * 6;
        const d = 11 + rnd() * 5;
        const h = rnd() > 0.45 ? 7.6 : 4.6;

        if (cachedHouse) {
          const hc = cachedHouse.clone(true);
          hc.position.set(x, y, z);
          hc.scale.set(w, h, d);
          hc.traverse((node) => {
            if (node instanceof THREE.Mesh) {
              node.castShadow = true;
              node.receiveShadow = true;
              if (node.material?.name === 'Facade') node.material = hMat;
              else if (node.material?.name === 'Roof') node.material = tileRoofMat;
            }
          });
          this.scene.add(hc);
        } else {
          const house = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), hMat);
          house.position.set(x, y + h / 2, z);
          this.scene.add(house);
        }
        this.addCollider(x, y + h / 2, z, w, h, d);
      }
    }

    // 4.3 Colinas de Luxo — Mansões carregadas de bldg_mansion.glb
    const cachedMansion = getCachedGlb('bldg_mansion.glb');
    const mansionSpots: [number, number][] = [[-540, -560], [-610, -680], [-560, -820], [-650, -890]];
    for (const [mx, mz] of mansionSpots) {
      const y = terrainHeight(mx, mz);
      if (cachedMansion) {
        const mc = cachedMansion.clone(true);
        mc.position.set(mx, y, mz);
        mc.traverse((node) => { if (node instanceof THREE.Mesh) node.castShadow = true; });
        this.scene.add(mc);
      }
      this.addCollider(mx, y + 5, mz, 26, 10, 16);
    }

    // 4.4 Praia Dourada — Resorts Costeiros (bldg_modern.glb com fachada Hotel), Marina e Farol (prop_lighthouse.glb)
    const cachedModern = getCachedGlb('bldg_modern.glb');
    for (let z = -300; z <= 480; z += 120) {
      const hx = -715;
      const hy = terrainHeight(hx, z);
      const hh = 38 + (Math.abs(z) % 3) * 10;
      const hotelMat = this.facadeMaterials[z % 240 === 0 ? 6 : 7];
      if (cachedModern) {
        const hm = cachedModern.clone(true);
        hm.position.set(hx, hy, z);
        hm.scale.set(28, hh, 22);
        hm.traverse((node) => {
          if (node instanceof THREE.Mesh) {
            node.castShadow = true;
            if (node.material?.name === 'Facade') node.material = hotelMat;
          }
        });
        this.scene.add(hm);
      }
      this.addCollider(hx, hy + hh / 2, z, 28, hh, 22);
    }

    const pier = new THREE.Mesh(new THREE.BoxGeometry(78, 1.3, 15), woodMat);
    pier.position.set(-885, WATER_LEVEL + 1.2, 515);
    pier.receiveShadow = true;
    this.scene.add(pier);

    const farolIsland = ISLANDS[0];
    const fy = terrainHeight(farolIsland.x, farolIsland.z);
    const cachedLighthouse = getCachedGlb('prop_lighthouse.glb');
    if (cachedLighthouse) {
      const lh = cachedLighthouse.clone(true);
      lh.position.set(farolIsland.x, fy, farolIsland.z);
      this.scene.add(lh);
    }

    // 4.5 Zona Rural — Fazendas e Silos carregados de bldg_barn.glb
    const cachedBarn = getCachedGlb('bldg_barn.glb');
    const farms: [number, number][] = [[710, -760], [825, -820], [960, -640], [780, -1080]];
    for (const [fx, fz] of farms) {
      const y = terrainHeight(fx, fz);
      if (cachedBarn) {
        const bc = cachedBarn.clone(true);
        bc.position.set(fx, y, fz);
        bc.traverse((node) => { if (node instanceof THREE.Mesh) node.castShadow = true; });
        this.scene.add(bc);
      }
      this.addCollider(fx, y + 5, fz, 22, 10, 14);
    }

    // 4.6 Porto Industrial — Galpões Metálicos, Contêineres Empilhados e Guindastes Portuários
    const warehouseMat = new THREE.MeshStandardMaterial({ map: tex.corrugatedMetal, metalness: 0.45, roughness: 0.6 });
    const containerColors = [0xc0392b, 0x2471a3, 0x1e8449, 0xd68910];
    for (const wx of [560, 640, 780, 860]) {
      const wy = terrainHeight(wx, 460);
      const wh = new THREE.Mesh(new THREE.BoxGeometry(36, 12.5, 22), warehouseMat);
      wh.position.set(wx, wy + 6.25, 460);
      wh.castShadow = true;
      this.scene.add(wh);
      this.addCollider(wx, wy + 6.25, 460, 36, 12.5, 22);
    }
    for (let i = 0; i < 24; i++) {
      const cx = 540 + (i % 6) * 18;
      const cz = 635 + Math.floor(i / 6) * 9;
      const cy = terrainHeight(cx, cz);
      const cMat = new THREE.MeshStandardMaterial({
        map: tex.corrugatedMetal,
        color: containerColors[i % containerColors.length],
        roughness: 0.55,
      });
      const c1 = new THREE.Mesh(new THREE.BoxGeometry(12, 3.2, 3.2), cMat);
      c1.position.set(cx, cy + 1.6, cz);
      c1.castShadow = true;
      this.scene.add(c1);
      this.addCollider(cx, cy + 1.6, cz, 12, 3.2, 3.2);
      if (i % 2 === 0) {
        const c2 = new THREE.Mesh(new THREE.BoxGeometry(12, 3.2, 3.2), cMat);
        c2.position.set(cx, cy + 4.8, cz);
        c2.castShadow = true;
        this.scene.add(c2);
      }
    }

    // 4.7 Aeroporto Internacional — Pista Sinalizada, Terminal de Vidro, Torre de Controle e Hangares
    const runwayY = terrainHeight(880, -110) + 0.1;
    const runway = new THREE.Mesh(
      new THREE.PlaneGeometry(520, 46),
      this.asphaltMat,
    );
    runway.rotation.x = -Math.PI / 2;
    runway.position.set(880, runwayY, -110);
    runway.receiveShadow = true;
    this.scene.add(runway);

    const addAirportBldg = (ax: number, az: number, aw: number, ah: number, ad: number, m: THREE.Material) => {
      const ay = terrainHeight(ax, az);
      const mesh = new THREE.Mesh(new THREE.BoxGeometry(aw, ah, ad), m);
      mesh.position.set(ax, ay + ah / 2, az);
      mesh.castShadow = true;
      this.scene.add(mesh);
      this.addCollider(ax, ay + ah / 2, az, aw, ah, ad);
    };
    addAirportBldg(740, 95, 92, 16, 32, this.facadeMaterials[0]);
    addAirportBldg(835, 90, 10, 44, 10, this.facadeMaterials[5]);
    addAirportBldg(910, 85, 38, 14, 30, warehouseMat);
    addAirportBldg(970, 85, 38, 14, 30, warehouseMat);
  }

  private buildVegetationAndStreetFurniture() {
    const rnd = mulberry32(9001);

    // 1. Árvores Frondosas / Pinheiros Rurais (Tronco + 2 Copas Escalonadas)
    const trunkGeo = new THREE.CylinderGeometry(0.24, 0.42, 4.6, 8);
    const crownLowerGeo = new THREE.DodecahedronGeometry(2.6, 1);
    const crownUpperGeo = new THREE.DodecahedronGeometry(1.85, 1);
    const trunkMat = new THREE.MeshStandardMaterial({ color: 0x5c3e26, roughness: 0.9 });
    const crownMat = new THREE.MeshStandardMaterial({ color: 0x2b6e32, roughness: 0.78 });

    const treeCount = 380;
    const trunks = new THREE.InstancedMesh(trunkGeo, trunkMat, treeCount);
    const crownsL = new THREE.InstancedMesh(crownLowerGeo, crownMat, treeCount);
    const crownsU = new THREE.InstancedMesh(crownUpperGeo, crownMat, treeCount);
    trunks.castShadow = true;
    crownsL.castShadow = true;

    // 2. Palmeiras Costeiras (Praia Dourada & Avenida Beira-Mar)
    const palmCount = 160;
    const palmTrunkGeo = new THREE.CylinderGeometry(0.16, 0.3, 6.8, 8);
    const palmCrownGeo = new THREE.ConeGeometry(2.9, 1.8, 7);
    const palmCrownMat = new THREE.MeshStandardMaterial({ color: 0x388e3c, roughness: 0.7 });
    const palmTrunks = new THREE.InstancedMesh(palmTrunkGeo, trunkMat, palmCount);
    const palmCrowns = new THREE.InstancedMesh(palmCrownGeo, palmCrownMat, palmCount);
    palmTrunks.castShadow = true;
    palmCrowns.castShadow = true;

    const dummy = new THREE.Object3D();
    let tPlaced = 0;
    let pPlaced = 0;
    let attempts = 0;

    while ((tPlaced < treeCount || pPlaced < palmCount) && attempts < 4200) {
      attempts++;
      const x = (rnd() - 0.5) * (WORLD_SIZE - 240);
      const z = (rnd() - 0.5) * (WORLD_SIZE - 240);
      const y = terrainHeight(x, z);
      if (y < 1.1) continue;
      const reg = regionAt(x, z);
      if (reg === 'downtown' || reg === 'industrial' || reg === 'airport') continue;
      if (nearestRoad(x, z, 17)) continue;

      const s = 0.82 + rnd() * 0.65;
      if ((reg === 'beach' || reg === 'island') && pPlaced < palmCount) {
        dummy.position.set(x, y + 3.2 * s, z);
        dummy.rotation.set((rnd() - 0.5) * 0.14, rnd() * Math.PI * 2, (rnd() - 0.5) * 0.14);
        dummy.scale.set(s, s, s);
        dummy.updateMatrix();
        palmTrunks.setMatrixAt(pPlaced, dummy.matrix);

        dummy.position.set(x, y + 6.5 * s, z);
        dummy.scale.set(s * 1.2, s * 0.7, s * 1.2);
        dummy.updateMatrix();
        palmCrowns.setMatrixAt(pPlaced, dummy.matrix);
        pPlaced++;
      } else if (tPlaced < treeCount) {
        dummy.rotation.set(0, rnd() * Math.PI * 2, 0);
        dummy.position.set(x, y + 2.2 * s, z);
        dummy.scale.set(s, s, s);
        dummy.updateMatrix();
        trunks.setMatrixAt(tPlaced, dummy.matrix);

        dummy.position.set(x, y + 4.8 * s, z);
        dummy.scale.set(s * 1.15, s * 0.88, s * 1.15);
        dummy.updateMatrix();
        crownsL.setMatrixAt(tPlaced, dummy.matrix);

        dummy.position.set(x, y + 6.6 * s, z);
        dummy.scale.set(s * 0.9, s * 0.95, s * 0.9);
        dummy.updateMatrix();
        crownsU.setMatrixAt(tPlaced, dummy.matrix);
        tPlaced++;
      }
    }

    trunks.count = tPlaced;
    crownsL.count = tPlaced;
    crownsU.count = tPlaced;
    palmTrunks.count = pPlaced;
    palmCrowns.count = pPlaced;
    this.scene.add(trunks, crownsL, crownsU, palmTrunks, palmCrowns);

    // 3. Postes de Iluminação Urbana ao longo das Avenidas
    const net = getRoadNetwork();
    const poleGeo = new THREE.CylinderGeometry(0.09, 0.13, 7.2, 8);
    const poleMat = new THREE.MeshStandardMaterial({ color: 0x282e38, metalness: 0.7, roughness: 0.35 });
    const lampGeo = new THREE.BoxGeometry(0.75, 0.18, 0.35);
    const lampMat = new THREE.MeshStandardMaterial({ color: 0xfff3cc, emissive: 0xffd27d, emissiveIntensity: 2.2 });

    const maxPoles = 260;
    const poles = new THREE.InstancedMesh(poleGeo, poleMat, maxPoles);
    const lamps = new THREE.InstancedMesh(lampGeo, lampMat, maxPoles);
    let poleIdx = 0;

    for (const e of net.edges) {
      if ((e.type !== 'avenue' && e.type !== 'street') || poleIdx >= maxPoles) continue;
      for (let i = 1; i < e.pts.length - 1; i += 4) {
        if (poleIdx >= maxPoles) break;
        const p = e.pts[i];
        const px = p[0] + e.width / 2 + 1.2;
        const pz = p[2];
        const py = terrainHeight(px, pz);

        dummy.rotation.set(0, 0, 0);
        dummy.scale.set(1, 1, 1);
        dummy.position.set(px, py + 3.6, pz);
        dummy.updateMatrix();
        poles.setMatrixAt(poleIdx, dummy.matrix);

        dummy.position.set(px - 0.3, py + 7.2, pz);
        dummy.updateMatrix();
        lamps.setMatrixAt(poleIdx, dummy.matrix);
        poleIdx++;
      }
    }
    poles.count = poleIdx;
    lamps.count = poleIdx;
    this.scene.add(poles, lamps);
  }

  private buildWorldMarkers() {
    const ringGeo = new THREE.CylinderGeometry(2.6, 2.6, 2.4, 24, 1, true);
    const ringMat = new THREE.MeshBasicMaterial({
      color: 0xf5b942,
      transparent: true,
      opacity: 0.55,
      side: THREE.DoubleSide,
    });

    for (const m of MISSIONS) {
      const y = terrainHeight(m.giver.x, m.giver.z);
      const mesh = new THREE.Mesh(ringGeo, ringMat.clone());
      mesh.position.set(m.giver.x, y + 1.2, m.giver.z);
      this.scene.add(mesh);
      this.missionRings.set(m.id, mesh);
    }

    const shopGeo = new THREE.CylinderGeometry(1.8, 1.8, 1.8, 20, 1, true);
    const shopMat = new THREE.MeshBasicMaterial({
      color: 0x2de2e6,
      transparent: true,
      opacity: 0.5,
      side: THREE.DoubleSide,
    });

    for (const poi of POIS) {
      if (poi.kind === 'landmark') continue;
      const y = terrainHeight(poi.x, poi.z);
      const mesh = new THREE.Mesh(shopGeo, shopMat);
      mesh.position.set(poi.x, y + 0.9, poi.z);
      this.scene.add(mesh);
    }

    const propGeo = new THREE.CylinderGeometry(1.9, 1.9, 1.8, 20, 1, true);
    const propMat = new THREE.MeshBasicMaterial({
      color: 0x38e54d,
      transparent: true,
      opacity: 0.5,
      side: THREE.DoubleSide,
    });
    for (const pr of PROPERTIES) {
      const y = terrainHeight(pr.x, pr.z);
      const mesh = new THREE.Mesh(propGeo, propMat);
      mesh.position.set(pr.x, y + 0.9, pr.z);
      this.scene.add(mesh);
    }
  }

  setActiveCheckpoint(cp: { x: number; z: number; r: number } | null) {
    if (this.activeCheckpointMesh) {
      this.scene.remove(this.activeCheckpointMesh);
      this.activeCheckpointMesh = null;
    }
    if (!cp) return;
    const y = Math.max(WATER_LEVEL, terrainHeight(cp.x, cp.z));
    const geo = new THREE.CylinderGeometry(cp.r, cp.r, 15, 28, 1, true);
    const mat = new THREE.MeshBasicMaterial({
      color: 0x38e54d,
      transparent: true,
      opacity: 0.45,
      side: THREE.DoubleSide,
    });
    this.activeCheckpointMesh = new THREE.Mesh(geo, mat);
    this.activeCheckpointMesh.position.set(cp.x, y + 7.5, cp.z);
    this.scene.add(this.activeCheckpointMesh);
  }

  setGpsRoute(pts: [number, number, number][]) {
    if (this.gpsLine) {
      this.scene.remove(this.gpsLine);
      this.gpsLine.geometry.dispose();
      this.gpsLine = null;
    }
    if (pts.length < 2) return;
    const vectors = pts.map(([x, y, z]) => new THREE.Vector3(x, Math.max(y, terrainHeight(x, z)) + 0.55, z));
    const geo = new THREE.BufferGeometry().setFromPoints(vectors);
    const mat = new THREE.LineBasicMaterial({ color: 0x2de2e6, linewidth: 3 });
    this.gpsLine = new THREE.Line(geo, mat);
    this.scene.add(this.gpsLine);
  }

  private buildRealisticWeatherAndHeli() {
    // 1. Traços de Chuva Realistas (LineSegments inclinados pelo vento)
    const dropCount = 1600;
    const streakPos = new Float32Array(dropCount * 6);
    for (let i = 0; i < dropCount; i++) {
      const x = (Math.random() - 0.5) * 140;
      const y = Math.random() * 55;
      const z = (Math.random() - 0.5) * 140;
      const b = i * 6;
      streakPos[b] = x;
      streakPos[b + 1] = y;
      streakPos[b + 2] = z;
      streakPos[b + 3] = x + 0.35;
      streakPos[b + 4] = y - 2.3;
      streakPos[b + 5] = z + 0.2;
    }
    const streakGeo = new THREE.BufferGeometry();
    streakGeo.setAttribute('position', new THREE.BufferAttribute(streakPos, 3));
    const streakMat = new THREE.LineBasicMaterial({
      color: 0xc8e2ff,
      transparent: true,
      opacity: 0.55,
    });
    this.rainStreaks = new THREE.LineSegments(streakGeo, streakMat);
    this.rainStreaks.visible = false;
    this.rainStreaks.frustumCulled = false;
    this.scene.add(this.rainStreaks);

    // 2. Respingos de Chuva no Chão (Rain Splashes)
    const splashCount = 350;
    const splashPos = new Float32Array(splashCount * 3);
    for (let i = 0; i < splashCount; i++) {
      splashPos[i * 3] = (Math.random() - 0.5) * 80;
      splashPos[i * 3 + 1] = Math.random() * 0.4;
      splashPos[i * 3 + 2] = (Math.random() - 0.5) * 80;
    }
    const splashGeo = new THREE.BufferGeometry();
    splashGeo.setAttribute('position', new THREE.BufferAttribute(splashPos, 3));
    const splashMat = new THREE.PointsMaterial({
      color: 0xe6f4ff,
      size: 0.32,
      transparent: true,
      opacity: 0.72,
    });
    this.rainSplashes = new THREE.Points(splashGeo, splashMat);
    this.rainSplashes.visible = false;
    this.rainSplashes.frustumCulled = false;
    this.scene.add(this.rainSplashes);

    // 3. Helicóptero Detalhado Sobrevoando a Costa (carregado de prop_helicopter.glb)
    this.helicopterGroup = new THREE.Group();
    const cachedHeli = getCachedGlb('prop_helicopter.glb');
    if (cachedHeli) {
      this.helicopterGroup.add(cachedHeli.clone(true));
    } else {
      const hMat = new THREE.MeshPhysicalMaterial({ color: 0x192536, metalness: 0.75, roughness: 0.2, clearcoat: 1 });
      const fuselage = new THREE.Mesh(new THREE.CapsuleGeometry(1.15, 3.2, 8, 14), hMat);
      fuselage.rotation.x = Math.PI / 2;
      this.helicopterGroup.add(fuselage);
    }
    const rotor = new THREE.Mesh(
      new THREE.BoxGeometry(10.2, 0.07, 0.36),
      new THREE.MeshStandardMaterial({ color: 0x111111 }),
    );
    rotor.position.set(0, 1.38, 0);
    this.heliRotor = rotor;
    this.helicopterGroup.add(rotor);
    this.helicopterGroup.position.set(-720, 88, 120);
    this.scene.add(this.helicopterGroup);
  }

  update(dt: number, hour: number, weather: Weather, focusPos: THREE.Vector3) {
    this.time += dt;

    // Animação do oceano
    this.waterMesh.position.y = WATER_LEVEL + Math.sin(this.time * 1.7) * 0.16;

    // Helicóptero costeiro
    const hAngle = this.time * 0.07;
    const hx = -640 + Math.cos(hAngle) * 260;
    const hz = 120 + Math.sin(hAngle) * 340;
    this.helicopterGroup.position.set(hx, 86 + Math.sin(this.time * 0.9) * 3, hz);
    this.helicopterGroup.rotation.y = -hAngle;
    this.heliRotor.rotation.y += dt * 20;

    // Ciclo Dia & Noite + Janelas Iluminadas à Noite
    const dayAngle = ((hour - 6) / 24) * Math.PI * 2;
    const sunY = Math.sin(dayAngle);
    const sunXZ = Math.cos(dayAngle);

    this.sunLight.position.set(
      focusPos.x + sunXZ * 260,
      Math.max(32, sunY * 390),
      focusPos.z + 140,
    );
    this.sunLight.target.position.copy(focusPos);
    this.sunLight.target.updateMatrixWorld();

    const daylight = THREE.MathUtils.clamp((sunY + 0.18) / 0.85, 0.08, 1);
    const nightFactor = 1 - daylight;

    // Acende as janelas dos prédios à noite / entardecer
    for (const fm of this.facadeMaterials) {
      fm.emissiveIntensity = 0.12 + nightFactor * 1.15;
    }

    // Asfalto molhado e reflexivo na chuva/tempestade
    const isRaining = weather === 'rain' || weather === 'storm';
    if (this.asphaltMat) {
      this.asphaltMat.roughness = isRaining ? 0.22 : 0.78;
      this.asphaltMat.metalness = isRaining ? 0.55 : 0.12;
    }

    // Relâmpagos ocasionais durante tempestade
    if (weather === 'storm' && Math.random() < dt * 0.18) {
      this.lightningFlash = 1.0;
    }
    if (this.lightningFlash > 0) {
      this.lightningFlash = Math.max(0, this.lightningFlash - dt * 4.5);
    }

    this.sunLight.intensity =
      daylight * (weather === 'storm' ? 0.55 : weather === 'rain' ? 0.72 : 1.75) +
      this.lightningFlash * 2.5;
    this.hemiLight.intensity = 0.28 + daylight * 0.58 + this.lightningFlash * 0.8;

    const skyColor = new THREE.Color();
    if (this.lightningFlash > 0.4) {
      skyColor.setHex(0xdceeff);
    } else if (weather === 'storm') {
      skyColor.setHex(daylight > 0.3 ? 0x2c3645 : 0x0b1019);
    } else if (weather === 'rain') {
      skyColor.setHex(daylight > 0.3 ? 0x4b5d70 : 0x0f1724);
    } else if (weather === 'fog') {
      skyColor.setHex(daylight > 0.3 ? 0x9fb0c2 : 0x1c2530);
    } else if (sunY > 0.25) {
      skyColor.setHex(0x63a4e8);
    } else if (sunY > -0.14) {
      // Golden Hour / Pôr do Sol Cinematográfico
      skyColor.setHex(0xe07a4b);
    } else {
      skyColor.setHex(0x060c18);
    }

    this.scene.background = skyColor;
    if (this.scene.fog instanceof THREE.FogExp2) {
      this.scene.fog.color.copy(skyColor);
      this.scene.fog.density =
        weather === 'fog' ? 0.0028 : weather === 'storm' ? 0.0013 : weather === 'rain' ? 0.00085 : 0.00044;
    }

    // Atualiza Traços de Chuva Realistas e Respingos no Solo
    this.rainStreaks.visible = isRaining;
    this.rainSplashes.visible = isRaining;
    if (isRaining) {
      this.rainStreaks.position.set(focusPos.x, focusPos.y, focusPos.z);
      const windX = weather === 'storm' ? 0.65 : 0.3;
      const dropLen = weather === 'storm' ? 2.8 : 2.1;
      const fallSpeed = weather === 'storm' ? 54 : 42;

      const sPos = this.rainStreaks.geometry.attributes.position as THREE.BufferAttribute;
      for (let i = 0; i < sPos.count; i += 2) {
        let x = sPos.getX(i) + windX * dt * 12;
        let y = sPos.getY(i) - fallSpeed * dt;
        const z = sPos.getZ(i);
        if (y < -4) {
          y = 52;
          x = (Math.random() - 0.5) * 140;
        }
        sPos.setXYZ(i, x, y, z);
        sPos.setXYZ(i + 1, x + windX, y - dropLen, z + 0.15);
      }
      sPos.needsUpdate = true;

      this.rainSplashes.position.set(focusPos.x, focusPos.y + 0.12, focusPos.z);
      const pPos = this.rainSplashes.geometry.attributes.position as THREE.BufferAttribute;
      for (let i = 0; i < pPos.count; i++) {
        let py = pPos.getY(i) + dt * 2.2;
        if (py > 0.45) {
          py = 0;
          pPos.setX(i, (Math.random() - 0.5) * 75);
          pPos.setZ(i, (Math.random() - 0.5) * 75);
        }
        pPos.setY(i, py);
      }
      pPos.needsUpdate = true;
    }
  }
}
