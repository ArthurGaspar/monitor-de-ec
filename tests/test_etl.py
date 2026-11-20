import pandas as pd
import pytest

from etl.cvm import read_statement
from etl.config import DRE_ACCOUNTS
from etl.metrics import company_panel, sector_group, sector_quarters
from etl.quality import duplicate_holdings, fix_scale
from etl.quarters import shift_quarter, standalone_quarters, wide
from etl.tesouro import rate_at_tenor

HEADER = "CNPJ_CIA;DT_REFER;VERSAO;DENOM_CIA;CD_CVM;GRUPO_DFP;MOEDA;ESCALA_MOEDA;ORDEM_EXERC;DT_INI_EXERC;DT_FIM_EXERC;CD_CONTA;DS_CONTA;VL_CONTA;ST_CONTA_FIXA"


def dre_csv(rows: list[str]) -> bytes:
    return ("\r\n".join([HEADER, *rows]) + "\r\n").encode("latin-1")


def test_read_statement_keeps_current_year_latest_version_and_finds_bank_profit():
    raw = dre_csv([
        # empresa comum: versão 1 é substituída pela 2; PENÚLTIMO (ano anterior) é ignorado
        "1;2025-03-31;1;IND;000100;DRE;REAL;MIL;ÚLTIMO;2025-01-01;2025-03-31;3.01;Receita de Venda de Bens e/ou Serviços;100;S",
        "1;2025-03-31;2;IND;000100;DRE;REAL;MIL;ÚLTIMO;2025-01-01;2025-03-31;3.01;Receita de Venda de Bens e/ou Serviços;110;S",
        "1;2025-03-31;2;IND;000100;DRE;REAL;MIL;PENÚLTIMO;2024-01-01;2024-03-31;3.01;Receita de Venda de Bens e/ou Serviços;90;S",
        "1;2025-03-31;2;IND;000100;DRE;REAL;MIL;ÚLTIMO;2025-01-01;2025-03-31;3.11;Lucro/Prejuízo Consolidado do Período;7;S",
        # banco: lucro em 3.09, e o 3.11 dele é outra coisa; escala em unidades
        "2;2025-03-31;1;BANCO;000200;DRE;REAL;UNIDADE;ÚLTIMO;2025-01-01;2025-03-31;3.09;Lucro/Prejuízo Consolidado do Período;5000;S",
        "2;2025-03-31;1;BANCO;000200;DRE;REAL;UNIDADE;ÚLTIMO;2025-01-01;2025-03-31;3.11;Resultado Líquido das Operações Continuadas;9999;S",
        "2;2025-03-31;1;BANCO;000200;DRE;REAL;UNIDADE;ÚLTIMO;2025-01-01;2025-03-31;3.07;Lucro ou Prejuízo antes das Participações e Contribuições Estatutárias do Período;8888;S",
    ])
    df = read_statement(raw, DRE_ACCOUNTS, "itr").set_index(["cd_cvm", "metric"])["value"]
    assert df[(100, "receita")] == 110
    assert df[(100, "lucro")] == 7
    assert df[(200, "lucro")] == pytest.approx(5.0)       # R$ 5.000 = R$ 5 mil


def facts_frame(rows: list[tuple]) -> pd.DataFrame:
    df = pd.DataFrame(rows, columns=["cd_cvm", "source", "dt_refer", "dt_ini", "dt_fim", "metric", "value"])
    for c in ("dt_refer", "dt_ini", "dt_fim"):
        df[c] = pd.to_datetime(df[c])
    return df


def year_of_flows(cd: int, q: list[float], annual: float, with_ytd9: bool = True) -> list[tuple]:
    ends = ["2024-03-31", "2024-06-30", "2024-09-30"]
    starts = ["2024-01-01", "2024-04-01", "2024-07-01"]
    rows = [(cd, "itr", e, s, e, "receita", v) for s, e, v in zip(starts, ends, q)]
    if with_ytd9:
        rows.append((cd, "itr", "2024-09-30", "2024-01-01", "2024-09-30", "receita", sum(q)))
    rows.append((cd, "dfp", "2024-12-31", "2024-01-01", "2024-12-31", "receita", annual))
    return rows


def test_q4_is_annual_minus_nine_month_ytd():
    q = standalone_quarters(facts_frame(year_of_flows(1, [10, 20, 30], 100)))
    assert dict(zip(q["quarter"], q["value"])) == {"2024T1": 10, "2024T2": 20, "2024T3": 30, "2024T4": 40}


def test_q4_falls_back_to_sum_of_quarters_without_ytd():
    q = standalone_quarters(facts_frame(year_of_flows(1, [10, 20, 30], 100, with_ytd9=False)))
    assert q.set_index("quarter").loc["2024T4", "value"] == 40


