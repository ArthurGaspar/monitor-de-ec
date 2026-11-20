import "./style.css";
import { barCompare, curveChart, heatmap, lineChart, redrawAll } from "./charts";
import { type Bulletin, type Company, type Data, NONFIN, type SectorRow, TOTAL, fmtBi, fmtNum, fmtPct, loadAll, quarterLabel } from "./data";

const $ = <T extends HTMLElement = HTMLElement>(sel: string, root: ParentNode = document) => root.querySelector(sel) as T;
const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!);
const shortQ = (q: string) => q.slice(0, 4);

function rowAt(d: Data, sector: string, q: string): SectorRow | undefined {
  return d.setores[sector]?.find((r) => r.q === q);
}

function prevYear(q: string): string {
  return `${Number(q.slice(0, 4)) - 1}${q.slice(4)}`;
}

function tile(label: string, value: string, note: string) {
  return `<div class="tile"><div class="tile-label">${label}</div><div class="tile-value">${value}</div><div class="tile-note">${note}</div></div>`;
}

function renderShell(d: Data) {
  const m = d.meta;
  const q = m.trimestre_empresas;
  const nf = rowAt(d, NONFIN, q), nf0 = rowAt(d, NONFIN, prevYear(q)), all = rowAt(d, TOTAL, q);
  const last = d.tesouro.semanal[d.tesouro.semanal.length - 1];
  const lastQ = rowAt(d, TOTAL, m.ultimo_trimestre), prevQ = rowAt(d, TOTAL, q);
  const partial = m.parcial && lastQ && prevQ
    ? `<p class="notice">O ${quarterLabel(m.ultimo_trimestre)} ainda está chegando: ${lastQ.empresas} de cerca de ${prevQ.empresas} empresas já publicaram. Os destaques usam o ${quarterLabel(q)}, o último completo; os gráficos mostram os dois.</p>`
    : "";

  $("#app").innerHTML = `
  <header class="top">
    <div>
      <p class="eyebrow">Dados abertos da CVM e do Tesouro Direto</p>
      <h1>Monitor da economia corporativa</h1>
      <p class="lede">A economia brasileira vista pelos balanços das ${m.empresas_no_painel} companhias abertas que entregam ITR e DFP à CVM:
      quem está vendendo mais, quem está ganhando dinheiro, quem está devendo demais, e quanto o Tesouro paga para se financiar.</p>
    </div>
    <button class="theme" id="theme" type="button" aria-label="Alternar tema claro/escuro">◐</button>
  </header>
  ${partial}
  <section class="tiles" aria-label="Destaques do ${quarterLabel(q)}">
    ${tile(`Receita, ${quarterLabel(q)}`, fmtBi(nf?.receita, 0), `${fmtPct(nf?.receita_aa)} sobre um ano antes · não financeiras`)}
    ${tile("Lucro líquido", fmtBi(all?.lucro, 1), `${fmtPct(all?.lucro_aa)} sobre um ano antes · todas`)}
    ${tile("Margem líquida", fmtPct(nf?.margem, false), `era ${fmtPct(nf0?.margem, false)} um ano antes`)}
    ${tile("Dívida líquida / EBIT 12m", fmtNum(nf?.div_liq_ebit) + "x", `era ${fmtNum(nf0?.div_liq_ebit)}x um ano antes`)}
    ${tile("Empresas no prejuízo", String(all?.prejuizo ?? "–"), `de ${all?.empresas ?? "–"} que publicaram`)}
    ${tile("Inflação implícita, 5 anos", fmtNum(last?.inflacao_implicita, 2) + "%", `prefixado ${fmtNum(last?.prefixado, 2)}% · IPCA+ ${fmtNum(last?.ipca, 2)}%`)}
  </section>

  <section class="card" id="boletim">
    <div class="card-head"><h2>Boletim do trimestre</h2><div id="bulletin-picker"></div></div>
    <div id="bulletin"></div>
  </section>

  <section class="card">
    <div class="card-head"><h2>O agregado</h2><p class="sub">Soma das empresas que publicaram em cada trimestre, em R$ bilhões correntes (sem correção pela inflação).</p></div>
    <div class="grid3">
      <figure><figcaption>Receita líquida trimestral · não financeiras</figcaption><div class="chart" id="c-receita"></div></figure>
      <figure><figcaption>Lucro líquido trimestral</figcaption><div class="chart" id="c-lucro"></div></figure>
      <figure><figcaption>Receita contra o mesmo trimestre do ano anterior · mesmas empresas</figcaption><div class="chart" id="c-cresc"></div></figure>
    </div>
  </section>

  <section class="card">
    <div class="card-head">
      <h2>Setor a setor, trimestre a trimestre</h2>
      <div class="seg" role="tablist" id="heat-metric">
        <button data-m="receita_aa" class="on">Receita a/a</button><button data-m="lucro_aa">Lucro a/a</button><button data-m="margem">Margem líquida</button>
      </div>
    </div>
    <p class="sub" id="heat-sub"></p>
    <div class="chart heat" id="c-heat"></div>
  </section>

  <section class="card">
    <div class="card-head"><h2>Um setor de perto</h2><select id="sector"></select></div>
    <p class="sub" id="sector-cvm"></p>
    <div class="grid3">
      <figure><figcaption>Receita, crescimento a/a</figcaption><div class="chart small" id="c-s-rec"></div></figure>
      <figure><figcaption>Margem líquida</figcaption><div class="chart small" id="c-s-mar"></div></figure>
      <figure><figcaption>Dívida líquida / EBIT 12 meses</figcaption><div class="chart small" id="c-s-div"></div></figure>
    </div>
    <h3>Empresas do setor · 12 meses até o ${quarterLabel(q)}</h3>
    <div class="table-wrap"><table id="companies"></table></div>
  </section>

  <section class="card">
    <div class="card-head"><h2>Endividamento por setor</h2><p class="sub">Dívida líquida (empréstimos e financiamentos menos caixa e aplicações) dividida pelo EBIT dos últimos 12 meses: quantos anos de resultado operacional pagariam a dívida.</p></div>
    <div class="chart tall" id="c-div"></div>
  </section>

  <section class="card">
    <div class="card-head"><h2>Tesouro Direto</h2><p class="sub">Taxa interpolada no prazo de 5 anos, toda semana desde 2019; inflação implícita é o que separa o prefixado do IPCA+ no mesmo prazo.</p></div>
    <div class="grid2">
      <figure><figcaption>Taxas de 5 anos, % ao ano</figcaption><div class="chart" id="c-tes"></div></figure>
      <figure><figcaption>Curva em ${d.tesouro.curva.data.split("-").reverse().join("/")}</figcaption><div class="chart" id="c-curva"></div></figure>
    </div>
  </section>

  <section class="card method">
    <h2>Como os números são feitos</h2>
    <ul>
      <li><b>Fonte.</b> Demonstrações consolidadas das DFP (anuais) e ITR (trimestrais) em <a href="${m.fontes.cvm}">dados.cvm.gov.br</a>, cadastro de companhias da CVM e preços e taxas do <a href="${m.fontes.tesouro}">Tesouro Transparente</a>. Atualizado em ${new Date(m.gerado_em).toLocaleDateString("pt-BR")}.</li>
      <li><b>Quem entra.</b> Empresas de registro categoria A (as que podem ter ações negociadas), inclusive as que tiveram o registro cancelado depois, para o passado não ficar só com as sobreviventes.</li>
      <li><b>Quarto trimestre.</b> Não existe ITR do quarto trimestre: ele é a DFP anual menos o acumulado de nove meses.</li>
      <li><b>Crescimento.</b> Sempre "mesmas empresas": compara só quem publicou nos dois trimestres, para IPOs e cancelamentos não virarem crescimento. Lucro a/a só existe quando o lucro do ano anterior é positivo.</li>
      <li><b>Bancos e seguradoras.</b> Entram no lucro, mas não em receita, margem e dívida: o plano de contas deles não tem receita de vendas nem dívida no mesmo sentido.</li>
      <li><b>Correções.</b> ${m.correcoes_escala} formulários com escala trocada (valores mil vezes fora) foram corrigidos. Ficaram de fora, para não contar o mesmo resultado duas vezes: ${m.excluidas.map((e) => `${esc(e.nome)} (${esc(e.motivo)})`).join("; ")}.</li>
      <li><b>Limites.</b> Valores nominais, sem correção pela inflação. Holdings que consolidam controladas também listadas, mas com números diferentes, ainda contam em dobro. Setores com poucas empresas (Papel e celulose tem quatro) oscilam com uma empresa só.</li>
      <li><b>Boletim.</b> Escrito por um LLM a partir de uma ficha de fatos calculada pelo ETL. Todo número do texto que não está na ficha aparece marcado. O texto descreve; não recomenda investimento.</li>
    </ul>
  </section>
  <footer>Código e dados no repositório. Dados públicos da CVM e do Tesouro Nacional.</footer>`;
}

