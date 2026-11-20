// Gráficos do terminal. Cores vêm dos tokens CSS (style.css): ao trocar o tema, todos são redesenhados com os novos.
import * as echarts from "echarts/core";
import { BarChart, HeatmapChart, LineChart } from "echarts/charts";
import { GridComponent, LegendComponent, MarkLineComponent, TooltipComponent, VisualMapComponent } from "echarts/components";
import { CanvasRenderer } from "echarts/renderers";

echarts.use([BarChart, HeatmapChart, LineChart, GridComponent, LegendComponent, MarkLineComponent,
  TooltipComponent, VisualMapComponent, CanvasRenderer]);

type Fmt = (v: number | null) => string;
type Opt = echarts.EChartsCoreOption;

export function tokens() {
  const css = getComputedStyle(document.documentElement);
  const v = (name: string) => css.getPropertyValue(name).trim();
  return {
    surface: v("--surface"), raised: v("--raised"), text1: v("--text-1"), text2: v("--text-2"), text3: v("--text-3"),
    grid: v("--line"), series: [v("--s1"), v("--s2"), v("--s3")], neg: v("--neg"), mid: v("--div-mid"), pos: v("--pos"),
    font: v("--font"), mono: v("--mono"), accent: v("--accent"),
  };
}
type T = ReturnType<typeof tokens>;

const registry = new Map<HTMLElement, { chart: echarts.ECharts; build: () => Opt; ro: ResizeObserver }>();

function mount(el: HTMLElement, build: () => Opt, onClick?: (p: any) => void) {
  let entry = registry.get(el);
  if (!entry) {
    const chart = echarts.init(el, undefined, { renderer: "canvas" });
    const ro = new ResizeObserver(() => chart.resize());
    ro.observe(el);
    entry = { chart, build, ro };
    registry.set(el, entry);
  }
  entry.build = build;
  entry.chart.off("click");
  if (onClick) entry.chart.on("click", onClick);
  entry.chart.setOption(build(), true);
}

export function redrawAll() {
  for (const e of registry.values()) e.chart.setOption(e.build(), true);
}

/** Descarta os gráficos que estavam dentro de root (troca de tela, modal fechado). */
export function disposeIn(root: HTMLElement) {
  for (const [el, e] of registry) {
    if (root.contains(el) || !el.isConnected) {
      e.ro.disconnect();
      e.chart.dispose();
      registry.delete(el);
    }
  }
}

const base = (t: T) => ({ backgroundColor: "transparent", textStyle: { fontFamily: t.font, color: t.text2 }, animationDuration: 250 });

const tip = (t: T) => ({
  backgroundColor: t.raised, borderColor: t.grid, borderWidth: 1, padding: [6, 9],
  textStyle: { color: t.text1, fontFamily: t.font, fontSize: 12 },
  extraCssText: "box-shadow: 0 8px 24px rgba(0,0,0,.28); border-radius: 6px;",
});

const axis = (t: T) => ({
  axisLine: { lineStyle: { color: t.grid } }, axisTick: { show: false },
  axisLabel: { color: t.text3, fontSize: 10, fontFamily: t.mono }, splitLine: { lineStyle: { color: t.grid, opacity: 0.55 } },
});

const qTick = (s: string) => (s.endsWith("T1") ? s.slice(0, 4) : "");

export interface LineSeries { name: string; data: (number | null)[]; slot?: number; area?: boolean }

export interface LineOpts { zero?: boolean; markX?: string; xFmt?: (s: string) => string; legend?: boolean }

