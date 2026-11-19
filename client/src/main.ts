import * as THREE from 'three';
import RAPIER from '@dimforge/rapier3d-compat';
import {
  EV, WEAPONS, VEHICLES, DEALER_STOCK, SHOP_ITEMS, PROPERTIES, MISSIONS, MISSION_MAP, POIS,
  CUSTOMS, PAINT_COLORS, WATER_LEVEL, WORLD_HALF, CLIENT_SEND_HZ, DEFAULT_APPEARANCE,
  terrainHeight, regionAt, REGION_NAMES, nearestRoad, findRoute,
  type Appearance, type RoomSummary, type RoomDetail, type NetPlayer, type NetVehicle,
  type Snapshot, type AnimState, type Weather, type ShopItem,
} from '../../shared/src';
import { NetworkClient } from './net/network';
import { SoundEngine } from './audio/sound';
import { CostaAuroraWorld } from './world/city';
import {
  buildHumanoid, animateHumanoid, attachWeaponVisual, triggerMuzzleFlash, buildVehicleMesh, preloadAllGlbModels,
  type HumanoidRig, type VehicleRig,
} from './world/models';
import { NpcTrafficSystem } from './world/npcs';
import { ParticleSystem } from './world/particles';
import { MapRenderer } from './ui/map';

/* ===================================================================
 * GTA 7 ONLINE — Costa Aurora: Motor Principal de Jogo & UI Completa
 * - Controles 100% Corrigidos (WASD Relativo à Câmera + Direção A/D Correta)
 * - Câmera de 3ª Pessoa Over-The-Shoulder (OTS) Estilo GTA V com Transição
 *   Suave de FOV, Alinhamento por Raycast e Prevenção de Colisão
 * - Roda Radial de Armas (Segurar Q) + Muzzle Flash + Cápsulas + Faíscas
 * - Sistema de Partículas InstancedMesh + Chuva Realista + Seletor Climático
 * =================================================================== */

interface KeyBinds {
  forward: string;
  back: string;
  left: string;
  right: string;
  jump: string;
  sprint: string;
  crouch: string;
  interact: string;
  reload: string;
  camera: string;
  lights: string;
  horn: string;
  radio: string;
}

const DEFAULT_BINDS: KeyBinds = {
  forward: 'KeyW',
  back: 'KeyS',
  left: 'KeyA',
  right: 'KeyD',
  jump: 'Space',
  sprint: 'ShiftLeft',
  crouch: 'KeyC',
  interact: 'KeyE',
  reload: 'KeyR',
  camera: 'KeyV',
  lights: 'KeyH',
  horn: 'KeyF',
  radio: 'KeyG',
};

const MENU_SCENES = [
  { name: 'Costa Aurora — Vista Aérea', pos: [210, 145, 290], look: [0, 22, 0], radius: 75, speed: 0.14 },
  { name: 'Avenida Central — Superesportivos', pos: [18, 9, 95], look: [0, 6, 0], radius: 14, speed: 0.25 },
  { name: 'Praia Dourada — Pôr do Sol', pos: [-825, 16, 160], look: [-720, 12, 80], radius: 28, speed: 0.16 },
  { name: 'Centro Financeiro — Horizonte', pos: [-160, 72, -160], look: [40, 38, 40], radius: 42, speed: 0.15 },
  { name: 'Vale do Sertão — Zona Rural', pos: [790, 32, -760], look: [830, 14, -820], radius: 34, speed: 0.14 },
  { name: 'Voo Costeiro — Marina & Farol', pos: [-960, 48, 460], look: [-1120, 18, 390], radius: 45, speed: 0.18 },
];

function lerpAngle(a: number, b: number, t: number): number {
  let diff = ((b - a + Math.PI) % (Math.PI * 2)) - Math.PI;
  if (diff < -Math.PI) diff += Math.PI * 2;
  return a + diff * t;
}

class GTA7OnlineGame {
  canvas = document.getElementById('game-canvas') as HTMLCanvasElement;
  renderer!: THREE.WebGLRenderer;
  scene = new THREE.Scene();
  camera = new THREE.PerspectiveCamera(66, window.innerWidth / window.innerHeight, 0.2, 2600);

  rapierWorld!: RAPIER.World;
  world!: CostaAuroraWorld;
  npcs!: NpcTrafficSystem;
  particles!: ParticleSystem;
  net = new NetworkClient();
  sound = new SoundEngine();
  mapRenderer!: MapRenderer;

  mode: 'menu' | 'lobby' | 'playing' = 'menu';
  menuCamIdx = 0;
  menuTimer = 0;

  // Estado da conta e personagem local
  appearance: Appearance = { ...DEFAULT_APPEARANCE };
  balance = 5000;
  room: RoomDetail | null = null;
  isReady = false;

  // Controles e Configurações
  binds: KeyBinds = { ...DEFAULT_BINDS };
  keys = new Set<string>();
  mouseDownLeft = false;
  mouseDownRight = false;
  camYaw = Math.PI; // Olhando para frente inicialmente
  camPitch = 0.18;
  camSmoothPos = new THREE.Vector3(12, 6, 54);
  camSmoothLook = new THREE.Vector3(12, 2, 48);
  camMode: 'third' | 'shoulder' | 'first' | 'cinematic' = 'third';
  graphicsQuality: 'low' | 'medium' | 'high' | 'ultra' = 'high';
  sensitivity = 1.0;
  invertY = false;

  // Estado do Jogador em Jogo
  selfId = '';
  selfRig!: HumanoidRig;
  selfPos = new THREE.Vector3(12, 3, 48);
  selfVel = new THREE.Vector3();
  selfYaw = Math.PI;
  selfAnim: AnimState = 'idle';
  onGround = true;
  isCrouching = false;
  hp = 100;
  armor = 0;
  wanted = 0;
  dead = false;
  seq = 0;
  lastNetSend = 0;
  footstepAcc = 0;

  // Combate, Roda de Armas e Inventário
  weapons = new Set<string>(['fists', 'pistol']);
  ammo = new Map<string, { mag: number; reserve: number }>([['pistol', { mag: 12, reserve: 36 }]]);
  currentWeapon = 'fists';
  lastShotAt = 0;
  reloadingUntil = 0;
  wheelOpen = false;
  tracers: { line: THREE.Line; expire: number }[] = [];

  // Veículos e Sincronização Multiplayer
  currentVehicleId: string | null = null;
  currentSeat = -1;
  remotePlayers = new Map<string, { data: NetPlayer; rig: HumanoidRig; targetPos: THREE.Vector3; targetYaw: number }>();
  lobbyRigs = new Map<string, HumanoidRig>();
  vehicles = new Map<string, { data: NetVehicle; rig: VehicleRig; targetPos: THREE.Vector3; targetQuat: THREE.Quaternion }>();

  // Mundo, Relógio, Clima Manual/Servidor, Missão e GPS
  hour = 9.5;
  weather: Weather = 'clear';
  weatherOverride: Weather | null = null;
  hourOverride: number | null = null;
  activeMission: { id: string; index: number; startedAt: number; timeLimit: number; dialog?: string } | null = null;
  gpsRoute: [number, number, number][] = [];
  gpsTarget: [number, number] | null = null;
  nearestInteraction: { label: string; action: () => void } | null = null;

  async init() {
    this.setAssetStatus('Carregando 45 modelos 3D (.GLB Blender) & Rapier 3D...');
    await Promise.all([
      RAPIER.init(),
      preloadAllGlbModels((loaded, total, name) => {
        this.setAssetStatus(`Carregando GLB 3D (${loaded}/${total}): ${name}`);
      }),
    ]);
    this.rapierWorld = new RAPIER.World({ x: 0, y: -9.81, z: 0 });

    this.initRenderer();
    this.world = new CostaAuroraWorld(this.scene);
    this.world.buildAll((msg) => this.setAssetStatus(msg));

    for (const b of this.world.colliders) {
      const desc = RAPIER.RigidBodyDesc.fixed().setTranslation(b.x, b.y, b.z);
      const body = this.rapierWorld.createRigidBody(desc);
      this.rapierWorld.createCollider(RAPIER.ColliderDesc.cuboid(b.hx, b.hy, b.hz), body);
    }

    this.npcs = new NpcTrafficSystem(this.scene);
    this.npcs.init(36, 22);

    this.particles = new ParticleSystem(this.scene);

    this.selfRig = buildHumanoid(this.appearance);
    this.selfRig.root.visible = false;
    this.scene.add(this.selfRig.root);

    this.mapRenderer = new MapRenderer(
      document.getElementById('minimap-canvas') as HTMLCanvasElement,
      document.getElementById('bigmap-canvas') as HTMLCanvasElement,
    );

    this.bindUiEvents();
    this.bindInputEvents();
    this.bindNetworkEvents();

    this.setAssetStatus('Assets 3D PBR & Costa Aurora prontos');
    await this.net.restoreOrGuest();
    this.refreshAuthUi();
    if (this.net.session) {
      await this.loadProfileFromServer();
    }

    let last = performance.now();
    const loop = (now: number) => {
      const dt = Math.min(0.05, (now - last) / 1000);
      last = now;
      this.update(dt);
      this.renderer.render(this.scene, this.camera);
      requestAnimationFrame(loop);
    };
    requestAnimationFrame(loop);
  }

  private initRenderer() {
    this.renderer = new THREE.WebGLRenderer({
      canvas: this.canvas,
      antialias: true,
      powerPreference: 'high-performance',
    });
    this.renderer.setSize(window.innerWidth, window.innerHeight);
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.15;

    window.addEventListener('resize', () => {
      this.camera.aspect = window.innerWidth / window.innerHeight;
      this.camera.updateProjectionMatrix();
      this.renderer.setSize(window.innerWidth, window.innerHeight);
    });
  }

  applyGraphicsQuality(q: 'low' | 'medium' | 'high' | 'ultra') {
    this.graphicsQuality = q;
    const pr = q === 'low' ? 0.85 : q === 'medium' ? 1.0 : q === 'high' ? 1.5 : Math.min(window.devicePixelRatio, 2);
    this.renderer.setPixelRatio(pr);
    this.renderer.shadowMap.enabled = q !== 'low';
    this.camera.far = q === 'low' ? 950 : q === 'medium' ? 1500 : 2600;
    this.camera.updateProjectionMatrix();
  }

  private setAssetStatus(text: string) {
    const el = document.getElementById('asset-text');
    if (el) el.textContent = text;
  }

  private refreshAuthUi() {
    const nameEl = document.getElementById('menu-username')!;
    const btnEl = document.getElementById('btn-open-auth')!;
    if (this.net.session) {
      nameEl.textContent = this.net.session.username;
      btnEl.textContent = 'Perfil / Sair';
    } else {
      nameEl.textContent = 'Visitante (clique para entrar)';
      btnEl.textContent = 'Criar Conta / Login';
    }
  }

  private async loadProfileFromServer() {
    try {
      const p = await this.net.api('GET', '/api/v1/profile');
      if (p.appearance) {
        this.appearance = p.appearance;
        this.rebuildSelfRig();
      }
      if (typeof p.balance === 'number') {
        this.balance = p.balance;
        this.updateHudMoney();
      }
      if (p.settings?.graphics) this.applyGraphicsQuality(p.settings.graphics);
      if (typeof p.settings?.invertY === 'boolean') this.invertY = p.settings.invertY;
    } catch { /* ignore */ }
  }

  private rebuildSelfRig() {
    const pos = this.selfRig.root.position.clone();
    const vis = this.selfRig.root.visible;
    this.scene.remove(this.selfRig.root);
    this.selfRig = buildHumanoid(this.appearance, this.net.session?.username);
    this.selfRig.root.position.copy(pos);
    this.selfRig.root.visible = vis;
    attachWeaponVisual(this.selfRig, this.currentWeapon);
    this.scene.add(this.selfRig.root);
  }

