// As cinco telas do terminal e as camadas de detalhe (empresa, setor no trimestre, nota). Tudo é recalculado para o
// trimestre selecionado no topo.
import { barCompare, bars, curveChart, heatmap, lineChart } from "./charts";
import {
  type Bulletin, Companies, type CompanyRaw, type Data, FIN, NONFIN, type Snapshot, TOTAL, esc, fmtMoney, fmtNum, fmtPct, fmtPp, fmtX,
  qLabel, qLong, quarterOf, sectorRow, sectorSeries, shiftQ, titleCase,
} from "./data";
import { $, type Col, delta, downloadCsv, icon, onSeg, openDrawer, openModal, panel, seg, spark, table } from "./ui";

export interface Ctx {
  d: Data;
  cos: Companies;
  q: string;
  heat: "receita_aa" | "lucro_aa" | "margem";
  agg: "receita" | "lucro" | "juros";
  sector: string;
  credit: "n" | "divida";
  rates: "1" | "3" | "all";
  screener: { text: string; setor: string; chips: Set<string>; sort: { key: string; dir: number } };
  sectorSort: { key: string; dir: number };
  go: (view: string, patch?: Partial<Ctx>) => void;
  setQuarter: (q: string) => void;
}

const money = (v: number | null | undefined, dd = 1) => (v == null ? "–" : "R$ " + fmtMoney(v, dd));
const window12 = (ctx: Ctx) => ctx.d.meta.trimestres.filter((x) => x <= ctx.q).slice(-12);
const nameCell = (c: CompanyRaw, sub = true) => `<span class="nm">${esc(titleCase(c.nome))}</span>${sub ? `<span class="nm-sub">${esc(c.setor)}</span>` : ""}`;

// ---------------------------------------------------------------- Painel

function kpi(label: string, value: string, deltaHtml: string, sparkSvg: string, sub = ""): string {
  return `<div class="kpi"><div class="kpi-top"><span class="kpi-label">${label}</span>${sparkSvg}</div>
    <div class="kpi-value">${value}</div><div class="kpi-sub">${deltaHtml}${sub ? `<span>${sub}</span>` : ""}</div></div>`;
}

function rateAtQuarterEnd(d: Data, q: string, key: "prefixado" | "ipca" | "inflacao_implicita"): number | null {
  const rows = d.tesouro.semanal.filter((r) => quarterOf(r.data) === q && r[key] != null);
  return rows.length ? rows[rows.length - 1][key] : null;
}

export function painel(stage: HTMLElement, ctx: Ctx) {
  const { d, q } = ctx;
  const q0 = shiftQ(q, -4), w = window12(ctx);
  const nf = sectorRow(d, NONFIN, q), nf0 = sectorRow(d, NONFIN, q0), all = sectorRow(d, TOTAL, q), all0 = sectorRow(d, TOTAL, q0);
  const sub = (a?: number | null, b?: number | null) => (a != null && b != null ? a - b : null);
  const share = (r?: { prejuizo: number; empresas: number }) => (r ? r.prejuizo / r.empresas : null);
  const inf = rateAtQuarterEnd(d, q, "inflacao_implicita"), inf1 = rateAtQuarterEnd(d, shiftQ(q, -1), "inflacao_implicita");
  const weekly = d.tesouro.semanal.filter((r) => r.data <= `${q.slice(0, 4)}-12-31` && quarterOf(r.data) <= q).slice(-52);

  stage.innerHTML = `<div class="view v-painel">
    <div class="kpis">
      ${kpi("Receita líquida · não fin.", money(nf?.receita, 0), delta(nf?.receita_aa, fmtPct(nf?.receita_aa) + " a/a"), spark(sectorSeries(d, NONFIN, "receita", w)))}
      ${kpi("Lucro líquido · todas", money(all?.lucro), delta(all?.lucro_aa, fmtPct(all?.lucro_aa) + " a/a"), spark(sectorSeries(d, TOTAL, "lucro", w), { bars: true }))}
      ${kpi("Margem líquida · não fin.", fmtPct(nf?.margem, false), delta(sub(nf?.margem, nf0?.margem), fmtPp(sub(nf?.margem, nf0?.margem)) + " a/a"), spark(sectorSeries(d, NONFIN, "margem", w), { zero: true }))}
      ${kpi("Dív. líq. / EBIT 12m", fmtX(nf?.div_liq_ebit), delta(sub(nf?.div_liq_ebit, nf0?.div_liq_ebit), fmtNum(sub(nf?.div_liq_ebit, nf0?.div_liq_ebit), 2) + "x a/a", true), spark(sectorSeries(d, NONFIN, "div_liq_ebit", w)))}
      ${kpi("Cias com prejuízo", all ? `${all.prejuizo}<small>/${all.empresas}</small>` : "–", delta(sub(share(all), share(all0)), fmtPp(sub(share(all), share(all0))) + " a/a", true), spark(w.map((x) => share(sectorRow(d, TOTAL, x)))))}
      ${kpi("Inflação implícita 5a", inf == null ? "–" : fmtNum(inf, 2) + "%", delta(sub(inf, inf1), fmtNum(sub(inf, inf1), 2) + " p.p. t/t", true), spark(weekly.map((r) => r.inflacao_implicita)), "fim do tri")}
    </div>
    ${panel("p-heat", "Mapa setorial", seg("s-heat", [["receita_aa", "Receita a/a"], ["lucro_aa", "Lucro a/a"], ["margem", "Margem"]], ctx.heat), `<div class="chart fill" id="c-heat"></div>`, "a-heat")}
    ${panel("p-nota", "Nota do trimestre", `<button class="icon-btn" id="nota-expand" title="Abrir nota completa">${icon.expand}</button>`, `<div id="nota"></div>`, "a-nota")}
    ${panel("p-agg", "Agregado", seg("s-agg", [["receita", "Receita"], ["lucro", "Lucro"], ["juros", "Juros 5a"]], ctx.agg), `<div class="chart fill" id="c-agg"></div>`, "a-agg")}
  </div>`;

  renderHeat(ctx);
  onSeg("s-heat", (v) => { ctx.heat = v as Ctx["heat"]; renderHeat(ctx); });
  renderAgg(ctx);
  onSeg("s-agg", (v) => { ctx.agg = v as Ctx["agg"]; renderAgg(ctx); });
  renderNotaPanel(ctx);
}

