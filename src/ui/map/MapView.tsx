import { Application, Container, Graphics, Text } from 'pixi.js';
import { useEffect, useRef, useState } from 'react';
import { fromPixel, key, parseKey, toPixel } from '../../engine/core/hex';
import { kingdomOf } from '../../engine/core/kingdoms';
import { visibleKeys } from '../../engine/core/vision';
import type { Company, GameState, TerrainId } from '../../engine/core/types';
import { PLAYER, useGame } from '../../store/game';

const HEX = 28;
const COLORS: Record<TerrainId, number> = {
  plains: 0xa9b86b, forest: 0x2f6b3a, hills: 0x93805a, mountains: 0x80838c, marsh: 0x4d6b5c, coast: 0x4f86b0,
};
const FOG_UNEXPLORED = 0x05070a;

const corners = (cx: number, cy: number, size = HEX) =>
  Array.from({ length: 6 }, (_, i) => {
    const a = (Math.PI / 180) * (60 * i - 30);
    return [cx + size * Math.cos(a), cy + size * Math.sin(a)];
  }).flat();

interface Scene {
  app: Application;
  world: Container;
  terrain: Graphics;
  overlays: Graphics;
  fog: Graphics;
  labels: Container;
  villages: Container;
  units: Container;
  select: Graphics;
}

function drawTerrain(g: Graphics, game: GameState) {
  g.clear();
  for (const t of Object.values(game.map.tiles)) {
    const p = toPixel(t, HEX);
    g.poly(corners(p.x, p.y)).fill({ color: COLORS[t.terrain] }).stroke({ width: 1, color: 0x000000, alpha: 0.18 });
  }
}

