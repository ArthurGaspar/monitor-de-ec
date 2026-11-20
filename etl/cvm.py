"""Leitura das DFP/ITR da CVM: dos zips para uma tabela longa (empresa, período, métrica, valor).

Cada zip traz uma demonstração por CSV, em latin-1 e separada por ponto e vírgula. Guardamos só as linhas do exercício
corrente (ORDEM_EXERC = "ÚLTIMO"); a coluna "PENÚLTIMO" repete o ano anterior, às vezes reapresentado, e misturar as duas
faria a mesma empresa ter dois valores para o mesmo trimestre. Entre versões de um mesmo formulário, fica a mais nova.
"""
import io
import zipfile
from pathlib import Path

import pandas as pd

from .config import BPA_ACCOUNTS, BPP_ACCOUNTS, DRE_ACCOUNTS

STATEMENTS = {"DRE": DRE_ACCOUNTS, "BPA": BPA_ACCOUNTS, "BPP": BPP_ACCOUNTS}
COLUMNS = ["CNPJ_CIA", "DT_REFER", "VERSAO", "DENOM_CIA", "CD_CVM", "ESCALA_MOEDA", "ORDEM_EXERC", "DT_INI_EXERC",
           "DT_FIM_EXERC", "CD_CONTA", "DS_CONTA", "VL_CONTA"]
# Bancos e seguradoras põem o lucro do período em 3.09, 3.11 ou 3.13, conforme o plano; o rótulo é o que não muda.
PROFIT_LABEL = r"^lucro.*(?:consolidado|l[ií]quido).*per[ií]odo"
EBIT_LABEL = r"^resultado antes do resultado financeiro"


def read_statement(raw: bytes, accounts: dict[str, str], source: str) -> pd.DataFrame:
    """Um CSV de demonstração consolidada -> linhas (cd_cvm, cnpj, nome, dt_refer, dt_ini, dt_fim, metric, value)."""
    df = pd.read_csv(io.BytesIO(raw), sep=";", encoding="latin-1", dtype=str,
                     usecols=lambda c: c in COLUMNS)
    df = df[df["ORDEM_EXERC"].str.startswith("ÚLTIMO")]
    metric = df["CD_CONTA"].map(accounts)
    if "lucro" in accounts.values():
        label = df["DS_CONTA"].fillna("").str.strip().str.lower()
        top_level = df["CD_CONTA"].str.count(r"\.") == 1
        metric = metric.where(metric != "lucro")
        metric = metric.where(~((metric == "ebit") & ~label.str.contains(EBIT_LABEL)))
        is_profit = top_level & label.str.contains(PROFIT_LABEL) & ~label.str.contains("antes")
        metric = metric.mask(is_profit, "lucro")
    df = df.assign(metric=metric).dropna(subset=["metric"])
    if "DT_INI_EXERC" not in df:
        df["DT_INI_EXERC"] = None
    df["VERSAO"] = df["VERSAO"].astype(int)
    latest = df.groupby(["CD_CVM", "DT_REFER"])["VERSAO"].transform("max")
    df = df[df["VERSAO"] == latest]
    # Valores em R$ mil em toda a tabela; algumas empresas publicam em unidades.
    scale = df["ESCALA_MOEDA"].map({"MIL": 1.0, "UNIDADE": 1e-3}).fillna(1.0)
    out = pd.DataFrame({
        "cd_cvm": df["CD_CVM"].astype(int),
        "cnpj": df["CNPJ_CIA"],
        "nome": df["DENOM_CIA"],
        "dt_refer": pd.to_datetime(df["DT_REFER"]),
        "dt_ini": pd.to_datetime(df["DT_INI_EXERC"]),
        "dt_fim": pd.to_datetime(df["DT_FIM_EXERC"]),
        "metric": df["metric"],
        "value": df["VL_CONTA"].astype(float) * scale,
        "source": source,
    })
    return out.drop_duplicates(["cd_cvm", "dt_ini", "dt_fim", "metric"], keep="last")


def read_zip(path: Path, kind: str) -> pd.DataFrame:
    """Lê as três demonstrações consolidadas (DRE, BPA, BPP) de um zip de DFP ou ITR."""
    frames = []
    with zipfile.ZipFile(path) as zf:
        names = zf.namelist()
        for stmt, accounts in STATEMENTS.items():
            member = next((n for n in names if f"_{stmt}_con_" in n), None)
            if member:
                frames.append(read_statement(zf.read(member), accounts, kind))
    return pd.concat(frames, ignore_index=True) if frames else pd.DataFrame()


def read_cadastro(path: Path) -> pd.DataFrame:
    """Cadastro de companhias: setor, situação e categoria de registro de cada código CVM."""
    raw = path.read_bytes()
    try:
        text = raw.decode("utf-8")
    except UnicodeDecodeError:
        text = raw.decode("latin-1")
    df = pd.read_csv(io.StringIO(text), sep=";", dtype=str)
    df = df.dropna(subset=["CD_CVM"])
    # Uma empresa pode aparecer mais de uma vez (registros cancelados e refeitos); fica o registro mais recente.
    df = df.sort_values("DT_REG").drop_duplicates("CD_CVM", keep="last")
    return pd.DataFrame({
        "cd_cvm": df["CD_CVM"].astype(int),
        "nome_comercial": df["DENOM_COMERC"].fillna(df["DENOM_SOCIAL"]),
        "setor_cvm": df["SETOR_ATIV"].fillna(""),
        "situacao": df["SIT"].fillna(""),
        "categoria": df["CATEG_REG"].fillna(""),
        "mercado": df["TP_MERC"].fillna(""),
    })
