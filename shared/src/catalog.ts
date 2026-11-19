/* ===================================================================
 * Catálogo do jogo. Os preços aqui são a ÚNICA fonte de verdade usada
 * pelo servidor; o cliente apenas exibe.
 * Todas as armas, veículos e marcas são fictícios.
 * =================================================================== */

export type WeaponCategory = 'melee' | 'pistol' | 'smg' | 'shotgun' | 'rifle' | 'sniper' | 'heavy' | 'throwable';

export interface WeaponDef {
  id: string; name: string; category: WeaponCategory;
  damage: number; rps: number; mag: number; reload: number; range: number;
  spread: number; pellets: number; auto: boolean; price: number; ammoPrice: number; ammoPack: number;
  recoil: number; slot: number;
}

export const WEAPONS: Record<string, WeaponDef> = {
  fists:     { id: 'fists', name: 'Punhos', category: 'melee', damage: 12, rps: 2.5, mag: 0, reload: 0, range: 1.8, spread: 0, pellets: 1, auto: false, price: 0, ammoPrice: 0, ammoPack: 0, recoil: 0, slot: 0 },
  bat:       { id: 'bat', name: 'Taco Aurora', category: 'melee', damage: 28, rps: 1.4, mag: 0, reload: 0, range: 2.3, spread: 0, pellets: 1, auto: false, price: 250, ammoPrice: 0, ammoPack: 0, recoil: 0, slot: 0 },
  knife:     { id: 'knife', name: 'Lâmina Tática K7', category: 'melee', damage: 34, rps: 2, mag: 0, reload: 0, range: 1.9, spread: 0, pellets: 1, auto: false, price: 400, ammoPrice: 0, ammoPack: 0, recoil: 0, slot: 0 },
  hammer:    { id: 'hammer', name: 'Marreta Ferro-Velho', category: 'melee', damage: 40, rps: 1, mag: 0, reload: 0, range: 2.2, spread: 0, pellets: 1, auto: false, price: 350, ammoPrice: 0, ammoPack: 0, recoil: 0, slot: 0 },
  pistol:    { id: 'pistol', name: 'P-9 Vesper', category: 'pistol', damage: 22, rps: 4, mag: 12, reload: 1.3, range: 60, spread: 0.012, pellets: 1, auto: false, price: 1200, ammoPrice: 60, ammoPack: 36, recoil: 0.03, slot: 1 },
  hpistol:   { id: 'hpistol', name: 'Magnus .50', category: 'pistol', damage: 40, rps: 2, mag: 7, reload: 1.6, range: 70, spread: 0.01, pellets: 1, auto: false, price: 3500, ammoPrice: 90, ammoPack: 21, recoil: 0.07, slot: 1 },
  apistol:   { id: 'apistol', name: 'Vespa Auto', category: 'pistol', damage: 16, rps: 10, mag: 18, reload: 1.4, range: 45, spread: 0.03, pellets: 1, auto: true, price: 5200, ammoPrice: 80, ammoPack: 54, recoil: 0.02, slot: 1 },
  revolver:  { id: 'revolver', name: 'Revólver Sertanejo', category: 'pistol', damage: 55, rps: 1.3, mag: 6, reload: 2.4, range: 75, spread: 0.008, pellets: 1, auto: false, price: 4800, ammoPrice: 100, ammoPack: 18, recoil: 0.1, slot: 1 },
  smg:       { id: 'smg', name: 'Corvo SMG', category: 'smg', damage: 15, rps: 12, mag: 30, reload: 1.8, range: 55, spread: 0.035, pellets: 1, auto: true, price: 6500, ammoPrice: 110, ammoPack: 90, recoil: 0.02, slot: 2 },
  csmg:      { id: 'csmg', name: 'Micro Gavião', category: 'smg', damage: 13, rps: 14, mag: 24, reload: 1.5, range: 40, spread: 0.045, pellets: 1, auto: true, price: 4800, ammoPrice: 100, ammoPack: 72, recoil: 0.02, slot: 2 },
  asmg:      { id: 'asmg', name: 'Falcão X-SMG', category: 'smg', damage: 18, rps: 13, mag: 32, reload: 1.7, range: 60, spread: 0.028, pellets: 1, auto: true, price: 9800, ammoPrice: 120, ammoPack: 96, recoil: 0.022, slot: 2 },
  shotgun:   { id: 'shotgun', name: 'Trovão 12', category: 'shotgun', damage: 12, rps: 1.1, mag: 6, reload: 2.6, range: 28, spread: 0.09, pellets: 8, auto: false, price: 5500, ammoPrice: 90, ammoPack: 18, recoil: 0.12, slot: 3 },
  pshotgun:  { id: 'pshotgun', name: 'Bomba-Ação P8', category: 'shotgun', damage: 14, rps: 0.9, mag: 8, reload: 3, range: 30, spread: 0.08, pellets: 8, auto: false, price: 7200, ammoPrice: 95, ammoPack: 24, recoil: 0.13, slot: 3 },
  ashotgun:  { id: 'ashotgun', name: 'Tempestade Auto-12', category: 'shotgun', damage: 10, rps: 3.5, mag: 10, reload: 2.8, range: 25, spread: 0.1, pellets: 7, auto: true, price: 14000, ammoPrice: 120, ammoPack: 30, recoil: 0.09, slot: 3 },
  rifle:     { id: 'rifle', name: 'AR-7 Aurora', category: 'rifle', damage: 24, rps: 9, mag: 30, reload: 2.1, range: 120, spread: 0.014, pellets: 1, auto: true, price: 12000, ammoPrice: 140, ammoPack: 90, recoil: 0.03, slot: 4 },
  carbine:   { id: 'carbine', name: 'Carabina C-4R', category: 'rifle', damage: 22, rps: 10, mag: 30, reload: 2, range: 110, spread: 0.012, pellets: 1, auto: true, price: 13500, ammoPrice: 140, ammoPack: 90, recoil: 0.028, slot: 4 },
  brifle:    { id: 'brifle', name: 'Rifle de Combate Bravo', category: 'rifle', damage: 32, rps: 6, mag: 20, reload: 2.3, range: 140, spread: 0.01, pellets: 1, auto: true, price: 17000, ammoPrice: 160, ammoPack: 60, recoil: 0.045, slot: 4 },
  mrifle:    { id: 'mrifle', name: 'DMR Sentinela', category: 'rifle', damage: 48, rps: 3, mag: 12, reload: 2.4, range: 200, spread: 0.004, pellets: 1, auto: false, price: 19000, ammoPrice: 170, ammoPack: 36, recoil: 0.06, slot: 4 },
  sniper:    { id: 'sniper', name: 'Longinus SR', category: 'sniper', damage: 95, rps: 0.8, mag: 5, reload: 3.2, range: 450, spread: 0.001, pellets: 1, auto: false, price: 24000, ammoPrice: 200, ammoPack: 15, recoil: 0.2, slot: 5 },
  hsniper:   { id: 'hsniper', name: 'Titã .50 Pesado', category: 'sniper', damage: 160, rps: 0.5, mag: 4, reload: 3.8, range: 600, spread: 0.001, pellets: 1, auto: false, price: 38000, ammoPrice: 260, ammoPack: 12, recoil: 0.3, slot: 5 },
  minigun:   { id: 'minigun', name: 'Ciclone Rotativa', category: 'heavy', damage: 14, rps: 25, mag: 200, reload: 4, range: 90, spread: 0.05, pellets: 1, auto: true, price: 60000, ammoPrice: 400, ammoPack: 400, recoil: 0.01, slot: 6 },
  launcher:  { id: 'launcher', name: 'Lançador Vulcão', category: 'heavy', damage: 220, rps: 0.5, mag: 1, reload: 3, range: 180, spread: 0.003, pellets: 1, auto: false, price: 75000, ammoPrice: 600, ammoPack: 4, recoil: 0.3, slot: 6 },
  grenade:   { id: 'grenade', name: 'Granada Fragmento-A', category: 'throwable', damage: 180, rps: 0.8, mag: 1, reload: 0, range: 35, spread: 0, pellets: 1, auto: false, price: 800, ammoPrice: 250, ammoPack: 1, recoil: 0, slot: 7 },
  smoke:     { id: 'smoke', name: 'Fumígeno Névoa', category: 'throwable', damage: 0, rps: 0.8, mag: 1, reload: 0, range: 35, spread: 0, pellets: 1, auto: false, price: 400, ammoPrice: 120, ammoPack: 1, recoil: 0, slot: 7 },
};
export const STARTING_WEAPONS = ['fists', 'pistol'];
export const STARTING_AMMO: Record<string, number> = { pistol: 48 };