  /* ===================================================================
   * Eventos de Rede (Socket.IO Autoritativo)
   * =================================================================== */
  private bindNetworkEvents() {
    this.net.onStatusChange = (st, text) => {
      const badge = document.getElementById('conn-badge')!;
      const txt = document.getElementById('conn-text')!;
      badge.className = `badge conn-${st}`;
      txt.textContent = text;
    };

    this.net.onWakeupChange = (waking) => {
      document.getElementById('wakeup-banner')?.classList.toggle('hidden', !waking);
    };

    this.net.on(EV.roomState, (detail: RoomDetail) => {
      this.room = detail;
      if (this.mode === 'menu' && detail.status === 'lobby') {
        this.enterLobbyScreen();
      }
      this.renderLobbyState();
    });

    this.net.on(EV.roomKicked, (d: { reason: string }) => {
      this.toast(d.reason || 'Removido da sala', 'warn');
      this.returnToMainMenu();
    });

    this.net.on(EV.roomClose, (d: { reason: string }) => {
      this.toast(d.reason || 'Sala encerrada', 'warn');
      this.returnToMainMenu();
    });

    this.net.on(EV.chatMsg, (m: { from: string; text: string; system?: boolean }) => {
      this.appendChatLine(m.from, m.text, !!m.system);
    });

    this.net.on(EV.emote, (d: { userId: string; emote: AnimState }) => {
      const lRig = this.lobbyRigs.get(d.userId);
      if (lRig) lRig.currentAnim = d.emote;
      const rPl = this.remotePlayers.get(d.userId);
      if (rPl) rPl.data.anim = d.emote;
      if (d.userId === this.selfId) this.selfAnim = d.emote;
    });

    this.net.on(EV.gameStarted, (payload: {
      roomId: string;
      you: NetPlayer;
      snapshot: Snapshot;
      inventory: { weapons: string[]; ammo: Record<string, { mag: number; reserve: number }>; weapon: string };
      mission: { id: string; index: number; startedAt: number } | null;
    }) => {
      this.selfId = payload.you.id;
      this.selfPos.set(payload.you.p[0], payload.you.p[1], payload.you.p[2]);
      this.selfYaw = payload.you.yaw;
      this.camYaw = payload.you.yaw + Math.PI;
      this.camSmoothPos.set(this.selfPos.x, this.selfPos.y + 4, this.selfPos.z + 6);
      this.camSmoothLook.copy(this.selfPos);
      this.hp = payload.you.hp;
      this.armor = payload.you.armor;
      this.wanted = payload.you.wanted;

      this.weapons = new Set(payload.inventory.weapons);
      this.ammo.clear();
      for (const [k, v] of Object.entries(payload.inventory.ammo)) this.ammo.set(k, v);
      this.currentWeapon = payload.inventory.weapon || 'fists';
      attachWeaponVisual(this.selfRig, this.currentWeapon);

      this.enterGameScreen();
      this.applySnapshot(payload.snapshot);
    });

    this.net.on(EV.snapshot, (snap: Snapshot) => {
      if (this.mode === 'playing') this.applySnapshot(snap);
    });

    this.net.on(EV.correct, (c: { p?: [number, number, number]; vehicle?: string; q?: [number, number, number, number] }) => {
      if (c.vehicle && this.currentVehicleId === c.vehicle && c.p) {
        const v = this.vehicles.get(c.vehicle);
        if (v) {
          v.rig.root.position.set(c.p[0], c.p[1], c.p[2]);
          if (c.q) v.rig.root.quaternion.set(c.q[0], c.q[1], c.q[2], c.q[3]);
        }
      } else if (c.p) {
        this.selfPos.set(c.p[0], c.p[1], c.p[2]);
      }
    });

    this.net.on(EV.vehicleEvent, (ev: any) => {
      if (ev.type === 'remove') {
        const v = this.vehicles.get(ev.id);
        if (v) {
          this.scene.remove(v.rig.root);
          this.vehicles.delete(ev.id);
        }
        if (this.currentVehicleId === ev.id) {
          this.currentVehicleId = null;
          this.currentSeat = -1;
        }
      } else if (ev.type === 'playerLeft') {
        const rp = this.remotePlayers.get(ev.userId);
        if (rp) {
          this.scene.remove(rp.rig.root);
          this.remotePlayers.delete(ev.userId);
        }
      } else if (ev.state) {
        this.upsertVehicle(ev.state);
      }
    });

    this.net.on(EV.combatEvent, (ev: any) => {
      if (ev.type === 'shot') {
        const w = WEAPONS[ev.weapon];
        const dist = Math.hypot(ev.origin[0] - this.selfPos.x, ev.origin[2] - this.selfPos.z);
        this.sound.playShot(w?.category ?? 'pistol', dist);
        this.npcs.alertDangerNear(ev.origin[0], ev.origin[2]);
        const rp = this.remotePlayers.get(ev.shooter);
        if (rp) triggerMuzzleFlash(rp.rig);
        for (const d of ev.dirs) {
          const endX = ev.origin[0] + d[0] * Math.min(65, w?.range ?? 60);
          const endY = ev.origin[1] + d[1] * Math.min(65, w?.range ?? 60);
          const endZ = ev.origin[2] + d[2] * Math.min(65, w?.range ?? 60);
          this.spawnTracer(ev.origin, [endX, endY, endZ]);
          this.particles.spawnBulletImpact(endX, Math.max(terrainHeight(endX, endZ), endY), endZ);
        }
      } else if (ev.type === 'explosion') {
        const dist = Math.hypot(ev.p[0] - this.selfPos.x, ev.p[2] - this.selfPos.z);
        this.sound.playExplosion(dist);
        this.particles.spawnExplosion(ev.p[0], ev.p[1], ev.p[2]);
        this.npcs.alertDangerNear(ev.p[0], ev.p[2], 70);
      } else if (ev.type === 'hit') {
        if (ev.target === this.selfId) {
          this.hp = ev.hp;
          this.armor = ev.armor;
          this.flashDamage();
        } else if (ev.attacker === this.selfId) {
          this.showHitmarker();
        }
      } else if (ev.type === 'death') {
        if (ev.victim === this.selfId) {
          this.dead = true;
          this.currentVehicleId = null;
          this.currentSeat = -1;
          document.getElementById('hud-wasted')?.classList.remove('hidden');
        }
      }
    });

    this.net.on(EV.respawn, (d: { p: [number, number, number]; hp: number; armor: number; reason?: string }) => {
      this.dead = false;
      this.selfPos.set(d.p[0], d.p[1], d.p[2]);
      this.selfVel.set(0, 0, 0);
      this.hp = d.hp;
      this.armor = d.armor;
      document.getElementById('hud-wasted')?.classList.add('hidden');
      if (d.reason) this.toast(d.reason, 'info');
    });

    this.net.on(EV.wanted, (d: { level: number; reason?: string }) => {
      this.wanted = d.level;
      this.updateHudWanted();
      if (d.reason) this.toast(`★ ${d.reason}`, 'warn');
    });

    this.net.on(EV.wallet, (d: { balance: number }) => {
      this.balance = d.balance;
      this.updateHudMoney();
    });

    this.net.on(EV.inventory, (d: { weapons: string[]; ammo: Record<string, { mag: number; reserve: number }>; weapon: string }) => {
      this.weapons = new Set(d.weapons);
      this.ammo.clear();
      for (const [k, v] of Object.entries(d.ammo)) this.ammo.set(k, v);
      this.updateHudWeapon();
    });

    this.net.on(EV.missionEvent, (ev: any) => {
      if (ev.type === 'started') {
        const def = MISSION_MAP.get(ev.missionId);
        if (!def) return;
        const cp = def.checkpoints[0];
        this.activeMission = { id: def.id, index: 0, startedAt: Date.now(), timeLimit: ev.timeLimit, dialog: cp.dialog };
        this.world.setActiveCheckpoint(cp);
        this.setGpsTo(cp.x, cp.z);
        this.toast(`Missão iniciada: ${def.name}`);
      } else if (ev.type === 'checkpoint') {
        if (!this.activeMission) return;
        const def = MISSION_MAP.get(this.activeMission.id)!;
        this.activeMission.index = ev.index;
        const cp = def.checkpoints[ev.index];
        this.activeMission.dialog = cp?.dialog;
        this.world.setActiveCheckpoint(cp);
        if (cp) this.setGpsTo(cp.x, cp.z);
      } else if (ev.type === 'completed') {
        this.activeMission = null;
        this.world.setActiveCheckpoint(null);
        this.clearGps();
        this.toast(`Missão Concluída! Recompensa: +$ ${ev.reward}`, 'money');
      } else if (ev.type === 'failed') {
        this.activeMission = null;
        this.world.setActiveCheckpoint(null);
        this.clearGps();
        this.toast(`Missão Falhou: ${ev.reason}`, 'warn');
      }
      this.updateHudMission();
    });
  }

  private applySnapshot(snap: Snapshot) {
    if (this.hourOverride === null) this.hour = snap.clock.hour;
    if (this.weatherOverride === null) this.weather = snap.clock.weather;

    const seenPlayers = new Set<string>();
    for (const np of snap.players) {
      seenPlayers.add(np.id);
      if (np.id === this.selfId) {
        this.hp = np.hp;
        this.armor = np.armor;
        this.wanted = np.wanted;
        continue;
      }
      let rp = this.remotePlayers.get(np.id);
      if (!rp) {
        const rig = buildHumanoid(np.appearance, np.name);
        attachWeaponVisual(rig, np.weapon);
        rig.root.position.set(np.p[0], np.p[1], np.p[2]);
        this.scene.add(rig.root);
        rp = {
          data: np,
          rig,
          targetPos: new THREE.Vector3(np.p[0], np.p[1], np.p[2]),
          targetYaw: np.yaw,
        };
        this.remotePlayers.set(np.id, rp);
      } else {
        if (rp.data.weapon !== np.weapon) attachWeaponVisual(rp.rig, np.weapon);
        rp.data = np;
        rp.targetPos.set(np.p[0], np.p[1], np.p[2]);
        rp.targetYaw = np.yaw;
      }
    }

    for (const [id, rp] of this.remotePlayers) {
      if (!seenPlayers.has(id)) {
        this.scene.remove(rp.rig.root);
        this.remotePlayers.delete(id);
      }
    }

    for (const nv of snap.vehicles) {
      this.upsertVehicle(nv);
    }

    this.updateHudBars();
    this.updateHudWanted();
  }

  private upsertVehicle(nv: NetVehicle) {
    let v = this.vehicles.get(nv.id);
    if (!v) {
      const rig = buildVehicleMesh(nv.model, nv.color);
      rig.root.position.set(nv.p[0], nv.p[1], nv.p[2]);
      rig.root.quaternion.set(nv.q[0], nv.q[1], nv.q[2], nv.q[3]);
      this.scene.add(rig.root);
      v = {
        data: nv,
        rig,
        targetPos: new THREE.Vector3(nv.p[0], nv.p[1], nv.p[2]),
        targetQuat: new THREE.Quaternion(nv.q[0], nv.q[1], nv.q[2], nv.q[3]),
      };
      this.vehicles.set(nv.id, v);
    } else {
      if (v.data.color !== nv.color) v.rig.bodyMat.color.setHex(nv.color);
      v.data = nv;
      if (!(this.currentVehicleId === nv.id && this.currentSeat === 0)) {
        v.targetPos.set(nv.p[0], nv.p[1], nv.p[2]);
        v.targetQuat.set(nv.q[0], nv.q[1], nv.q[2], nv.q[3]);
      }
    }
  }

  /* ===================================================================
   * Loop Principal de Jogo (Movimentação, Veículos, Partículas, Câmera e HUD)
   * =================================================================== */
  private update(dt: number) {
    const now = performance.now();
    for (let i = this.tracers.length - 1; i >= 0; i--) {
      if (now > this.tracers[i].expire) {
        this.scene.remove(this.tracers[i].line);
        this.tracers[i].line.geometry.dispose();
        this.tracers.splice(i, 1);
      }
    }

    this.particles.update(dt);

    const activeHour = this.hourOverride ?? this.hour;
    const activeWeather = this.weatherOverride ?? this.weather;

    if (this.mode === 'menu') {
      this.updateMenuCamera(dt);
      this.world.update(dt, 16.4, 'clear', this.camera.position);
      this.npcs.update(dt, this.camera.position, 0);
      return;
    }

    if (this.mode === 'lobby') {
      this.updateLobby3D(dt);
      this.world.update(dt, 17.5, 'clear', this.camera.position);
      return;
    }

    // Modo Playing
    if (!this.dead) {
      if (this.currentVehicleId) {
        this.updateDriving(dt);
      } else {
        this.updateOnFoot(dt);
      }
    }

    // Disparo automático quando segurando botão esquerdo
    if (this.mouseDownLeft && !this.dead && !this.wheelOpen && document.pointerLockElement === this.canvas) {
      const w = WEAPONS[this.currentWeapon];
      if (w?.auto) this.tryFireWeapon();
    }

    // Interpola jogadores remotos
    for (const rp of this.remotePlayers.values()) {
      if (rp.data.veh) {
        const veh = this.vehicles.get(rp.data.veh);
        if (veh) {
          rp.rig.root.position.copy(veh.rig.root.position);
          rp.rig.root.visible = false;
        }
      } else {
        rp.rig.root.visible = true;
        rp.rig.root.position.lerp(rp.targetPos, Math.min(1, dt * 14));
        rp.rig.root.rotation.y = lerpAngle(rp.rig.root.rotation.y, rp.targetYaw, Math.min(1, dt * 14));
        animateHumanoid(rp.rig, rp.data.anim, dt, rp.data.pitch);
      }
    }

    // Interpola veículos não dirigidos localmente
    for (const v of this.vehicles.values()) {
      if (this.currentVehicleId === v.data.id && this.currentSeat === 0) continue;
      v.rig.root.position.lerp(v.targetPos, Math.min(1, dt * 12));
      v.rig.root.quaternion.slerp(v.targetQuat, Math.min(1, dt * 12));
      for (const w of v.rig.wheels) w.rotation.x += v.data.speed * dt * 2.2;
      if (v.data.health < 400 && Math.random() < dt * 8) {
        this.particles.spawnExhaustOrDamageSmoke(v.rig.root.position.x, v.rig.root.position.y + 0.9, v.rig.root.position.z, true);
      }
    }

    // Atualiza câmera de 3ª pessoa Over-The-Shoulder / Direção
    this.updateGameplayCamera(dt);

    // Atualiza mundo, clima e ciclo dia/noite
    this.world.update(dt, activeHour, activeWeather, this.selfPos);

    // Atualiza NPCs, trânsito e polícia
    const spotted = this.npcs.update(
      dt,
      this.selfPos,
      this.wanted,
      undefined,
      () => void this.net.emit(EV.arrest),
    );

    // Envia estado local ao servidor autoritativo (15 Hz)
    if (now - this.lastNetSend >= 1000 / CLIENT_SEND_HZ) {
      this.lastNetSend = now;
      if (this.currentVehicleId && this.currentSeat === 0) {
        const v = this.vehicles.get(this.currentVehicleId);
        if (v) {
          const p = v.rig.root.position;
          const q = v.rig.root.quaternion;
          this.net.emitFast(EV.vehicleState, {
            id: v.data.id,
            p: [p.x, p.y, p.z],
            q: [q.x, q.y, q.z, q.w],
            v: v.data.v,
            steer: v.data.steer,
            speed: v.data.speed,
            lights: v.data.lights,
            horn: this.keys.has(this.binds.horn),
            siren: v.data.siren,
          });
        }
      } else {
        this.net.emitFast(EV.playerState, {
          seq: ++this.seq,
          p: [this.selfPos.x, this.selfPos.y, this.selfPos.z],
          yaw: this.selfYaw,
          pitch: this.camPitch,
          anim: this.selfAnim,
          weapon: this.currentWeapon,
          spotted,
        });
      }
    }

    this.checkMissionProximity();
    this.scanInteractions();
    this.updateHud();
  }

  private updateMenuCamera(dt: number) {
    this.menuTimer += dt;
    if (this.menuTimer > 12) {
      this.menuTimer = 0;
      this.setMenuCamera((this.menuCamIdx + 1) % MENU_SCENES.length);
    }
    const sc = MENU_SCENES[this.menuCamIdx];
    const ang = this.menuTimer * sc.speed;
    this.camera.position.set(
      sc.pos[0] + Math.cos(ang) * sc.radius,
      sc.pos[1],
      sc.pos[2] + Math.sin(ang) * sc.radius,
    );
    this.camera.lookAt(sc.look[0], sc.look[1], sc.look[2]);
  }

  setMenuCamera(idx: number) {
    this.menuCamIdx = idx;
    this.menuTimer = 0;
    const sc = MENU_SCENES[idx];
    const cap = document.getElementById('scene-caption');
    if (cap) cap.textContent = sc.name;
    document.querySelectorAll('#menu-cam-pills .cam-pill').forEach((btn, i) => {
      btn.classList.toggle('active', i === idx);
    });
  }