const HEAT = {
  receita_aa: { range: 0.3, signed: true },
  lucro_aa: { range: 1, signed: true },
  margem: { range: 0.2, signed: false },
};

function renderHeat(ctx: Ctx) {
  const { d } = ctx;
  const rows = d.meta.setores.filter((s) => ctx.heat === "lucro_aa" || s !== FIN);
  const cols = d.meta.trimestres;
  const m = HEAT[ctx.heat];
  heatmap($("#c-heat"), rows, cols, rows.map((s) => sectorSeries(d, s, ctx.heat)), (v) => fmtPct(v, m.signed, 0), m.range, (r, c) => {
    const row = sectorRow(d, rows[r], cols[c]);
    if (!row) return `<b>${esc(rows[r])}</b> · ${qLong(cols[c])}<br>sem dados`;
    return `<b>${esc(rows[r])}</b> · ${qLong(cols[c])}<br><span class="tt-big">${fmtPct(row[ctx.heat], m.signed)}</span><br>
      receita ${money(row.receita)} · lucro ${money(row.lucro)}<br>${row.empresas} cias · clique para abrir`;
  }, ctx.q, (r, c) => { ctx.setQuarter(cols[c]); sectorQuarterDrawer(ctx, rows[r], cols[c]); });
}

function renderAgg(ctx: Ctx) {
  const { d } = ctx;
  const x = d.meta.trimestres;
  const el = $("#c-agg");
  const bi = (v: number | null) => (v == null ? "–" : fmtNum(v, 0));
  if (ctx.agg === "receita") lineChart(el, x, [{ name: "Receita líquida, R$ bi", data: sectorSeries(d, NONFIN, "receita"), area: true }], bi, { markX: ctx.q, legend: false });
  else if (ctx.agg === "lucro") lineChart(el, x, [
    { name: "Não financeiras", data: sectorSeries(d, NONFIN, "lucro") },
    { name: "Financeiras", data: sectorSeries(d, FIN, "lucro") },
  ], bi, { zero: true, markX: ctx.q });
  else {
    const w = d.tesouro.semanal;
    lineChart(el, w.map((r) => r.data), [
      { name: "Prefixado", data: w.map((r) => r.prefixado) },
      { name: "IPCA+", data: w.map((r) => r.ipca) },
      { name: "Implícita", data: w.map((r) => r.inflacao_implicita) },
    ], (v) => (v == null ? "–" : fmtNum(v, 1) + "%"), { xFmt: (s) => (s.slice(5, 7) === "01" && Number(s.slice(8)) <= 7 ? s.slice(0, 4) : "") });
  }
}

// ---------------------------------------------------------------- Nota (boletim)

function bulletinFor(ctx: Ctx): Bulletin | undefined {
  return ctx.d.boletins.find((b) => b.trimestre === ctx.q) ?? ctx.d.boletins[0];
}

function bulletinHtml(b: Bulletin): string {
  const flagged = new Set(b.nao_verificados);
  const html = esc(b.texto).replace(/[-+]?\d{1,3}(?:\.\d{3})*(?:,\d+)?|[-+]?\d+(?:,\d+)?/g, (n) =>
    flagged.has(n.replace(/^[-+]/, "")) ? `<mark title="Fora da ficha de fatos">${n}</mark>` : n);
  return html.split(/\n{2,}/).map((p) => p.trim()).filter(Boolean).map((p) =>
    p.startsWith("# ") ? `<h3>${p.slice(2)}</h3>` : `<p>${p.replace(/\*\*(.+?)\*\*/g, "<b>$1</b>").replace(/\n/g, " ")}</p>`).join("");
}

function checks(b: Bulletin): string {
  const n = b.nao_verificados.length, t = b.termos_errados ?? [];
  return `<div class="checks">
    <span class="chip ${n ? "warn" : "ok"}">${n ? icon.alert : icon.check} ${n ? `${n} número${n > 1 ? "s" : ""} fora da ficha` : "números conferem"}</span>
    <span class="chip ${t.length ? "warn" : "ok"}">${t.length ? icon.alert : icon.check} ${t.length ? `${t.length} termo${t.length > 1 ? "s" : ""} incorreto${t.length > 1 ? "s" : ""}` : "termos conferem"}</span>
    <span class="chip">${esc(b.modelo)}</span></div>`;
}

function renderNotaPanel(ctx: Ctx) {
  const box = $("#nota");
  const b = bulletinFor(ctx);
  if (!b) { box.innerHTML = `<p class="empty">Sem nota gerada. <code>uv run python -m etl bulletin</code></p>`; return; }
  const other = b.trimestre !== ctx.q ? `<p class="note-ref">Nota disponível mais recente: ${qLong(b.trimestre)}</p>` : "";
  box.innerHTML = `${other}${checks(b)}<article class="note clip">${bulletinHtml(b)}</article>`;
  $("#nota-expand").onclick = () => notaModal(b);
  box.querySelector(".note")!.addEventListener("click", () => notaModal(b));
}

