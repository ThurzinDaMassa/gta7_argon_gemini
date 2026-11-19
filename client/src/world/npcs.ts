import * as THREE from 'three';
import {
  getRoadNetwork, terrainHeight, mulberry32, DEFAULT_APPEARANCE, VEHICLES,
  type RoadEdge,
} from '../../../shared/src';
import { buildHumanoid, animateHumanoid, buildVehicleMesh, type HumanoidRig, type VehicleRig } from './models';

/* ===================================================================
 * Cidade Viva: Pedestres NPC, Trânsito Autônomo por Malha Viária e
 * Unidades Policiais de Perseguição (1 a 5 estrelas)
 * =================================================================== */

interface PedestrianNPC {
  rig: HumanoidRig;
  x: number;
  y: number;
  z: number;
  yaw: number;
  speed: number;
  state: 'walk' | 'flee' | 'wait';
  timer: number;
}

interface TrafficCar {
  rig: VehicleRig;
  edge: RoadEdge;
  ptIdx: number;
  t: number;
  speed: number;
  x: number;
  y: number;
  z: number;
  yaw: number;
}

interface PoliceUnit {
  rig: VehicleRig;
  x: number;
  y: number;
  z: number;
  yaw: number;
  speed: number;
  active: boolean;
}

export class NpcTrafficSystem {
  scene: THREE.Scene;
  peds: PedestrianNPC[] = [];
  traffic: TrafficCar[] = [];
  policeUnits: PoliceUnit[] = [];
  private rnd = mulberry32(4242);
  private signalPhase = 0;

  constructor(scene: THREE.Scene) {
    this.scene = scene;
  }

  init(maxPeds = 36, maxTraffic = 22) {
    const net = getRoadNetwork();
    const urbanEdges = net.edges.filter((e) => e.type === 'avenue' || e.type === 'street');

    // Pedestres nas calçadas
    for (let i = 0; i < maxPeds; i++) {
      const edge = urbanEdges[Math.floor(this.rnd() * urbanEdges.length)];
      const pt = edge.pts[Math.floor(this.rnd() * edge.pts.length)];
      const side = this.rnd() > 0.5 ? 1 : -1;
      const offset = edge.width / 2 + 2.2;
      const x = pt[0] + side * offset;
      const z = pt[2] + side * offset;
      const y = terrainHeight(x, z);

      const app = {
        ...DEFAULT_APPEARANCE,
        body: this.rnd() > 0.5 ? ('masc' as const) : ('fem' as const),
        skin: Math.floor(this.rnd() * 8),
        topColor: Math.floor(this.rnd() * 12),
        legsColor: Math.floor(this.rnd() * 12),
        hair: Math.floor(this.rnd() * 6),
      };
      const rig = buildHumanoid(app);
      rig.root.position.set(x, y, z);
      this.scene.add(rig.root);
      this.peds.push({
        rig,
        x, y, z,
        yaw: this.rnd() * Math.PI * 2,
        speed: 1.5 + this.rnd() * 0.8,
        state: 'walk',
        timer: 4 + this.rnd() * 8,
      });
    }

    // Trânsito IA seguindo segmentos da malha viária
    const trafficModels = ['brisa', 'aurelia', 'trilha', 'taxi', 'raio', 'furgao', 'saudade'];
    for (let i = 0; i < maxTraffic; i++) {
      const edge = net.edges[Math.floor(this.rnd() * net.edges.length)];
      if (edge.pts.length < 2) continue;
      const model = trafficModels[Math.floor(this.rnd() * trafficModels.length)];
      const def = VEHICLES[model];
      const color = def.colors[Math.floor(this.rnd() * def.colors.length)];
      const rig = buildVehicleMesh(model, color);
      const ptIdx = Math.floor(this.rnd() * (edge.pts.length - 1));
      const p = edge.pts[ptIdx];
      rig.root.position.set(p[0], p[1], p[2]);
      this.scene.add(rig.root);

      this.traffic.push({
        rig,
        edge,
        ptIdx,
        t: 0,
        speed: edge.speed * (0.65 + this.rnd() * 0.35),
        x: p[0], y: p[1], z: p[2], yaw: 0,
      });
    }

    // Pool de 3 viaturas policiais de resposta tática
    for (let i = 0; i < 3; i++) {
      const rig = buildVehicleMesh('police', 0xf2f2f2);
      rig.root.visible = false;
      this.scene.add(rig.root);
      this.policeUnits.push({
        rig,
        x: 0, y: 2, z: 0, yaw: 0, speed: 0, active: false,
      });
    }
  }

  alertDangerNear(x: number, z: number, radius = 35) {
    for (const ped of this.peds) {
      if (Math.hypot(ped.x - x, ped.z - z) < radius) {
        ped.state = 'flee';
        ped.timer = 8;
        ped.yaw = Math.atan2(ped.x - x, ped.z - z);
      }
    }
  }