/** Everything that depends on what the player has explored or can currently see. */
function drawKnowledge(s: Scene, game: GameState, selectedUnits: string[]) {
  const explored = new Set(game.kingdoms[PLAYER].explored);
  const visible = visibleKeys(game, PLAYER);

  s.overlays.clear();
  s.fog.clear();
  for (const [k, t] of Object.entries(game.map.tiles)) {
    const p = toPixel(t, HEX);
    if (!explored.has(k)) {
      s.fog.poly(corners(p.x, p.y, HEX + 0.5)).fill({ color: FOG_UNEXPLORED });
      continue;
    }
    if (!visible.has(k)) s.fog.poly(corners(p.x, p.y)).fill({ color: 0x000000, alpha: 0.5 });
    if (t.ancientForest) s.overlays.poly(corners(p.x, p.y, HEX - 3)).stroke({ width: 2, color: 0x0f3d1c, alpha: 0.9 });
    if (t.ley) s.overlays.circle(p.x, p.y, 7).fill({ color: 0x5fd4ff, alpha: 0.85 }).stroke({ width: 2, color: 0xffffff, alpha: 0.8 });
    if (t.ruins) s.overlays.rect(p.x - 6, p.y - 6, 12, 12).fill({ color: 0xcfc6a8 }).stroke({ width: 1.5, color: 0x3a3426 });
    if (t.goldDeposit) s.overlays.circle(p.x + 10, p.y - 10, 4).fill({ color: 0xffd34d }).stroke({ width: 1, color: 0x5a4300 });
  }

  s.labels.removeChildren().forEach((c) => c.destroy());
  for (const r of Object.values(game.map.regions)) {
    if (r.hexes.length < 10) continue;
    const pts = r.hexes.filter((h) => explored.has(h)).map(parseKey);
    if (pts.length < 4) continue;
    const mid = pts.reduce((m, h) => ({ q: m.q + h.q / pts.length, r: m.r + h.r / pts.length }), { q: 0, r: 0 });
    const p = toPixel(mid, HEX);
    const label = new Text({ text: r.name, style: { fontSize: 13, fill: 0xffffff, fontStyle: 'italic', letterSpacing: 1 } });
    label.anchor.set(0.5);
    label.alpha = 0.45;
    label.position.set(p.x, p.y);
    s.labels.addChild(label);
  }

  s.villages.removeChildren().forEach((c) => c.destroy());
  for (const v of Object.values(game.villages)) {
    const k = key(v.hex);
    if (!explored.has(k)) continue;
    const p = toPixel(v.hex, HEX);
    const owner = v.ownerId ? game.kingdoms[v.ownerId] : null;
    const color = owner ? Number.parseInt(owner.color.slice(1), 16) : 0x9aa0a6;
    const g = new Graphics();
    const capital = !!owner && owner.capitalId === v.id;
    if (capital) g.circle(p.x, p.y, 13).fill({ color: 0xffffff, alpha: 0.9 });
    g.circle(p.x, p.y, 9).fill({ color }).stroke({ width: 2, color: 0x101010 });
    s.villages.addChild(g);
    const t = new Text({ text: v.name, style: { fontSize: 12, fill: 0xffffff, stroke: { color: 0x000000, width: 3 } } });
    t.anchor.set(0.5, 0);
    t.position.set(p.x, p.y + 14);
    s.villages.addChild(t);
  }

  for (const sg of Object.values(game.sieges)) {
    const v = game.villages[sg.villageId];
    if (!v || !explored.has(key(v.hex))) continue;
    const p = toPixel(v.hex, HEX);
    const g = new Graphics();
    g.poly(corners(p.x, p.y, HEX - 4)).stroke({ width: 3, color: 0xff9f1c });
    s.villages.addChild(g);
  }
  for (const gb of Object.values(game.battles)) {
    if (!explored.has(key(gb.hex))) continue;
    const p = toPixel(gb.hex, HEX);
    const g = new Graphics();
    g.circle(p.x, p.y - 16, 9).fill({ color: 0xb3261e }).stroke({ width: 2, color: 0xffffff });
    s.villages.addChild(g);
    const t = new Text({ text: 'X', style: { fontSize: 12, fill: 0xffffff, fontWeight: 'bold' } });
    t.anchor.set(0.5);
    t.position.set(p.x, p.y - 16);
    s.villages.addChild(t);
  }

  // Banners: one per owner per hex; enemies only where we can see them.
  s.units.removeChildren().forEach((c) => c.destroy());
  const groups = new Map<string, Company[]>();
  for (const c of Object.values(game.companies)) {
    if (c.ownerId !== PLAYER && !visible.has(key(c.hex))) continue;
    const g = `${key(c.hex)}|${c.ownerId}`;
    groups.set(g, [...(groups.get(g) ?? []), c]);
  }
  for (const cs of groups.values()) {
    const first = cs[0];
    const p = toPixel(first.hex, HEX);
    const mine = first.ownerId === PLAYER;
    const color = Number.parseInt(kingdomOf(game, first.ownerId).color.slice(1), 16);
    const x = p.x + (mine ? 13 : -13), y = p.y - 2;
    const g = new Graphics();
    if (cs.some((c) => selectedUnits.includes(c.id))) g.circle(x + 5, y - 4, 13).stroke({ width: 3, color: 0xffe066 });
    g.moveTo(x, y + 10).lineTo(x, y - 14).stroke({ width: 2, color: 0x1a1a1a });
    g.rect(x, y - 14, 14, 10).fill({ color }).stroke({ width: 1.5, color: 0x101010 });
    if (mine && cs.every((c) => c.movementLeft > 0 && c.status !== 'garrison')) g.circle(x + 18, y - 12, 2.5).fill({ color: 0x7CFC00 });
    s.units.addChild(g);
    const armies = new Set(cs.map((c) => c.armyId ?? c.id));
    const t = new Text({ text: String(armies.size > 1 ? armies.size : cs.length), style: { fontSize: 10, fill: 0xffffff, fontWeight: 'bold' } });
    t.position.set(x + 3, y - 14);
    s.units.addChild(t);
  }
}