  private updateLobby3D(dt: number) {
    this.camera.position.set(0, 4.2, 13.5);
    this.camera.lookAt(0, 2.5, 4);

    if (!this.room) return;
    const list = this.room.playersList;
    const seen = new Set<string>();

    list.forEach((pl, idx) => {
      seen.add(pl.userId);
      let rig = this.lobbyRigs.get(pl.userId);
      if (!rig) {
        rig = buildHumanoid(pl.appearance, pl.username);
        this.scene.add(rig.root);
        this.lobbyRigs.set(pl.userId, rig);
      }
      const spread = (idx - (list.length - 1) / 2) * 1.65;
      const x = spread;
      const z = 4 - Math.abs(spread) * 0.25;
      const y = terrainHeight(x, z) + 0.5;
      rig.root.position.set(x, y, z);
      rig.root.rotation.y = 0;
      animateHumanoid(rig, rig.currentAnim || 'idle', dt);
    });

    for (const [id, rig] of this.lobbyRigs) {
      if (!seen.has(id)) {
        this.scene.remove(rig.root);
        this.lobbyRigs.delete(id);
      }
    }
  }

  private clearLobbyRigs() {
    for (const rig of this.lobbyRigs.values()) this.scene.remove(rig.root);
    this.lobbyRigs.clear();
  }

  /* ===================================================================
   * Movimentação a Pé em 3ª Pessoa (100% Relativa aos Vetores Reais da Câmera!)
   * W = Frente da câmera | S = Trás da câmera | A = Esquerda da câmera | D = Direita da câmera
   * =================================================================== */
  private updateOnFoot(dt: number) {
    this.selfRig.root.visible = this.camMode !== 'first';
    this.sound.updateEngine(false, 0, 1);

    let fwdInput = 0;
    let rightInput = 0;
    if (this.keys.has(this.binds.forward)) fwdInput += 1;
    if (this.keys.has(this.binds.back)) fwdInput -= 1;
    if (this.keys.has(this.binds.right)) rightInput += 1;
    if (this.keys.has(this.binds.left)) rightInput -= 1;

    const moving = fwdInput !== 0 || rightInput !== 0;
    const aiming = this.mouseDownRight || this.mouseDownLeft;
    const sprinting = this.keys.has(this.binds.sprint) && !this.isCrouching && !aiming;
    const groundY = terrainHeight(this.selfPos.x, this.selfPos.z);
    const inWater = groundY < WATER_LEVEL - 0.65 && this.selfPos.y <= WATER_LEVEL + 0.25;

    let speed = this.isCrouching ? 3.3 : sprinting ? 9.6 : aiming ? 4.2 : 6.0;
    if (inWater) speed = sprinting ? 5.2 : 3.6;

    // Extrai o vetor Forward e Right REAIS da câmera projetados no plano horizontal XZ!
    // Isso garante matematicamente que W SEMPRE anda para onde a câmera olha e D SEMPRE anda para a direita da tela.
    const camForward = new THREE.Vector3();
    this.camera.getWorldDirection(camForward);
    camForward.y = 0;
    if (camForward.lengthSq() < 0.0001) camForward.set(0, 0, -1);
    camForward.normalize();

    // Right = camForward × Up(0, 1, 0) = (-camForward.z, 0, camForward.x)
    const camRight = new THREE.Vector3(-camForward.z, 0, camForward.x);

    if (moving) {
      const moveDir = new THREE.Vector3()
        .addScaledVector(camForward, fwdInput)
        .addScaledVector(camRight, rightInput)
        .normalize();

      const targetVx = moveDir.x * speed;
      const targetVz = moveDir.z * speed;
      this.selfVel.x = THREE.MathUtils.lerp(this.selfVel.x, targetVx, Math.min(1, dt * 14));
      this.selfVel.z = THREE.MathUtils.lerp(this.selfVel.z, targetVz, Math.min(1, dt * 14));

      if (!aiming) {
        const targetYaw = Math.atan2(moveDir.x, moveDir.z);
        this.selfYaw = lerpAngle(this.selfYaw, targetYaw, Math.min(1, dt * 14));
      }
    } else {
      this.selfVel.x *= Math.max(0, 1 - dt * 15);
      this.selfVel.z *= Math.max(0, 1 - dt * 15);
    }

    // Quando mirando ou disparando, o personagem gira suavemente para alinhar com a direção da câmera
    if (aiming) {
      const aimYaw = Math.atan2(camForward.x, camForward.z);
      this.selfYaw = lerpAngle(this.selfYaw, aimYaw, Math.min(1, dt * 22));
    }

    // Pulo e Gravidade
    if (inWater) {
      this.selfPos.y = WATER_LEVEL - 0.35;
      this.selfVel.y = 0;
      this.onGround = true;
      if (moving && Math.random() < dt * 8) {
        this.particles.spawnWaterSplash(this.selfPos.x, WATER_LEVEL + 0.05, this.selfPos.z);
      }
    } else {
      if (this.onGround && this.keys.has(this.binds.jump)) {
        this.selfVel.y = 7.6;
        this.onGround = false;
      }
      this.selfVel.y -= 19.6 * dt;
      this.selfPos.y += this.selfVel.y * dt;

      if (this.selfPos.y <= groundY) {
        if (this.selfVel.y < -18) {
          const dmg = Math.round((Math.abs(this.selfVel.y) - 17) * 6);
          if (dmg > 5) void this.net.emit(EV.selfDamage, { amount: dmg, cause: 'fall' });
        }
        this.selfPos.y = groundY;
        this.selfVel.y = 0;
        this.onGround = true;
      }
    }

    // Colisão horizontal contra edifícios
    const nextX = THREE.MathUtils.clamp(this.selfPos.x + this.selfVel.x * dt, -WORLD_HALF + 10, WORLD_HALF - 10);
    const nextZ = THREE.MathUtils.clamp(this.selfPos.z + this.selfVel.z * dt, -WORLD_HALF + 10, WORLD_HALF - 10);
    if (!this.hitsBuilding(nextX, this.selfPos.y + 1, this.selfPos.z, 0.45)) this.selfPos.x = nextX;
    if (!this.hitsBuilding(this.selfPos.x, this.selfPos.y + 1, nextZ, 0.45)) this.selfPos.z = nextZ;

    // Estado de animação
    if (inWater) {
      this.selfAnim = 'swim';
    } else if (!this.onGround) {
      this.selfAnim = this.selfVel.y > 0 ? 'jump' : 'fall';
    } else if (aiming) {
      this.selfAnim = 'aim';
    } else if (moving) {
      this.selfAnim = this.isCrouching ? 'crouchWalk' : sprinting ? 'sprint' : 'run';
      this.footstepAcc += dt * speed;
      if (this.footstepAcc > 2.3) {
        this.footstepAcc = 0;
        const reg = regionAt(this.selfPos.x, this.selfPos.z);
        this.sound.playFootstep(reg === 'beach' ? 'sand' : reg === 'rural' ? 'grass' : 'asphalt');
      }
    } else {
      this.selfAnim = this.isCrouching ? 'crouch' : 'idle';
    }

    this.selfRig.root.position.copy(this.selfPos);
    this.selfRig.root.rotation.y = this.selfYaw;
    animateHumanoid(this.selfRig, this.selfAnim, dt, this.camPitch);
  }

  private hitsBuilding(x: number, y: number, z: number, radius: number): boolean {
    for (const b of this.world.colliders) {
      if (
        Math.abs(x - b.x) < b.hx + radius &&
        Math.abs(z - b.z) < b.hz + radius &&
        Math.abs(y - b.y) < b.hy + 1
      ) {
        return true;
      }
    }
    return false;
  }

  /* ===================================================================
   * Física e Direção de Veículos (A = Esquerda, D = Direita, Body Roll,
   * Fumaça de Drift, Luz de Freio e Auto-Follow da Câmera)
   * =================================================================== */
  private updateDriving(dt: number) {
    const v = this.currentVehicleId ? this.vehicles.get(this.currentVehicleId) : undefined;
    if (!v) {
      this.currentVehicleId = null;
      this.currentSeat = -1;
      return;
    }

    this.selfRig.root.visible = false;
    const def = VEHICLES[v.data.model] ?? VEHICLES.aurelia;

    if (this.currentSeat !== 0) {
      this.selfPos.copy(v.rig.root.position);
      this.sound.updateEngine(true, Math.abs(v.data.speed), def.maxSpeed);
      return;
    }

    const throttle = (this.keys.has(this.binds.forward) ? 1 : 0) - (this.keys.has(this.binds.back) ? 1 : 0);
    // A (+1) vira para a esquerda (aumenta yaw em Three.js), D (-1) vira para a direita (diminui yaw)
    const steerInput = (this.keys.has(this.binds.left) ? 1 : 0) - (this.keys.has(this.binds.right) ? 1 : 0);
    const handbrake = this.keys.has(this.binds.jump);

    let speed = v.data.speed;
    const accel = (def.engine / def.mass) * 3.4;
    const activeWeather = this.weatherOverride ?? this.weather;
    const rainGrip = activeWeather === 'rain' || activeWeather === 'storm' ? 0.76 : 1.0;

    if (throttle > 0) {
      speed += accel * dt;
    } else if (throttle < 0) {
      if (speed > 1) speed -= (def.brake / 11) * dt;
      else speed -= accel * 0.65 * dt;
    } else {
      speed *= Math.max(0, 1 - dt * 1.4);
    }

    if (handbrake) {
      speed *= Math.max(0, 1 - dt * 5.0);
    }

    // Luzes de freio intensas ao frear
    v.rig.tailLightMat.emissiveIntensity = throttle < 0 || handbrake ? 3.2 : 1.0;

    speed = THREE.MathUtils.clamp(speed, -def.maxSpeed * 0.35, def.maxSpeed);
    v.data.speed = speed;

    const steerRate = Math.min(1, Math.abs(speed) / 4) * (def.grip * 0.68 * rainGrip);
    v.data.steer = THREE.MathUtils.lerp(v.data.steer, steerInput * 0.58, Math.min(1, dt * 11));

    const euler = new THREE.Euler().setFromQuaternion(v.rig.root.quaternion, 'YXZ');
    euler.y += v.data.steer * steerRate * Math.sign(speed || 1) * dt * 2.15;

    // Inclinação realista da suspensão/carroceria nas curvas e aceleração (Body Roll & Pitch)
    const targetRoll = -v.data.steer * Math.min(1, Math.abs(speed) / 22) * 0.085;
    const targetPitch = -throttle * 0.032;
    v.rig.bodyGroup.rotation.z = THREE.MathUtils.lerp(v.rig.bodyGroup.rotation.z, targetRoll, Math.min(1, dt * 10));
    v.rig.bodyGroup.rotation.x = THREE.MathUtils.lerp(v.rig.bodyGroup.rotation.x, targetPitch, Math.min(1, dt * 10));

    const forwardX = Math.sin(euler.y);
    const forwardZ = Math.cos(euler.y);
    let nx = v.rig.root.position.x + forwardX * speed * dt;
    let nz = v.rig.root.position.z + forwardZ * speed * dt;

    // Colisão com edifícios + faíscas metálicas
    if (this.hitsBuilding(nx, v.rig.root.position.y + 1, nz, def.width * 0.55)) {
      if (Math.abs(speed) > 8) {
        this.particles.spawnBulletImpact(nx, v.rig.root.position.y + 0.8, nz);
      }
      if (Math.abs(speed) > 12) {
        const dmg = Math.round(Math.abs(speed) * 1.8);
        void this.net.emit(EV.vehicleDamage, { id: v.data.id, amount: dmg });
      }
      speed = -speed * 0.25;
      v.data.speed = speed;
      nx = v.rig.root.position.x;
      nz = v.rig.root.position.z;
    }

    let ny: number;
    if (def.category === 'boat') {
      const ground = terrainHeight(nx, nz);
      if (ground > WATER_LEVEL - 0.15) {
        speed *= 0.5;
        v.data.speed = speed;
      }
      ny = WATER_LEVEL + 0.35 + Math.sin(performance.now() * 0.004) * 0.08;
      if (Math.abs(speed) > 4 && Math.random() < dt * 15) {
        this.particles.spawnWaterSplash(nx - forwardX * (def.length * 0.45), WATER_LEVEL + 0.1, nz - forwardZ * (def.length * 0.45));
      }
    } else {
      ny = Math.max(WATER_LEVEL - 0.4, terrainHeight(nx, nz)) + def.wheelRadius * 0.3;
      // Fumaça nos pneus traseiros durante drift / freio de mão ou curva em alta velocidade
      if ((handbrake && Math.abs(speed) > 6) || (Math.abs(v.data.steer) > 0.38 && Math.abs(speed) > 18)) {
        this.particles.spawnTireSmoke(
          nx - forwardX * (def.length * 0.34),
          ny,
          nz - forwardZ * (def.length * 0.34),
        );
      }
      // Fumaça no motor se o veículo estiver danificado
      if (v.data.health < 450 && Math.random() < dt * 10) {
        this.particles.spawnExhaustOrDamageSmoke(
          nx + forwardX * (def.length * 0.35),
          ny + 0.9,
          nz + forwardZ * (def.length * 0.35),
          v.data.health < 220,
        );
      }
    }

    v.rig.root.position.set(nx, ny, nz);
    v.rig.root.quaternion.setFromEuler(euler);
    v.data.v = [forwardX * speed, 0, forwardZ * speed];

    for (let i = 0; i < v.rig.wheels.length; i++) {
      v.rig.wheels[i].rotation.x += speed * dt * 2.4;
      if (i < 2) v.rig.wheels[i].rotation.y = v.data.steer * 0.75;
    }

    this.selfPos.copy(v.rig.root.position);
    this.selfYaw = euler.y;

    // A câmera acompanha suavemente a traseira do veículo enquanto ele dirige
    if (Math.abs(speed) > 2.5 && !this.mouseDownRight) {
      const desiredCamYaw = euler.y + Math.PI;
      this.camYaw = lerpAngle(this.camYaw, desiredCamYaw, Math.min(1, dt * 2.4));
    }

    this.sound.updateEngine(true, Math.abs(speed), def.maxSpeed);
  }

