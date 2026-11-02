import { useState } from 'react';
import { recruitBlocker } from '../../engine/core/recruit';
import { UNIT_DEFS, companyMen } from '../../engine/core/units';
import { assignWorkers, buildBlocker, buildCost, effectiveStability, kingdomIncome, popCap, slotsFree, totalPop, villageEconomy } from '../../engine/core/economy';
import { BUILDINGS, ECON, RACES, TIERS } from '../../engine/core/data';
import type { RaceId, Resources, TaxLevel, Village } from '../../engine/core/types';
import { PLAYER, useGame } from '../../store/game';

const fmt = (n: number) => Math.round(n).toLocaleString('en-US');
const signed = (n: number) => `${n >= 0 ? '+' : ''}${n.toFixed(1)}`;
const cost = (c: Partial<Resources>) => Object.entries(c).map(([k, n]) => `${n} ${k}`).join(', ');
const raceLabel = (r: RaceId) => `${RACES[r].name} (${RACES[r].plain})`;

function Bar({ value, max, color }: { value: number; max: number; color: string }) {
  return (
    <div className="h-1.5 w-full rounded bg-white/10">
      <div className="h-full rounded" style={{ width: `${Math.min(100, (value / max) * 100)}%`, background: color }} />
    </div>
  );
}

export function VillagePanel({ village: v }: { village: Village }) {
  const game = useGame((s) => s.game)!;
  const order = useGame((s) => s.order);
  const mine = v.ownerId === PLAYER;
  const owner = v.ownerId ? game.kingdoms[v.ownerId] : null;
  const pop = totalPop(v);
  const cap = popCap(v);
  const eco = villageEconomy(game, v);
  const stab = effectiveStability(game, v);
  const tier = TIERS[v.tier];
  const income = mine ? kingdomIncome(game, PLAYER) : null;
  const next = tier.next;
  const races = Object.keys(v.populationByRace) as RaceId[];
  const [source, setSource] = useState<RaceId | null>(null);
  const draw = source && races.includes(source) ? source : races[0];

  const siege = game.sieges[v.id];
  const defenses = v.buildings.filter((b) => BUILDINGS[b.id].defense).map((b) => BUILDINGS[b.id].name);
  const annexPrice = Math.round(pop * ECON.capture.annexGoldPerResident);
  const rich = game.kingdoms[PLAYER].resources.gold >= annexPrice;

  return (
    <div className="space-y-4 text-sm">
      <div>
        <h2 className="text-lg font-semibold text-amber-200">{v.name}</h2>
        <p className="text-slate-400">
          {v.tier[0].toUpperCase() + v.tier.slice(1)} · {owner ? owner.name : 'Independent'}
        </p>
      </div>

      {siege && (
        <section className="space-y-1 rounded border border-orange-400/40 bg-orange-500/10 p-2 text-xs">
          <div className="font-semibold text-orange-200">Under siege by {game.kingdoms[siege.attackerId]?.name}</div>
          <div className="flex justify-between"><span>Walls breached</span><span>{Math.round(siege.breach * 100)}%</span></div>
          <div className="flex justify-between"><span>Stores</span><span>{siege.stores} turn{siege.stores === 1 ? '' : 's'}</span></div>
          {siege.stores <= 0 && <div className="flex justify-between"><span>Garrison morale</span><span>{siege.garrisonMorale}</span></div>}
          <p className="text-slate-400">Siege Engineers add 25% breach a day each. When the stores run out the garrison and people starve.</p>
        </section>
      )}
      {defenses.length > 0 && <p className="text-xs text-slate-400">Defenses: {defenses.join(', ')}</p>}
      {!v.ownerId && (
        <button disabled={!rich} className="w-full rounded bg-slate-700 px-2 py-1.5 enabled:hover:bg-slate-600 disabled:opacity-40" onClick={() => order({ type: 'annex', villageId: v.id })} title="Needs one of your villages within 4 hexes">
          Annex <span className="text-slate-400">({annexPrice} gold)</span>
        </button>
      )}

      <section>
        <div className="mb-1 flex justify-between"><span>Population</span><span>{fmt(pop)} / {fmt(cap)}</span></div>
        <Bar value={pop} max={cap} color="#7fb069" />
        <ul className="mt-2 space-y-0.5 text-slate-300">
          {(Object.entries(v.populationByRace) as [RaceId, number][]).map(([r, n]) => (
            <li key={r} className="flex justify-between"><span>{raceLabel(r)}</span><span>{fmt(n)}</span></li>
          ))}
        </ul>
      </section>

      <section>
        <div className="mb-1 flex justify-between">
          <span>Stability</span>
          <span title="Base drift + modifiers (temples, race, minorities, war weariness)">{Math.round(stab)} <span className="text-slate-500">(base {Math.round(v.stability)})</span></span>
        </div>
        <Bar value={stab} max={100} color={stab < 20 ? '#e5484d' : stab < 40 ? '#e5a84d' : '#6fb1ff'} />
        <p className="mt-1 text-xs text-slate-500">
          {stab >= ECON.stability.bonusAt ? '+10% production' : stab < ECON.stability.penaltyBelow ? '−20% production' : 'Normal production'}
          {stab < ECON.stability.revoltBelow && ' · risk of revolt'}
        </p>
      </section>

      {mine && (
        <>
          <section>
            <div className="mb-1 text-slate-300">Taxes</div>
            <div className="flex gap-1">
              {(['low', 'normal', 'high'] as TaxLevel[]).map((l) => (
                <button
                  key={l}
                  onClick={() => order({ type: 'setTax', villageId: v.id, level: l })}
                  className={`flex-1 rounded px-2 py-1 capitalize ${v.taxLevel === l ? 'bg-amber-500 text-black' : 'bg-slate-700 hover:bg-slate-600'}`}
                  title={`${ECON.tax[l].gold} gold per 100 civilians · ${ECON.tax[l].stability >= 0 ? '+' : ''}${ECON.tax[l].stability} stability per turn`}
                >
                  {l}
                </button>
              ))}
            </div>
            <p className="mt-1 text-xs text-slate-400">
              This village: {signed(eco.taxGold)} gold, food {signed(eco.produced.food - eco.foodUse)} per turn
            </p>
          </section>

          <section>
            <div className="mb-1 flex justify-between text-slate-300">
              <span>Buildings</span>
              <span>{v.buildings.length + v.buildQueue.length} / {tier.slots} slots</span>
            </div>
            <ul className="space-y-1">
              {v.buildings.map((b) => {
                const def = BUILDINGS[b.id];
                const w = assignWorkers(v)[b.id];
                return (
                  <li key={b.id} className="flex justify-between rounded bg-white/5 px-2 py-1">
                    <span>{def.name}</span>
                    <span className="text-slate-400">{def.workers ? `${fmt(w)}/${def.workers} workers` : 'no workers'}</span>
                  </li>
                );
              })}
              {v.buildQueue.map((q) => (
                <li key={q.id} className="flex justify-between rounded bg-amber-500/10 px-2 py-1 text-amber-200">
                  <span>{BUILDINGS[q.id].name}</span><span>{q.turnsLeft} turn{q.turnsLeft > 1 ? 's' : ''}</span>
                </li>
              ))}
            </ul>
          </section>

          <section>
            <div className="mb-1 text-slate-300">Build</div>
            {slotsFree(v) <= 0 && <p className="mb-1 text-xs text-slate-500">No free slots.{next && ' Upgrade the village for more.'}</p>}
            <ul className="max-h-64 space-y-1 overflow-y-auto pr-1">
              {Object.keys(BUILDINGS).map((id) => {
                const reason = buildBlocker(game, PLAYER, v, id);
                if (reason === 'Already built or under construction') return null;
                const def = BUILDINGS[id];
                return (
                  <li key={id}>
                    <button
                      disabled={!!reason}
                      onClick={() => order({ type: 'build', villageId: v.id, building: id })}
                      title={reason ?? `Build ${def.name}`}
                      className="w-full rounded bg-slate-700 px-2 py-1 text-left enabled:hover:bg-slate-600 disabled:opacity-40"
                    >
                      <div className="flex justify-between"><span>{def.name}</span><span className="text-slate-400">{def.turns}t</span></div>
                      <div className="text-xs text-slate-400">{reason ?? cost(buildCost(game.kingdoms[PLAYER].race, id))}</div>
                    </button>
                  </li>
                );
              })}
            </ul>
          </section>

          <section>
            <div className="mb-1 flex items-center justify-between text-slate-300">
              <span>Recruit</span>
              {races.length > 1 && (
                <select className="rounded bg-[#0b0e14] px-1 py-0.5 text-xs" value={draw} onChange={(e) => setSource(e.target.value as RaceId)} title="Which people to draw the men from">
                  {races.map((r) => <option key={r} value={r}>{raceLabel(r)}</option>)}
                </select>
              )}
            </div>
            {v.trainQueue.length > 0 && (
              <ul className="mb-1 space-y-1">
                {v.trainQueue.map((q) => (
                  <li key={q.slot} className="flex justify-between rounded bg-sky-500/10 px-2 py-1 text-sky-200">
                    <span>{UNIT_DEFS[q.id].name} <span className="text-xs text-slate-400">({q.men} {RACES[q.race].name})</span></span>
                    <span>{q.turnsLeft} turn{q.turnsLeft > 1 ? 's' : ''}</span>
                  </li>
                ))}
              </ul>
            )}
            <ul className="max-h-56 space-y-1 overflow-y-auto pr-1">
              {Object.keys(UNIT_DEFS).filter((id) => UNIT_DEFS[id].cost).map((id) => {
                const reason = recruitBlocker(game, PLAYER, v, id, draw);
                const def = UNIT_DEFS[id];
                // Hide units this people can never field, to keep the list readable.
                if (RACES[draw].forbiddenUnits.includes(id) || (def.allowedRaces && !def.allowedRaces.includes(draw))) return null;
                return (
                  <li key={id}>
                    <button
                      disabled={!!reason}
                      onClick={() => order({ type: 'recruit', villageId: v.id, unit: id, race: draw })}
                      title={reason ?? `Recruit ${def.name}`}
                      className="w-full rounded bg-slate-700 px-2 py-1 text-left enabled:hover:bg-slate-600 disabled:opacity-40"
                    >
                      <div className="flex justify-between"><span>{def.name} <span className="text-xs text-slate-400">({companyMen(id, draw)})</span></span><span className="text-slate-400">{def.turns}t</span></div>
                      <div className="text-xs text-slate-400">{reason ?? cost(def.cost!)}</div>
                    </button>
                  </li>
                );
              })}
            </ul>
          </section>

          {next && (
            <button
              onClick={() => order({ type: 'upgrade', villageId: v.id })}
              className="w-full rounded bg-slate-700 px-2 py-1.5 hover:bg-slate-600"
              title={`Needs ${Math.round(ECON.upgradePopShare * 100)}% of the population cap`}
            >
              Upgrade to {next} <span className="text-slate-400">({cost(TIERS[next].upgrade!)})</span>
            </button>
          )}
          {income && <p className="text-xs text-slate-500">Kingdom income: {signed(income.gold)} gold, {signed(income.food)} food, {signed(income.wood)} wood</p>}
        </>
      )}
    </div>
  );
}
