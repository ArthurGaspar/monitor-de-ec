"""Correções que os dados abertos precisam antes de qualquer soma.

Escala trocada: algumas empresas pequenas marcam ESCALA_MOEDA = UNIDADE num formulário e continuam lançando em milhares
(ou o contrário). O ativo total cai ou sobe exatamente mil vezes e volta no formulário seguinte. Comparamos o ativo de
cada formulário com a mediana da própria empresa e desfazemos saltos perto de 1000x.

Holdings duplicadas: a Suzano Holding consolida a Suzano, então as duas publicam a mesma receita e o mesmo EBIT. Pares com
receita e EBIT iguais (0,5%) em vários trimestres viram uma empresa só; sai a holding.
"""
import numpy as np
import pandas as pd

SCALE_BAND = (100, 10_000)      # razão ativo/mediana tratada como erro de escala; ativo real não muda 100x num trimestre
MATCH_TOLERANCE = 0.005
MIN_MATCHED_QUARTERS = 4


def fix_scale(facts: pd.DataFrame) -> tuple[pd.DataFrame, list[dict]]:
    """Desfaz formulários com valores mil vezes fora da escala da própria empresa.

    Corrige por formulário (empresa, DFP/ITR, data de referência), antes de derivar trimestres: o quarto trimestre é
    DFP menos ITR, e uma das duas fora de escala estraga a diferença. A referência é a mediana do ativo nas DFP, que são
    auditadas; sem DFP, a mediana de todos os formulários.
    """
    key = ["cd_cvm", "source", "dt_refer"]
    ativo = facts[(facts["metric"] == "ativo") & (facts["dt_fim"] == facts["dt_refer"])][key + ["value"]]
    ativo = ativo.drop_duplicates(key, keep="last")
    ref = ativo[ativo["source"] == "dfp"].groupby("cd_cvm")["value"].median()
    ref = ref.combine_first(ativo.groupby("cd_cvm")["value"].median())
    ativo["ratio"] = (ativo["value"] / ativo["cd_cvm"].map(ref)).abs()
    lo, hi = SCALE_BAND
    ativo["fator"] = np.select([(ativo["ratio"] > 1 / hi) & (ativo["ratio"] < 1 / lo), (ativo["ratio"] > lo) & (ativo["ratio"] < hi)],
                               [1000.0, 1e-3], 1.0)
    bad = ativo[ativo["fator"] != 1.0][key + ["fator"]]
    out = facts.merge(bad, on=key, how="left")
    out["value"] = out["value"] * out["fator"].fillna(1.0)
    log = [{"cd_cvm": int(r.cd_cvm), "formulario": r.source.upper(), "dt_refer": r.dt_refer.strftime("%Y-%m-%d"), "fator": r.fator}
           for r in bad.itertuples()]
    return out.drop(columns="fator"), log


def duplicate_holdings(panel: pd.DataFrame) -> dict[int, int]:
    """{código da holding: código da controlada} para pares que publicam a mesma receita e EBIT."""
    x = panel[(panel["receita"].abs() > 0) & panel["ebit"].notna()][["cd_cvm", "quarter", "receita", "ebit", "setor_cvm"]]
    m = x.merge(x, on="quarter", suffixes=("_a", "_b"))
    m = m[m["cd_cvm_a"] < m["cd_cvm_b"]]
    close = lambda a, b: (a - b).abs() <= MATCH_TOLERANCE * np.maximum(a.abs(), b.abs())
    m = m[close(m["receita_a"], m["receita_b"]) & close(m["ebit_a"], m["ebit_b"])]
    pairs = m.groupby(["cd_cvm_a", "cd_cvm_b", "setor_cvm_a", "setor_cvm_b"]).size().reset_index(name="n")
    out = {}
    for r in pairs[pairs["n"] >= MIN_MATCHED_QUARTERS].itertuples():
        a_holding = r.setor_cvm_a.startswith("Emp. Adm. Part.")
        b_holding = r.setor_cvm_b.startswith("Emp. Adm. Part.")
        # Sem pista pelo setor, sai o código mais novo, que costuma ser a holding criada depois.
        holding, sub = (r.cd_cvm_a, r.cd_cvm_b) if a_holding and not b_holding else (r.cd_cvm_b, r.cd_cvm_a)
        out[int(holding)] = int(sub)
    return out
