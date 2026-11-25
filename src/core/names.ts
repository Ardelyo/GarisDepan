import { Rng } from './rng';

const ON = ['K', 'B', 'D', 'M', 'S', 'T', 'R', 'L', 'P', 'G', 'N', 'W', 'J', 'V', 'Ch', 'Br', 'Tr', 'Kr', 'St'];
const NU = ['a', 'e', 'i', 'o', 'u', 'ar', 'en', 'or', 'ia', 'au', 'el'];
const CO = ['n', 'r', 'l', 's', 'k', 'th', 'v', 'nd', 'st', 'm', 'g'];
const END = ['ia', 'a', 'or', 'en', 'ova', 'ara', 'esk', 'ung', 'ana', 'ir', 'ovo', 'ste', 'heim', 'grad', 'pura'];

/** Deterministic procedural province name. */
export function provinceName(seed: number, id: number): string {
  const r = new Rng((seed * 31 + id * 2654435761) >>> 0);
  r.next();
  let s = r.pick(ON) + r.pick(NU);
  if (r.chance(0.6)) s += r.pick(CO) + r.pick(NU);
  s += r.pick(END);
  s = s.replace(/([aeiou])\1+/g, '$1');
  return s.charAt(0).toUpperCase() + s.slice(1).toLowerCase();
}