/** Linhas com crosshair; markX desenha o trimestre selecionado. */
export function lineChart(el: HTMLElement, x: string[], series: LineSeries[], fmt: Fmt, o: LineOpts = {}) {
  mount(el, () => {
    const t = tokens();
    const legend = o.legend ?? series.length > 1;
    return {
      ...base(t),
      grid: { left: 4, right: 12, top: legend ? 26 : 10, bottom: 4, containLabel: true },
      legend: legend ? { top: 0, left: 0, icon: "roundRect", itemWidth: 10, itemHeight: 3, itemGap: 14, textStyle: { color: t.text2, fontSize: 11 } } : undefined,
      tooltip: {
        trigger: "axis", ...tip(t), axisPointer: { type: "line", lineStyle: { color: t.text3, width: 1 } },
        valueFormatter: (v: unknown) => fmt(typeof v === "number" ? v : null),
      },
      xAxis: { type: "category", data: x, boundaryGap: false, ...axis(t), splitLine: { show: false },
               axisLabel: { ...axis(t).axisLabel, formatter: o.xFmt ?? qTick, interval: 0, hideOverlap: true } },
      yAxis: { type: "value", scale: !o.zero, ...axis(t), axisLabel: { ...axis(t).axisLabel, formatter: (v: number) => fmt(v) } },
      series: series.map((s, i) => {
        const color = t.series[(s.slot ?? i) % t.series.length];
        return {
          name: s.name, type: "line", data: s.data, showSymbol: false, symbolSize: 7, color,
          lineStyle: { width: 1.75 },
          areaStyle: s.area ? { color: new echarts.graphic.LinearGradient(0, 0, 0, 1, [{ offset: 0, color: color + "40" }, { offset: 1, color: color + "00" }]) } : undefined,
          markLine: i === 0 ? {
            silent: true, symbol: "none", animation: false,
            data: [
              ...(o.zero ? [{ yAxis: 0, lineStyle: { color: t.text3, type: "solid", width: 1, opacity: 0.6 }, label: { show: false } }] : []),
              ...(o.markX && x.includes(o.markX) ? [{ xAxis: o.markX, lineStyle: { color: t.accent, type: "dashed", width: 1 }, label: { show: false } }] : []),
            ],
          } : undefined,
        };
      }),
    };
  });
}

export interface BarSeries { name: string; data: (number | null)[]; slot?: number; signed?: boolean }

/** Barras verticais (agrupadas); signed pinta negativos com a cor de queda. */
export function bars(el: HTMLElement, x: string[], series: BarSeries[], fmt: Fmt, o: { markX?: string; xFmt?: (s: string) => string } = {}) {
  mount(el, () => {
    const t = tokens();
    const legend = series.length > 1;
    return {
      ...base(t),
      grid: { left: 4, right: 8, top: legend ? 26 : 10, bottom: 4, containLabel: true },
      legend: legend ? { top: 0, left: 0, icon: "roundRect", itemWidth: 10, itemHeight: 8, textStyle: { color: t.text2, fontSize: 11 } } : undefined,
      tooltip: { trigger: "axis", ...tip(t), axisPointer: { type: "shadow", shadowStyle: { color: t.grid, opacity: 0.35 } },
                 valueFormatter: (v: unknown) => fmt(typeof v === "number" ? v : null) },
      xAxis: { type: "category", data: x, ...axis(t), splitLine: { show: false },
               axisLabel: { ...axis(t).axisLabel, formatter: o.xFmt ?? qTick, interval: 0, hideOverlap: true } },
      yAxis: { type: "value", ...axis(t), axisLabel: { ...axis(t).axisLabel, formatter: (v: number) => fmt(v) } },
      series: series.map((s, i) => {
        const color = t.series[(s.slot ?? i) % t.series.length];
        return {
          name: s.name, type: "bar", barMaxWidth: 14, barGap: "10%", color,
          data: s.data.map((v, k) => ({
            value: v,
            itemStyle: {
              color: s.signed && v != null && v < 0 ? t.neg : color,
              opacity: o.markX && x[k] !== o.markX ? 0.55 : 1,
              borderRadius: v != null && v < 0 ? [0, 0, 3, 3] : [3, 3, 0, 0],
            },
          })),
        };
      }),
    };
  });
}

/** Barras horizontais lado a lado (agora vs. um ano antes). */
export function barCompare(el: HTMLElement, cats: string[], now: (number | null)[], before: (number | null)[], labels: [string, string], fmt: Fmt,
                           onClick?: (cat: string) => void) {
  mount(el, () => {
    const t = tokens();
    return {
      ...base(t),
      grid: { left: 4, right: 44, top: 26, bottom: 4, containLabel: true },
      legend: { top: 0, left: 0, icon: "roundRect", itemWidth: 10, itemHeight: 8, textStyle: { color: t.text2, fontSize: 11 } },
      tooltip: { trigger: "axis", axisPointer: { type: "shadow", shadowStyle: { color: t.grid, opacity: 0.35 } }, ...tip(t),
                 valueFormatter: (v: unknown) => fmt(typeof v === "number" ? v : null) },
      xAxis: { type: "value", ...axis(t), axisLabel: { ...axis(t).axisLabel, formatter: (v: number) => fmt(v) } },
      yAxis: { type: "category", data: cats, inverse: true, ...axis(t), splitLine: { show: false },
               axisLabel: { color: t.text2, fontSize: 11, fontFamily: t.font } },
      series: [
        { name: labels[0], type: "bar", data: now, color: t.series[0], barGap: "12%", barMaxWidth: 10, cursor: "pointer",
          itemStyle: { borderRadius: [0, 3, 3, 0] },
          label: { show: true, position: "right", color: t.text2, fontSize: 10, fontFamily: t.mono, formatter: (p: { value: number }) => fmt(p.value) } },
        { name: labels[1], type: "bar", data: before, color: t.text3, barMaxWidth: 10, itemStyle: { borderRadius: [0, 3, 3, 0], opacity: 0.45 } },
      ],
    };
  }, onClick ? (p: { name: string }) => onClick(p.name) : undefined);
}