  update(
    dt: number,
    playerPos: THREE.Vector3,
    wantedLevel: number,
    onPoliceSpotted?: () => void,
    onPoliceArrest?: () => void,
  ): boolean {
    this.signalPhase = (this.signalPhase + dt) % 16;
    const redLight = this.signalPhase > 10;
    const net = getRoadNetwork();

    // Atualizar Pedestres (culling de atualização acima de 260m)
    for (const ped of this.peds) {
      const dist = Math.hypot(ped.x - playerPos.x, ped.z - playerPos.z);
      ped.rig.root.visible = dist < 240;
      if (!ped.rig.root.visible) continue;

      ped.timer -= dt;
      if (ped.timer <= 0) {
        ped.state = 'walk';
        ped.yaw += (this.rnd() - 0.5) * 2.2;
        ped.timer = 4 + this.rnd() * 7;
      }

      const spd = ped.state === 'flee' ? ped.speed * 2.4 : ped.speed;
      const nx = ped.x + Math.sin(ped.yaw) * spd * dt;
      const nz = ped.z + Math.cos(ped.yaw) * spd * dt;
      const ny = terrainHeight(nx, nz);

      if (ny < 0.7) {
        ped.yaw += Math.PI;
      } else {
        ped.x = nx;
        ped.z = nz;
        ped.y = ny;
      }

      ped.rig.root.position.set(ped.x, ped.y, ped.z);
      ped.rig.root.rotation.y = ped.yaw;
      animateHumanoid(ped.rig, ped.state === 'flee' ? 'run' : 'walk', dt);
    }

    // Atualizar Trânsito IA
    for (const car of this.traffic) {
      const distToPlayer = Math.hypot(car.x - playerPos.x, car.z - playerPos.z);
      car.rig.root.visible = distToPlayer < 360;

      const a = car.edge.pts[car.ptIdx];
      const b = car.edge.pts[car.ptIdx + 1];
      if (!a || !b) {
        car.ptIdx = 0;
        continue;
      }

      const segLen = Math.hypot(b[0] - a[0], b[2] - a[2]) || 1;
      const nearEnd = car.ptIdx >= car.edge.pts.length - 2;
      const endNode = net.nodes[car.edge.b];

      // Freia em semáforo vermelho ou se o jogador estiver bem na frente
      const playerAhead = distToPlayer < 9;
      const stopForSignal = nearEnd && endNode?.signal && redLight;

      const curSpeed = playerAhead || stopForSignal ? 0 : car.speed;
      car.t += (curSpeed * dt) / segLen;

      if (car.t >= 1) {
        car.t = 0;
        car.ptIdx++;
        if (car.ptIdx >= car.edge.pts.length - 1) {
          // Escolhe próxima rua conectada
          const node = net.nodes[car.edge.b];
          const nextEdgeId = node.edges[Math.floor(this.rnd() * node.edges.length)];
          car.edge = net.edges[nextEdgeId] ?? car.edge;
          car.ptIdx = 0;
        }
      }

      const p0 = car.edge.pts[car.ptIdx];
      const p1 = car.edge.pts[Math.min(car.edge.pts.length - 1, car.ptIdx + 1)];
      const dx = p1[0] - p0[0];
      const dz = p1[2] - p0[2];
      const len = Math.hypot(dx, dz) || 1;
      // Deslocamento para faixa da direita
      const rightX = -dz / len;
      const rightZ = dx / len;
      const laneOffset = Math.min(3.2, car.edge.width * 0.22);

      car.x = p0[0] + dx * car.t + rightX * laneOffset;
      car.z = p0[2] + dz * car.t + rightZ * laneOffset;
      car.y = terrainHeight(car.x, car.z);
      car.yaw = Math.atan2(dx, dz);

      car.rig.root.position.set(car.x, car.y, car.z);
      car.rig.root.rotation.y = car.yaw;
      for (const w of car.rig.wheels) w.rotation.x += curSpeed * dt * 2.2;
    }

    // Atualizar Polícia e Perseguição (1 a 5 estrelas)
    let spotted = false;
    const activeNeeded = wantedLevel <= 0 ? 0 : Math.min(3, Math.ceil(wantedLevel * 0.7));

    for (let i = 0; i < this.policeUnits.length; i++) {
      const u = this.policeUnits[i];
      if (i >= activeNeeded) {
        u.active = false;
        u.rig.root.visible = false;
        continue;
      }

      const dist = Math.hypot(u.x - playerPos.x, u.z - playerPos.z);
      if (!u.active || dist > 220) {
        const ang = (i * Math.PI * 2) / 3 + Math.random() * 0.5;
        const spawnR = 65 + i * 18;
        u.x = playerPos.x + Math.cos(ang) * spawnR;
        u.z = playerPos.z + Math.sin(ang) * spawnR;
        u.y = Math.max(1, terrainHeight(u.x, u.z));
        u.active = true;
        u.rig.root.visible = true;
      }

      const dx = playerPos.x - u.x;
      const dz = playerPos.z - u.z;
      const d = Math.hypot(dx, dz) || 1;
      u.yaw = Math.atan2(dx, dz);

      const targetSpeed = d > 9 ? 18 + wantedLevel * 3.5 : 0;
      u.speed += (targetSpeed - u.speed) * Math.min(1, dt * 4);
      u.x += (dx / d) * u.speed * dt;
      u.z += (dz / d) * u.speed * dt;
      u.y = Math.max(0.5, terrainHeight(u.x, u.z));

      u.rig.root.position.set(u.x, u.y, u.z);
      u.rig.root.rotation.y = u.yaw;

      if (d < 85) {
        spotted = true;
        onPoliceSpotted?.();
      }
      if (wantedLevel === 1 && d < 3.4) {
        onPoliceArrest?.();
      }
    }

    return spotted;
  }
}