function renderBulletin(d: Data) {
  const box = $("#bulletin"), picker = $("#bulletin-picker");
  if (!d.boletins.length) {
    box.innerHTML = `<p class="empty">Nenhum boletim gerado ainda. Rode <code>uv run python -m etl bulletin</code>.</p>`;
    return;
  }
  const show = (b: Bulletin) => {
    let html = esc(b.texto);
    const flagged = new Set(b.nao_verificados);
    // Marca no texto os números que não estão na ficha de fatos.
    html = html.replace(/[-+]?\d{1,3}(?:\.\d{3})*(?:,\d+)?|[-+]?\d+(?:,\d+)?/g, (n) =>
      flagged.has(n.replace(/^[-+]/, "")) ? `<mark title="Número que não está na ficha de fatos">${n}</mark>` : n);
    const blocks = html.split(/\n{2,}/).map((p) => p.trim()).filter(Boolean).map((p) =>
      p.startsWith("# ") ? `<h3 class="b-title">${p.slice(2)}</h3>` : `<p>${p.replace(/\*\*(.+?)\*\*/g, "<b>$1</b>").replace(/\n/g, " ")}</p>`);
    const terms = b.termos_errados ?? [];
    const check = (flagged.size
      ? `<span class="warn">${flagged.size} número(s) fora da ficha de fatos, marcados no texto</span>`
      : `<span class="ok">Todos os números conferem com a ficha de fatos</span>`) +
      (terms.length ? `<br><span class="warn">Termos que contradizem os dados: ${terms.map(esc).join("; ")}</span>` : "");
    box.innerHTML = `<article class="bulletin">${blocks.join("")}</article>
      <p class="b-meta">${quarterLabel(b.trimestre)} · escrito por <code>${esc(b.modelo)}</code> (${esc(b.provedor)}) em ${new Date(b.gerado_em).toLocaleDateString("pt-BR")} · ${check}</p>`;
  };
  if (d.boletins.length > 1) {
    picker.innerHTML = `<select id="b-sel">${d.boletins.map((b, i) => `<option value="${i}">${quarterLabel(b.trimestre)}</option>`).join("")}</select>`;
    $<HTMLSelectElement>("#b-sel").onchange = (e) => show(d.boletins[Number((e.target as HTMLSelectElement).value)]);
  }
  show(d.boletins[0]);
}

