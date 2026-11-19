import { describe, it, expect } from 'vitest';
import {
  terrainHeight, regionAt, findRoute, getRoadNetwork, getParkingSpots,
  WEAPONS, VEHICLES, MISSIONS, POIS, PROPERTIES,
} from '../../shared/src';

describe('Costa Aurora — Mundo, Malha Viária, GPS A* e Catálogos', () => {
  it('gera malha viária conectada com semáforos e vagas de estacionamento', () => {
    const net = getRoadNetwork();
    expect(net.nodes.length).toBeGreaterThan(30);
    expect(net.edges.length).toBeGreaterThan(40);
    expect(net.nodes.some((n) => n.signal)).toBe(true);
    const spots = getParkingSpots();
    expect(spots.length).toBeGreaterThan(40);
  });

  it('calcula rotas GPS reais pela malha viária entre o Centro e o Sertão', () => {
    const route = findRoute(0, 0, 820, -820);
    expect(route.length).toBeGreaterThan(10);
    const last = route[route.length - 1];
    expect(Math.hypot(last[0] - 800, last[2] + 1130)).toBeLessThan(650);
  });

  it('distingue todas as regiões de Costa Aurora e alturas coerentes', () => {
    expect(regionAt(0, 0)).toBe('downtown');
    expect(regionAt(0, -600)).toBe('residential');
    expect(regionAt(-600, -700)).toBe('luxury');
    expect(regionAt(-800, 100)).toBe('beach');
    expect(regionAt(-1200, 0)).toBe('ocean');
    expect(regionAt(800, -800)).toBe('rural');
    expect(regionAt(700, 500)).toBe('industrial');
    expect(regionAt(800, 100)).toBe('airport');
    expect(terrainHeight(-1200, 0)).toBeLessThan(0);
    expect(terrainHeight(0, 0)).toBeGreaterThan(1);
  });

  it('possui as 10 missões obrigatórias, todas as categorias de armas, veículos e propriedades', () => {
    expect(MISSIONS.length).toBe(10);
    expect(Object.keys(WEAPONS).length).toBeGreaterThanOrEqual(20);
    expect(Object.keys(VEHICLES).length).toBeGreaterThanOrEqual(15);
    expect(POIS.length).toBeGreaterThanOrEqual(15);
    expect(PROPERTIES.length).toBeGreaterThanOrEqual(8);
  });
});
