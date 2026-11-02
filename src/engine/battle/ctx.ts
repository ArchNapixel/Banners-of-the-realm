import type { Rng } from '../core/rng';
import type { Combatant } from './damage';
import type { AttackKind, BCompany, BSide, Battle, RoundLog, SideKey, Slot } from './types';

export interface Acc { start: number; taken: number; dealt: number; flanked: boolean; charged: boolean }

export interface Atk {
  from: BCompany;
  fs: SideKey;
  to: BCompany;
  ts: SideKey;
  kind: AttackKind;
  flanked?: boolean;
  /** override the attacker's stats (champions fight as soldiers with Atk 8) */
  attacker?: Combatant;
  extra?: number;
}

/** Everything a round phase needs; built once per round in resolveBattleDay. */
export interface RoundCtx {
  b: Battle;
  rng: Rng;
  round: number;
  /** absolute round counter across days */
  abs: number;
  log: RoundLog;
  acc: Record<string, Acc>;
  key(s: SideKey, c: BCompany): string;
  apply(attacks: Atk[]): void;
  /** apply fractional casualties to one company; returns men lost */
  inflict(s: SideKey, c: BCompany, dmg: number, from?: BCompany, spell?: boolean): number;
  pick(seeker: BSide, enemy: BSide, pool: Slot[], withAir?: boolean): BCompany | undefined;
  moment(text: string): void;
  cull(): void;
}

export const SIDES: SideKey[] = ['attacker', 'defender'];
export const opp = (s: SideKey): SideKey => (s === 'attacker' ? 'defender' : 'attacker');