export function notaModal(b: Bulletin) {
  const terms = b.termos_errados ?? [];
  const facts = b.fatos ? Object.entries(b.fatos).filter(([, v]) => typeof v !== "object" || v === null) : [];
  openModal(`Nota · ${qLong(b.trimestre)}`, `<div class="note-wrap">
    <article class="note">${bulletinHtml(b)}</article>
    <aside class="note-side">
      ${checks(b)}
      ${terms.length ? `<h4>Termos que contradizem os dados</h4><ul>${terms.map((t) => `<li>${esc(t)}</li>`).join("")}</ul>` : ""}
      ${b.nao_verificados.length ? `<h4>Números fora da ficha</h4><p class="mono">${b.nao_verificados.map(esc).join(" · ")}</p>` : ""}
      <h4>Geração</h4><p>${esc(b.provedor)} · <code>${esc(b.modelo)}</code><br>${new Date(b.gerado_em).toLocaleString("pt-BR")}</p>
      <p class="muted">O modelo recebe só a ficha de fatos calculada pelo ETL. Números fora dela e termos incorretos são marcados automaticamente.</p>
      ${facts.length ? `<h4>Ficha</h4><dl>${facts.map(([k, v]) => `<dt>${esc(k)}</dt><dd>${esc(String(v))}</dd>`).join("")}</dl>` : ""}
    </aside></div>`, true);
}

// ---------------------------------------------------------------- Setor num trimestre (gaveta)

export function sectorQuarterDrawer(ctx: Ctx, sector: string, q: string) {
  const { d, cos } = ctx;
  const q0 = shiftQ(q, -4);
  const row = sectorRow(d, sector, q);
  const fin = sector === FIN;
  const members = cos.list.filter((c) => c.setor === sector);
  type R = { c: CompanyRaw; rec: number | null; rec0: number | null; luc: number | null; luc0: number | null };
  const rs: R[] = members.map((c) => ({ c, rec: cos.value(c, "receita", q), rec0: cos.value(c, "receita", q0), luc: cos.value(c, "lucro", q), luc0: cos.value(c, "lucro", q0) }))
    .filter((r) => r.rec != null || r.luc != null);
  const key = fin ? "luc" : "rec";
  const base = rs.reduce((s, r) => (r[key] != null && r[`${key}0` as "rec0"] != null ? s + (r[`${key}0` as "rec0"] as number) : s), 0);
  const contrib = (r: R) => { const a = r[key], b = r[`${key}0` as "rec0"]; return a != null && b != null && base > 0 ? (a - b) / base : null; };

  const body = openDrawer(`${esc(sector)} · ${qLong(q)}`, `
    <div class="mini-kpis">
      <div><span>Receita</span><b>${money(row?.receita)}</b>${delta(row?.receita_aa, fmtPct(row?.receita_aa))}</div>
      <div><span>Lucro</span><b>${money(row?.lucro)}</b>${delta(row?.lucro_aa, fmtPct(row?.lucro_aa))}</div>
      <div><span>Margem</span><b>${fmtPct(row?.margem, false)}</b></div>
      <div><span>Cias</span><b>${row?.empresas ?? "–"}</b><span class="muted">${row?.prejuizo ?? "–"} no prejuízo</span></div>
    </div>
    <p class="muted small">Contribuição: quanto cada empresa explica do crescimento ${fin ? "do lucro" : "da receita"} do setor contra ${qLong(q0)}, em pontos percentuais.</p>
    <div class="table-host" id="sq-table"></div>`);
  const cols: Col<R>[] = [
    { key: "nome", label: "Empresa", get: (r) => r.c.nome, fmt: (r) => nameCell(r.c, false) },
    { key: "rec", label: "Receita tri", get: (r) => r.rec, fmt: (r) => fmtMoney(r.rec), cls: "num" },
    { key: "rec_aa", label: "a/a", get: (r) => (r.rec != null && r.rec0 && r.rec0 > 0 ? r.rec / r.rec0 - 1 : null), fmt: (r) => fmtPct(r.rec != null && r.rec0 && r.rec0 > 0 ? r.rec / r.rec0 - 1 : null), cls: "num" },
    { key: "luc", label: "Lucro tri", get: (r) => r.luc, fmt: (r) => `<span class="${(r.luc ?? 0) < 0 ? "neg-t" : ""}">${fmtMoney(r.luc)}</span>`, cls: "num" },
    { key: "contrib", label: "Contrib.", get: (r) => contrib(r) == null ? null : Math.abs(contrib(r)!), fmt: (r) => contribBar(contrib(r)), cls: "num", title: "Contribuição para o crescimento do setor, p.p." },
  ];
  table(body.querySelector("#sq-table") as HTMLElement, rs, cols, { key: "contrib", dir: -1 }, (r) => companyModal(ctx, r.c));
}

function contribBar(v: number | null): string {
  if (v == null) return "–";
  const w = Math.min(40, Math.abs(v) * 200);
  return `<span class="cbar"><i class="${v < 0 ? "neg" : "pos"}" style="width:${w}px"></i>${fmtPp(v)}</span>`;
}

// ---------------------------------------------------------------- Empresa (modal)