/** Mapa de calor setor x trimestre, divergente em zero; a coluna do trimestre selecionado ganha moldura. */
export function heatmap(el: HTMLElement, rows: string[], cols: string[], values: (number | null)[][], fmt: Fmt, range: number,
                        detail: (r: number, c: number) => string, selected: string, onCell: (r: number, c: number) => void) {
  mount(el, () => {
    const t = tokens();
    const sel = cols.indexOf(selected);
    const data = values.flatMap((row, r) => row.map((v, c) => ({
      value: [c, r, v == null ? "-" : v],
      itemStyle: c === sel ? { borderColor: t.text1, borderWidth: 1.5 } : undefined,
    })));
    return {
      ...base(t),
      grid: { left: 4, right: 4, top: 4, bottom: 30, containLabel: true },
      tooltip: { ...tip(t), formatter: (p: { value: [number, number, number | string] }) => detail(p.value[1], p.value[0]) },
      xAxis: { type: "category", data: cols, ...axis(t), splitLine: { show: false }, axisLine: { show: false },
               axisLabel: { ...axis(t).axisLabel, interval: 0,
                            formatter: (s: string, i: number) => (i === sel ? `{sel|${s.slice(-1)}T${s.slice(2, 4)}}` : qTick(s)),
                            rich: { sel: { color: t.text1, fontWeight: 600, fontFamily: t.mono, fontSize: 10, backgroundColor: t.accent + "33", padding: [2, 4], borderRadius: 3 } } } },
      yAxis: { type: "category", data: rows, inverse: true, ...axis(t), splitLine: { show: false }, axisLine: { show: false },
               axisLabel: { color: t.text2, fontSize: 11, fontFamily: t.font } },
      visualMap: {
        min: -range, max: range, calculable: false, orient: "horizontal", right: 0, bottom: 0, itemWidth: 8, itemHeight: 120,
        text: ["≥ " + fmt(range), fmt(-range)], textStyle: { color: t.text3, fontSize: 10, fontFamily: t.mono },
        inRange: { color: [t.neg, t.mid, t.pos] },
      },
      series: [{
        type: "heatmap", data, cursor: "pointer",
        itemStyle: { borderColor: t.surface, borderWidth: 1.5, borderRadius: 2 },
        emphasis: { itemStyle: { borderColor: t.text1, borderWidth: 1 } },
      }],
    };
  }, (p: { value: [number, number] }) => onCell(p.value[1], p.value[0]));
}

/** Curva de juros: taxa por prazo. */
export function curveChart(el: HTMLElement, curves: { name: string; points: [number, number, string][] }[]) {
  mount(el, () => {
    const t = tokens();
    const pct = (v: number) => v.toFixed(2).replace(".", ",") + "%";
    return {
      ...base(t),
      grid: { left: 4, right: 30, top: 26, bottom: 4, containLabel: true },
      legend: { top: 0, left: 0, icon: "circle", itemWidth: 7, textStyle: { color: t.text2, fontSize: 11 } },
      tooltip: { trigger: "item", ...tip(t),
                 formatter: (p: { seriesName: string; data: [number, number, string] }) =>
                   `<b>${p.seriesName}</b> ${p.data[2].split("-").reverse().join("/")}<br>${pct(p.data[1])} a.a. · ${p.data[0].toFixed(1).replace(".", ",")} anos` },
      xAxis: { type: "value", name: "anos", nameLocation: "end", nameGap: 6, nameTextStyle: { color: t.text3, fontSize: 10 }, ...axis(t) },
      yAxis: { type: "value", scale: true, ...axis(t), axisLabel: { ...axis(t).axisLabel, formatter: pct } },
      series: curves.map((c, i) => ({
        name: c.name, type: "line", data: c.points, color: t.series[i], symbol: "circle", symbolSize: 7, lineStyle: { width: 1.75 },
        itemStyle: { borderColor: t.surface, borderWidth: 1.5 },
      })),
    };
  });
}
