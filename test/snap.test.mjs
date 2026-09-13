import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildGraph, nearestNode, nodeKey, shortestPath, stitchNetworks } from '../src/js/snap.js';

/**
 * Et lite stinett:
 *   1 --sti--- 2 ---sti--- 3
 *   |                      |
 *   +-------- veg ---------+
 * Vegen er like lang, men har høyere vekt, så stien skal vinne.
 */
const A = { lat: 61.0, lon: 8.0 };
const MID_NORTH = { lat: 61.0, lon: 8.02 };
const MID_SOUTH = { lat: 60.99, lon: 8.02 };
const B = { lat: 61.0, lon: 8.04 };

const LINKS = [
  { points: [A, MID_NORTH, B], weight: 1.0 },
  { points: [A, MID_SOUTH, B], weight: 1.7 },
];

test('buildGraph knytter lenker sammen på delt geometri', () => {
  const nodes = buildGraph(LINKS);
  assert.equal(nodes.size, 4);
  assert.equal(nodes.get(nodeKey(MID_NORTH)).edges.length, 2);
  // A hører til begge lenkene og har dermed fire kanter.
  assert.equal(nodes.get(nodeKey(A)).edges.length, 2);
});

test('buildGraph lager kanter begge veier', () => {
  const nodes = buildGraph(LINKS);
  assert.ok(nodes.get(nodeKey(A)).edges.some((edge) => edge.to === nodeKey(MID_NORTH)));
  assert.ok(nodes.get(nodeKey(MID_NORTH)).edges.some((edge) => edge.to === nodeKey(A)));
});

test('buildGraph hopper over nullengde-lenker', () => {
  const nodes = buildGraph([{ points: [A, { ...A }], weight: 1 }]);
  assert.equal([...nodes.values()].every((node) => node.edges.length === 0), true);
});

test('shortestPath velger stien framfor den tyngre vegen', () => {
  const path = shortestPath(buildGraph(LINKS), nodeKey(A), nodeKey(B));
  assert.equal(path.length, 3);
  assert.ok(Math.abs(path[1].lat - MID_NORTH.lat) < 1e-9, 'gikk om den sørlige vegen');
});

test('shortestPath gir null når nettet ikke henger sammen', () => {
  const nodes = buildGraph([
    ...LINKS,
    { points: [{ lat: 62.0, lon: 9.0 }, { lat: 62.0, lon: 9.01 }], weight: 1 },
  ]);
  assert.equal(shortestPath(nodes, nodeKey(A), nodeKey({ lat: 62.0, lon: 9.01 })), null);
});

test('shortestPath med samme start og mål gir ett punkt', () => {
  assert.equal(shortestPath(buildGraph(LINKS), nodeKey(A), nodeKey(A)).length, 1);
});

test('nearestNode finner nærmeste node innenfor grensen', () => {
  const nodes = buildGraph(LINKS);
  assert.equal(nearestNode(nodes, { lat: 61.0001, lon: 8.0201 }), nodeKey(MID_NORTH));
  assert.equal(nearestNode(nodes, { lat: 63.0, lon: 12.0 }), null);
});

test('nearestNode respekterer maksavstanden', () => {
  const nodes = buildGraph(LINKS);
  assert.equal(nearestNode(nodes, { lat: 61.01, lon: 8.0 }, 200), null);
  assert.equal(nearestNode(nodes, { lat: 61.01, lon: 8.0 }, 2000), nodeKey(A));
});

test('stitchNetworks kobler sammen to kilder som nesten møtes', () => {
  // Turrutebasen slutter der OpenStreetMap begynner, ti meter unna.
  const marked = { points: [{ lat: 61.0, lon: 8.0 }, { lat: 61.0, lon: 8.002 }], weight: 0.85 };
  const osm = { points: [{ lat: 61.00009, lon: 8.002 }, { lat: 61.0, lon: 8.004 }], weight: 1 };
  const nodes = buildGraph([marked, osm]);

  assert.equal(shortestPath(nodes, nodeKey(marked.points[0]), nodeKey(osm.points[1])), null);
  const added = stitchNetworks(nodes, 25);
  assert.ok(added >= 1, `sydde sammen ${added} par`);
  const path = shortestPath(nodes, nodeKey(marked.points[0]), nodeKey(osm.points[1]));
  assert.ok(path && path.length >= 4, 'fant ikke veg etter sammensying');
});

test('stitchNetworks lar nett som ligger langt fra hverandre være i fred', () => {
  const nodes = buildGraph([
    { points: [{ lat: 61.0, lon: 8.0 }, { lat: 61.0, lon: 8.002 }], weight: 1 },
    { points: [{ lat: 61.01, lon: 8.0 }, { lat: 61.01, lon: 8.002 }], weight: 1 },
  ]);
  assert.equal(stitchNetworks(nodes, 25), 0);
});