export function companyModal(ctx: Ctx, c: CompanyRaw) {
  const { cos, d } = ctx;
  const all = cos.s.trimestres.filter((x) => x >= d.meta.trimestres[0]);
  const snaps = all.map((x) => cos.snapshot(c, x));
  const s = cos.snapshot(c, ctx.q) ?? snaps.filter(Boolean).pop() ?? null;
  const fin = c.setor === FIN;
  const body = openModal(esc(titleCase(c.nome)), `
    <div class="co-head">
      <span class="chip">${esc(c.setor)}</span><span class="chip">${esc(c.setor_cvm)}</span><span class="chip">CVM ${c.cd}</span>
      <span class="chip ${c.situacao === "ATIVO" ? "" : "warn"}">${esc(c.situacao.toLowerCase() || "situação ?")}</span>
      <button class="link" id="co-sector">abrir setor ${icon.right}</button>
    </div>
    <div class="mini-kpis six">
      <div><span>Receita 12m</span><b>${money(s?.receita_12m)}</b>${delta(s?.receita_12m_aa, fmtPct(s?.receita_12m_aa))}</div>
      <div><span>Lucro 12m</span><b class="${(s?.lucro_12m ?? 0) < 0 ? "neg-t" : ""}">${money(s?.lucro_12m)}</b></div>
      <div><span>Margem 12m</span><b>${fmtPct(s?.margem_12m, false)}</b></div>
      <div><span>EBIT 12m</span><b>${money(s?.ebit_12m)}</b></div>
      <div><span>Dív. líq. / EBIT</span><b>${fmtX(s?.div_liq_ebit)}</b>${s?.div_liq_ebit != null && s.div_liq_ebit_ant != null ? delta(s.div_liq_ebit - s.div_liq_ebit_ant, fmtNum(s.div_liq_ebit - s.div_liq_ebit_ant, 1) + "x", true) : ""}</div>
      <div><span>Patrimônio líq.</span><b>${money(s?.pl)}</b></div>
    </div>
    <p class="muted small">Indicadores no ${qLong(ctx.q)}${cos.snapshot(c, ctx.q) ? "" : " (sem formulário neste trimestre; último disponível)"}. Valores consolidados, R$ correntes.</p>
    <div class="co-charts">
      <figure><figcaption>${fin ? "Lucro" : "Receita e lucro"} trimestrais, R$ bi</figcaption><div class="chart" id="co-a"></div></figure>
      <figure><figcaption>${fin ? "Lucro 12 meses, R$ bi" : "Margem líquida 12 meses"}</figcaption><div class="chart" id="co-b"></div></figure>
      <figure><figcaption>Dívida líquida / EBIT 12 meses</figcaption><div class="chart" id="co-c"></div></figure>
      <figure><figcaption>Dívida líquida e patrimônio líquido, R$ bi</figcaption><div class="chart" id="co-d"></div></figure>
    </div>`, true);
  const bi = (v: number | null) => (v == null ? "–" : fmtNum(v, Math.abs(v) < 10 ? 2 : 1));
  const pick = (f: (x: Snapshot) => number | null) => snaps.map((x) => (x ? f(x) : null));
  bars(body.querySelector("#co-a") as HTMLElement, all, fin
    ? [{ name: "Lucro", data: cos.series(c, "lucro", all), signed: true, slot: 1 }]
    : [{ name: "Receita", data: cos.series(c, "receita", all) }, { name: "Lucro", data: cos.series(c, "lucro", all), signed: true }], bi, { markX: ctx.q });
  if (fin) lineChart(body.querySelector("#co-b") as HTMLElement, all, [{ name: "Lucro 12m", data: pick((x) => x.lucro_12m), slot: 1 }], bi, { zero: true, markX: ctx.q });
  else lineChart(body.querySelector("#co-b") as HTMLElement, all, [{ name: "Margem", data: pick((x) => x.margem_12m) }], (v) => fmtPct(v, false, 0), { zero: true, markX: ctx.q });
  lineChart(body.querySelector("#co-c") as HTMLElement, all, [{ name: "Dív/EBIT", data: pick((x) => x.div_liq_ebit) }], (v) => fmtX(v), { markX: ctx.q });
  lineChart(body.querySelector("#co-d") as HTMLElement, all, [
    { name: "Dívida líquida", data: cos.series(c, "divida_liquida", all) },
    { name: "Patrimônio líquido", data: cos.series(c, "pl", all), slot: 2 },
  ], bi, { zero: true, markX: ctx.q });
  (body.querySelector("#co-sector") as HTMLElement).onclick = () => ctx.go("setores", { sector: c.setor });
}

// ---------------------------------------------------------------- Setores

