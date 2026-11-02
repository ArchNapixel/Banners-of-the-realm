import { formatReport } from '../src/engine/battle/report';
import { runBattle } from '../src/engine/battle/runBattle';
import { SCENARIOS } from './scenarios';

const [name = 'hills', seed = 'hills-1'] = process.argv.slice(2);
const sc = SCENARIOS[name];
if (!sc) {
  console.error(`Unknown scenario "${name}". Available: ${Object.keys(SCENARIOS).join(', ')}`);
  process.exit(1);
}
console.log(formatReport(runBattle(sc.build(seed), sc.onNight)));