export type VehicleCategory = 'compact' | 'sedan' | 'suv' | 'pickup' | 'sports' | 'super' | 'classic' | 'taxi' | 'police' | 'ambulance' | 'van' | 'bus' | 'truck' | 'tractor' | 'moto' | 'boat' | 'heli';

export interface VehicleModelDef {
  id: string; name: string; brand: string; category: VehicleCategory; price: number;
  /** dimensões aproximadas (m) */
  length: number; width: number; height: number;
  mass: number; engine: number; maxSpeed: number; brake: number; grip: number;
  seats: number; drive: 'fwd' | 'rwd' | 'awd'; wheelRadius: number;
  colors: number[];
}

export const VEHICLES: Record<string, VehicleModelDef> = {
  brisa:    { id: 'brisa', name: 'Brisa', brand: 'Velta', category: 'compact', price: 14000, length: 3.9, width: 1.75, height: 1.48, mass: 1050, engine: 2600, maxSpeed: 44, brake: 60, grip: 2.4, seats: 4, drive: 'fwd', wheelRadius: 0.32, colors: [0xd23b2f, 0xf2f2f2, 0x2f6fd2, 0xf0c419, 0x2e2e2e] },
  aurelia:  { id: 'aurelia', name: 'Aurélia', brand: 'Montecor', category: 'sedan', price: 26000, length: 4.8, width: 1.85, height: 1.45, mass: 1450, engine: 3600, maxSpeed: 52, brake: 70, grip: 2.6, seats: 4, drive: 'rwd', wheelRadius: 0.34, colors: [0x1d2433, 0xbfc5cc, 0x6b0f1a, 0xffffff, 0x0f3d2e] },
  trilha:   { id: 'trilha', name: 'Trilha XR', brand: 'Kanto', category: 'suv', price: 42000, length: 4.9, width: 2.0, height: 1.8, mass: 2100, engine: 4800, maxSpeed: 48, brake: 80, grip: 2.7, seats: 4, drive: 'awd', wheelRadius: 0.4, colors: [0x0e0e0e, 0xe8e8e8, 0x3a4a2a, 0x8a1c1c] },
  boiadeiro:{ id: 'boiadeiro', name: 'Boiadeiro', brand: 'Kanto', category: 'pickup', price: 36000, length: 5.3, width: 2.0, height: 1.85, mass: 2200, engine: 4600, maxSpeed: 46, brake: 80, grip: 2.6, seats: 2, drive: 'awd', wheelRadius: 0.42, colors: [0xb8452b, 0xf2f2f2, 0x2c3e50, 0x5d4a2e] },
  raio:     { id: 'raio', name: 'Raio GT', brand: 'Saetta', category: 'sports', price: 98000, length: 4.5, width: 1.95, height: 1.25, mass: 1400, engine: 6200, maxSpeed: 68, brake: 95, grip: 3.2, seats: 2, drive: 'rwd', wheelRadius: 0.35, colors: [0xffcc00, 0xe0201b, 0x1b5fe0, 0x111111, 0xffffff] },
  zenit:    { id: 'zenit', name: 'Zênite V12', brand: 'Saetta', category: 'super', price: 285000, length: 4.6, width: 2.05, height: 1.12, mass: 1500, engine: 8200, maxSpeed: 82, brake: 110, grip: 3.6, seats: 2, drive: 'awd', wheelRadius: 0.36, colors: [0x58e01b, 0xff5a00, 0x9b1be0, 0xf2f2f2, 0x101010] },
  saudade:  { id: 'saudade', name: 'Saudade 64', brand: 'Montecor', category: 'classic', price: 64000, length: 4.7, width: 1.85, height: 1.35, mass: 1500, engine: 3800, maxSpeed: 50, brake: 55, grip: 2.2, seats: 2, drive: 'rwd', wheelRadius: 0.36, colors: [0x6fc3d6, 0xe8d8b0, 0xa6192e, 0x223355] },
  taxi:     { id: 'taxi', name: 'Táxi Aurélia', brand: 'Montecor', category: 'taxi', price: 22000, length: 4.8, width: 1.85, height: 1.45, mass: 1450, engine: 3400, maxSpeed: 50, brake: 70, grip: 2.6, seats: 4, drive: 'rwd', wheelRadius: 0.34, colors: [0xf5c518] },
  police:   { id: 'police', name: 'Interceptor', brand: 'Montecor', category: 'police', price: 0, length: 4.9, width: 1.9, height: 1.5, mass: 1650, engine: 5600, maxSpeed: 62, brake: 90, grip: 3.0, seats: 4, drive: 'rwd', wheelRadius: 0.35, colors: [0xf2f2f2] },
  ambulance:{ id: 'ambulance', name: 'Resgate', brand: 'Velta', category: 'ambulance', price: 0, length: 6.0, width: 2.2, height: 2.6, mass: 3200, engine: 6000, maxSpeed: 42, brake: 80, grip: 2.4, seats: 2, drive: 'rwd', wheelRadius: 0.42, colors: [0xffffff] },
  furgao:   { id: 'furgao', name: 'Furgão Entrega', brand: 'Velta', category: 'van', price: 30000, length: 5.4, width: 2.0, height: 2.3, mass: 2400, engine: 4200, maxSpeed: 40, brake: 70, grip: 2.4, seats: 2, drive: 'rwd', wheelRadius: 0.38, colors: [0xffffff, 0x1f5fa8, 0xd2a01f] },
  onibus:   { id: 'onibus', name: 'Ônibus Urbano', brand: 'Marcon', category: 'bus', price: 120000, length: 11, width: 2.55, height: 3.1, mass: 9000, engine: 16000, maxSpeed: 30, brake: 220, grip: 2.4, seats: 8, drive: 'rwd', wheelRadius: 0.55, colors: [0x2a8c5a, 0xd23b2f] },
  carreta:  { id: 'carreta', name: 'Carreta Titã', brand: 'Marcon', category: 'truck', price: 140000, length: 8.5, width: 2.5, height: 3.3, mass: 8000, engine: 15000, maxSpeed: 32, brake: 200, grip: 2.4, seats: 2, drive: 'rwd', wheelRadius: 0.55, colors: [0xc0392b, 0x2c3e50, 0xf39c12] },
  trator:   { id: 'trator', name: 'Trator Campeiro', brand: 'Agrovale', category: 'tractor', price: 28000, length: 3.8, width: 2.0, height: 2.6, mass: 3500, engine: 7000, maxSpeed: 14, brake: 120, grip: 3.0, seats: 1, drive: 'awd', wheelRadius: 0.75, colors: [0x2e8b2e, 0xd03020] },
  lancha:   { id: 'lancha', name: 'Lancha Maré', brand: 'Náutica Sul', category: 'boat', price: 55000, length: 7, width: 2.4, height: 1.6, mass: 1800, engine: 9000, maxSpeed: 30, brake: 0, grip: 1, seats: 4, drive: 'rwd', wheelRadius: 0, colors: [0xffffff, 0x1b3f8a, 0xc0392b] },
  jetski:   { id: 'jetski', name: 'Jet Onda', brand: 'Náutica Sul', category: 'boat', price: 18000, length: 3, width: 1.2, height: 1.1, mass: 400, engine: 3000, maxSpeed: 26, brake: 0, grip: 1, seats: 2, drive: 'rwd', wheelRadius: 0, colors: [0xf0c419, 0x1fd2c8, 0xe0201b] },
};