export function setores(stage: HTMLElement, ctx: Ctx) {
  const { d, q } = ctx;
  stage.innerHTML = `<div class="view v-setores">
    ${panel("p-slist", `Setores · ${qLabel(q)}`, `<span class="muted small">clique para detalhar</span>`, `<div class="table-host" id="s-table"></div>`, "a-list")}
    ${panel("p-sdet", esc(ctx.sector), `<span class="muted small" id="s-cvm"></span>`, `<div class="quad">
        <figure><figcaption id="s-a-cap">Receita líquida trimestral, R$ bi</figcaption><div class="chart" id="s-a"></div></figure>
        <figure><figcaption id="s-b-cap">Receita a/a · mesmas empresas</figcaption><div class="chart" id="s-b"></div></figure>
        <figure><figcaption>Margem líquida</figcaption><div class="chart" id="s-c"></div></figure>
        <figure><figcaption>Dív. líq. / EBIT 12m</figcaption><div class="chart" id="s-d"></div></figure></div>`, "a-det")}
    ${panel("p-scos", `Empresas · 12m até ${qLabel(q)}`, `<span class="muted small" id="s-count"></span>`, `<div class="table-host" id="s-cos"></div>`, "a-cos")}
  </div>`;

  type R = { s: string; row: ReturnType<typeof sectorRow>; total: boolean };
  const rows: R[] = [...[NONFIN, TOTAL], ...d.meta.setores].map((s) => ({ s, row: sectorRow(d, s, q), total: s === NONFIN || s === TOTAL }));
  const w = window12(ctx);
  const cols: Col<R>[] = [
    { key: "s", label: "Setor", get: (r) => r.s, fmt: (r) => `<span class="${r.total ? "tot" : ""}">${esc(r.s)}</span>` },
    { key: "n", label: "Cias", get: (r) => r.row?.empresas ?? null, cls: "num" },
    { key: "rec", label: "Receita", get: (r) => r.row?.receita ?? null, fmt: (r) => fmtMoney(r.row?.receita, 1), cls: "num" },
    { key: "ra", label: "a/a", get: (r) => r.row?.receita_aa ?? null, fmt: (r) => pctCell(r.row?.receita_aa), cls: "num" },
    { key: "la", label: "Lucro a/a", get: (r) => r.row?.lucro_aa ?? null, fmt: (r) => pctCell(r.row?.lucro_aa), cls: "num" },
    { key: "m", label: "Margem", get: (r) => r.row?.margem ?? null, fmt: (r) => fmtPct(r.row?.margem, false), cls: "num" },
    { key: "de", label: "DL/EBIT", get: (r) => r.row?.div_liq_ebit ?? null, fmt: (r) => fmtX(r.row?.div_liq_ebit), cls: "num" },
    { key: "t", label: "12 tri", get: () => null, fmt: (r) => spark(sectorSeries(d, r.s, r.s === FIN ? "lucro_aa" : "receita_aa", w), { bars: true, w: 56 }), cls: "num", title: "Receita a/a nos últimos 12 trimestres (lucro a/a no Financeiro)" },
  ];
  table($("#s-table"), rows, cols, ctx.sectorSort, (r) => { ctx.sector = r.s; ctx.go("setores"); }, (r) => (r.s === ctx.sector ? "sel" : r.total ? "total" : ""));

  const s = ctx.sector, fin = s === FIN;
  $("#s-cvm").textContent = (d.meta.setores_cvm[s] ?? []).join(" · ");
  const x = d.meta.trimestres;
  $("#s-a-cap").textContent = fin ? "Lucro líquido trimestral, R$ bi" : "Receita líquida trimestral, R$ bi";
  $("#s-b-cap").textContent = fin ? "Lucro a/a · mesmas empresas" : "Receita a/a · mesmas empresas";
  bars($("#s-a"), x, [{ name: fin ? "Lucro" : "Receita", data: sectorSeries(d, s, fin ? "lucro" : "receita"), signed: fin }], (v) => (v == null ? "–" : fmtNum(v, 0)), { markX: q });
  lineChart($("#s-b"), x, [{ name: "a/a", data: sectorSeries(d, s, fin ? "lucro_aa" : "receita_aa") }], (v) => fmtPct(v, true, 0), { zero: true, markX: q });
  lineChart($("#s-c"), x, [{ name: "Margem", data: sectorSeries(d, s, "margem") }], (v) => fmtPct(v, false, 0), { zero: true, markX: q });
  lineChart($("#s-d"), x, [{ name: "DL/EBIT", data: sectorSeries(d, s, "div_liq_ebit") }], fmtX, { markX: q });

  const members = s === NONFIN ? (c: CompanyRaw) => c.setor !== FIN : s === TOTAL ? () => true : (c: CompanyRaw) => c.setor === s;
  const snaps = ctx.cos.snapshots(q, members);
  $("#s-count").textContent = `${snaps.length} cias`;
  table($("#s-cos"), snaps, companyCols(fin, false), { key: fin ? "luc" : "rec", dir: -1 }, (r) => companyModal(ctx, r.c));
}

const pctCell = (v: number | null | undefined) => `<span class="${v == null ? "" : v < 0 ? "neg-t" : "pos-t"}">${fmtPct(v)}</span>`;

function companyCols(fin: boolean, withSector: boolean): Col<Snapshot>[] {
  const cols: Col<Snapshot>[] = [
    { key: "nome", label: "Empresa", get: (r) => r.c.nome, fmt: (r) => nameCell(r.c, withSector) },
    { key: "rec", label: "Receita 12m", get: (r) => r.receita_12m, fmt: (r) => fmtMoney(r.receita_12m), cls: "num" },
    { key: "ra", label: "a/a", get: (r) => r.receita_12m_aa, fmt: (r) => pctCell(r.receita_12m_aa), cls: "num" },
    { key: "luc", label: "Lucro 12m", get: (r) => r.lucro_12m, fmt: (r) => `<span class="${(r.lucro_12m ?? 0) < 0 ? "neg-t" : ""}">${fmtMoney(r.lucro_12m)}</span>`, cls: "num" },
    { key: "m", label: "Margem", get: (r) => r.margem_12m, fmt: (r) => fmtPct(r.margem_12m, false), cls: "num" },
    { key: "de", label: "DL/EBIT", get: (r) => r.div_liq_ebit, fmt: (r) => leverageCell(r), cls: "num" },
  ];
  return fin ? cols.filter((c) => ["nome", "luc"].includes(c.key)).concat([{ key: "pl", label: "Patrimônio", get: (r) => r.pl, fmt: (r) => fmtMoney(r.pl), cls: "num" }]) : cols;
}

