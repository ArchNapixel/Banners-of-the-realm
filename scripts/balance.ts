import { runBattle } from '../src/engine/battle/runBattle';
import { SCENARIOS } from './scenarios';

const runs = Number(process.argv[2] ?? 1000);

for (const [name, sc] of Object.entries(SCENARIOS)) {
  const wins = { attacker: 0, defender: 0, draw: 0 };
  let days = 0, aLoss = 0, dLoss = 0, pyrrhic = 0;
  for (let i = 0; i < runs; i++) {
    const b = runBattle(sc.build(`${name}-${i}`), sc.onNight);
    const r = b.result!;
    wins[r.winner ?? 'draw']++;
    days += b.day;
    pyrrhic += r.pyrrhic ? 1 : 0;
    const lost = (s: 'attacker' | 'defender') => r.summary[s].dead + r.summary[s].wounded + r.summary[s].captured;
    aLoss += lost('attacker');
    dLoss += lost('defender');
  }
  const pct = (x: number) => `${((x / runs) * 100).toFixed(1)}%`;
  console.log(`${name}: ${runs} battles`);
  console.log(`  attacker wins ${pct(wins.attacker)} | defender wins ${pct(wins.defender)} | draws ${pct(wins.draw)} | pyrrhic ${pct(pyrrhic)}`);
  console.log(`  avg days ${(days / runs).toFixed(2)} | avg losses (dead+wounded+captured) attacker ${Math.round(aLoss / runs)}, defender ${Math.round(dLoss / runs)}`);
}
