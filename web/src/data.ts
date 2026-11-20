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

export interface Company {
  cd_cvm: number;
  nome: string;
  setor: string;
  receita_12m: number | null;
  lucro_12m: number | null;
  receita_12m_aa: number | null;
  margem_12m: number | null;
  div_liq_ebit: number | null;
  div_liq_pl: number | null;
  ativo: number | null;
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
}

export interface Data {
  meta: Meta;
  setores: Record<string, SectorRow[]>;
  empresas: Company[];
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
    load<Company[]>("empresas.json"),
    load<Tesouro>("tesouro.json"),
    load<Bulletin[]>("boletins.json", []),
  ]);
  return { meta, setores, empresas, tesouro, boletins };
}

export const TOTAL = "Todas as empresas";
export const NONFIN = "Não financeiras";

export function quarterLabel(q: string): string {
  return `${q.slice(-1)}º tri ${q.slice(0, 4)}`;
}

const nf = (d: number) => new Intl.NumberFormat("pt-BR", { minimumFractionDigits: d, maximumFractionDigits: d });

export function fmtPct(v: number | null | undefined, signed = true, d = 1): string {
  if (v == null) return "–";
  const s = nf(d).format(v * 100) + "%";
  return signed && v > 0 ? "+" + s : s;
}

export function fmtBi(v: number | null | undefined, d = 1): string {
  if (v == null) return "–";
  return "R$ " + nf(d).format(v) + " bi";
}

export function fmtNum(v: number | null | undefined, d = 1): string {
  return v == null ? "–" : nf(d).format(v);
}