function leverageCell(r: Snapshot): string {
  if (r.divida_liquida != null && r.divida_liquida > 0 && (r.ebit_12m == null || r.ebit_12m <= 0) && r.ebit_12m != null) return `<span class="flag">EBIT ≤ 0</span>`;
  if (r.div_liq_ebit != null && r.div_liq_ebit > 4) return `<span class="flag">${fmtX(r.div_liq_ebit)}</span>`;
  if (r.divida_liquida != null && r.divida_liquida < 0) return `<span class="muted">caixa líq.</span>`;
  return fmtX(r.div_liq_ebit);
}

// ---------------------------------------------------------------- Empresas (screener)

const CHIPS: [string, string, (s: Snapshot) => boolean][] = [
  ["grandes", "Receita 12m > R$ 10 bi", (s) => (s.receita_12m ?? 0) > 10],
  ["prejuizo", "Prejuízo 12m", (s) => (s.lucro_12m ?? 0) < 0],
  ["alav", "DL/EBIT > 4x ou EBIT ≤ 0", (s) => (s.div_liq_ebit ?? 0) > 4 || ((s.divida_liquida ?? 0) > 0 && s.ebit_12m != null && s.ebit_12m <= 0)],
  ["cresc", "Receita a/a > 20%", (s) => (s.receita_12m_aa ?? 0) > 0.2],
];

export function empresas(stage: HTMLElement, ctx: Ctx) {
  const { d, q, screener: f } = ctx;
  stage.innerHTML = `<div class="view v-empresas">
    ${panel("p-screen", `Empresas · 12 meses até ${qLabel(q)}`, `
      <div class="filters">
        <label class="search-in">${icon.search}<input id="f-text" type="search" placeholder="Filtrar por nome" value="${esc(f.text)}" autocomplete="off"></label>
        <select id="f-setor"><option value="">Todos os setores</option>${d.meta.setores.map((s) => `<option ${s === f.setor ? "selected" : ""}>${esc(s)}</option>`).join("")}</select>
        ${CHIPS.map(([k, l]) => `<button class="chip toggle ${f.chips.has(k) ? "on" : ""}" data-k="${k}">${l}</button>`).join("")}
        <span class="muted small" id="f-count"></span>
        <button class="btn" id="f-csv">${icon.download} CSV</button>
      </div>`, `<div class="table-host" id="f-table"></div>`, "a-full")}
  </div>`;

  const all = ctx.cos.snapshots(q);
  const w = window12(ctx);
  let rows: Snapshot[] = [];
  const cols: Col<Snapshot>[] = [
    ...companyCols(false, true),
    { key: "ebit", label: "EBIT 12m", get: (r) => r.ebit_12m, fmt: (r) => fmtMoney(r.ebit_12m), cls: "num" },
    { key: "dl", label: "Dív. líq.", get: (r) => r.divida_liquida, fmt: (r) => fmtMoney(r.divida_liquida), cls: "num" },
    { key: "dpl", label: "DL/PL", get: (r) => r.div_liq_pl, fmt: (r) => fmtX(r.div_liq_pl), cls: "num" },
    { key: "sp", label: "Receita, 12 tri", get: () => null, fmt: (r) => spark(ctx.cos.series(r.c, r.c.setor === FIN ? "lucro" : "receita", w), { bars: true, w: 84 }), cls: "num" },
  ];
  const apply = () => {
    const text = f.text.trim().toLowerCase();
    rows = all.filter((s) => (!text || s.c.nome.toLowerCase().includes(text)) && (!f.setor || s.c.setor === f.setor)
      && CHIPS.every(([k, , fn]) => !f.chips.has(k) || fn(s)));
    $("#f-count").textContent = `${rows.length} de ${all.length}`;
    table($("#f-table"), rows, cols, f.sort, (r) => companyModal(ctx, r.c));
  };
  $<HTMLInputElement>("#f-text").oninput = (e) => { f.text = (e.target as HTMLInputElement).value; apply(); };
  $<HTMLSelectElement>("#f-setor").onchange = (e) => { f.setor = (e.target as HTMLSelectElement).value; apply(); };
  stage.querySelectorAll<HTMLButtonElement>(".chip.toggle").forEach((b) => (b.onclick = () => {
    const k = b.dataset.k!;
    if (f.chips.has(k)) f.chips.delete(k); else f.chips.add(k);
    b.classList.toggle("on");
    apply();
  }));
  $("#f-csv").onclick = () => downloadCsv(`empresas_${q}.csv`,
    ["cd_cvm", "empresa", "setor", "receita_12m_bi", "receita_12m_aa", "lucro_12m_bi", "margem_12m", "ebit_12m_bi", "divida_liquida_bi", "div_liq_ebit", "div_liq_pl"],
    rows.map((r) => [r.c.cd, r.c.nome, r.c.setor, r.receita_12m, r.receita_12m_aa, r.lucro_12m, r.margem_12m, r.ebit_12m, r.divida_liquida, r.div_liq_ebit, r.div_liq_pl]));
  apply();
}

// ---------------------------------------------------------------- Crédito

const BUCKETS: [string, (s: Snapshot) => boolean][] = [
  ["Caixa líquido", (s) => (s.divida_liquida ?? 0) < 0],
  ["0–1x", (s) => (s.div_liq_ebit ?? -1) >= 0 && s.div_liq_ebit! < 1],
  ["1–2x", (s) => (s.div_liq_ebit ?? -1) >= 1 && s.div_liq_ebit! < 2],
  ["2–3x", (s) => (s.div_liq_ebit ?? -1) >= 2 && s.div_liq_ebit! < 3],
  ["3–4x", (s) => (s.div_liq_ebit ?? -1) >= 3 && s.div_liq_ebit! < 4],
  ["4–6x", (s) => (s.div_liq_ebit ?? -1) >= 4 && s.div_liq_ebit! < 6],
  ["> 6x", (s) => (s.div_liq_ebit ?? -1) >= 6],
  ["EBIT ≤ 0", (s) => (s.divida_liquida ?? 0) > 0 && s.ebit_12m != null && s.ebit_12m <= 0],
];

