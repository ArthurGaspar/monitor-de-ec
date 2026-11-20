// Contratos do JSON que etl/pipeline.py:publish e etl/bulletin.py escrevem. Mudou lá, muda aqui.

export interface SectorRow {
  q: string;
  empresas: number;
  receita: number | null;
  lucro: number | null;
  margem: number | null;
  receita_aa: number | null;
  receita_aa_n: number;
  lucro_aa: number | null;
  lucro_aa_n: number;
  prejuizo: number;
  divida_liquida: number | null;
  div_liq_pl: number | null;
  div_liq_ebit: number | null;
}

export interface Meta {
  gerado_em: string;
  trimestres: string[];
  ultimo_trimestre: string;
  parcial: boolean;
  trimestre_empresas: string;
  setores: string[];
  totais: string[];
  setores_cvm: Record<string, string[]>;
  empresas_no_painel: number;
  correcoes_escala: number;
  excluidas: { cd_cvm: number; nome: string; motivo: string }[];
  fontes: { cvm: string; tesouro: string };
}

export interface CompanyRaw {
  cd: number;
  nome: string;
  setor: string;
  setor_cvm: string;
  situacao: string;
  v: (number | null)[][];
}

export interface CompanySeries {
  trimestres: string[];
  campos: string[];
  empresas: CompanyRaw[];
}

export interface Tesouro {
  semanal: { data: string; prefixado: number | null; ipca: number | null; inflacao_implicita: number | null }[];
  curva: { data: string; titulos: { tipo: "prefixado" | "ipca" | "selic"; vencimento: string; prazo_anos: number; taxa: number }[] };
}

export interface Bulletin {
  trimestre: string;
  provedor: string;
  modelo: string;
  gerado_em: string;
  texto: string;
  nao_verificados: string[];
  termos_errados?: string[];
  fatos?: Record<string, unknown>;
}

export interface Data {
  meta: Meta;
  setores: Record<string, SectorRow[]>;
  empresas: CompanySeries;
  tesouro: Tesouro;
  boletins: Bulletin[];
}

async function load<T>(name: string, fallback?: T): Promise<T> {
  try {
    const res = await fetch(`${import.meta.env.BASE_URL}data/${name}`);
    if (!res.ok) throw new Error(`${name}: ${res.status}`);
    // Servidores com fallback de SPA devolvem index.html (200) para arquivo inexistente; o parse falha e cai no fallback.
    return (await res.json()) as T;
  } catch (err) {
    if (fallback !== undefined) return fallback;
    throw err;
  }
}

export async function loadAll(): Promise<Data> {
  const [meta, setores, empresas, tesouro, boletins] = await Promise.all([
    load<Meta>("meta.json"),
    load<Record<string, SectorRow[]>>("setores.json"),
    load<CompanySeries>("empresas.json"),
    load<Tesouro>("tesouro.json"),
    load<Bulletin[]>("boletins.json", []),
  ]);
  return { meta, setores, empresas, tesouro, boletins };
}

export const TOTAL = "Todas as empresas";
export const NONFIN = "Não financeiras";
export const FIN = "Financeiro";

// ---- trimestres ----

export function shiftQ(q: string, n: number): string {
  const idx = Number(q.slice(0, 4)) * 4 + Number(q.slice(-1)) - 1 + n;
  return `${Math.floor(idx / 4)}T${(idx % 4) + 1}`;
}

export const qLabel = (q: string) => `${q.slice(-1)}T${q.slice(2, 4)}`;          // 2T26
export const qLong = (q: string) => `${q.slice(-1)}º tri ${q.slice(0, 4)}`;      // 2º tri 2026

export function quarterOf(date: string): string {
  return `${date.slice(0, 4)}T${Math.floor((Number(date.slice(5, 7)) - 1) / 3) + 1}`;
}

export function sectorRow(d: Data, sector: string, q: string): SectorRow | undefined {
  return d.setores[sector]?.find((r) => r.q === q);
}

export function sectorSeries(d: Data, sector: string, key: keyof SectorRow, quarters = d.meta.trimestres): (number | null)[] {
  const by = new Map((d.setores[sector] ?? []).map((r) => [r.q, r[key] as number | null]));
  return quarters.map((q) => by.get(q) ?? null);
}

// ---- empresas: indicadores de 12 meses calculados no navegador, para qualquer trimestre ----

export interface Snapshot {
  c: CompanyRaw;
  receita: number | null;
  lucro: number | null;
  receita_12m: number | null;
  lucro_12m: number | null;
  ebit_12m: number | null;
  receita_12m_aa: number | null;
  margem_12m: number | null;
  divida_liquida: number | null;
  div_liq_ebit: number | null;
  div_liq_ebit_ant: number | null;
  div_liq_pl: number | null;
  pl: number | null;
  ativo: number | null;
}

