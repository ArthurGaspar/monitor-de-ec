// Gráficos do painel. Cores vêm dos tokens CSS (style.css), então claro/escuro troca num lugar só: ao mudar o tema,
// todos os gráficos são redesenhados com os tokens novos.
import * as echarts from "echarts/core";
import { BarChart, HeatmapChart, LineChart } from "echarts/charts";
import { GridComponent, LegendComponent, MarkLineComponent, TooltipComponent, VisualMapComponent } from "echarts/components";
import { CanvasRenderer } from "echarts/renderers";

echarts.use([BarChart, HeatmapChart, LineChart, GridComponent, LegendComponent, MarkLineComponent, TooltipComponent,
  VisualMapComponent, CanvasRenderer]);

type Fmt = (v: number | null) => string;

export function tokens() {
  const css = getComputedStyle(document.documentElement);
  const v = (name: string) => css.getPropertyValue(name).trim();
  return {
    surface: v("--surface"), text1: v("--text-1"), text2: v("--text-2"), text3: v("--text-3"), grid: v("--grid"),
    series: [v("--s1"), v("--s2"), v("--s3")], neg: v("--div-neg"), mid: v("--div-mid"), pos: v("--div-pos"),
    font: v("--font"),
  };
}

const registry = new Map<HTMLElement, () => echarts.EChartsCoreOption>();
const instances = new Map<HTMLElement, echarts.ECharts>();

function mount(el: HTMLElement, build: () => echarts.EChartsCoreOption) {
  registry.set(el, build);
  let chart = instances.get(el);
  if (!chart) {
    chart = echarts.init(el, undefined, { renderer: "canvas" });
    instances.set(el, chart);
    new ResizeObserver(() => chart!.resize()).observe(el);
  }
  chart.setOption(build(), true);
}

export function redrawAll() {
  for (const [el, build] of registry) instances.get(el)?.setOption(build(), true);
}

function base(t: ReturnType<typeof tokens>) {
  return {
    backgroundColor: "transparent",
    textStyle: { fontFamily: t.font, color: t.text2 },
    animationDuration: 300,
  };
}

function tooltipBox(t: ReturnType<typeof tokens>) {
  return {
    backgroundColor: t.surface, borderColor: t.grid, borderWidth: 1, padding: [8, 10],
    textStyle: { color: t.text1, fontFamily: t.font, fontSize: 12 },
    extraCssText: "box-shadow: 0 4px 16px rgba(0,0,0,.12); border-radius: 8px;",
  };
}

function axisCommon(t: ReturnType<typeof tokens>) {
  return {
    axisLine: { lineStyle: { color: t.grid } }, axisTick: { show: false },
    axisLabel: { color: t.text3, fontSize: 11 }, splitLine: { lineStyle: { color: t.grid, opacity: 0.6 } },
  };
}

export interface LineSeries { name: string; data: (number | null)[]; slot?: number; dashed?: boolean }

/** Linhas com crosshair e tooltip; legenda e rótulo no fim da linha quando há mais de uma série. */
export function lineChart(el: HTMLElement, x: string[], series: LineSeries[], fmt: Fmt, opts: { zero?: boolean; xFmt?: (s: string) => string } = {}) {
  mount(el, () => {
    const t = tokens();
    const multi = series.length > 1;
    return {
      ...base(t),
      grid: { left: 8, right: multi ? 92 : 16, top: multi ? 36 : 16, bottom: 8, containLabel: true },
      legend: multi ? { top: 0, left: 0, icon: "roundRect", itemWidth: 12, itemHeight: 3, textStyle: { color: t.text2 } } : undefined,
      tooltip: {
        trigger: "axis", ...tooltipBox(t),
        axisPointer: { type: "line", lineStyle: { color: t.text3, width: 1 } },
        valueFormatter: (v: unknown) => fmt(typeof v === "number" ? v : null),
      },
      xAxis: { type: "category", data: x, boundaryGap: false, ...axisCommon(t), splitLine: { show: false },
               axisLabel: { color: t.text3, fontSize: 11, formatter: opts.xFmt ?? ((s: string) => s) } },
      yAxis: { type: "value", scale: !opts.zero, ...axisCommon(t), axisLabel: { color: t.text3, fontSize: 11, formatter: (v: number) => fmt(v) } },
      series: series.map((s, i) => ({
        name: s.name, type: "line", data: s.data, connectNulls: false, showSymbol: false, symbolSize: 8,
        lineStyle: { width: 2, type: s.dashed ? "dashed" : "solid" },
        color: t.series[(s.slot ?? i) % t.series.length],
        emphasis: { focus: "series" },
        endLabel: multi ? { show: true, color: t.text2, fontSize: 11, formatter: (p: { value: number }) => fmt(p.value) } : undefined,
        markLine: i === 0 && opts.zero ? { silent: true, symbol: "none", label: { show: false },
                                          lineStyle: { color: t.text3, type: "solid", width: 1 }, data: [{ yAxis: 0 }] } : undefined,
      })),
    };
  });
}