function series(d: Data, sector: string, key: keyof SectorRow): (number | null)[] {
  const by = new Map((d.setores[sector] ?? []).map((r) => [r.q, r[key] as number | null]));
  return d.meta.trimestres.map((q) => by.get(q) ?? null);
}

function renderAggregate(d: Data) {
  const x = d.meta.trimestres;
  const bi = (v: number | null) => (v == null ? "–" : fmtNum(v, 0));
  const xFmt = (s: string) => (s.endsWith("T1") ? shortQ(s) : "");
  lineChart($("#c-receita"), x, [{ name: "Receita", data: series(d, NONFIN, "receita") }], bi, { xFmt });
  lineChart($("#c-lucro"), x, [
    { name: "Não financeiras", data: series(d, NONFIN, "lucro") },
    { name: "Financeiras", data: series(d, "Financeiro", "lucro") },
  ], bi, { zero: true, xFmt });
  // Só receita: o lucro saindo da base deprimida de 2020 passa de +1.000% e achataria a linha. Ele está no mapa de calor.
  lineChart($("#c-cresc"), x, [{ name: "Receita", data: series(d, NONFIN, "receita_aa") }], (v) => fmtPct(v, true, 0), { zero: true, xFmt });
}

type HeatMetric = "receita_aa" | "lucro_aa" | "margem";
const HEAT: Record<HeatMetric, { range: number; sub: string }> = {
  receita_aa: { range: 0.3, sub: "Receita contra o mesmo trimestre do ano anterior, só com as empresas que publicaram nos dois. Bancos e seguradoras não têm receita comparável." },
  lucro_aa: { range: 1, sub: "Lucro líquido contra o mesmo trimestre do ano anterior. Célula vazia: lucro somado negativo no ano anterior, ou menos de três empresas." },
  margem: { range: 0.2, sub: "Lucro líquido sobre receita líquida no trimestre. Vermelho é prejuízo agregado do setor." },
};