  /* ===================================================================
   * Câmera de 3ª Pessoa Over-The-Shoulder (OTS) Estilo GTA V
   * - Em exploração livre: câmera ampla centrada com spring damping suave
   * - Ao mirar (Botão Direito): aproxima sobre o ombro direito (+0.62m),
   *   reduz FOV para 52° e alinha a retícula perfeitamente com o raycast
   * =================================================================== */
  private updateGameplayCamera(dt: number) {
    const aiming = this.mouseDownRight && !this.currentVehicleId;

    // Atualiza estado visual da retícula no HUD
    const chEl = document.getElementById('hud-crosshair');
    if (chEl) chEl.classList.toggle('aiming', aiming);

    // Transição suave de Field of View (FOV) ao mirar ou correr em alta velocidade
    const targetFov = aiming ? 50 : this.currentVehicleId ? 72 : 66;
    if (Math.abs(this.camera.fov - targetFov) > 0.1) {
      this.camera.fov = THREE.MathUtils.lerp(this.camera.fov, targetFov, Math.min(1, dt * 12));
      this.camera.updateProjectionMatrix();
    }

    const focus = this.selfPos.clone();
    focus.y += this.currentVehicleId ? 1.55 : this.isCrouching ? 1.18 : 1.52;

    if (this.camMode === 'first') {
      this.camera.position.set(focus.x, focus.y + 0.18, focus.z);
      const lookX = focus.x - Math.sin(this.camYaw) * Math.cos(this.camPitch) * 25;
      const lookY = focus.y + 0.18 - Math.sin(this.camPitch) * 25;
      const lookZ = focus.z - Math.cos(this.camYaw) * Math.cos(this.camPitch) * 25;
      this.camera.lookAt(lookX, lookY, lookZ);
      return;
    }

    const dist = this.currentVehicleId
      ? 7.8
      : aiming
        ? 2.25
        : this.camMode === 'shoulder'
          ? 2.75
          : this.camMode === 'cinematic'
            ? 10.5
            : 4.35;

    const shoulderOffset = this.currentVehicleId
      ? 0
      : aiming
        ? 0.62
        : this.camMode === 'shoulder'
          ? 0.52
          : 0.34;

    // Vetor que vai do personagem para trás (onde a câmera fica)
    const offsetX = Math.sin(this.camYaw) * Math.cos(this.camPitch);
    const offsetY = Math.sin(this.camPitch);
    const offsetZ = Math.cos(this.camYaw) * Math.cos(this.camPitch);

    // Vetor lateral direito da câmera para o deslocamento Over-The-Shoulder
    const rightX = Math.cos(this.camYaw) * shoulderOffset;
    const rightZ = -Math.sin(this.camYaw) * shoulderOffset;

    // Prevenção contra atravessar edifícios
    let safeDist = dist;
    for (let s = 1; s <= 6; s++) {
      const testD = (dist * s) / 6;
      const tx = focus.x + offsetX * testD + rightX;
      const ty = focus.y + offsetY * testD;
      const tz = focus.z + offsetZ * testD + rightZ;
      if (this.hitsBuilding(tx, ty, tz, 0.35)) {
        safeDist = Math.max(1.05, ((s - 1) * dist) / 6);
        break;
      }
    }

    const desiredCamX = focus.x + offsetX * safeDist + rightX;
    const minGround = terrainHeight(desiredCamX, focus.z + offsetZ * safeDist + rightZ) + 0.55;
    const desiredCamY = Math.max(minGround, focus.y + offsetY * safeDist);
    const desiredCamZ = focus.z + offsetZ * safeDist + rightZ;

    // Amortecimento exponencial para eliminar qualquer tremor na câmera
    const camLerp = aiming ? Math.min(1, dt * 26) : Math.min(1, dt * 16);
    this.camSmoothPos.lerp(new THREE.Vector3(desiredCamX, desiredCamY, desiredCamZ), camLerp);
    this.camera.position.copy(this.camSmoothPos);

    // Ponto de mira à frente da câmera
    const targetLook = new THREE.Vector3(
      focus.x - offsetX * 28 + rightX,
      focus.y - offsetY * 28,
      focus.z - offsetZ * 28 + rightZ,
    );
    this.camSmoothLook.lerp(targetLook, camLerp);
    this.camera.lookAt(this.camSmoothLook);
  }

  /* ===================================================================
   * Combate de 3ª Pessoa com Alinhamento Exato à Retícula + Roda de Armas
   * =================================================================== */
  private tryFireWeapon() {
    if (this.dead || this.wheelOpen) return;
    const now = performance.now();
    if (now < this.reloadingUntil) return;
    const def = WEAPONS[this.currentWeapon];
    if (!def) return;
    if (now - this.lastShotAt < 1000 / def.rps) return;

    const ammoState = this.ammo.get(def.id);
    if (def.mag > 0) {
      if (!ammoState || ammoState.mag <= 0) {
        this.reloadWeapon();
        return;
      }
      ammoState.mag--;
      this.updateHudWeapon();
    }

    this.lastShotAt = now;
    this.sound.playShot(def.category, 0);
    triggerMuzzleFlash(this.selfRig);
    this.npcs.alertDangerNear(this.selfPos.x, this.selfPos.z);

    // Animação de expansão da retícula ao atirar
    const chEl = document.getElementById('hud-crosshair');
    if (chEl) {
      chEl.classList.add('firing');
      setTimeout(() => chEl.classList.remove('firing'), 85);
    }

    // Recuo vertical suave na câmera
    this.camPitch = Math.max(-0.85, this.camPitch + def.recoil * 0.28);

    // Gira o personagem imediatamente para a direção do tiro em 3ª pessoa
    const camDir = new THREE.Vector3();
    this.camera.getWorldDirection(camDir);
    this.selfYaw = Math.atan2(camDir.x, camDir.z);

    // Posição real da boca do cano (ou ombro direito do jogador)
    const muzzleWorld = new THREE.Vector3();
    this.selfRig.muzzleFlash.getWorldPosition(muzzleWorld);
    const origin: [number, number, number] = [
      this.selfPos.x + Math.sin(this.selfYaw) * 0.35,
      this.selfPos.y + 1.38,
      this.selfPos.z + Math.cos(this.selfYaw) * 0.35,
    ];

    // Ejeta cápsula de munição para a direita
    if (def.mag > 0) {
      this.particles.spawnShellCasing(
        origin[0],
        origin[1],
        origin[2],
        Math.cos(this.selfYaw),
        -Math.sin(this.selfYaw),
      );
    }

    // Ponto focal onde o centro da câmera mira (convergência 3ª pessoa -> retícula)
    const aimTarget = new THREE.Vector3()
      .copy(this.camera.position)
      .addScaledVector(camDir, Math.min(80, def.range));

    const baseShotDir = new THREE.Vector3(
      aimTarget.x - origin[0],
      aimTarget.y - origin[1],
      aimTarget.z - origin[2],
    ).normalize();

    const dirs: [number, number, number][] = [];
    const pellets = Math.max(1, def.pellets);
    const spreadFactor = this.mouseDownRight ? def.spread * 0.55 : def.spread;

    for (let i = 0; i < pellets; i++) {
      const dx = baseShotDir.x + (Math.random() - 0.5) * spreadFactor;
      const dy = baseShotDir.y + (Math.random() - 0.5) * spreadFactor;
      const dz = baseShotDir.z + (Math.random() - 0.5) * spreadFactor;
      const len = Math.hypot(dx, dy, dz) || 1;
      const dir: [number, number, number] = [dx / len, dy / len, dz / len];
      dirs.push(dir);
      if (def.category !== 'melee') {
        const hitDist = Math.min(70, def.range);
        const endPt: [number, number, number] = [
          origin[0] + dir[0] * hitDist,
          origin[1] + dir[1] * hitDist,
          origin[2] + dir[2] * hitDist,
        ];
        this.spawnTracer([muzzleWorld.x, muzzleWorld.y, muzzleWorld.z], endPt);
        this.particles.spawnBulletImpact(
          endPt[0],
          Math.max(terrainHeight(endPt[0], endPt[2]), endPt[1]),
          endPt[2],
        );
      }
    }

    const impact: [number, number, number] | undefined =
      def.id === 'launcher' || def.category === 'throwable'
        ? [
            origin[0] + baseShotDir.x * 26,
            Math.max(terrainHeight(origin[0] + baseShotDir.x * 26, origin[2] + baseShotDir.z * 26), origin[1] + baseShotDir.y * 26),
            origin[2] + baseShotDir.z * 26,
          ]
        : undefined;

    void this.net.emit(EV.fire, { weapon: def.id, origin, dirs, impact }).then((res) => {
      if (res.ok && res.data?.ammo) {
        this.ammo.set(def.id, res.data.ammo);
        this.updateHudWeapon();
      }
      if (res.ok && res.data?.hits?.length) {
        this.showHitmarker();
      }
    });
  }

  private openWeaponWheel() {
    if (this.wheelOpen || this.mode !== 'playing') return;
    this.wheelOpen = true;
    if (document.pointerLockElement) document.exitPointerLock();

    const wheel = document.getElementById('weapon-wheel')!;
    const slotsEl = document.getElementById('wheel-slots')!;
    slotsEl.innerHTML = '';

    const list = [...this.weapons];
    const radius = 132;
    list.forEach((wid, idx) => {
      const def = WEAPONS[wid];
      if (!def) return;
      const angle = (idx / Math.max(1, list.length)) * Math.PI * 2 - Math.PI / 2;
      const x = 190 + Math.cos(angle) * radius;
      const y = 190 + Math.sin(angle) * radius;

      const btn = document.createElement('button');
      btn.className = `wheel-slot ${wid === this.currentWeapon ? 'active' : ''}`;
      btn.style.left = `${x}px`;
      btn.style.top = `${y}px`;
      const a = this.ammo.get(wid);
      const ammoStr = def.mag > 0 ? `${(a?.mag ?? 0) + (a?.reserve ?? 0)}` : '∞';
      btn.innerHTML = `<span>${def.name}</span><small style="color:#f5b942">${ammoStr}</small>`;

      btn.onmouseenter = () => {
        document.getElementById('wheel-sel-name')!.textContent = def.name;
        document.getElementById('wheel-sel-ammo')!.textContent = `Dano: ${def.damage} • Munição: ${ammoStr}`;
      };
      btn.onclick = () => {
        this.selectWeapon(wid);
        this.closeWeaponWheel();
      };
      slotsEl.appendChild(btn);
    });

    const curDef = WEAPONS[this.currentWeapon] ?? WEAPONS.fists;
    document.getElementById('wheel-sel-name')!.textContent = curDef.name;
    document.getElementById('wheel-sel-ammo')!.textContent = curDef.category.toUpperCase();
    wheel.classList.remove('hidden');
  }

  private closeWeaponWheel() {
    if (!this.wheelOpen) return;
    this.wheelOpen = false;
    document.getElementById('weapon-wheel')!.classList.add('hidden');
  }

  private reloadWeapon() {
    const def = WEAPONS[this.currentWeapon];
    if (!def || def.mag <= 0) return;
    const a = this.ammo.get(def.id);
    if (!a || a.mag >= def.mag || a.reserve <= 0) return;
    this.reloadingUntil = performance.now() + def.reload * 1000;
    this.toast(`Recarregando ${def.name}...`);
    void this.net.emit(EV.reload).then((res) => {
      if (res.ok && res.data) {
        this.ammo.set(def.id, res.data);
        this.updateHudWeapon();
      }
    });
  }

  private cycleWeapon(step = 1) {
    const list = [...this.weapons];
    if (list.length <= 1) return;
    const idx = list.indexOf(this.currentWeapon);
    const next = list[(idx + step + list.length) % list.length];
    this.selectWeapon(next);
  }

  selectWeapon(weaponId: string) {
    if (!this.weapons.has(weaponId)) return;
    this.currentWeapon = weaponId;
    attachWeaponVisual(this.selfRig, weaponId);
    this.updateHudWeapon();
    void this.net.emit(EV.selectWeapon, { weapon: weaponId });
  }

  private spawnTracer(a: [number, number, number], b: [number, number, number]) {
    const geo = new THREE.BufferGeometry().setFromPoints([
      new THREE.Vector3(a[0], a[1], a[2]),
      new THREE.Vector3(b[0], b[1], b[2]),
    ]);
    const mat = new THREE.LineBasicMaterial({ color: 0xffe47a, transparent: true, opacity: 0.9 });
    const line = new THREE.Line(geo, mat);
    this.scene.add(line);
    this.tracers.push({ line, expire: performance.now() + 85 });
  }

  /* ===================================================================
   * Interações Contextuais com o Mundo (Veículos, Lojas, Missões, Imóveis)
   * =================================================================== */
  private scanInteractions() {
    const promptEl = document.getElementById('hud-prompt')!;
    if (this.currentVehicleId) {
      this.nearestInteraction = {
        label: '[E] Sair do Veículo • [G] Rádio • [H] Farol • [Espaço] Drift/Freio de Mão',
        action: () => void this.exitVehicle(),
      };
      const customs = POIS.find((p) => p.kind === 'customs' && Math.hypot(p.x - this.selfPos.x, p.z - this.selfPos.z) < 22);
      if (customs) {
        this.nearestInteraction = {
          label: `[E] Abrir ${customs.name} (Personalizar/Reparar)`,
          action: () => void this.openCustomsModal(),
        };
      }
      promptEl.textContent = this.nearestInteraction.label;
      promptEl.classList.remove('hidden');
      return;
    }

    this.nearestInteraction = null;

    if (!this.activeMission) {
      for (const m of MISSIONS) {
        const d = Math.hypot(m.giver.x - this.selfPos.x, m.giver.z - this.selfPos.z);
        if (d < 12) {
          this.nearestInteraction = {
            label: `[E] Iniciar Missão: ${m.name} (+$ ${m.reward})`,
            action: () => void this.startMission(m.id),
          };
          break;
        }
      }
    }

    if (!this.nearestInteraction) {
      for (const poi of POIS) {
        const d = Math.hypot(poi.x - this.selfPos.x, poi.z - this.selfPos.z);
        if (d < 16) {
          if (poi.kind === 'gunshop' || poi.kind === 'store' || poi.kind === 'restaurant' || poi.kind === 'gas') {
            this.nearestInteraction = {
              label: `[E] Entrar em ${poi.name}`,
              action: () => this.openShopModal(poi.kind, poi.name),
            };
            break;
          } else if (poi.kind === 'dealer' || poi.kind === 'marina') {
            this.nearestInteraction = {
              label: `[E] Abrir Concessionária ${poi.name}`,
              action: () => this.openDealerModal(poi.kind === 'marina'),
            };
            break;
          } else if (poi.kind === 'clothes') {
            this.nearestInteraction = {
              label: `[E] Personalizar Roupas em ${poi.name}`,
              action: () => this.openCharacterModal(),
            };
            break;
          }
        }
      }
    }

    if (!this.nearestInteraction) {
      for (const pr of PROPERTIES) {
        const d = Math.hypot(pr.x - this.selfPos.x, pr.z - this.selfPos.z);
        if (d < 16) {
          this.nearestInteraction = {
            label: `[E] Imóvel: ${pr.name} ($ ${pr.price.toLocaleString('pt-BR')})`,
            action: () => void this.openPropertiesModal(pr.id),
          };
          break;
        }
      }
    }

    if (!this.nearestInteraction) {
      let bestVeh: { id: string; name: string; d: number } | null = null;
      for (const v of this.vehicles.values()) {
        if (v.data.health <= 0) continue;
        const d = v.rig.root.position.distanceTo(this.selfPos);
        const def = VEHICLES[v.data.model];
        if (d < (def?.length ?? 4) / 2 + 2.8 && (!bestVeh || d < bestVeh.d)) {
          bestVeh = { id: v.data.id, name: def?.name ?? v.data.model, d };
        }
      }
      if (bestVeh) {
        const vid = bestVeh.id;
        this.nearestInteraction = {
          label: `[E] Entrar em ${bestVeh.name}`,
          action: () => void this.enterVehicle(vid),
        };
      }
    }

    if (this.nearestInteraction) {
      promptEl.textContent = this.nearestInteraction.label;
      promptEl.classList.remove('hidden');
    } else {
      promptEl.classList.add('hidden');
    }
  }

