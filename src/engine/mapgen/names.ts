import { pickOne, type Rng } from '../core/rng';
import type { RaceId, TerrainId } from '../core/types';
import durrakin from '../data/names/durrakin.json';
import ghor from '../data/names/ghor.json';
import sylvaen from '../data/names/sylvaen.json';
import valdren from '../data/names/valdren.json';
import vashkari from '../data/names/vashkari.json';
import mapgen from '../data/mapgen.json';

interface RaceNames {
  kingdomPatterns: string[];
  villages: string[];
  prefixes: string[];
  suffixes: string[];
  houses?: string[];
  clans?: string[];
}
const NAMES: Record<RaceId, RaceNames> = { valdren, sylvaen, durrakin, ghor, vashkari };

const ROMAN = ['', 'II', 'III', 'IV', 'V', 'VI', 'VII', 'VIII', 'IX', 'X'];

/** Hands out names that are never reused within one game. `used` is shared with GameState.usedNames. */
export function createNamer(rng: Rng, used: string[]) {
  const taken = new Set(used);
  const claim = (name: string) => {
    let n = name, i = 1;
    while (taken.has(n)) n = `${name} ${ROMAN[i++] ?? i}`;
    taken.add(n);
    used.push(n);
    return n;
  };
  const free = (names: string[]) => names.filter((n) => !taken.has(n));

  return {
    /** Full-name list first, then the syllable generator. */
    village(race: RaceId): string {
      const d = NAMES[race];
      const list = free(d.villages);
      if (list.length) return claim(pickOne(rng, list));
      for (let tries = 0; tries < 20; tries++) {
        const n = pickOne(rng, d.prefixes) + pickOne(rng, d.suffixes);
        if (!taken.has(n)) return claim(n);
      }
      return claim(pickOne(rng, d.prefixes) + pickOne(rng, d.suffixes));
    },
    kingdom(race: RaceId, place: string): string {
      const d = NAMES[race];
      const pattern = pickOne(rng, d.kingdomPatterns);
      return claim(
        pattern
          .replace('{Place}', place)
          .replace('{House}', d.houses ? pickOne(rng, d.houses) : place)
          .replace('{Clan}', d.clans ? pickOne(rng, d.clans) : place),
      );
    },
    region(terrain: TerrainId): string {
      const words = mapgen.regionWords[terrain];
      for (let tries = 0; tries < 30; tries++) {
        const n = `${pickOne(rng, mapgen.regionParts)} ${pickOne(rng, words)}`;
        if (!taken.has(n)) return claim(n);
      }
      return claim(`${pickOne(rng, mapgen.regionParts)} ${pickOne(rng, words)}`);
    },
  };
}