def test_q4_missing_when_a_quarter_is_missing():
    rows = [r for r in year_of_flows(1, [10, 20, 30], 100, with_ytd9=False) if r[2] != "2024-06-30"]
    q = standalone_quarters(facts_frame(rows))
    assert "2024T4" not in set(q["quarter"])


def test_scale_fix_restores_filing_reported_in_wrong_unit():
    rows = [(1, "dfp", "2023-12-31", None, "2023-12-31", "ativo", 50_000.0),
            (1, "dfp", "2024-12-31", None, "2024-12-31", "ativo", 52_000.0),
            (1, "itr", "2024-06-30", None, "2024-06-30", "ativo", 51.0),         # marcado UNIDADE, lançado em mil
            (1, "itr", "2024-06-30", "2024-04-01", "2024-06-30", "receita", 3.0)]
    fixed, log = fix_scale(facts_frame(rows))
    itr = fixed[fixed["source"] == "itr"].set_index("metric")["value"]
    assert itr["ativo"] == 51_000 and itr["receita"] == 3_000
    assert len(log) == 1


def panel_rows(cd: int, setor: str, values: dict[str, dict[str, float]]) -> tuple[pd.DataFrame, dict]:
    rows = [{"cd_cvm": cd, "quarter": q, **m} for q, m in values.items()]
    return pd.DataFrame(rows), {"cd_cvm": cd, "nome_comercial": f"E{cd}", "setor_cvm": setor, "situacao": "ATIVO",
                                "categoria": "Categoria A", "mercado": "BOLSA"}


def build_panel(companies: list[tuple]) -> pd.DataFrame:
    frames, cad = [], []
    for c in companies:
        f, row = panel_rows(*c)
        frames.append(f)
        cad.append(row)
    return company_panel(pd.concat(frames, ignore_index=True), pd.DataFrame(cad))


def test_growth_uses_only_companies_present_in_both_years():
    base = {"2024T1": {"receita": 100.0, "lucro": 10.0}, "2025T1": {"receita": 110.0, "lucro": 12.0}}
    # uma estreante grande em 2025 não pode virar crescimento
    newcomer = {"2025T1": {"receita": 1000.0, "lucro": 50.0}}
    panel = build_panel([(1, "Alimentos", base), (2, "Alimentos", base), (3, "Alimentos", base), (4, "Alimentos", newcomer)])
    row = sector_quarters(panel).query("setor == 'Agro e alimentos' and quarter == '2025T1'").iloc[0]
    assert row["receita_aa"] == pytest.approx(0.10)
    assert row["receita_aa_n"] == 3
    assert row["receita"] == pytest.approx(1330.0)


def test_profit_growth_undefined_from_a_loss_base():
    vals = {"2024T1": {"receita": 100.0, "lucro": -10.0}, "2025T1": {"receita": 100.0, "lucro": 5.0}}
    panel = build_panel([(i, "Alimentos", vals) for i in range(1, 5)])
    row = sector_quarters(panel).query("setor == 'Agro e alimentos' and quarter == '2025T1'").iloc[0]
    assert pd.isna(row["lucro_aa"])


def test_financial_companies_have_no_revenue_or_debt():
    vals = {"2025T1": {"receita": 500.0, "lucro": 50.0, "divida_cp": 10.0}}
    panel = build_panel([(1, "Bancos", vals)])
    assert panel["financeira"].all() and panel["receita"].isna().all() and panel["divida_liquida"].isna().all()


def test_duplicate_holding_is_detected_and_holding_side_removed():
    q = {f"2024T{i}": {"receita": 100.0 * i, "ebit": 10.0 * i} for i in range(1, 5)}
    panel = build_panel([(10, "Papel e Celulose", q), (20, "Emp. Adm. Part. - Papel e Celulose", q)])
    assert duplicate_holdings(panel) == {20: 10}


def test_sector_group_follows_holdings_and_abbreviations():
    assert sector_group("Emp. Adm. Part. - Bancos") == "Financeiro"
    assert sector_group("Emp. Adm. Part. - Máqs., Equip., Veíc. e Peças") == "Indústria e bens de capital"
    assert sector_group("Algo novo") == "Outros"


def test_wide_and_shift_quarter():
    assert shift_quarter("2025T1", -1) == "2024T4" and shift_quarter("2024T4", 4) == "2025T4"
    w = wide(pd.DataFrame({"cd_cvm": [1, 1], "quarter": ["2025T1"] * 2, "metric": ["receita", "lucro"], "value": [1.0, 2.0]}))
    assert w.loc[0, "receita"] == 1.0 and w.loc[0, "lucro"] == 2.0


def test_rate_at_tenor_interpolates_and_refuses_extrapolation():
    g = pd.DataFrame({"prazo_anos": [2.0, 8.0], "taxa": [10.0, 13.0]})
    assert rate_at_tenor(g, 5.0) == pytest.approx(11.5)
    assert rate_at_tenor(g, 9.0) is None
