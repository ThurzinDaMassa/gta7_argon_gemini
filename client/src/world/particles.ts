import * as THREE from 'three';

/* ===================================================================
 * Sistema de Partículas Otimizado (InstancedMesh Pool — Zero GC por Frame)
 * - Faíscas de impacto de bala e colisão metálica
 * - Fumaça de pneu (drift/freio de mão), escapamento e dano no motor
 * - Cápsulas de munição ejetadas com gravidade e quique
 * - Fogo e fumaça volumétrica de explosão
 * - Respingos de água e poças de chuva no asfalto
 * =================================================================== */

interface Particle {
  active: boolean;
  x: number;
  y: number;
  z: number;
  vx: number;
  vy: number;
  vz: number;
  scale: number;
  grow: number;
  gravity: number;
  life: number;
  maxLife: number;
  color: THREE.Color;
}

export class ParticleSystem {
  scene: THREE.Scene;
  private maxCount = 500;
  private mesh: THREE.InstancedMesh;
  private pool: Particle[] = [];
  private cursor = 0;
  private dummy = new THREE.Object3D();

  constructor(scene: THREE.Scene) {
    this.scene = scene;
    const geo = new THREE.DodecahedronGeometry(0.18, 0);
    const mat = new THREE.MeshBasicMaterial({
      color: 0xffffff,
      transparent: true,
      opacity: 0.85,
    });
    this.mesh = new THREE.InstancedMesh(geo, mat, this.maxCount);
    this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.mesh.frustumCulled = false;
    this.scene.add(this.mesh);

    for (let i = 0; i < this.maxCount; i++) {
      this.pool.push({
        active: false,
        x: 0, y: -999, z: 0,
        vx: 0, vy: 0, vz: 0,
        scale: 0.001, grow: 0, gravity: 0,
        life: 0, maxLife: 1,
        color: new THREE.Color(0xffffff),
      });
      this.dummy.position.set(0, -999, 0);
      this.dummy.scale.setScalar(0.001);
      this.dummy.updateMatrix();
      this.mesh.setMatrixAt(i, this.dummy.matrix);
      this.mesh.setColorAt(i, new THREE.Color(0xffffff));
    }
  }

  private alloc(): Particle {
    const p = this.pool[this.cursor];
    this.cursor = (this.cursor + 1) % this.maxCount;
    p.active = true;
    return p;
  }

  spawnBulletImpact(x: number, y: number, z: number) {
    for (let i = 0; i < 8; i++) {
      const p = this.alloc();
      p.x = x; p.y = y; p.z = z;
      p.vx = (Math.random() - 0.5) * 9;
      p.vy = 1.5 + Math.random() * 6;
      p.vz = (Math.random() - 0.5) * 9;
      p.scale = 0.25 + Math.random() * 0.2;
      p.grow = -0.35;
      p.gravity = 16;
      p.life = 0;
      p.maxLife = 0.28 + Math.random() * 0.2;
      p.color.setHex(i % 2 === 0 ? 0xffcc33 : 0xd0d7e2);
    }
  }

  spawnShellCasing(x: number, y: number, z: number, rightX: number, rightZ: number) {
    const p = this.alloc();
    p.x = x; p.y = y; p.z = z;
    p.vx = rightX * (2.5 + Math.random() * 1.5);
    p.vy = 2.4 + Math.random() * 1.2;
    p.vz = rightZ * (2.5 + Math.random() * 1.5);
    p.scale = 0.14;
    p.grow = 0;
    p.gravity = 18;
    p.life = 0;
    p.maxLife = 0.7;
    p.color.setHex(0xf5c542);
  }

