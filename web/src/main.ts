import "./style.css";
import { disposeIn, redrawAll } from "./charts";
import { Companies, type Data, FIN, NONFIN, TOTAL, esc, loadAll, qLong, sectorRow, titleCase } from "./data";
import { $, $$, closeLayer, icon, layerOpen } from "./ui";
import { type Ctx, companyModal, credito, empresas, juros, metodologia, notaModal, painel, setores } from "./views";

const VIEWS = [
  { id: "painel", label: "Painel", icon: icon.painel, render: painel },
  { id: "setores", label: "Setores", icon: icon.setores, render: setores },
  { id: "empresas", label: "Empresas", icon: icon.empresas, render: empresas },
  { id: "credito", label: "Crédito", icon: icon.credito, render: credito },
  { id: "juros", label: "Juros", icon: icon.juros, render: juros },
] as const;
type ViewId = (typeof VIEWS)[number]["id"];

let view: ViewId = "painel";
let ctx: Ctx;

function shell(d: Data) {
  const m = d.meta;
  const last = d.tesouro.semanal[d.tesouro.semanal.length - 1];
  $("#app").innerHTML = `
  <header class="topbar">
    <div class="brand"><span class="mark" aria-hidden="true"><i></i><i></i><i></i></span><span class="brand-name">Monitor <b>Corporativo</b></span></div>
    <h1 class="view-title" id="view-title"></h1>
    <div class="qstep" role="group" aria-label="Trimestre de referência">
      <button class="icon-btn" id="q-prev" aria-label="Trimestre anterior">${icon.left}</button>
      <select id="q-sel" aria-label="Trimestre">${[...m.trimestres].reverse().map((q) => `<option value="${q}">${qLong(q)}</option>`).join("")}</select>
      <button class="icon-btn" id="q-next" aria-label="Próximo trimestre">${icon.right}</button>
      <span class="badge warn" id="q-partial" hidden></span>
    </div>
    <button class="cmd" id="cmd-open">${icon.search}<span>Buscar empresa, setor, tela</span><kbd>Ctrl K</kbd></button>
    <button class="icon-btn" id="btn-nota" title="Nota do trimestre">${icon.nota}</button>
    <button class="icon-btn" id="btn-method" title="Metodologia">${icon.info}</button>
    <button class="icon-btn" id="btn-theme" title="Tema claro/escuro">${icon.theme}</button>
  </header>
  <nav class="rail" aria-label="Telas">
    ${VIEWS.map((v, i) => `<a href="#/${v.id}" data-view="${v.id}" title="${v.label} (${i + 1})">${v.icon}<span>${v.label}</span></a>`).join("")}
  </nav>
  <main class="stage" id="stage"></main>
  <footer class="statusbar">
    <span><i class="led"></i>CVM DFP/ITR · ${m.trimestres[0].slice(0, 4)}–${m.ultimo_trimestre.slice(0, 4)}</span>
    <span>${m.empresas_no_painel} companhias</span>
    <span>${m.correcoes_escala} correções de escala</span>
    <span>Tesouro Direto · ${last.data.split("-").reverse().join("/")}</span>
    <span class="grow"></span>
    <span>processado ${new Date(m.gerado_em).toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "short" })}</span>
    <span class="keys"><kbd>1</kbd>–<kbd>5</kbd> telas · <kbd>←</kbd><kbd>→</kbd> trimestre · <kbd>/</kbd> busca</span>
  </footer>`;
}