export function MapView() {
  const host = useRef<HTMLDivElement>(null);
  const scene = useRef<Scene | null>(null);
  const [ready, setReady] = useState(false);
  const game = useGame((s) => s.game)!;
  const selected = useGame((s) => s.selectedHex);
  const select = useGame((s) => s.select);
  const selectedUnits = useGame((s) => s.selectedUnits);
  const moveSelected = useGame((s) => s.moveSelected);
  const latest = useRef({ game, select, moveSelected });
  latest.current = { game, select, moveSelected };

  // Create the Pixi application once.
  useEffect(() => {
    const el = host.current!;
    const app = new Application();
    let inited = false, disposed = false;
    const cleanups: (() => void)[] = [];

    app.init({ resizeTo: el, background: 0x0b0e14, antialias: true }).then(() => {
      inited = true;
      if (disposed) return void app.destroy(true, { children: true });
      el.appendChild(app.canvas);
      const world = new Container();
      const s: Scene = {
        app, world,
        terrain: new Graphics(), overlays: new Graphics(), fog: new Graphics(),
        labels: new Container(), villages: new Container(), units: new Container(), select: new Graphics(),
      };
      world.addChild(s.terrain, s.overlays, s.fog, s.labels, s.villages, s.units, s.select);
      app.stage.addChild(world);
      scene.current = s;

      // Centre on the player's capital.
      const g = latest.current.game;
      const cap = toPixel(g.villages[g.kingdoms[PLAYER].capitalId].hex, HEX);
      world.position.set(el.clientWidth / 2 - cap.x, el.clientHeight / 2 - cap.y);

      // Pan, zoom and click-to-select, straight on the canvas.
      const canvas = app.canvas;
      let drag: { x: number; y: number; moved: boolean } | null = null;
      const down = (e: PointerEvent) => { if (e.button !== 0) return; drag = { x: e.clientX, y: e.clientY, moved: false }; canvas.setPointerCapture(e.pointerId); };
      const move = (e: PointerEvent) => {
        if (!drag) return;
        const dx = e.clientX - drag.x, dy = e.clientY - drag.y;
        if (!drag.moved && Math.hypot(dx, dy) < 4) return;
        drag.moved = true;
        world.position.x += dx; world.position.y += dy;
        drag.x = e.clientX; drag.y = e.clientY;
      };
      const up = (e: PointerEvent) => {
        if (drag && !drag.moved) {
          const r = canvas.getBoundingClientRect();
          const h = fromPixel((e.clientX - r.left - world.x) / world.scale.x, (e.clientY - r.top - world.y) / world.scale.y, HEX);
          latest.current.select(latest.current.game.map.tiles[key(h)] ? h : null);
        }
        drag = null;
      };
      // Right-click orders the selected army or company to move.
      const context = (e: MouseEvent) => {
        e.preventDefault();
        const r = canvas.getBoundingClientRect();
        const h = fromPixel((e.clientX - r.left - world.x) / world.scale.x, (e.clientY - r.top - world.y) / world.scale.y, HEX);
        if (latest.current.game.map.tiles[key(h)]) latest.current.moveSelected(h);
      };
      const wheel = (e: WheelEvent) => {
        e.preventDefault();
        const r = canvas.getBoundingClientRect();
        const mx = e.clientX - r.left, my = e.clientY - r.top;
        const f = e.deltaY < 0 ? 1.1 : 1 / 1.1;
        const ns = Math.min(2.5, Math.max(0.35, world.scale.x * f));
        const k = ns / world.scale.x;
        world.position.set(mx - (mx - world.x) * k, my - (my - world.y) * k);
        world.scale.set(ns);
      };
      canvas.addEventListener('pointerdown', down);
      canvas.addEventListener('pointermove', move);
      canvas.addEventListener('pointerup', up);
      canvas.addEventListener('wheel', wheel, { passive: false });
      canvas.addEventListener('contextmenu', context);
      cleanups.push(() => {
        canvas.removeEventListener('pointerdown', down);
        canvas.removeEventListener('pointermove', move);
        canvas.removeEventListener('pointerup', up);
        canvas.removeEventListener('wheel', wheel);
        canvas.removeEventListener('contextmenu', context);
      });
      setReady(true);
    });

    return () => {
      disposed = true;
      cleanups.forEach((f) => f());
      scene.current = null;
      if (inited) app.destroy(true, { children: true });
    };
  }, []);

  // Terrain only changes with the map.
  useEffect(() => {
    if (ready) drawTerrain(scene.current!.terrain, game);
  }, [ready, game.map]);

  // Fog, overlays, labels and villages follow the game state.
  useEffect(() => {
    if (ready) drawKnowledge(scene.current!, game, selectedUnits);
  }, [ready, game, selectedUnits]);

  useEffect(() => {
    if (!ready) return;
    const g = scene.current!.select;
    g.clear();
    if (selected) {
      const p = toPixel(selected, HEX);
      g.poly(corners(p.x, p.y, HEX - 1)).stroke({ width: 3, color: 0xffe066 });
    }
  }, [ready, selected]);

  return <div ref={host} className="h-full w-full cursor-grab" />;
}