export function credito(stage: HTMLElement, ctx: Ctx) {
  const { d, q } = ctx;
  const q0 = shiftQ(q, -4);
  stage.innerHTML = `<div class="view v-credito">
    ${panel("p-cbar", "Alavancagem por setor · DL/EBIT 12m", `<span class="muted small">clique num setor</span>`, `<div class="chart fill" id="c-cbar"></div>`, "a-bar")}
    ${panel("p-cdist", `Distribuição · ${qLabel(q)}`, seg("s-credit", [["n", "Empresas"], ["divida", "Dívida líq., R$ bi"]], ctx.credit), `<div class="chart fill" id="c-dist"></div>`, "a-dist")}
    ${panel("p-ctop", "Maiores dívidas líquidas", `<span class="muted small">não financeiras · ${qLabel(q)}</span>`, `<div class="table-host" id="c-top"></div>`, "a-top")}
  </div>`;

  const sectors = d.meta.setores.filter((s) => s !== FIN && sectorRow(d, s, q)?.div_liq_ebit != null)
    .sort((a, b) => (sectorRow(d, b, q)!.div_liq_ebit ?? 0) - (sectorRow(d, a, q)!.div_liq_ebit ?? 0));
  const cats = [NONFIN, ...sectors];
  barCompare($("#c-cbar"), cats, cats.map((s) => sectorRow(d, s, q)?.div_liq_ebit ?? null), cats.map((s) => sectorRow(d, s, q0)?.div_liq_ebit ?? null),
    [qLabel(q), qLabel(q0)], fmtX, (cat) => cat !== NONFIN && ctx.go("setores", { sector: cat }));

  const snaps = ctx.cos.snapshots(q, (c) => c.setor !== FIN).filter((s) => s.divida_liquida != null);
  const renderDist = () => {
    const vals = BUCKETS.map(([, fn]) => {
      const m = snaps.filter(fn);
      return ctx.credit === "n" ? m.length : m.reduce((acc, s) => acc + Math.max(0, s.divida_liquida ?? 0), 0);
    });
    bars($("#c-dist"), BUCKETS.map(([l]) => l), [{ name: ctx.credit === "n" ? "Empresas" : "Dívida líquida", data: vals }],
      (v) => (v == null ? "–" : ctx.credit === "n" ? String(v) : fmtNum(v, 0)), { xFmt: (s) => s });
  };
  renderDist();
  onSeg("s-credit", (v) => { ctx.credit = v as Ctx["credit"]; renderDist(); });

  const top = snaps.filter((s) => (s.divida_liquida ?? 0) > 0).sort((a, b) => b.divida_liquida! - a.divida_liquida!).slice(0, 60);
  table($("#c-top"), top, [
    { key: "nome", label: "Empresa", get: (r) => r.c.nome, fmt: (r) => nameCell(r.c) },
    { key: "dl", label: "Dív. líq.", get: (r) => r.divida_liquida, fmt: (r) => fmtMoney(r.divida_liquida), cls: "num" },
    { key: "de", label: "DL/EBIT", get: (r) => r.div_liq_ebit, fmt: leverageCell, cls: "num" },
    { key: "dd", label: "Δ 12m", get: (r) => (r.div_liq_ebit != null && r.div_liq_ebit_ant != null ? r.div_liq_ebit - r.div_liq_ebit_ant : null),
      fmt: (r) => (r.div_liq_ebit != null && r.div_liq_ebit_ant != null ? delta(r.div_liq_ebit - r.div_liq_ebit_ant, fmtNum(r.div_liq_ebit - r.div_liq_ebit_ant, 1) + "x", true) : "–"), cls: "num" },
    { key: "dpl", label: "DL/PL", get: (r) => r.div_liq_pl, fmt: (r) => fmtX(r.div_liq_pl), cls: "num" },
  ], { key: "dl", dir: -1 }, (r) => companyModal(ctx, r.c));
}

// ---------------------------------------------------------------- Juros