  spawnTireSmoke(x: number, y: number, z: number) {
    for (let i = 0; i < 2; i++) {
      const p = this.alloc();
      p.x = x + (Math.random() - 0.5) * 0.4;
      p.y = y + 0.1;
      p.z = z + (Math.random() - 0.5) * 0.4;
      p.vx = (Math.random() - 0.5) * 1.6;
      p.vy = 0.8 + Math.random() * 1.2;
      p.vz = (Math.random() - 0.5) * 1.6;
      p.scale = 0.7 + Math.random() * 0.4;
      p.grow = 2.4;
      p.gravity = -0.4;
      p.life = 0;
      p.maxLife = 0.65;
      p.color.setHex(0xd8dee9);
    }
  }

  spawnExhaustOrDamageSmoke(x: number, y: number, z: number, dark = false) {
    const p = this.alloc();
    p.x = x; p.y = y; p.z = z;
    p.vx = (Math.random() - 0.5) * 0.9;
    p.vy = 1.2 + Math.random() * 1.1;
    p.vz = (Math.random() - 0.5) * 0.9;
    p.scale = dark ? 0.9 : 0.45;
    p.grow = dark ? 2.2 : 1.1;
    p.gravity = -0.5;
    p.life = 0;
    p.maxLife = dark ? 0.9 : 0.45;
    p.color.setHex(dark ? 0x262930 : 0x9aa3b0);
  }

  spawnWaterSplash(x: number, y: number, z: number) {
    for (let i = 0; i < 4; i++) {
      const p = this.alloc();
      p.x = x + (Math.random() - 0.5) * 0.8;
      p.y = y;
      p.z = z + (Math.random() - 0.5) * 0.8;
      p.vx = (Math.random() - 0.5) * 3.5;
      p.vy = 2.2 + Math.random() * 2.5;
      p.vz = (Math.random() - 0.5) * 3.5;
      p.scale = 0.45;
      p.grow = 0.6;
      p.gravity = 14;
      p.life = 0;
      p.maxLife = 0.45;
      p.color.setHex(0xc8f0ff);
    }
  }

  spawnExplosion(x: number, y: number, z: number) {
    for (let i = 0; i < 42; i++) {
      const p = this.alloc();
      p.x = x + (Math.random() - 0.5) * 1.4;
      p.y = y + 0.5 + Math.random() * 1.2;
      p.z = z + (Math.random() - 0.5) * 1.4;
      const ang = Math.random() * Math.PI * 2;
      const spd = 3 + Math.random() * 14;
      p.vx = Math.cos(ang) * spd;
      p.vy = 3 + Math.random() * 11;
      p.vz = Math.sin(ang) * spd;
      p.scale = 1.2 + Math.random() * 1.6;
      p.grow = 3.2;
      p.gravity = i < 20 ? 6 : -1.5;
      p.life = 0;
      p.maxLife = 0.6 + Math.random() * 0.7;
      p.color.setHex(i < 16 ? 0xff6a00 : i < 28 ? 0xffcc22 : 0x2b2e36);
    }
  }

  update(dt: number) {
    let dirty = false;
    for (let i = 0; i < this.maxCount; i++) {
      const p = this.pool[i];
      if (!p.active) continue;
      dirty = true;
      p.life += dt;
      if (p.life >= p.maxLife) {
        p.active = false;
        this.dummy.position.set(0, -999, 0);
        this.dummy.scale.setScalar(0.001);
        this.dummy.updateMatrix();
        this.mesh.setMatrixAt(i, this.dummy.matrix);
        continue;
      }

      p.vy -= p.gravity * dt;
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.z += p.vz * dt;
      const ratio = 1 - p.life / p.maxLife;
      const s = Math.max(0.02, (p.scale + p.grow * p.life) * ratio);

      this.dummy.position.set(p.x, p.y, p.z);
      this.dummy.scale.setScalar(s);
      this.dummy.rotation.set(p.life * 4, p.life * 3, 0);
      this.dummy.updateMatrix();
      this.mesh.setMatrixAt(i, this.dummy.matrix);
      this.mesh.setColorAt(i, p.color);
    }

    if (dirty) {
      this.mesh.instanceMatrix.needsUpdate = true;
      if (this.mesh.instanceColor) this.mesh.instanceColor.needsUpdate = true;
    }
  }
}
