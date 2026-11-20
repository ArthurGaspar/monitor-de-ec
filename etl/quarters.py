"""De períodos publicados para trimestres isolados.

O ITR traz o trimestre (3 meses) e o acumulado do ano; a DFP traz só o ano inteiro. Não existe formulário do quarto
trimestre: ele sai da diferença entre a DFP anual e o acumulado de nove meses do ITR de setembro. Se o acumulado não foi
publicado, usamos a soma dos três trimestres isolados; sem nenhum dos dois, o quarto trimestre fica vazio.

Fluxos (DRE) viram trimestres isolados; saldos (balanço) ficam com o valor da data de fechamento. Empresas com exercício
fora do ano civil (trimestres terminando em abril, julho...) ficam de fora para os trimestres se alinharem entre setores.
"""
import pandas as pd

FLOWS = {"receita", "ebit", "lucro"}
QUARTER_END_MONTHS = {3, 6, 9, 12}


def months_between(start: pd.Series, end: pd.Series) -> pd.Series:
    return ((end - start).dt.days / 30.44).round().astype("Int64")


def quarter_label(dt: pd.Series) -> pd.Series:
    return dt.dt.year.astype(str) + "T" + ((dt.dt.month - 1) // 3 + 1).astype(str)


def standalone_quarters(facts: pd.DataFrame) -> pd.DataFrame:
    """facts (saída de cvm.read_zip) -> (cd_cvm, quarter, metric, value) com um valor por trimestre."""
    flows = facts[facts["metric"].isin(FLOWS)].copy()
    flows["months"] = months_between(flows["dt_ini"], flows["dt_fim"])
    key = ["cd_cvm", "metric"]

    direct = flows[(flows["source"] == "itr") & (flows["months"] == 3)][key + ["dt_fim", "value"]]

    annual = flows[(flows["source"] == "dfp") & (flows["months"] == 12)][key + ["dt_ini", "dt_fim", "value"]]
    ytd9 = flows[(flows["source"] == "itr") & (flows["months"] == 9)][key + ["dt_ini", "value"]]
    q4 = annual.merge(ytd9, on=key + ["dt_ini"], how="left", suffixes=("", "_ytd9"))

    # Plano B: soma dos três trimestres isolados que caem dentro do exercício.
    window = annual.merge(direct, on=key, suffixes=("", "_q"))
    window = window[(window["dt_fim_q"] > window["dt_ini"]) & (window["dt_fim_q"] < window["dt_fim"])]
    summed = (window.groupby(key + ["dt_ini"]).agg(q_sum=("value_q", "sum"), q_n=("value_q", "size")).reset_index())
    q4 = q4.merge(summed, on=key + ["dt_ini"], how="left")
    prior = q4["value_ytd9"].where(q4["value_ytd9"].notna(), q4["q_sum"].where(q4["q_n"] == 3))
    q4 = q4.assign(value=q4["value"] - prior).dropna(subset=["value"])[key + ["dt_fim", "value"]]

    stocks = facts[~facts["metric"].isin(FLOWS)][key + ["dt_fim", "value"]]

    out = pd.concat([direct, q4, stocks], ignore_index=True)
    out = out[out["dt_fim"].dt.month.isin(QUARTER_END_MONTHS)]
    out["quarter"] = quarter_label(out["dt_fim"])
    # Um ITR reapresentado e a DFP podem trazer o mesmo saldo; fica um por empresa, trimestre e métrica.
    out = out.drop_duplicates(["cd_cvm", "quarter", "metric"], keep="last")
    return out[["cd_cvm", "quarter", "metric", "value"]].reset_index(drop=True)


def wide(quarters: pd.DataFrame) -> pd.DataFrame:
    """Uma linha por empresa e trimestre, uma coluna por métrica."""
    return quarters.pivot_table(index=["cd_cvm", "quarter"], columns="metric", values="value", aggfunc="last").reset_index()


def shift_quarter(q: str, n: int) -> str:
    year, qt = int(q[:4]), int(q[-1])
    idx = year * 4 + (qt - 1) + n
    return f"{idx // 4}T{idx % 4 + 1}"
