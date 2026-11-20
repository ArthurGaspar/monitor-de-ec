"""Indicadores por empresa, setor e trimestre.

Somar a receita de um setor trimestre a trimestre mede também quem entrou e quem saiu da bolsa: um IPO grande parece
crescimento. Por isso todo crescimento aqui é "mesmas empresas": compara o trimestre com o mesmo trimestre do ano
anterior usando só as empresas que publicaram nos dois. Os totais (R$) somam quem publicou no trimestre.

Crescimento do lucro só existe quando o lucro somado das mesmas empresas no ano anterior é positivo; de prejuízo para
lucro não há porcentagem que faça sentido.
Receita, margem e dívida excluem o setor financeiro, cujo plano de contas não tem receita de vendas nem "empréstimos e
financiamentos" no mesmo sentido.
"""
import unicodedata

import numpy as np
import pandas as pd

from .config import FINANCIAL, MIN_COMPANIES, OTHER, SECTOR_GROUPS
from .quarters import shift_quarter

TOTAL = "Todas as empresas"
TOTAL_NONFIN = "Não financeiras"


def _norm(s: str) -> str:
    s = unicodedata.normalize("NFKD", s).encode("ascii", "ignore").decode().lower()
    return " ".join(s.split())


_LOOKUP = {_norm(cvm): group for group, names in SECTOR_GROUPS.items() for cvm in names}


def sector_group(setor_cvm: str) -> str:
    """Setor da CVM -> grupo do painel. Holdings ("Emp. Adm. Part. - Bancos") seguem o setor que controlam."""
    s = setor_cvm.split(" - ", 1)[1] if setor_cvm.startswith("Emp. Adm. Part. -") else setor_cvm
    return _LOOKUP.get(_norm(s), OTHER)


def company_panel(quarters_wide: pd.DataFrame, cad: pd.DataFrame, exclude: set[int] = frozenset()) -> pd.DataFrame:
    """Empresas de categoria A (as que podem ter ações negociadas) com setor e indicadores derivados por trimestre."""
    cad = cad[(cad["categoria"] == "Categoria A") & ~cad["cd_cvm"].isin(exclude)].copy()
    cad["setor"] = cad["setor_cvm"].map(sector_group)
    df = quarters_wide.merge(cad[["cd_cvm", "nome_comercial", "setor", "setor_cvm", "situacao"]], on="cd_cvm")
    for col in ("receita", "ebit", "lucro", "ativo", "caixa", "aplicacoes", "divida_cp", "divida_lp", "pl"):
        if col not in df:
            df[col] = np.nan
    df["financeira"] = df["setor"] == FINANCIAL
    df["divida_bruta"] = df[["divida_cp", "divida_lp"]].sum(axis=1, min_count=1)
    df["divida_liquida"] = df["divida_bruta"] - df[["caixa", "aplicacoes"]].sum(axis=1, min_count=1).fillna(0)
    df.loc[df["financeira"], ["receita", "ebit", "divida_bruta", "divida_liquida"]] = np.nan
    df = df.sort_values(["cd_cvm", "quarter"])
    for col in ("receita", "ebit", "lucro"):
        df[f"{col}_12m"] = _trailing(df, col)
    return df.reset_index(drop=True)


def _trailing(df: pd.DataFrame, col: str) -> pd.Series:
    """Soma dos últimos quatro trimestres, só quando os quatro existem e são consecutivos."""
    out = pd.Series(np.nan, index=df.index)
    for _, g in df.groupby("cd_cvm"):
        vals = dict(zip(g["quarter"], g[col]))
        for idx, q in zip(g.index, g["quarter"]):
            window = [vals.get(shift_quarter(q, -i)) for i in range(4)]
            if all(v is not None and not pd.isna(v) for v in window):
                out[idx] = sum(window)
    return out


def _growth(cur: pd.DataFrame, prev: pd.DataFrame, col: str) -> tuple[float | None, int]:
    """Crescimento mesmas-empresas entre dois recortes do painel. Retorna (taxa, número de empresas comparadas)."""
    both = cur[["cd_cvm", col]].merge(prev[["cd_cvm", col]], on="cd_cvm", suffixes=("", "_ant")).dropna()
    base = both[f"{col}_ant"].sum()
    if len(both) < MIN_COMPANIES or base <= 0:
        return None, len(both)
    return both[col].sum() / base - 1, len(both)


def _ratio(num: pd.Series, den: pd.Series) -> float | None:
    ok = num.notna() & den.notna()
    d = den[ok].sum()
    if ok.sum() < MIN_COMPANIES or d <= 0:
        return None
    return float(num[ok].sum() / d)


def _summarize(cur: pd.DataFrame, prev: pd.DataFrame) -> dict:
    rec_g, rec_n = _growth(cur, prev, "receita")
    luc_g, luc_n = _growth(cur, prev, "lucro")
    return {
        "empresas": int(cur[["receita", "lucro"]].notna().any(axis=1).sum()),
        "receita": _sum(cur["receita"]),
        "lucro": _sum(cur["lucro"]),
        "margem": _ratio(cur["lucro"].where(cur["receita"].notna()), cur["receita"].where(cur["lucro"].notna())),
        "receita_aa": rec_g, "receita_aa_n": rec_n,
        "lucro_aa": luc_g, "lucro_aa_n": luc_n,
        "empresas_prejuizo": int((cur["lucro"] < 0).sum()),
        "divida_liquida": _sum(cur["divida_liquida"]),
        "div_liq_pl": _ratio(cur["divida_liquida"], cur["pl"].where(cur["divida_liquida"].notna())),
        "div_liq_ebit": _ratio(cur["divida_liquida"], cur["ebit_12m"].where(cur["divida_liquida"].notna())),
    }


def _sum(s: pd.Series) -> float | None:
    return float(s.sum()) if s.notna().any() else None


def sector_quarters(panel: pd.DataFrame) -> pd.DataFrame:
    """Uma linha por (setor, trimestre), incluindo os totais 'Todas as empresas' e 'Não financeiras'."""
    groups = {TOTAL: panel, TOTAL_NONFIN: panel[~panel["financeira"]]}
    groups.update({s: g for s, g in panel.groupby("setor")})
    rows = []
    for sector, g in groups.items():
        by_q = {q: gq for q, gq in g.groupby("quarter")}
        for q, cur in by_q.items():
            prev = by_q.get(shift_quarter(q, -4), cur.iloc[0:0])
            rows.append({"setor": sector, "quarter": q, **_summarize(cur, prev)})
    return pd.DataFrame(rows).sort_values(["setor", "quarter"]).reset_index(drop=True)


def company_snapshot(panel: pd.DataFrame, quarter: str) -> pd.DataFrame:
    """Indicadores dos últimos 12 meses de cada empresa que publicou no trimestre."""
    cur = panel[panel["quarter"] == quarter]
    prev = panel[panel["quarter"] == shift_quarter(quarter, -4)][["cd_cvm", "receita_12m", "lucro_12m"]]
    df = cur.merge(prev, on="cd_cvm", how="left", suffixes=("", "_ant"))
    df["receita_12m_aa"] = np.where(df["receita_12m_ant"] > 0, df["receita_12m"] / df["receita_12m_ant"] - 1, np.nan)
    df["margem_12m"] = np.where(df["receita_12m"] > 0, df["lucro_12m"] / df["receita_12m"], np.nan)
    df["div_liq_ebit"] = np.where(df["ebit_12m"] > 0, df["divida_liquida"] / df["ebit_12m"], np.nan)
    df["div_liq_pl"] = np.where(df["pl"] > 0, df["divida_liquida"] / df["pl"], np.nan)
    return df
