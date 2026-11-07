/** `YYYY-MM-DD` for a local calendar day: what the API takes, with no timezone to shift it. */
export function toIsoDate(date: Date) {
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${date.getFullYear()}-${month}-${day}`;
}

/** The days of a month in Sunday-first weeks; null pads the cells outside it. */
export function monthGrid(year: number, month: number) {
  const days = new Date(year, month + 1, 0).getDate();
  const cells: (string | null)[] = Array(new Date(year, month, 1).getDay()).fill(null);
  for (let day = 1; day <= days; day += 1) cells.push(toIsoDate(new Date(year, month, day)));
  while (cells.length % 7 > 0) cells.push(null);
  return cells;
}
