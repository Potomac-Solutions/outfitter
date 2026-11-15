// A bar chart drawn on the server as SVG, so it shows without JavaScript.
//
// One series, one colour (the shop's primary), bars rounded only at the data end, a recessive
// baseline and top gridline, labels every few bars. Each bar's <title> is its tooltip on hover
// and what a screen reader reads; the same numbers are in a table under the chart.
import { escape } from './layout.js';

/**
 * `points`: [{ label, value, tip }]. `format` turns a value into words for the axis and tips.
 * `name` titles the chart and its table.
 */
export function barChart(points, { name, format = String, height = 180 } = {}) {
  const width = 720;
  const left = 56;
  const bottom = 26;
  const top = 12;
  const plot = height - top - bottom;
  const max = Math.max(1, ...points.map((point) => point.value));
  const step = (width - left) / Math.max(1, points.length);
  const gap = Math.min(4, step * 0.25);
  const barWidth = Math.max(1, step - gap);
  const every = Math.max(1, Math.ceil(points.length / 10));
  const y = (value) => top + plot - (value / max) * plot;
  const bars = points
    .map((point, i) => {
      const x = left + i * step + gap / 2;
      const h = Math.max(point.value > 0 ? 1 : 0, (point.value / max) * plot);
      const r = Math.min(4, barWidth / 2, h);
      const base = top + plot;
      // Square at the baseline, rounded at the top.
      const shape = h
        ? `<path d="M${x},${base} V${base - h + r} Q${x},${base - h} ${x + r},${base - h} H${x + barWidth - r} Q${x + barWidth},${base - h} ${x + barWidth},${base - h + r} V${base} Z" class="bar"/>`
        : '';
      // The hit area is the whole column, taller than the bar.
      return `<g class="col"><title>${escape(point.tip ?? `${point.label}: ${format(point.value)}`)}</title><rect x="${left + i * step}" y="${top}" width="${step}" height="${plot}" class="hit"/>${shape}${i % every === 0 ? `<text x="${x + barWidth / 2}" y="${height - 8}" text-anchor="middle" class="tick">${escape(point.label)}</text>` : ''}</g>`;
    })
    .join('');
  const table = `<details class="chart-table"><summary>${escape(name)} as a table</summary><table><thead><tr><th scope="col">Period</th><th scope="col">${escape(name)}</th></tr></thead><tbody>${points.map((point) => `<tr><td>${escape(point.label)}</td><td>${escape(format(point.value))}</td></tr>`).join('')}</tbody></table></details>`;
  return `<figure class="chart"><svg viewBox="0 0 ${width} ${height}" role="img" aria-label="${escape(name)}">
<line x1="${left}" x2="${width}" y1="${y(max)}" y2="${y(max)}" class="grid"/><text x="${left - 8}" y="${y(max) + 4}" text-anchor="end" class="tick">${escape(format(max))}</text>
<line x1="${left}" x2="${width}" y1="${top + plot}" y2="${top + plot}" class="axis"/><text x="${left - 8}" y="${top + plot + 4}" text-anchor="end" class="tick">${escape(format(0))}</text>
${bars}</svg>${table}</figure>`;
}

/** Horizontal bars for a breakdown (by fleet, by customer): a label, a bar, the value. */
export function rankBars(rows, { format = String } = {}) {
  const max = Math.max(1, ...rows.map((row) => row.value));
  return `<ul class="ranks">${rows
    .map((row) => `<li><span class="rank-label">${escape(row.label)}</span><span class="rank-track"><span class="rank-bar" style="width:${((row.value / max) * 100).toFixed(1)}%"></span></span><span class="rank-value">${escape(format(row.value))}</span></li>`)
    .join('')}</ul>`;
}