  private async enterVehicle(id: string) {
    const res = await this.net.emit<{ id: string; seat: number; vehicle: NetVehicle }>(EV.vehicleEnter, { id, seat: -1 });
    if (!res.ok) {
      this.toast(res.error, 'warn');
      return;
    }
    this.currentVehicleId = res.data.id;
    this.currentSeat = res.data.seat;
    this.upsertVehicle(res.data.vehicle);
  }

  private async exitVehicle() {
    const res = await this.net.emit<{ p: [number, number, number] }>(EV.vehicleExit);
    this.currentVehicleId = null;
    this.currentSeat = -1;
    if (res.ok && res.data?.p) {
      this.selfPos.set(res.data.p[0], res.data.p[1], res.data.p[2]);
    }
  }

  private async startMission(missionId: string) {
    const res = await this.net.emit(EV.missionStart, { missionId });
    if (!res.ok) this.toast(res.error, 'warn');
  }

  private checkMissionProximity() {
    if (!this.activeMission) return;
    const def = MISSION_MAP.get(this.activeMission.id);
    if (!def) return;
    const cp = def.checkpoints[this.activeMission.index];
    if (!cp) return;
    const d = Math.hypot(this.selfPos.x - cp.x, this.selfPos.z - cp.z);
    if (d <= cp.r + 2) {
      const idx = this.activeMission.index;
      this.activeMission.index = -1;
      void this.net.emit(EV.missionCheckpoint, { missionId: def.id, index: idx }).then((r) => {
        if (!r.ok && this.activeMission) {
          this.activeMission.index = idx;
          this.toast(r.error, 'warn');
        }
      });
    }
  }

  setGpsTo(tx: number, tz: number) {
    this.gpsTarget = [tx, tz];
    this.gpsRoute = findRoute(this.selfPos.x, this.selfPos.z, tx, tz);
    this.world.setGpsRoute(this.gpsRoute);
  }

  clearGps() {
    this.gpsTarget = null;
    this.gpsRoute = [];
    this.world.setGpsRoute([]);
  }

  /* ===================================================================
   * Atualização de HUD e Minimapa Radar Rotativo
   * =================================================================== */
  private updateHud() {
    this.updateHudBars();
    this.updateHudWeapon();

    const activeHour = this.hourOverride ?? this.hour;
    const activeWeather = this.weatherOverride ?? this.weather;

    const reg = regionAt(this.selfPos.x, this.selfPos.z);
    document.getElementById('hud-region')!.textContent = REGION_NAMES[reg];
    const road = nearestRoad(this.selfPos.x, this.selfPos.z, 32);
    const hInt = Math.floor(activeHour);
    const mInt = Math.floor((activeHour - hInt) * 60);
    const clockStr = `${String(hInt).padStart(2, '0')}:${String(mInt).padStart(2, '0')}`;
    const wLabel = { clear: 'Sol', cloudy: 'Nublado', rain: 'Chuva', storm: 'Tempestade', fog: 'Neblina' }[activeWeather];
    document.getElementById('hud-street')!.textContent = `${road?.edge.name ?? 'Costa Aurora'} • ${clockStr} • ${wLabel}`;

    const gpsEl = document.getElementById('hud-gps-dist')!;
    if (this.gpsTarget) {
      const d = Math.round(Math.hypot(this.gpsTarget[0] - this.selfPos.x, this.gpsTarget[1] - this.selfPos.z));
      gpsEl.textContent = `GPS: ${d} m`;
      gpsEl.classList.remove('hidden');
      if (d < 14) this.clearGps();
    } else {
      gpsEl.classList.add('hidden');
    }

    // Velocímetro Digital + RPM
    const speedo = document.getElementById('hud-speedo')!;
    if (this.currentVehicleId) {
      const v = this.vehicles.get(this.currentVehicleId);
      if (v) {
        speedo.classList.remove('hidden');
        const def = VEHICLES[v.data.model] ?? VEHICLES.aurelia;
        const kmh = Math.round(Math.abs(v.data.speed) * 3.6);
        document.getElementById('hud-speed-val')!.textContent = String(kmh);
        document.getElementById('hud-veh-name')!.textContent = def.name;
        const gearNum = Math.min(6, 1 + Math.floor(kmh / 32));
        const gear = v.data.speed < -0.5 ? 'R' : kmh < 2 ? 'N' : `D${gearNum}`;
        document.getElementById('hud-veh-gear')!.textContent = gear;
        document.getElementById('hud-veh-hp')!.textContent = `${Math.round(v.data.health / 10)}%`;
        document.getElementById('hud-radio-station')!.textContent = this.sound.currentStation.name;

        const rpmPct = Math.min(100, Math.max(12, ((kmh % 34) / 34) * 100));
        document.getElementById('hud-rpm-fill')!.style.width = `${rpmPct}%`;
      }
    } else {
      speedo.classList.add('hidden');
    }

    if (this.activeMission) {
      const elapsed = (Date.now() - this.activeMission.startedAt) / 1000;
      const rem = Math.max(0, Math.ceil(this.activeMission.timeLimit - elapsed));
      const mm = String(Math.floor(rem / 60)).padStart(2, '0');
      const ss = String(rem % 60).padStart(2, '0');
      document.getElementById('hud-mission-timer')!.textContent = `${mm}:${ss}`;
    }

    // Minimapa Radar Rotacionado pela Câmera
    const netPlayers = new Map<string, NetPlayer>();
    for (const [id, rp] of this.remotePlayers) netPlayers.set(id, rp.data);
    const netVehicles = new Map<string, NetVehicle>();
    for (const [id, rv] of this.vehicles) netVehicles.set(id, rv.data);
    const cp = this.activeMission ? MISSION_MAP.get(this.activeMission.id)?.checkpoints[this.activeMission.index] ?? null : null;
    this.mapRenderer.drawMinimap(
      this.selfPos,
      this.selfYaw,
      this.camYaw,
      netPlayers,
      netVehicles,
      this.gpsRoute,
      cp,
      this.npcs.policeUnits,
    );
  }

  private updateHudBars() {
    document.getElementById('hud-hp-bar')!.style.width = `${Math.max(0, Math.min(100, this.hp))}%`;
    document.getElementById('hud-armor-bar')!.style.width = `${Math.max(0, Math.min(100, this.armor))}%`;
  }

  private updateHudMoney() {
    document.getElementById('hud-money')!.textContent = `$ ${this.balance.toLocaleString('pt-BR')}`;
  }

  private updateHudWanted() {
    const stars = document.querySelectorAll('#hud-wanted .star');
    stars.forEach((s, i) => s.classList.toggle('active', i < this.wanted));
  }

  private updateHudWeapon() {
    const def = WEAPONS[this.currentWeapon] ?? WEAPONS.fists;
    document.getElementById('hud-weapon-name')!.textContent = def.name;
    if (def.mag <= 0) {
      document.getElementById('hud-weapon-ammo')!.textContent = '∞';
    } else {
      const a = this.ammo.get(def.id) ?? { mag: 0, reserve: 0 };
      document.getElementById('hud-weapon-ammo')!.textContent = `${a.mag} / ${a.reserve}`;
    }
  }

  private updateHudMission() {
    const box = document.getElementById('hud-mission-box')!;
    if (!this.activeMission) {
      box.classList.add('hidden');
      return;
    }
    const def = MISSION_MAP.get(this.activeMission.id);
    if (!def) return;
    box.classList.remove('hidden');
    document.getElementById('hud-mission-title')!.textContent = def.name.toUpperCase();
    const cp = def.checkpoints[this.activeMission.index];
    document.getElementById('hud-mission-obj')!.textContent = cp ? `${cp.label} (${this.activeMission.index + 1}/${def.checkpoints.length})` : def.description;
    const dlg = document.getElementById('hud-mission-dialog')!;
    if (this.activeMission.dialog) {
      dlg.textContent = this.activeMission.dialog;
      dlg.classList.remove('hidden');
    } else {
      dlg.classList.add('hidden');
    }
  }

  private flashDamage() {
    const el = document.getElementById('hud-damage-flash')!;
    el.style.opacity = '1';
    setTimeout(() => { el.style.opacity = '0'; }, 240);
  }

  private showHitmarker() {
    const el = document.getElementById('hud-hitmarker')!;
    el.classList.remove('hidden');
    setTimeout(() => el.classList.add('hidden'), 140);
  }

  toast(text: string, _kind: 'info' | 'warn' | 'money' = 'info') {
    const stack = document.getElementById('hud-toasts')!;
    const item = document.createElement('div');
    item.className = 'toast';
    item.textContent = text;
    stack.appendChild(item);
    setTimeout(() => item.remove(), 4000);
  }

  private appendChatLine(from: string, text: string, system = false) {
    for (const id of ['lobby-chat-log', 'hud-chat-log']) {
      const log = document.getElementById(id);
      if (!log) continue;
      const div = document.createElement('div');
      div.className = `chat-line ${system ? 'sys' : ''}`;
      if (system) {
        div.textContent = `• ${text}`;
      } else {
        const b = document.createElement('b');
        b.textContent = `${from}: `;
        div.appendChild(b);
        div.appendChild(document.createTextNode(text));
      }
      log.appendChild(div);
      log.scrollTop = log.scrollHeight;
    }
  }

  /* ===================================================================
   * Transições de Tela
   * =================================================================== */
  private enterLobbyScreen() {
    this.mode = 'lobby';
    this.sound.stopMenuAmbience();
    document.getElementById('screen-menu')!.classList.add('hidden');
    document.getElementById('screen-hud')!.classList.add('hidden');
    document.getElementById('screen-lobby')!.classList.remove('hidden');
    this.closeModal();
  }

  private enterGameScreen() {
    this.mode = 'playing';
    this.clearLobbyRigs();
    this.sound.stopMenuAmbience();
    document.getElementById('screen-menu')!.classList.add('hidden');
    document.getElementById('screen-lobby')!.classList.add('hidden');
    document.getElementById('screen-hud')!.classList.remove('hidden');
    this.closeModal();
    this.updateHudMoney();
    this.updateHudWeapon();
    this.updateHudWanted();
  }

  private returnToMainMenu() {
    this.mode = 'menu';
    this.room = null;
    this.currentVehicleId = null;
    this.currentSeat = -1;
    this.clearLobbyRigs();
    this.selfRig.root.visible = false;
    this.sound.updateEngine(false, 0, 1);
    if (document.pointerLockElement) document.exitPointerLock();
    document.getElementById('screen-lobby')!.classList.add('hidden');
    document.getElementById('screen-hud')!.classList.add('hidden');
    document.getElementById('screen-menu')!.classList.remove('hidden');
  }

  private renderLobbyState() {
    if (!this.room) return;
    document.getElementById('lobby-room-name')!.textContent = this.room.name;
    document.getElementById('lobby-room-meta')!.textContent =
      `Modo: ${this.room.mode.toUpperCase()} • PvP: ${this.room.pvp ? 'Ativo' : 'Desativado'} • Região: ${this.room.region}`;
    document.getElementById('lobby-invite-code')!.textContent = this.room.code;
    document.getElementById('lobby-count')!.textContent = `${this.room.players}/${this.room.maxPlayers}`;

    const ul = document.getElementById('lobby-players-list')!;
    ul.innerHTML = '';
    const myId = this.net.session?.id;
    const isHost = this.room.playersList.some((p) => p.userId === myId && p.isHost);

    for (const p of this.room.playersList) {
      if (p.userId === myId) this.isReady = p.ready;
      const li = document.createElement('li');
      li.className = 'player-item';
      const statusSpan = p.isHost
        ? '<span class="tag-ready">★ ANFITRIÃO</span>'
        : p.ready
          ? '<span class="tag-ready">✔ PRONTO</span>'
          : '<span class="tag-wait">Aguardando...</span>';
      li.innerHTML = `<span><strong>${p.username}</strong> ${!p.connected ? '(Reconectando)' : ''}</span><div>${statusSpan}</div>`;
      if (isHost && p.userId !== myId) {
        const kickBtn = document.createElement('button');
        kickBtn.className = 'btn-small';
        kickBtn.textContent = 'Expulsar';
        kickBtn.style.marginLeft = '8px';
        kickBtn.onclick = () => void this.net.emit(EV.roomUpdate, { kick: p.userId });
        li.querySelector('div')!.appendChild(kickBtn);
      }
      ul.appendChild(li);
    }

    document.getElementById('host-controls')!.classList.toggle('hidden', !isHost);
    document.getElementById('btn-lobby-start')!.classList.toggle('hidden', !isHost);
    document.getElementById('btn-lobby-ready')!.textContent = this.isReady ? 'DESMARCAR PRONTO' : 'MARCAR PRONTO';
  }