function renderHeat(d: Data, metric: HeatMetric) {
  const rows = d.meta.setores.filter((s) => metric === "lucro_aa" || s !== "Financeiro");
  const cols = d.meta.trimestres;
  const values = rows.map((s) => series(d, s, metric));
  $("#heat-sub").textContent = HEAT[metric].sub;
  const signed = metric !== "margem";
  heatmap($("#c-heat"), rows, cols, values, (v) => fmtPct(v, signed, 0), HEAT[metric].range, (r, c) => {
    const row = rowAt(d, rows[r], cols[c]);
    if (!row) return `<b>${esc(rows[r])}</b><br>${quarterLabel(cols[c])}<br>sem dados`;
    const n = metric === "receita_aa" ? row.receita_aa_n : metric === "lucro_aa" ? row.lucro_aa_n : row.empresas;
    return `<b>${esc(rows[r])}</b><br>${quarterLabel(cols[c])}<br>${fmtPct(row[metric], signed)}<br>` +
      `<span style="opacity:.7">receita ${fmtBi(row.receita)} · lucro ${fmtBi(row.lucro)}<br>${n} empresas na conta</span>`;
  }, (s) => shortQ(s));
}

let sortKey: keyof Company = "receita_12m";
let sortDir = -1;

function renderSector(d: Data, sector: string) {
  const x = d.meta.trimestres;
  const xFmt = (s: string) => (s.endsWith("T1") ? shortQ(s) : "");
  const fin = sector === "Financeiro";
  $("#sector-cvm").textContent = `Setores da CVM incluídos: ${(d.meta.setores_cvm[sector] ?? []).join(", ")}.` +
    (fin ? " Bancos e seguradoras só têm lucro comparável; receita, margem e dívida ficam vazias." : "");
  lineChart($("#c-s-rec"), x, [{ name: "Receita a/a", data: series(d, sector, fin ? "lucro_aa" : "receita_aa") }], (v) => fmtPct(v, true, 0), { zero: true, xFmt });
  lineChart($("#c-s-mar"), x, [{ name: "Margem", data: series(d, sector, "margem") }], (v) => fmtPct(v, false, 0), { zero: true, xFmt });
  lineChart($("#c-s-div"), x, [{ name: "Dív. líq./EBIT", data: series(d, sector, "div_liq_ebit") }], (v) => (v == null ? "–" : fmtNum(v) + "x"), { xFmt });
  $("#c-s-rec").previousElementSibling!.textContent = fin ? "Lucro, crescimento a/a" : "Receita, crescimento a/a";
  renderTable(d, sector);
}

function renderTable(d: Data, sector: string) {
  const cols: [keyof Company, string, (c: Company) => string][] = [
    ["nome", "Empresa", (c) => esc(c.nome)],
    ["receita_12m", "Receita 12m", (c) => fmtBi(c.receita_12m)],
    ["receita_12m_aa", "Receita a/a", (c) => fmtPct(c.receita_12m_aa)],
    ["lucro_12m", "Lucro 12m", (c) => fmtBi(c.lucro_12m)],
    ["margem_12m", "Margem", (c) => fmtPct(c.margem_12m, false)],
    ["div_liq_ebit", "Dív. líq./EBIT", (c) => (c.div_liq_ebit == null ? "–" : fmtNum(c.div_liq_ebit) + "x")],
  ];
  const key = sector === "Financeiro" && sortKey === "receita_12m" ? "lucro_12m" : sortKey;
  const list = d.empresas.filter((c) => c.setor === sector).sort((a, b) => {
    const va = a[key], vb = b[key];
    if (va == null) return 1;
    if (vb == null) return -1;
    return (typeof va === "string" ? va.localeCompare(vb as string) : (va as number) - (vb as number)) * sortDir;
  });
  const table = $("#companies");
  table.innerHTML = `<thead><tr>${cols.map(([k, label]) =>
    `<th data-k="${k}" class="${k === key ? "sorted" : ""}" aria-sort="${k === key ? (sortDir > 0 ? "ascending" : "descending") : "none"}">${label}${k === key ? (sortDir > 0 ? " ↑" : " ↓") : ""}</th>`).join("")}</tr></thead>
    <tbody>${list.map((c) => `<tr>${cols.map(([k, , f]) => `<td class="${k === "nome" ? "name" : "num"}">${f(c)}</td>`).join("")}</tr>`).join("")}</tbody>`;
  table.querySelectorAll<HTMLElement>("th").forEach((th) => (th.onclick = () => {
    const k = th.dataset.k as keyof Company;
    sortDir = k === sortKey ? -sortDir : k === "nome" ? 1 : -1;
    sortKey = k;
    renderTable(d, sector);
  }));
}