export function juros(stage: HTMLElement, ctx: Ctx) {
  const { d } = ctx;
  const w = d.tesouro.semanal;
  const last = w[w.length - 1];
  const back = (weeks: number) => w[Math.max(0, w.length - 1 - weeks)];
  const rk = (label: string, key: "prefixado" | "ipca" | "inflacao_implicita") => {
    const v = last[key], a = back(13)[key], b = back(52)[key];
    const dd = (x: number | null) => (v != null && x != null ? v - x : null);
    return `<div class="kpi"><div class="kpi-top"><span class="kpi-label">${label}</span>${spark(w.slice(-52).map((r) => r[key]))}</div>
      <div class="kpi-value">${fmtNum(v, 2)}%</div>
      <div class="kpi-sub">${delta(dd(a), fmtNum(dd(a), 2) + " p.p. 3m", true, 0.005)}${delta(dd(b), fmtNum(dd(b), 2) + " p.p. 12m", true, 0.005)}</div></div>`;
  };
  const curve = d.tesouro.curva;
  stage.innerHTML = `<div class="view v-juros">
    <div class="kpis three">${rk("Prefixado 5 anos", "prefixado")}${rk("IPCA+ 5 anos · juro real", "ipca")}${rk("Inflação implícita 5 anos", "inflacao_implicita")}</div>
    ${panel("p-rates", "Taxas de 5 anos · % a.a.", seg("s-rates", [["1", "1A"], ["3", "3A"], ["all", "Desde 2019"]], ctx.rates), `<div class="chart fill" id="c-rates"></div>`, "a-rates")}
    ${panel("p-curve", `Curva · ${curve.data.split("-").reverse().join("/")}`, "", `<div class="chart fill" id="c-curve"></div>`, "a-curve")}
    ${panel("p-titles", "Títulos ofertados", `<span class="muted small">taxa de compra</span>`, `<div class="table-host" id="c-titles"></div>`, "a-titles")}
  </div>`;

  const renderRates = () => {
    const n = ctx.rates === "all" ? w.length : Number(ctx.rates) * 52;
    const s = w.slice(-n);
    lineChart($("#c-rates"), s.map((r) => r.data), [
      { name: "Prefixado", data: s.map((r) => r.prefixado) },
      { name: "IPCA+ (real)", data: s.map((r) => r.ipca) },
      { name: "Inflação implícita", data: s.map((r) => r.inflacao_implicita) },
    ], (v) => (v == null ? "–" : fmtNum(v, 2) + "%"), {
      xFmt: (x) => (ctx.rates === "1" ? (x.slice(8) <= "07" ? x.slice(5, 7) + "/" + x.slice(2, 4) : "") : x.slice(5, 7) === "01" && x.slice(8) <= "07" ? x.slice(0, 4) : ""),
    });
  };
  renderRates();
  onSeg("s-rates", (v) => { ctx.rates = v as Ctx["rates"]; renderRates(); });

  const pts = (tipo: string) => curve.titulos.filter((t) => t.tipo === tipo).map((t) => [t.prazo_anos, t.taxa, t.vencimento] as [number, number, string]);
  curveChart($("#c-curve"), [{ name: "Prefixado", points: pts("prefixado") }, { name: "IPCA+", points: pts("ipca") }]);

  const NAMES = { prefixado: "Prefixado", ipca: "IPCA+", selic: "Selic" } as const;
  type TRow = (typeof curve.titulos)[number];
  table($("#c-titles"), curve.titulos, [
    { key: "tipo", label: "Título", get: (r: TRow) => NAMES[r.tipo], fmt: (r: TRow) => `<span class="dot dot-${r.tipo}"></span>${NAMES[r.tipo]}` },
    { key: "venc", label: "Vencimento", get: (r: TRow) => r.vencimento, fmt: (r: TRow) => r.vencimento.split("-").reverse().join("/"), cls: "num" },
    { key: "prazo", label: "Anos", get: (r: TRow) => r.prazo_anos, fmt: (r: TRow) => fmtNum(r.prazo_anos, 1), cls: "num" },
    { key: "taxa", label: "Taxa", get: (r: TRow) => r.taxa, fmt: (r: TRow) => (r.tipo === "selic" ? "Selic + " : r.tipo === "ipca" ? "IPCA + " : "") + fmtNum(r.taxa, 2) + "%", cls: "num" },
  ], { key: "prazo", dir: 1 });
}

// ---------------------------------------------------------------- Metodologia

export function metodologia(d: Data) {
  const m = d.meta;
  openModal("Metodologia", `<div class="method">
    <section><h4>Fontes</h4><p>DFP e ITR consolidados, cadastro de companhias: <a href="${m.fontes.cvm}" target="_blank" rel="noopener">dados.cvm.gov.br</a>. Preços e taxas do Tesouro Direto: <a href="${m.fontes.tesouro}" target="_blank" rel="noopener">Tesouro Transparente</a>. Processado em ${new Date(m.gerado_em).toLocaleString("pt-BR")}.</p></section>
    <section><h4>Universo</h4><p>${m.empresas_no_painel} companhias de registro categoria A, incluindo registros cancelados depois (sem viés de sobrevivência). Exercício fora do ano civil fica de fora.</p></section>
    <section><h4>Trimestres</h4><p>ITR traz o trimestre isolado. O 4º trimestre é a DFP anual menos o acumulado de nove meses (ou a soma dos três trimestres). Versão mais recente de cada formulário; só o exercício corrente.</p></section>
    <section><h4>Crescimento</h4><p>Sempre mesmas empresas: só quem publicou nos dois trimestres comparados. Lucro a/a indefinido quando o lucro somado do ano anterior não é positivo. Totais em R$ somam todas as que publicaram.</p></section>
    <section><h4>Financeiras</h4><p>Bancos, seguradoras e afins entram no lucro (achado pelo rótulo da conta, que muda de código entre planos), mas não em receita, margem e dívida.</p></section>
    <section><h4>Dívida</h4><p>Dívida líquida = empréstimos e financiamentos (circulante e não circulante) − caixa e aplicações. Alavancagem = dívida líquida / EBIT dos últimos quatro trimestres.</p></section>
    <section><h4>Correções</h4><p>${m.correcoes_escala} formulários com escala trocada (1000x) corrigidos antes de derivar o 4º trimestre. Excluídas para não contar o mesmo resultado duas vezes: ${m.excluidas.map((e) => `${esc(titleCase(e.nome))} (${esc(e.motivo)})`).join("; ")}.</p></section>
    <section><h4>Tesouro</h4><p>Taxa de compra (de venda quando o título não está à venda), interpolada linearmente no prazo de 5 anos entre vencimentos vizinhos, com e sem cupom. Inflação implícita = (1 + pré) / (1 + IPCA+) − 1.</p></section>
    <section><h4>Limites</h4><p>Valores nominais. Holdings que consolidam controladas listadas com números diferentes ainda contam em dobro. Setores com poucas empresas oscilam com uma só.</p></section>
  </div>`, true);
}