  /* ===================================================================
   * Controles de Teclado e Mouse
   * =================================================================== */
  private bindInputEvents() {
    window.addEventListener('keydown', (e) => {
      if (document.activeElement?.tagName === 'INPUT' || document.activeElement?.tagName === 'SELECT') {
        if (e.code === 'Escape') (document.activeElement as HTMLElement).blur();
        return;
      }

      this.keys.add(e.code);

      if (this.mode !== 'playing') return;

      if (e.code === this.binds.interact) {
        if (this.nearestInteraction) {
          this.sound.playUiClick();
          this.nearestInteraction.action();
        }
      } else if (e.code === this.binds.crouch && !this.currentVehicleId) {
        this.isCrouching = !this.isCrouching;
      } else if (e.code === this.binds.reload) {
        this.reloadWeapon();
      } else if (e.code === this.binds.camera) {
        const order: typeof this.camMode[] = ['third', 'shoulder', 'first', 'cinematic'];
        this.camMode = order[(order.indexOf(this.camMode) + 1) % order.length];
        this.toast(`Câmera: ${this.camMode}`);
      } else if (e.code === this.binds.radio && this.currentVehicleId) {
        const st = this.sound.cycleRadio();
        this.toast(`Rádio: ${st.name}`);
      } else if (e.code === this.binds.lights && this.currentVehicleId) {
        const v = this.vehicles.get(this.currentVehicleId);
        if (v) v.data.lights = !v.data.lights;
      } else if (e.code === this.binds.horn && this.currentVehicleId) {
        this.sound.playHorn();
      } else if (e.code === 'KeyQ' && !e.repeat) {
        this.openWeaponWheel();
      } else if (e.code === 'KeyM') {
        this.toggleFullscreenMap();
      } else if (e.code === 'Tab') {
        e.preventDefault();
        void this.openInventoryAndGarageModal();
      } else if (e.code === 'KeyT') {
        e.preventDefault();
        const form = document.getElementById('hud-chat-form')!;
        form.classList.remove('hidden');
        (document.getElementById('hud-chat-input') as HTMLInputElement).focus();
        if (document.pointerLockElement) document.exitPointerLock();
      } else if (e.code === 'Escape') {
        this.openPauseModal();
      } else if (e.code.startsWith('Digit')) {
        const idx = Number(e.code.replace('Digit', '')) - 1;
        const arr = [...this.weapons];
        if (arr[idx]) this.selectWeapon(arr[idx]);
      }
    });

    window.addEventListener('keyup', (e) => {
      this.keys.delete(e.code);
      if (e.code === 'KeyQ' && this.wheelOpen) {
        this.closeWeaponWheel();
        void this.canvas.requestPointerLock?.();
      }
    });

    this.canvas.addEventListener('mousedown', (e) => {
      this.sound.ensure();
      if (this.mode !== 'playing') return;
      if (this.wheelOpen) {
        this.closeWeaponWheel();
      }
      if (document.pointerLockElement !== this.canvas) {
        void this.canvas.requestPointerLock?.();
        return;
      }
      if (e.button === 0) {
        this.mouseDownLeft = true;
        this.tryFireWeapon();
      } else if (e.button === 2) {
        this.mouseDownRight = true;
      }
    });

    window.addEventListener('mouseup', (e) => {
      if (e.button === 0) this.mouseDownLeft = false;
      if (e.button === 2) this.mouseDownRight = false;
    });

    window.addEventListener('contextmenu', (e) => e.preventDefault());

    window.addEventListener('mousemove', (e) => {
      if (this.mode !== 'playing' || document.pointerLockElement !== this.canvas) return;
      const sens = 0.0022 * this.sensitivity;
      // Movimento horizontal natural (arrastar mouse para direita gira a câmera para a direita)
      this.camYaw -= e.movementX * sens;
      // Movimento vertical natural (arrastar mouse para baixo olha para baixo; invertY opcional)
      const ySign = this.invertY ? -1 : 1;
      this.camPitch = THREE.MathUtils.clamp(this.camPitch + e.movementY * sens * ySign, -0.65, 0.95);
    });

    window.addEventListener('wheel', (e) => {
      if (this.mode === 'playing' && document.pointerLockElement === this.canvas) {
        this.cycleWeapon(e.deltaY > 0 ? 1 : -1);
      }
    });
  }