export class Companies {
  readonly idx: Map<string, number>;
  readonly f: Record<string, number>;
  constructor(readonly s: CompanySeries) {
    this.idx = new Map(s.trimestres.map((q, i) => [q, i]));
    this.f = Object.fromEntries(s.campos.map((c, i) => [c, i]));
  }
  get list() { return this.s.empresas; }
  byCd(cd: number) { return this.s.empresas.find((c) => c.cd === cd); }

  value(c: CompanyRaw, field: string, q: string): number | null {
    const i = this.idx.get(q);
    return i == null ? null : c.v[this.f[field]][i] ?? null;
  }

  ltm(c: CompanyRaw, field: string, q: string): number | null {
    let sum = 0;
    for (let k = 0; k < 4; k++) {
      const v = this.value(c, field, shiftQ(q, -k));
      if (v == null) return null;
      sum += v;
    }
    return sum;
  }

  series(c: CompanyRaw, field: string, quarters: string[]): (number | null)[] {
    return quarters.map((q) => this.value(c, field, q));
  }

  snapshot(c: CompanyRaw, q: string): Snapshot | null {
    const ativo = this.value(c, "ativo", q);
    const receita = this.value(c, "receita", q), lucro = this.value(c, "lucro", q);
    if (ativo == null && receita == null && lucro == null) return null;
    const receita_12m = this.ltm(c, "receita", q), lucro_12m = this.ltm(c, "lucro", q), ebit_12m = this.ltm(c, "ebit", q);
    const rec_ant = this.ltm(c, "receita", shiftQ(q, -4));
    const divida_liquida = this.value(c, "divida_liquida", q), pl = this.value(c, "pl", q);
    const ratio = (n: number | null, dd: number | null) => (n != null && dd != null && dd > 0 ? n / dd : null);
    const ebit_ant = this.ltm(c, "ebit", shiftQ(q, -4));
    return {
      c, receita, lucro, receita_12m, lucro_12m, ebit_12m,
      receita_12m_aa: rec_ant != null && rec_ant > 0 && receita_12m != null ? receita_12m / rec_ant - 1 : null,
      margem_12m: ratio(lucro_12m, receita_12m),
      divida_liquida, div_liq_ebit: ratio(divida_liquida, ebit_12m),
      div_liq_ebit_ant: ratio(this.value(c, "divida_liquida", shiftQ(q, -4)), ebit_ant),
      div_liq_pl: ratio(divida_liquida, pl), pl, ativo,
    };
  }

  snapshots(q: string, filter: (c: CompanyRaw) => boolean = () => true): Snapshot[] {
    const out: Snapshot[] = [];
    for (const c of this.s.empresas) {
      if (!filter(c)) continue;
      const s = this.snapshot(c, q);
      if (s) out.push(s);
    }
    return out;
  }
}

// ---- formatação ----

const nf = (d: number) => new Intl.NumberFormat("pt-BR", { minimumFractionDigits: d, maximumFractionDigits: d });

export function fmtPct(v: number | null | undefined, signed = true, d = 1): string {
  if (v == null || !isFinite(v)) return "–";
  const s = nf(d).format(v * 100) + "%";
  return signed && v > 0 ? "+" + s : s;
}

export function fmtPp(v: number | null | undefined, d = 1): string {
  if (v == null) return "–";
  const s = nf(d).format(v * 100) + " p.p.";
  return v > 0 ? "+" + s : s;
}

/** Valor em R$ bilhões com unidade adaptada (bi ou mi). */
export function fmtMoney(v: number | null | undefined, d = 1): string {
  if (v == null) return "–";
  if (Math.abs(v) >= 1) return nf(d).format(v) + " bi";
  return nf(0).format(v * 1000) + " mi";
}

export function fmtNum(v: number | null | undefined, d = 1): string {
  return v == null || !isFinite(v) ? "–" : nf(d).format(v);
}

export const fmtX = (v: number | null | undefined) => (v == null ? "–" : nf(1).format(v) + "x");

export const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!);

export function titleCase(name: string): string {
  // Nomes da CVM vêm em caixa alta; deixamos legíveis sem mexer em siglas curtas.
  const keep = new Set(["S.A.", "SA", "S/A", "LTDA", "II", "III"]);
  return name.split(/\s+/).map((w) => (keep.has(w) || /^([A-Z]\.)+[A-Z]?\.?$/.test(w) || w.includes("/") || (w.length <= 3 && !/[aeiouáéíóú]/i.test(w)) ? w
    : w.charAt(0) + w.slice(1).toLowerCase())).join(" ");
}