export const DEALER_STOCK = ['brisa', 'aurelia', 'trilha', 'boiadeiro', 'raio', 'zenit', 'saudade', 'furgao', 'trator', 'lancha', 'jetski'];

export interface ShopItem { id: string; name: string; kind: 'weapon' | 'ammo' | 'armor' | 'consumable' | 'clothing'; price: number; ref?: string; qty?: number }
export const SHOP_ITEMS: Record<string, ShopItem> = {
  armor_light: { id: 'armor_light', name: 'Colete Leve', kind: 'armor', price: 500, qty: 50 },
  armor_heavy: { id: 'armor_heavy', name: 'Colete Pesado', kind: 'armor', price: 1200, qty: 100 },
  snack: { id: 'snack', name: 'Lanche Aurora', kind: 'consumable', price: 15, qty: 1 },
  medkit: { id: 'medkit', name: 'Kit Médico', kind: 'consumable', price: 250, qty: 1 },
  ...Object.fromEntries(
    Object.values(WEAPONS).filter((w) => w.price > 0).flatMap((w) => {
      const items: [string, ShopItem][] = [[`w_${w.id}`, { id: `w_${w.id}`, name: w.name, kind: 'weapon', price: w.price, ref: w.id }]];
      if (w.ammoPack > 0) items.push([`a_${w.id}`, { id: `a_${w.id}`, name: `Munição ${w.name}`, kind: 'ammo', price: w.ammoPrice, ref: w.id, qty: w.ammoPack }]);
      return items;
    }),
  ),
};

export const CUSTOMS = {
  paint: 500,
  wheels: 1500,
  suspension: 2500,
  engine: [0, 4000, 9000, 16000],
  repair: 300,
};

export const STARTING_MONEY = 5000;
export const RESPAWN_COST = 250;
export const ARREST_FINE = 500;
export const PAINT_COLORS = [0xd23b2f, 0xf2f2f2, 0x2f6fd2, 0xf0c419, 0x2e2e2e, 0x1d2433, 0x58e01b, 0xff5a00, 0x9b1be0, 0x6fc3d6, 0x0f3d2e, 0xbfc5cc];