  /* ===================================================================
   * Eventos dos Botões de Menu, Seletor Climático, Mapa e Modais
   * =================================================================== */
  private bindUiEvents() {
    document.querySelectorAll('#menu-cam-pills .cam-pill').forEach((btn) => {
      btn.addEventListener('click', () => {
        this.sound.playUiClick();
        this.setMenuCamera(Number((btn as HTMLElement).dataset.cam || 0));
      });
    });

    // Seletor rápido de clima e horário no HUD
    document.querySelectorAll('.weather-strip .w-pill').forEach((btn) => {
      btn.addEventListener('click', () => {
        this.sound.playUiClick();
        document.querySelectorAll('.weather-strip .w-pill').forEach((b) => b.classList.remove('active'));
        btn.classList.add('active');
        const preset = (btn as HTMLElement).dataset.weather;
        if (preset === 'clear') {
          this.weatherOverride = 'clear';
          this.hourOverride = 11.5;
        } else if (preset === 'sunset') {
          this.weatherOverride = 'clear';
          this.hourOverride = 18.15;
        } else if (preset === 'night') {
          this.weatherOverride = 'clear';
          this.hourOverride = 23.0;
        } else if (preset === 'rain') {
          this.weatherOverride = 'rain';
          this.hourOverride = 16.5;
        } else if (preset === 'storm') {
          this.weatherOverride = 'storm';
          this.hourOverride = 20.5;
        } else if (preset === 'fog') {
          this.weatherOverride = 'fog';
          this.hourOverride = 7.2;
        }
      });
    });

    document.getElementById('btn-open-auth')!.onclick = () => {
      this.sound.playUiClick();
      this.openAuthModal();
    };

    document.getElementById('btn-play-online')!.onclick = () => {
      this.sound.playUiClick();
      this.ensureAuthThen(() => void this.quickMatch());
    };

    document.getElementById('btn-quick-match')!.onclick = () => {
      this.sound.playUiClick();
      this.ensureAuthThen(() => void this.quickMatch());
    };

    document.getElementById('btn-create-room')!.onclick = () => {
      this.sound.playUiClick();
      this.ensureAuthThen(() => this.openCreateRoomModal());
    };

    document.getElementById('btn-join-room')!.onclick = () => {
      this.sound.playUiClick();
      this.ensureAuthThen(() => void this.openJoinRoomModal());
    };

    document.getElementById('btn-character')!.onclick = () => {
      this.sound.playUiClick();
      this.ensureAuthThen(() => this.openCharacterModal());
    };

    document.getElementById('btn-settings')!.onclick = () => {
      this.sound.playUiClick();
      this.openSettingsModal();
    };

    document.getElementById('btn-controls')!.onclick = () => {
      this.sound.playUiClick();
      this.openControlsModal();
    };

    document.getElementById('btn-credits')!.onclick = () => {
      this.sound.playUiClick();
      this.openCreditsModal();
    };

    document.getElementById('modal-close')!.onclick = () => this.closeModal();

    // Botões do Lobby
    document.getElementById('btn-copy-code')!.onclick = () => {
      if (this.room?.code) {
        void navigator.clipboard?.writeText(this.room.code);
        this.toast(`Código ${this.room.code} copiado!`);
      }
    };

    document.querySelectorAll('#screen-lobby [data-emote]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const emote = (btn as HTMLElement).dataset.emote;
        void this.net.emit(EV.emote, { emote });
      });
    });

    document.getElementById('lobby-host-mode')!.onchange = (e) => {
      void this.net.emit(EV.roomUpdate, { mode: (e.target as HTMLSelectElement).value });
    };

    document.getElementById('lobby-host-pvp')!.onchange = (e) => {
      void this.net.emit(EV.roomUpdate, { pvp: (e.target as HTMLInputElement).checked });
    };

    document.getElementById('lobby-chat-form')!.onsubmit = (e) => {
      e.preventDefault();
      const input = document.getElementById('lobby-chat-input') as HTMLInputElement;
      const text = input.value.trim();
      if (!text) return;
      input.value = '';
      void this.net.emit(EV.chatSend, { text });
    };

    document.getElementById('btn-lobby-leave')!.onclick = async () => {
      await this.net.emit(EV.roomLeave);
      this.returnToMainMenu();
    };

    document.getElementById('btn-lobby-ready')!.onclick = async () => {
      await this.net.emit(EV.roomReady, { ready: !this.isReady });
    };

    document.getElementById('btn-lobby-start')!.onclick = async () => {
      const r = await this.net.emit(EV.roomStart);
      if (!r.ok) this.toast(r.error, 'warn');
    };

    // Botões do HUD em Jogo
    document.getElementById('hud-btn-map')!.onclick = () => this.toggleFullscreenMap();
    document.getElementById('hud-btn-inv')!.onclick = () => void this.openInventoryAndGarageModal();
    document.getElementById('hud-btn-pause')!.onclick = () => this.openPauseModal();

    document.getElementById('hud-chat-form')!.onsubmit = (e) => {
      e.preventDefault();
      const input = document.getElementById('hud-chat-input') as HTMLInputElement;
      const text = input.value.trim();
      input.value = '';
      document.getElementById('hud-chat-form')!.classList.add('hidden');
      if (text) void this.net.emit(EV.chatSend, { text });
    };

    // Mapa em tela cheia com Zoom e Clique GPS
    document.getElementById('btn-close-map')!.onclick = () => this.toggleFullscreenMap(false);
    document.getElementById('btn-clear-gps')!.onclick = () => {
      this.clearGps();
      this.refreshBigMap();
    };
    document.getElementById('btn-zoom-in')!.onclick = () => {
      this.mapRenderer.zoom = Math.min(3.5, this.mapRenderer.zoom * 1.25);
      this.refreshBigMap();
    };
    document.getElementById('btn-zoom-out')!.onclick = () => {
      this.mapRenderer.zoom = Math.max(1.0, this.mapRenderer.zoom / 1.25);
      if (this.mapRenderer.zoom === 1.0) { this.mapRenderer.panX = 0; this.mapRenderer.panZ = 0; }
      this.refreshBigMap();
    };

    const bigCanvas = document.getElementById('bigmap-canvas')!;
    bigCanvas.addEventListener('wheel', (ev) => {
      ev.preventDefault();
      if (ev.deltaY < 0) this.mapRenderer.zoom = Math.min(3.5, this.mapRenderer.zoom * 1.15);
      else this.mapRenderer.zoom = Math.max(1.0, this.mapRenderer.zoom / 1.15);
      this.refreshBigMap();
    });
    bigCanvas.addEventListener('click', (ev) => {
      const [wx, wz] = this.mapRenderer.canvasClickToWorld(ev);
      this.setGpsTo(wx, wz);
      this.refreshBigMap();
      this.toast(`Rota GPS traçada (${Math.round(wx)}, ${Math.round(wz)})`);
    });
  }

  private ensureAuthThen(next: () => void) {
    if (this.net.session) {
      next();
    } else {
      this.openAuthModal(next);
    }
  }

  private async quickMatch() {
    const res = await this.net.emit<RoomDetail>(EV.roomQuick);
    if (!res.ok) {
      this.toast(res.error, 'warn');
      return;
    }
    this.room = res.data;
    if (res.data.status === 'lobby') {
      this.enterLobbyScreen();
      this.renderLobbyState();
    }
  }

  private showModal(title: string, render: (body: HTMLElement) => void) {
    if (document.pointerLockElement) document.exitPointerLock();
    document.getElementById('modal-title')!.textContent = title;
    const body = document.getElementById('modal-body')!;
    body.innerHTML = '';
    render(body);
    document.getElementById('modal-backdrop')!.classList.remove('hidden');
  }

  private closeModal() {
    document.getElementById('modal-backdrop')!.classList.add('hidden');
  }

  private openAuthModal(onSuccess?: () => void) {
    this.showModal(this.net.session ? 'PERFIL DA CONTA' : 'ACESSAR CONTA — GTA 7 ONLINE', (body) => {
      if (this.net.session) {
        body.innerHTML = `
          <div>Conectado como <strong>${this.net.session.username}</strong></div>
          <div>Saldo persistente: <strong style="color:#52f279">$ ${this.balance.toLocaleString('pt-BR')}</strong></div>
          <div style="display:flex;gap:10px;margin-top:10px">
            <button id="m-btn-char" class="btn-primary">Personalizar Personagem</button>
            <button id="m-btn-logout" class="btn-secondary">Sair da Conta (Logout)</button>
          </div>
        `;
        body.querySelector('#m-btn-char')!.addEventListener('click', () => this.openCharacterModal());
        body.querySelector('#m-btn-logout')!.addEventListener('click', async () => {
          await this.net.logout();
          this.refreshAuthUi();
          this.closeModal();
        });
        return;
      }

      body.innerHTML = `
        <div class="sub">Crie uma conta persistente ou faça login. Suas senhas são protegidas com hash Argon2id no servidor.</div>
        <div class="form-row">
          <label>Nome de Usuário (3-20 caracteres, letras/números/_)</label>
          <input id="auth-user" type="text" placeholder="Ex: PilotoAurora" />
        </div>
        <div class="form-row">
          <label>Senha (mínimo 8 caracteres)</label>
          <input id="auth-pass" type="password" placeholder="••••••••" />
        </div>
        <div id="auth-err" style="color:#ff385c;font-size:12.5px"></div>
        <div style="display:flex;gap:10px;margin-top:6px">
          <button id="auth-btn-register" class="btn-primary">Criar Nova Conta</button>
          <button id="auth-btn-login" class="btn-secondary">Fazer Login</button>
        </div>
      `;

      const userIn = body.querySelector('#auth-user') as HTMLInputElement;
      const passIn = body.querySelector('#auth-pass') as HTMLInputElement;
      const errEl = body.querySelector('#auth-err') as HTMLElement;

      const handle = async (mode: 'register' | 'login') => {
        errEl.textContent = '';
        try {
          if (mode === 'register') await this.net.register(userIn.value.trim(), passIn.value);
          else await this.net.login(userIn.value.trim(), passIn.value);
          this.refreshAuthUi();
          await this.loadProfileFromServer();
          this.closeModal();
          onSuccess?.();
        } catch (e: any) {
          errEl.textContent = e.message || 'Falha na autenticação';
        }
      };

      body.querySelector('#auth-btn-register')!.addEventListener('click', () => void handle('register'));
      body.querySelector('#auth-btn-login')!.addEventListener('click', () => void handle('login'));
    });
  }

  private openCreateRoomModal() {
    this.showModal('CRIAR SALA MULTIPLAYER', (body) => {
      body.innerHTML = `
        <div class="form-grid">
          <div class="form-row">
            <label>Nome da Sala</label>
            <input id="cr-name" type="text" value="Costa Aurora #${Math.floor(100 + Math.random() * 900)}" maxlength="32" />
          </div>
          <div class="form-row">
            <label>Máximo de Jogadores (1 a 8)</label>
            <input id="cr-max" type="number" min="1" max="8" value="8" />
          </div>
          <div class="form-row">
            <label>Modo de Jogo</label>
            <select id="cr-mode">
              <option value="freeroam">Mundo Aberto (Freeroam)</option>
              <option value="race">Corrida de Rua</option>
              <option value="coop">Missão Cooperativa</option>
              <option value="deathmatch">Combate PvP</option>
            </select>
          </div>
          <div class="form-row">
            <label>Senha Opcional</label>
            <input id="cr-pass" type="password" placeholder="Deixe vazio para sem senha" />
          </div>
        </div>
        <div class="form-row">
          <label><input id="cr-private" type="checkbox" /> Sala Privada (acesso somente por código de convite)</label>
        </div>
        <div class="form-row">
          <label><input id="cr-pvp" type="checkbox" checked /> Combate PvP Ativado</label>
        </div>
        <div class="form-row">
          <label>Regras da Sala</label>
          <input id="cr-rules" type="text" value="Respeito no chat e direção livre em Costa Aurora" />
        </div>
        <div id="cr-err" style="color:#ff385c;font-size:12px"></div>
        <button id="cr-submit" class="btn-primary">Criar Sala e Ir para o Lobby 3D</button>
      `;

      body.querySelector('#cr-submit')!.addEventListener('click', async () => {
        const payload = {
          name: (body.querySelector('#cr-name') as HTMLInputElement).value,
          maxPlayers: Number((body.querySelector('#cr-max') as HTMLInputElement).value),
          mode: (body.querySelector('#cr-mode') as HTMLSelectElement).value,
          password: (body.querySelector('#cr-pass') as HTMLInputElement).value || undefined,
          isPrivate: (body.querySelector('#cr-private') as HTMLInputElement).checked,
          pvp: (body.querySelector('#cr-pvp') as HTMLInputElement).checked,
          rules: (body.querySelector('#cr-rules') as HTMLInputElement).value,
        };
        const r = await this.net.emit<RoomDetail>(EV.roomCreate, payload);
        if (!r.ok) {
          (body.querySelector('#cr-err') as HTMLElement).textContent = r.error;
          return;
        }
        this.room = r.data;
        this.enterLobbyScreen();
        this.renderLobbyState();
      });
    });
  }

  private async openJoinRoomModal() {
    this.showModal('ENTRAR EM SALA / LISTA DE SERVIDORES', (body) => {
      body.innerHTML = `
        <div class="form-grid">
          <div class="form-row">
            <label>Entrar por Código de Convite (6 dígitos)</label>
            <input id="jr-code" type="text" maxlength="8" placeholder="Ex: A7K9P2" />
          </div>
          <div class="form-row">
            <label>Senha da Sala (se protegida)</label>
            <input id="jr-pass" type="password" placeholder="Opcional" />
          </div>
        </div>
        <div style="display:flex;gap:10px">
          <button id="jr-by-code" class="btn-primary">Entrar com Código</button>
          <button id="jr-refresh" class="btn-secondary">Atualizar Lista</button>
        </div>
        <div id="jr-err" style="color:#ff385c;font-size:12px"></div>
        <h4>Salas Públicas Ativas</h4>
        <div id="jr-list" style="display:flex;flex-direction:column;gap:8px">Carregando salas...</div>
      `;

      const errEl = body.querySelector('#jr-err') as HTMLElement;
      const listEl = body.querySelector('#jr-list') as HTMLElement;

      const loadList = async () => {
        const res = await this.net.emit<RoomSummary[]>(EV.roomList);
        if (!res.ok) {
          listEl.textContent = res.error;
          return;
        }
        if (res.data.length === 0) {
          listEl.innerHTML = `<div class="sub">Nenhuma sala pública listada no momento. Crie uma sala ou clique em Encontrar Partida!</div>`;
          return;
        }
        listEl.innerHTML = '';
        for (const rm of res.data) {
          const row = document.createElement('div');
          row.className = 'player-item';
          row.innerHTML = `
            <div>
              <strong>${rm.name}</strong> ${rm.hasPassword ? '🔒' : ''}
              <div class="sub">Host: ${rm.host} • Modo: ${rm.mode} • Região: ${rm.region} • ~${this.net.latencyMs}ms • Status: ${rm.status}</div>
            </div>
            <div style="display:flex;align-items:center;gap:10px">
              <span>${rm.players}/${rm.maxPlayers}</span>
              <button class="btn-primary">Entrar</button>
            </div>
          `;
          row.querySelector('button')!.onclick = async () => {
            const password = (body.querySelector('#jr-pass') as HTMLInputElement).value || undefined;
            const jr = await this.net.emit<RoomDetail>(EV.roomJoin, { roomId: rm.id, password });
            if (!jr.ok) {
              errEl.textContent = jr.error;
              return;
            }
            this.room = jr.data;
            if (jr.data.status === 'lobby') {
              this.enterLobbyScreen();
              this.renderLobbyState();
            }
          };
          listEl.appendChild(row);
        }
      };

      body.querySelector('#jr-refresh')!.addEventListener('click', () => void loadList());
      body.querySelector('#jr-by-code')!.addEventListener('click', async () => {
        const code = (body.querySelector('#jr-code') as HTMLInputElement).value.trim().toUpperCase();
        const password = (body.querySelector('#jr-pass') as HTMLInputElement).value || undefined;
        const jr = await this.net.emit<RoomDetail>(EV.roomJoin, { code, password });
        if (!jr.ok) {
          errEl.textContent = jr.error;
          return;
        }
        this.room = jr.data;
        if (jr.data.status === 'lobby') {
          this.enterLobbyScreen();
          this.renderLobbyState();
        }
      });

      void loadList();
    });
  }

  private openCharacterModal() {
    this.showModal('PERSONALIZAÇÃO DE PERSONAGEM 3D', (body) => {
      const a = { ...this.appearance };
      body.innerHTML = `
        <div class="form-grid">
          <div class="form-row">
            <label>Biotipo</label>
            <select id="ap-body">
              <option value="masc" ${a.body === 'masc' ? 'selected' : ''}>Masculino</option>
              <option value="fem" ${a.body === 'fem' ? 'selected' : ''}>Feminino</option>
            </select>
          </div>
          <div class="form-row"><label>Tom de Pele (0-7)</label><input id="ap-skin" type="number" min="0" max="7" value="${a.skin}" /></div>
          <div class="form-row"><label>Estilo de Cabelo (0-6)</label><input id="ap-hair" type="number" min="0" max="6" value="${a.hair}" /></div>
          <div class="form-row"><label>Cor do Cabelo (0-7)</label><input id="ap-hairColor" type="number" min="0" max="7" value="${a.hairColor}" /></div>
          <div class="form-row"><label>Cor da Jaqueta/Camisa (0-11)</label><input id="ap-topColor" type="number" min="0" max="11" value="${a.topColor}" /></div>
          <div class="form-row"><label>Cor da Calça (0-11)</label><input id="ap-legsColor" type="number" min="0" max="11" value="${a.legsColor}" /></div>
          <div class="form-row"><label>Cor do Calçado (0-11)</label><input id="ap-shoesColor" type="number" min="0" max="11" value="${a.shoesColor}" /></div>
          <div class="form-row"><label>Acessório (0=Nenhum, 1-2=Óculos, 3-4=Boné)</label><input id="ap-acc" type="number" min="0" max="4" value="${a.accessory}" /></div>
        </div>
        <button id="ap-save" class="btn-primary">Salvar Aparência no Banco de Dados</button>
      `;

      body.querySelector('#ap-save')!.addEventListener('click', async () => {
        const next: Appearance = {
          ...this.appearance,
          body: (body.querySelector('#ap-body') as HTMLSelectElement).value as 'masc' | 'fem',
          skin: Number((body.querySelector('#ap-skin') as HTMLInputElement).value),
          hair: Number((body.querySelector('#ap-hair') as HTMLInputElement).value),
          hairColor: Number((body.querySelector('#ap-hairColor') as HTMLInputElement).value),
          topColor: Number((body.querySelector('#ap-topColor') as HTMLInputElement).value),
          legsColor: Number((body.querySelector('#ap-legsColor') as HTMLInputElement).value),
          shoesColor: Number((body.querySelector('#ap-shoesColor') as HTMLInputElement).value),
          accessory: Number((body.querySelector('#ap-acc') as HTMLInputElement).value),
        };
        try {
          const res = await this.net.api('PUT', '/api/v1/profile/character', { appearance: next });
          this.appearance = res.appearance;
          this.rebuildSelfRig();
          this.toast('Personagem salvo com sucesso!');
          this.closeModal();
        } catch (e: any) {
          this.toast(e.message, 'warn');
        }
      });
    });
  }

  private openShopModal(poiKind: string, shopName: string) {
    this.showModal(shopName.toUpperCase(), (body) => {
      const isGunShop = poiKind === 'gunshop';
      const items: ShopItem[] = Object.values(SHOP_ITEMS).filter((it) =>
        isGunShop ? (it.kind === 'weapon' || it.kind === 'ammo' || it.kind === 'armor') : (it.kind === 'consumable'),
      );

      const grid = document.createElement('div');
      grid.className = 'catalog-grid';

      for (const it of items) {
        const card = document.createElement('div');
        card.className = 'catalog-card';
        card.innerHTML = `
          <div>
            <h4>${it.name}</h4>
            <div class="sub">${it.kind.toUpperCase()} ${it.qty && it.qty > 1 ? `(+${it.qty})` : ''}</div>
          </div>
          <div style="display:flex;justify-content:space-between;align-items:center">
            <span class="price">$ ${it.price.toLocaleString('pt-BR')}</span>
            <button class="btn-small">Comprar</button>
          </div>
        `;
        card.querySelector('button')!.onclick = async () => {
          try {
            const res = await this.net.api('POST', '/api/v1/shop/buy', { itemId: it.id });
            this.balance = res.balance;
            this.updateHudMoney();
            this.toast(`Comprado: ${it.name}!`, 'money');
          } catch (e: any) {
            this.toast(e.message, 'warn');
          }
        };
        grid.appendChild(card);
      }

      body.appendChild(grid);
    });
  }

  private openDealerModal(boatsOnly = false) {
    this.showModal(boatsOnly ? 'MARINA DOURADA — EMBARCAÇÕES' : 'PRESTIGE MOTORS — CONCESSIONÁRIA', (body) => {
      const grid = document.createElement('div');
      grid.className = 'catalog-grid';

      for (const modelId of DEALER_STOCK) {
        const def = VEHICLES[modelId];
        if (boatsOnly && def.category !== 'boat') continue;
        const card = document.createElement('div');
        card.className = 'catalog-card';
        card.innerHTML = `
          <div>
            <h4>${def.brand} ${def.name}</h4>
            <div class="sub">Vel. Máx: ${Math.round(def.maxSpeed * 3.6)} km/h • ${def.seats} lugares • Tração ${def.drive.toUpperCase()}</div>
          </div>
          <div style="display:flex;justify-content:space-between;align-items:center">
            <span class="price">$ ${def.price.toLocaleString('pt-BR')}</span>
            <button class="btn-small">Comprar</button>
          </div>
        `;
        card.querySelector('button')!.onclick = async () => {
          try {
            const res = await this.net.api('POST', '/api/v1/vehicles/buy', { model: def.id, color: def.colors[0] });
            this.balance = res.balance;
            this.updateHudMoney();
            this.toast(`Veículo ${def.name} adquirido! Chame-o na aba Garagem [Tab].`, 'money');
          } catch (e: any) {
            this.toast(e.message, 'warn');
          }
        };
        grid.appendChild(card);
      }
      body.appendChild(grid);
    });
  }

  private async openCustomsModal() {
    const ownedRes = await this.net.api<{ vehicles: any[] }>('GET', '/api/v1/vehicles').catch(() => ({ vehicles: [] }));
    this.showModal('AURORA CUSTOMS — OFICINA & TUNING', (body) => {
      if (ownedRes.vehicles.length === 0) {
        body.innerHTML = `<div class="sub">Você ainda não possui veículos próprios registrados na garagem. Visite a Prestige Motors para comprar um veículo!</div>`;
        return;
      }

      for (const ov of ownedRes.vehicles) {
        const def = VEHICLES[ov.model];
        const card = document.createElement('div');
        card.className = 'catalog-card';
        card.innerHTML = `
          <div>
            <h4>${def?.name ?? ov.model} (Saúde: ${Math.round(ov.health / 10)}%)</h4>
            <div class="sub">Motor Nível ${ov.mods?.engine ?? 0}/3</div>
          </div>
          <div style="display:flex;gap:6px;flex-wrap:wrap">
            <button data-act="repair" class="btn-small">Reparar ($${CUSTOMS.repair})</button>
            <button data-act="paint" class="btn-small">Nova Pintura ($${CUSTOMS.paint})</button>
            <button data-act="engine" class="btn-small">Upgrade Motor</button>
          </div>
        `;
        card.querySelector('[data-act="repair"]')!.addEventListener('click', async () => {
          try {
            const r = await this.net.api('POST', `/api/v1/vehicles/${ov.id}/customize`, { repair: true });
            this.balance = r.balance;
            this.updateHudMoney();
            this.toast('Veículo reparado!');
          } catch (e: any) { this.toast(e.message, 'warn'); }
        });
        card.querySelector('[data-act="paint"]')!.addEventListener('click', async () => {
          const randomColor = PAINT_COLORS[Math.floor(Math.random() * PAINT_COLORS.length)];
          try {
            const r = await this.net.api('POST', `/api/v1/vehicles/${ov.id}/customize`, { color: randomColor });
            this.balance = r.balance;
            this.updateHudMoney();
            this.toast('Pintura aplicada!');
          } catch (e: any) { this.toast(e.message, 'warn'); }
        });
        card.querySelector('[data-act="engine"]')!.addEventListener('click', async () => {
          const nextLvl = Math.min(3, (ov.mods?.engine ?? 0) + 1);
          try {
            const r = await this.net.api('POST', `/api/v1/vehicles/${ov.id}/customize`, { engine: nextLvl });
            this.balance = r.balance;
            this.updateHudMoney();
            this.toast(`Motor atualizado para nível ${nextLvl}!`);
          } catch (e: any) { this.toast(e.message, 'warn'); }
        });
        body.appendChild(card);
      }
    });
  }

  private async openInventoryAndGarageModal() {
    const [invRes, vehRes] = await Promise.all([
      this.net.api<{ items: { itemId: string; kind: string; qty: number }[] }>('GET', '/api/v1/inventory').catch(() => ({ items: [] })),
      this.net.api<{ vehicles: any[] }>('GET', '/api/v1/vehicles').catch(() => ({ vehicles: [] })),
    ]);

    this.showModal('INVENTÁRIO, ARMAS & GARAGEM PESSOAL', (body) => {
      body.innerHTML = `<h4>Armas Equipadas (clique para selecionar ou segure [Q] em jogo)</h4>`;
      const wGrid = document.createElement('div');
      wGrid.className = 'catalog-grid';
      for (const wid of this.weapons) {
        const def = WEAPONS[wid];
        if (!def) continue;
        const a = this.ammo.get(wid);
        const card = document.createElement('div');
        card.className = 'catalog-card';
        card.innerHTML = `
          <div>
            <h4>${def.name}</h4>
            <div class="sub">${def.mag > 0 ? `Munição: ${(a?.mag ?? 0) + (a?.reserve ?? 0)}` : 'Corpo a corpo'}</div>
          </div>
          <button class="btn-small">${this.currentWeapon === wid ? 'Equipada' : 'Equipar'}</button>
        `;
        card.querySelector('button')!.onclick = () => {
          this.selectWeapon(wid);
          this.closeModal();
        };
        wGrid.appendChild(card);
      }
      body.appendChild(wGrid);

      const consumables = invRes.items.filter((i) => (i.kind === 'consumable' || i.kind === 'armor') && i.qty > 0);
      const cHdr = document.createElement('h4');
      cHdr.textContent = 'Suprimentos & Coletes';
      body.appendChild(cHdr);
      if (consumables.length === 0) {
        const sub = document.createElement('div');
        sub.className = 'sub';
        sub.textContent = 'Nenhum consumível no inventário. Compre lanches, kits médicos ou coletes nas lojas.';
        body.appendChild(sub);
      } else {
        const cGrid = document.createElement('div');
        cGrid.className = 'catalog-grid';
        for (const it of consumables) {
          const card = document.createElement('div');
          card.className = 'catalog-card';
          card.innerHTML = `
            <div><h4>${SHOP_ITEMS[it.itemId]?.name ?? it.itemId}</h4><div class="sub">Qtd: ${it.qty}</div></div>
            <button class="btn-small">Usar</button>
          `;
          card.querySelector('button')!.onclick = async () => {
            const r = await this.net.emit(EV.useItem, { itemId: it.itemId });
            if (r.ok) {
              this.hp = r.data.hp;
              this.armor = r.data.armor;
              this.toast('Item utilizado!');
              this.closeModal();
            } else {
              this.toast(r.error, 'warn');
            }
          };
          cGrid.appendChild(card);
        }
        body.appendChild(cGrid);
      }

      const gHdr = document.createElement('h4');
      gHdr.textContent = 'Meus Veículos na Garagem (entrega imediata)';
      body.appendChild(gHdr);
      if (vehRes.vehicles.length === 0) {
        const sub = document.createElement('div');
        sub.className = 'sub';
        sub.textContent = 'Você ainda não comprou veículos na Prestige Motors.';
        body.appendChild(sub);
      } else {
        const vGrid = document.createElement('div');
        vGrid.className = 'catalog-grid';
        for (const ov of vehRes.vehicles) {
          const def = VEHICLES[ov.model];
          const card = document.createElement('div');
          card.className = 'catalog-card';
          card.innerHTML = `
            <div>
              <h4>${def?.name ?? ov.model}</h4>
              <div class="sub">Condição: ${Math.round(ov.health / 10)}%</div>
            </div>
            <button class="btn-primary">Solicitar Entrega</button>
          `;
          card.querySelector('button')!.onclick = async () => {
            const r = await this.net.emit(EV.vehicleSpawnOwned, { ownedId: ov.id });
            if (r.ok) {
              this.toast(`${def?.name ?? 'Veículo'} entregue próximo a você!`);
              this.closeModal();
            } else {
              this.toast(r.error, 'warn');
            }
          };
          vGrid.appendChild(card);
        }
        body.appendChild(vGrid);
      }
    });
  }

  private async openPropertiesModal(highlightId?: string) {
    const res = await this.net.api<{ owned: { propertyId: string }[] }>('GET', '/api/v1/properties').catch(() => ({ owned: [] }));
    const ownedSet = new Set(res.owned.map((o) => o.propertyId));

    this.showModal('IMÓVEIS & PROPRIEDADES — COSTA AURORA', (body) => {
      const grid = document.createElement('div');
      grid.className = 'catalog-grid';

      for (const pr of PROPERTIES) {
        const isOwned = ownedSet.has(pr.id);
        const card = document.createElement('div');
        card.className = 'catalog-card';
        if (pr.id === highlightId) card.style.borderColor = '#f5b942';
        card.innerHTML = `
          <div>
            <h4>${pr.name}</h4>
            <div class="sub">Tipo: ${pr.kind.toUpperCase()} • +${pr.garageSlots} vagas na garagem</div>
          </div>
          <div style="display:flex;justify-content:space-between;align-items:center">
            <span class="price">$ ${pr.price.toLocaleString('pt-BR')}</span>
            <button class="btn-small">${isOwned ? 'Vender (50%)' : 'Comprar'}</button>
          </div>
        `;
        card.querySelector('button')!.onclick = async () => {
          try {
            if (isOwned) {
              const r = await this.net.api('POST', '/api/v1/properties/sell', { propertyId: pr.id });
              this.balance = r.balance;
              this.updateHudMoney();
              this.toast(`Propriedade vendida por $${r.refund}`);
            } else {
              this.setGpsTo(pr.x, pr.z);
              const r = await this.net.api('POST', '/api/v1/properties/buy', { propertyId: pr.id });
              this.balance = r.balance;
              this.updateHudMoney();
              this.toast(`Parabéns! Você comprou ${pr.name}!`, 'money');
            }
            this.closeModal();
          } catch (e: any) {
            this.toast(`${e.message} (Rota marcada no GPS)`, 'warn');
          }
        };
        grid.appendChild(card);
      }
      body.appendChild(grid);
    });
  }

  private openPauseModal() {
    this.showModal('MENU DE PAUSA — GTA 7 ONLINE', (body) => {
      body.innerHTML = `
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px">
          <button id="pm-resume" class="btn-primary">Retomar Jogo</button>
          <button id="pm-map" class="btn-secondary">Abrir Mapa & GPS [M]</button>
          <button id="pm-inv" class="btn-secondary">Inventário & Garagem [Tab]</button>
          <button id="pm-char" class="btn-secondary">Meu Personagem</button>
          <button id="pm-props" class="btn-secondary">Propriedades & Imóveis</button>
          <button id="pm-settings" class="btn-secondary">Configurações Gráficas & Áudio</button>
          <button id="pm-controls" class="btn-secondary">Controles</button>
          <button id="pm-leave" class="btn-secondary" style="color:#ff385c">Sair da Sala</button>
        </div>
      `;
      body.querySelector('#pm-resume')!.addEventListener('click', () => this.closeModal());
      body.querySelector('#pm-map')!.addEventListener('click', () => { this.closeModal(); this.toggleFullscreenMap(true); });
      body.querySelector('#pm-inv')!.addEventListener('click', () => void this.openInventoryAndGarageModal());
      body.querySelector('#pm-char')!.addEventListener('click', () => this.openCharacterModal());
      body.querySelector('#pm-props')!.addEventListener('click', () => void this.openPropertiesModal());
      body.querySelector('#pm-settings')!.addEventListener('click', () => this.openSettingsModal());
      body.querySelector('#pm-controls')!.addEventListener('click', () => this.openControlsModal());
      body.querySelector('#pm-leave')!.addEventListener('click', async () => {
        await this.net.emit(EV.roomLeave);
        this.closeModal();
        this.returnToMainMenu();
      });
    });
  }

  private openSettingsModal() {
    this.showModal('CONFIGURAÇÕES GRÁFICAS, CÂMERA & ÁUDIO', (body) => {
      body.innerHTML = `
        <div class="form-grid">
          <div class="form-row">
            <label>Qualidade Gráfica 3D</label>
            <select id="st-gfx">
              <option value="low" ${this.graphicsQuality === 'low' ? 'selected' : ''}>Baixa (Desempenho)</option>
              <option value="medium" ${this.graphicsQuality === 'medium' ? 'selected' : ''}>Média</option>
              <option value="high" ${this.graphicsQuality === 'high' ? 'selected' : ''}>Alta (PBR + Sombras)</option>
              <option value="ultra" ${this.graphicsQuality === 'ultra' ? 'selected' : ''}>Ultra (Resolução Nativa)</option>
            </select>
          </div>
          <div class="form-row">
            <label>Sensibilidade do Mouse</label>
            <input id="st-sens" type="number" step="0.1" min="0.2" max="4" value="${this.sensitivity}" />
          </div>
          <div class="form-row">
            <label>Volume Geral (0 a 1)</label>
            <input id="st-master" type="number" step="0.1" min="0" max="1" value="${this.sound.masterVolume}" />
          </div>
          <div class="form-row">
            <label>Volume da Rádio de Veículos (0 a 1)</label>
            <input id="st-radio" type="number" step="0.1" min="0" max="1" value="${this.sound.radioVolume}" />
          </div>
        </div>
        <div class="form-row">
          <label><input id="st-invert" type="checkbox" ${this.invertY ? 'checked' : ''} /> Inverter Eixo Vertical do Mouse (Y)</label>
        </div>
        <button id="st-save" class="btn-primary">Aplicar e Salvar Configurações</button>
      `;

      body.querySelector('#st-save')!.addEventListener('click', async () => {
        const gfx = (body.querySelector('#st-gfx') as HTMLSelectElement).value as any;
        this.applyGraphicsQuality(gfx);
        this.sensitivity = Number((body.querySelector('#st-sens') as HTMLInputElement).value);
        this.sound.masterVolume = Number((body.querySelector('#st-master') as HTMLInputElement).value);
        this.sound.radioVolume = Number((body.querySelector('#st-radio') as HTMLInputElement).value);
        this.invertY = (body.querySelector('#st-invert') as HTMLInputElement).checked;
        if (this.net.session) {
          await this.net.api('PUT', '/api/v1/profile/settings', {
            settings: {
              graphics: gfx,
              sensitivity: this.sensitivity,
              invertY: this.invertY,
              masterVolume: this.sound.masterVolume,
              radioVolume: this.sound.radioVolume,
            },
          }).catch(() => {});
        }
        this.toast('Configurações aplicadas!');
        this.closeModal();
      });
    });
  }

  private openControlsModal() {
    this.showModal('CONTROLES & REMAPEAMENTO', (body) => {
      body.innerHTML = `
        <div class="sub">Clique em um botão de tecla e pressione a nova tecla desejada.</div>
        <div class="form-grid" id="binds-grid"></div>
        <div class="sub" style="margin-top:8px">
          Mouse Esquerdo: Disparar/Atacar • Mouse Direito: Mirar sobre o Ombro (3ª Pessoa) • Segurar Q: Roda Radial de Armas • M: Mapa GPS • Tab: Inventário/Garagem • T: Chat • Esc: Pausa
        </div>
      `;
      const grid = body.querySelector('#binds-grid') as HTMLElement;
      const labels: Record<keyof KeyBinds, string> = {
        forward: 'Avançar / Acelerar (W)',
        back: 'Recuar / Frear / Ré (S)',
        left: 'Esquerda (A)',
        right: 'Direita (D)',
        jump: 'Pular / Freio de Mão (Espaço)',
        sprint: 'Correr / Sprint (Shift)',
        crouch: 'Agachar / Furtivo (C)',
        interact: 'Interagir / Entrar em Veículo (E)',
        reload: 'Recarregar Arma (R)',
        camera: 'Alternar Câmera (V)',
        lights: 'Faróis do Veículo (H)',
        horn: 'Buzina (F)',
        radio: 'Trocar Estação de Rádio (G)',
      };

      for (const k of Object.keys(labels) as (keyof KeyBinds)[]) {
        const row = document.createElement('div');
        row.className = 'player-item';
        row.innerHTML = `<span>${labels[k]}</span><button class="btn-small">${this.binds[k]}</button>`;
        const btn = row.querySelector('button')!;
        btn.onclick = () => {
          btn.textContent = 'Pressione tecla...';
          const handler = (ev: KeyboardEvent) => {
            ev.preventDefault();
            this.binds[k] = ev.code;
            btn.textContent = ev.code;
            window.removeEventListener('keydown', handler, true);
          };
          window.addEventListener('keydown', handler, true);
        };
        grid.appendChild(row);
      }
    });
  }

  private openCreditsModal() {
    this.showModal('CRÉDITOS, ARQUITETURA & LICENÇAS', (body) => {
      body.innerHTML = `
        <h4>GTA 7 ONLINE — COSTA AURORA</h4>
        <p class="sub">
          Projeto original de mundo aberto multiplayer 3D para navegadores modernos.
          O título "GTA 7" é provisório e demonstrativo, sem qualquer vínculo oficial com a Rockstar Games ou Take-Two Interactive.
        </p>
        <h4>Tecnologias Utilizadas</h4>
        <p class="sub">
          • Frontend: TypeScript, Three.js (WebGL 2 PBR + Clearcoat + Emissive Maps), Rapier 3D Physics (WASM), Vite, WebAudio API Espacial.<br/>
          • Backend Autoritativo: Node.js, Fastify, Socket.IO, Drizzle ORM, PostgreSQL / PGlite, Argon2id, Zod.
        </p>
        <h4>Modelos 3D, Texturas e Áudio</h4>
        <p class="sub">
          • Todos os modelos 3D articulados de personagens, veículos esculpidos, 10 estilos arquitetônicos PBR de Costa Aurora, sistema de partículas InstancedMesh e síntese de áudio/rádio foram gerados proceduralmente como obras originais sob licença MIT/CC0.
        </p>
      `;
    });
  }

  private toggleFullscreenMap(force?: boolean) {
    const el = document.getElementById('fullscreen-map')!;
    const open = force !== undefined ? force : el.classList.contains('hidden');
    el.classList.toggle('hidden', !open);
    if (open) {
      if (document.pointerLockElement) document.exitPointerLock();
      this.populateMapLegend();
      this.refreshBigMap();
    }
  }

  private populateMapLegend() {
    const list = document.getElementById('map-poi-list')!;
    list.innerHTML = '';

    for (const m of MISSIONS) {
      const btn = document.createElement('button');
      btn.className = 'poi-btn';
      btn.innerHTML = `<strong style="color:#f5b942">★ Missão: ${m.name}</strong><div class="sub">Recompensa: $${m.reward}</div>`;
      btn.onclick = () => {
        this.setGpsTo(m.giver.x, m.giver.z);
        this.refreshBigMap();
      };
      list.appendChild(btn);
    }

    for (const poi of POIS) {
      const btn = document.createElement('button');
      btn.className = 'poi-btn';
      btn.innerHTML = `<strong style="color:#2de2e6">• ${poi.name}</strong><div class="sub">${poi.kind.toUpperCase()}</div>`;
      btn.onclick = () => {
        this.setGpsTo(poi.x, poi.z);
        this.refreshBigMap();
      };
      list.appendChild(btn);
    }
  }

  private refreshBigMap() {
    const netPlayers = new Map<string, NetPlayer>();
    for (const [id, rp] of this.remotePlayers) netPlayers.set(id, rp.data);
    const cp = this.activeMission ? MISSION_MAP.get(this.activeMission.id)?.checkpoints[this.activeMission.index] ?? null : null;
    this.mapRenderer.drawBigMap(this.selfPos, netPlayers, this.gpsRoute, cp);
  }
}

const game = new GTA7OnlineGame();
void game.init();