/** Mapa de calor setor x trimestre, escala divergente centrada em zero (azul positivo, vermelho negativo). */
export function heatmap(el: HTMLElement, rows: string[], cols: string[], values: (number | null)[][], fmt: Fmt, range: number,
                        detail: (r: number, c: number) => string, colFmt: (s: string) => string) {
  mount(el, () => {
    const t = tokens();
    const data: [number, number, number | string][] = [];
    values.forEach((row, r) => row.forEach((v, c) => data.push([c, r, v == null ? "-" : v])));
    return {
      ...base(t),
      grid: { left: 8, right: 8, top: 8, bottom: 56, containLabel: true },
      tooltip: { ...tooltipBox(t), formatter: (p: { data: [number, number, number | string] }) => detail(p.data[1], p.data[0]) },
      xAxis: { type: "category", data: cols, ...axisCommon(t), splitLine: { show: false }, axisLine: { show: false },
               axisLabel: { color: t.text3, fontSize: 10, formatter: colFmt, interval: (i: number) => cols[i].endsWith("T1") } },
      yAxis: { type: "category", data: rows, inverse: true, ...axisCommon(t), splitLine: { show: false }, axisLine: { show: false },
               axisLabel: { color: t.text2, fontSize: 11 } },
      visualMap: {
        min: -range, max: range, calculable: false, orient: "horizontal", left: "center", bottom: 0, itemWidth: 12, itemHeight: 160,
        text: [fmt(range) + " ou mais", fmt(-range)], textStyle: { color: t.text3, fontSize: 11 },
        inRange: { color: [t.neg, t.mid, t.pos] },
      },
      series: [{ type: "heatmap", data, itemStyle: { borderColor: t.surface, borderWidth: 2, borderRadius: 3 },
                 emphasis: { itemStyle: { borderColor: t.text1, borderWidth: 1 } } }],
    };
  });
}

/** Barras horizontais lado a lado (agora vs. um ano antes), ordenadas pelo valor atual. */
export function barCompare(el: HTMLElement, cats: string[], now: (number | null)[], before: (number | null)[], labels: [string, string], fmt: Fmt) {
  mount(el, () => {
    const t = tokens();
    return {
      ...base(t),
      grid: { left: 8, right: 48, top: 32, bottom: 8, containLabel: true },
      legend: { top: 0, left: 0, icon: "roundRect", itemWidth: 12, itemHeight: 8, textStyle: { color: t.text2 } },
      tooltip: { trigger: "axis", axisPointer: { type: "shadow", shadowStyle: { color: t.grid, opacity: 0.4 } }, ...tooltipBox(t),
                 valueFormatter: (v: unknown) => fmt(typeof v === "number" ? v : null) },
      xAxis: { type: "value", ...axisCommon(t), axisLabel: { color: t.text3, fontSize: 11, formatter: (v: number) => fmt(v) } },
      yAxis: { type: "category", data: cats, inverse: true, ...axisCommon(t), splitLine: { show: false }, axisLabel: { color: t.text2, fontSize: 11 } },
      series: [
        { name: labels[0], type: "bar", data: now, color: t.series[0], barGap: "15%", barMaxWidth: 12,
          itemStyle: { borderRadius: [0, 4, 4, 0] },
          label: { show: true, position: "right", color: t.text2, fontSize: 11, formatter: (p: { value: number }) => fmt(p.value) } },
        { name: labels[1], type: "bar", data: before, color: t.text3, barMaxWidth: 12, itemStyle: { borderRadius: [0, 4, 4, 0], opacity: 0.55 } },
      ],
    };
  });
}

/** Curva de juros: taxa por prazo, uma linha com marcadores por tipo de título. */
export function curveChart(el: HTMLElement, curves: { name: string; points: [number, number, string][] }[]) {
  mount(el, () => {
    const t = tokens();
    const pct = (v: number) => v.toFixed(2).replace(".", ",") + "%";
    return {
      ...base(t),
      grid: { left: 8, right: 64, top: 36, bottom: 24, containLabel: true },
      legend: { top: 0, left: 0, icon: "circle", itemWidth: 8, textStyle: { color: t.text2 } },
      tooltip: { trigger: "item", ...tooltipBox(t),
                 formatter: (p: { seriesName: string; data: [number, number, string] }) =>
                   `<b>${p.seriesName}</b><br>vence em ${p.data[2].split("-").reverse().join("/")}<br>${pct(p.data[1])} ao ano` },
      xAxis: { type: "value", name: "anos até o vencimento", nameLocation: "middle", nameGap: 26, nameTextStyle: { color: t.text3, fontSize: 11 },
               ...axisCommon(t) },
      yAxis: { type: "value", scale: true, ...axisCommon(t), axisLabel: { color: t.text3, fontSize: 11, formatter: pct } },
      series: curves.map((c, i) => ({
        name: c.name, type: "line", data: c.points, color: t.series[i], symbol: "circle", symbolSize: 8, lineStyle: { width: 2 },
        itemStyle: { borderColor: t.surface, borderWidth: 2 },
        endLabel: { show: true, color: t.text2, fontSize: 11, formatter: c.name },
      })),
    };
  });
}