function renderDebt(d: Data) {
  const q = d.meta.trimestre_empresas, q0 = prevYear(q);
  const sectors = d.meta.setores.filter((s) => s !== "Financeiro" && rowAt(d, s, q)?.div_liq_ebit != null)
    .sort((a, b) => (rowAt(d, b, q)!.div_liq_ebit ?? 0) - (rowAt(d, a, q)!.div_liq_ebit ?? 0));
  const cats = [NONFIN, ...sectors];
  barCompare($("#c-div"), cats, cats.map((s) => rowAt(d, s, q)?.div_liq_ebit ?? null), cats.map((s) => rowAt(d, s, q0)?.div_liq_ebit ?? null),
    [quarterLabel(q), quarterLabel(q0)], (v) => (v == null ? "–" : fmtNum(v) + "x"));
}

function renderTesouro(d: Data) {
  const w = d.tesouro.semanal;
  const x = w.map((r) => r.data);
  const pct = (v: number | null) => (v == null ? "–" : fmtNum(v, 1) + "%");
  lineChart($("#c-tes"), x, [
    { name: "Prefixado", data: w.map((r) => r.prefixado) },
    { name: "IPCA+ (real)", data: w.map((r) => r.ipca) },
    { name: "Inflação implícita", data: w.map((r) => r.inflacao_implicita) },
  ], pct, { xFmt: (s) => s.slice(0, 4) });
  const pts = (tipo: string) => d.tesouro.curva.titulos.filter((t) => t.tipo === tipo)
    .map((t) => [t.prazo_anos, t.taxa, t.vencimento] as [number, number, string]);
  curveChart($("#c-curva"), [{ name: "Prefixado", points: pts("prefixado") }, { name: "IPCA+", points: pts("ipca") }]);
}

function setupTheme() {
  const root = document.documentElement;
  try {
    const saved = localStorage.getItem("theme");
    if (saved) root.dataset.theme = saved;
  } catch { /* sem storage: segue o sistema */ }
  $("#theme").onclick = () => {
    const dark = root.dataset.theme ? root.dataset.theme === "dark" : matchMedia("(prefers-color-scheme: dark)").matches;
    root.dataset.theme = dark ? "light" : "dark";
    try { localStorage.setItem("theme", root.dataset.theme); } catch { /* ignora */ }
    redrawAll();
  };
  matchMedia("(prefers-color-scheme: dark)").addEventListener("change", redrawAll);
}

async function main() {
  try {
    const d = await loadAll();
    renderShell(d);
    setupTheme();
    renderBulletin(d);
    renderAggregate(d);
    renderHeat(d, "receita_aa");
    $("#heat-metric").querySelectorAll<HTMLButtonElement>("button").forEach((b) => (b.onclick = () => {
      $("#heat-metric").querySelectorAll("button").forEach((o) => o.classList.toggle("on", o === b));
      renderHeat(d, b.dataset.m as HeatMetric);
    }));
    const sel = $<HTMLSelectElement>("#sector");
    sel.innerHTML = d.meta.setores.map((s) => `<option>${esc(s)}</option>`).join("");
    sel.onchange = () => renderSector(d, sel.value);
    renderSector(d, d.meta.setores[0]);
    renderDebt(d);
    renderTesouro(d);
  } catch (err) {
    $("#app").innerHTML = `<p class="loading">Não consegui carregar os dados (${esc(String(err))}). Rode <code>uv run python -m etl run</code> antes.</p>`;
  }
}

main();
