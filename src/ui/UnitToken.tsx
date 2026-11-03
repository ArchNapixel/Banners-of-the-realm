/** Shield token for a unit type, from public/troops/<unitId>.png. */
export function UnitToken({ id, size = 28 }: { id: string; size?: number }) {
  return <img src={`/troops/${id}.png`} alt="" width={size} height={Math.round(size * 1.2)} className="shrink-0" onError={(e) => { e.currentTarget.style.display = 'none'; }} />;
}