function render() {
  const stage = $("#stage");
  disposeIn(stage);
  const v = VIEWS.find((x) => x.id === view)!;
  $$("[data-view]").forEach((a) => a.classList.toggle("on", a.dataset.view === view));
  $("#view-title").textContent = v.label;
  $<HTMLSelectElement>("#q-sel").value = ctx.q;
  const m = ctx.d.meta;
  const partial = $("#q-partial");
  const lastRow = sectorRow(ctx.d, TOTAL, m.ultimo_trimestre), prevRow = sectorRow(ctx.d, TOTAL, m.trimestre_empresas);
  partial.hidden = !(m.parcial && ctx.q === m.ultimo_trimestre);
  partial.textContent = `parcial · ${lastRow?.empresas ?? "?"}/${prevRow?.empresas ?? "?"} cias`;
  partial.title = "O prazo do ITR é de 45 dias; nem todas as companhias publicaram este trimestre";
  const qs = m.trimestres;
  $<HTMLButtonElement>("#q-prev").disabled = ctx.q === qs[0];
  $<HTMLButtonElement>("#q-next").disabled = ctx.q === qs[qs.length - 1];
  v.render(stage, ctx);
  const hash = `#/${view}?q=${ctx.q}${view === "setores" ? `&s=${encodeURIComponent(ctx.sector)}` : ""}`;
  if (location.hash !== hash) history.replaceState(null, "", hash);
}

function parseHash() {
  const [path, query] = location.hash.replace(/^#\/?/, "").split("?");
  if (VIEWS.some((v) => v.id === path)) view = path as ViewId;
  const p = new URLSearchParams(query ?? "");
  const q = p.get("q");
  if (q && ctx.d.meta.trimestres.includes(q)) ctx.q = q;
  const s = p.get("s");
  if (s && (ctx.d.meta.setores.includes(s) || s === NONFIN || s === TOTAL)) ctx.sector = s;
}

// ---- busca (Ctrl+K) ----

type Hit = { kind: string; label: string; sub: string; run: () => void };

function palette() {
  if ($(".palette")) return;
  closeLayer();
  const norm = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
  const hits: Hit[] = [
    ...VIEWS.map((v) => ({ kind: "Tela", label: v.label, sub: "", run: () => go(v.id) })),
    ...ctx.d.meta.setores.map((s) => ({ kind: "Setor", label: s, sub: `${sectorRow(ctx.d, s, ctx.q)?.empresas ?? 0} cias`, run: () => go("setores", { sector: s }) })),
    ...ctx.cos.list.map((c) => ({ kind: "Empresa", label: titleCase(c.nome), sub: c.setor, run: () => companyModal(ctx, c) })),
    { kind: "Ação", label: "Metodologia", sub: "", run: () => metodologia(ctx.d) },
    { kind: "Ação", label: "Nota do trimestre", sub: "", run: openNota },
  ];
  const root = document.createElement("div");
  root.className = "palette";
  root.innerHTML = `<div class="scrim"></div><div class="pal" role="dialog" aria-label="Busca">
    <label class="pal-in">${icon.search}<input placeholder="Empresa, setor ou tela" autocomplete="off" spellcheck="false"><kbd>Esc</kbd></label>
    <ul class="pal-list" role="listbox"></ul></div>`;
  document.body.appendChild(root);
  const input = root.querySelector("input")!, list = root.querySelector("ul")!;
  let shown: Hit[] = [], sel = 0;
  const close = () => root.remove();
  const draw = () => {
    const t = norm(input.value.trim());
    shown = (t ? hits.filter((h) => norm(h.label).includes(t)) : hits.filter((h) => h.kind !== "Empresa").concat(hits.filter((h) => h.kind === "Empresa").slice(0, 6)))
      .sort((a, b) => (t ? Number(!norm(a.label).startsWith(t)) - Number(!norm(b.label).startsWith(t)) : 0)).slice(0, 14);
    sel = Math.min(sel, Math.max(0, shown.length - 1));
    list.innerHTML = shown.length ? shown.map((h, i) => `<li role="option" class="${i === sel ? "on" : ""}" data-i="${i}">
      <span class="pk">${h.kind}</span><span class="pl">${esc(h.label)}</span><span class="ps">${esc(h.sub)}</span></li>`).join("")
      : `<li class="none">Nada encontrado</li>`;
    $$<HTMLElement>("li[data-i]", list).forEach((li) => (li.onclick = () => { close(); shown[Number(li.dataset.i)].run(); }));
  };
  input.oninput = () => { sel = 0; draw(); };
  input.onkeydown = (e) => {
    if (e.key === "ArrowDown") { sel = Math.min(sel + 1, shown.length - 1); draw(); e.preventDefault(); }
    else if (e.key === "ArrowUp") { sel = Math.max(sel - 1, 0); draw(); e.preventDefault(); }
    else if (e.key === "Enter" && shown[sel]) { close(); shown[sel].run(); }
    else if (e.key === "Escape") close();
  };
  root.querySelector(".scrim")!.addEventListener("click", close);
  draw();
  input.focus();
}

function openNota() {
  const b = ctx.d.boletins.find((x) => x.trimestre === ctx.q) ?? ctx.d.boletins[0];
  if (b) notaModal(b);
}

function go(v: string, patch: Partial<Ctx> = {}) {
  closeLayer();
  Object.assign(ctx, patch);
  view = v as ViewId;
  render();
}

function setQuarter(q: string) {
  if (!ctx.d.meta.trimestres.includes(q) || q === ctx.q) return;
  ctx.q = q;
  render();
}

function setupTheme() {
  const root = document.documentElement;
  try { const s = localStorage.getItem("theme"); if (s) root.dataset.theme = s; } catch { /* segue o sistema */ }
  $("#btn-theme").onclick = () => {
    const dark = root.dataset.theme ? root.dataset.theme === "dark" : matchMedia("(prefers-color-scheme: dark)").matches;
    root.dataset.theme = dark ? "light" : "dark";
    try { localStorage.setItem("theme", root.dataset.theme); } catch { /* ignora */ }
    redrawAll();
  };
  matchMedia("(prefers-color-scheme: dark)").addEventListener("change", redrawAll);
}

function setupKeys() {
  document.addEventListener("keydown", (e) => {
    const typing = e.target instanceof Element && e.target.closest("input, select, textarea");
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "k") { e.preventDefault(); palette(); return; }
    if (e.key === "Escape") { closeLayer(); return; }
    if (typing || $(".palette")) return;
    if (e.key === "/") { e.preventDefault(); palette(); return; }
    if (layerOpen()) return;
    const n = Number(e.key);
    if (n >= 1 && n <= VIEWS.length) go(VIEWS[n - 1].id);
    const qs = ctx.d.meta.trimestres, i = qs.indexOf(ctx.q);
    if (e.key === "ArrowLeft" && i > 0) setQuarter(qs[i - 1]);
    if (e.key === "ArrowRight" && i < qs.length - 1) setQuarter(qs[i + 1]);
  });
}

async function main() {
  try {
    const d = await loadAll();
    ctx = {
      d, cos: new Companies(d.empresas), q: d.meta.trimestre_empresas, heat: "receita_aa", agg: "receita",
      sector: d.meta.setores.find((s) => s !== FIN) ?? d.meta.setores[0], credit: "n", rates: "3",
      screener: { text: "", setor: "", chips: new Set(), sort: { key: "rec", dir: -1 } },
      sectorSort: { key: "rec", dir: -1 }, go, setQuarter,
    };
    shell(d);
    parseHash();
    setupTheme();
    setupKeys();
    $<HTMLSelectElement>("#q-sel").onchange = (e) => setQuarter((e.target as HTMLSelectElement).value);
    $("#q-prev").onclick = () => { const qs = d.meta.trimestres; setQuarter(qs[qs.indexOf(ctx.q) - 1]); };
    $("#q-next").onclick = () => { const qs = d.meta.trimestres; setQuarter(qs[qs.indexOf(ctx.q) + 1]); };
    $("#cmd-open").onclick = palette;
    $("#btn-method").onclick = () => metodologia(d);
    $("#btn-nota").onclick = openNota;
    $$<HTMLAnchorElement>("[data-view]").forEach((a) => (a.onclick = (e) => { e.preventDefault(); go(a.dataset.view!); }));
    window.addEventListener("hashchange", () => { parseHash(); render(); });
    render();
  } catch (err) {
    $("#app").innerHTML = `<p class="fatal">Não foi possível carregar os dados (${esc(String(err))}). Rode <code>uv run python -m etl run</code>.</p>`;
  }
}

main();
