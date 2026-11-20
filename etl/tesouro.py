"""Taxas do Tesouro Direto: a curva de hoje e a taxa de cinco anos ao longo do tempo.

Cada título tem vencimento próprio, e os vencimentos disponíveis mudam com as emissões, então "a taxa do prefixado"
sozinha não é uma série. Para cada data, interpolamos linearmente a taxa no prazo fixo de cinco anos entre os dois
vencimentos vizinhos. Prefixado contra IPCA+ no mesmo prazo dá a inflação implícita: (1 + pré) / (1 + real) - 1.

A taxa usada é a de compra (a que o investidor recebe); quando o título não está à venda ela vem zerada, e usamos a de
venda. O Tesouro Selic só aparece na curva: a taxa dele é o ágio sobre a Selic, não a Selic.
"""
from pathlib import Path

import numpy as np
import pandas as pd

from .config import FIRST_YEAR, TESOURO_TYPES

TENOR_YEARS = 5.0


def read_tesouro(path: Path) -> pd.DataFrame:
    df = pd.read_csv(path, sep=";", decimal=",", encoding="latin-1")
    df = df[df["Tipo Titulo"].isin(TESOURO_TYPES)]
    out = pd.DataFrame({
        "tipo": df["Tipo Titulo"].map(TESOURO_TYPES),
        "vencimento": pd.to_datetime(df["Data Vencimento"], format="%d/%m/%Y"),
        "data": pd.to_datetime(df["Data Base"], format="%d/%m/%Y"),
        "taxa": df["Taxa Compra Manha"].where(df["Taxa Compra Manha"] > 0, df["Taxa Venda Manha"]),
    })
    out = out[(out["data"].dt.year >= FIRST_YEAR) & (out["taxa"] > 0) & (out["vencimento"] > out["data"])]
    out["prazo_anos"] = (out["vencimento"] - out["data"]).dt.days / 365.25
    # Com e sem cupom podem vencer no mesmo dia; fica a média, para a interpolação ter x único.
    out = out.groupby(["tipo", "data", "vencimento"], as_index=False).agg(taxa=("taxa", "mean"), prazo_anos=("prazo_anos", "first"))
    return out.sort_values(["data", "tipo", "prazo_anos"]).reset_index(drop=True)


def rate_at_tenor(group: pd.DataFrame, tenor: float = TENOR_YEARS) -> float | None:
    """Taxa interpolada no prazo pedido, só se houver vencimentos dos dois lados."""
    x, y = group["prazo_anos"].to_numpy(), group["taxa"].to_numpy()
    if len(x) < 2 or x.min() > tenor or x.max() < tenor:
        return None
    return float(np.interp(tenor, x, y))


def weekly_series(df: pd.DataFrame) -> pd.DataFrame:
    """Última data de cada semana, taxa de 5 anos por tipo e inflação implícita."""
    last_days = df.groupby(df["data"].dt.to_period("W"))["data"].max()
    sample = df[df["data"].isin(last_days)]
    rows = []
    for data, g in sample.groupby("data"):
        row = {"data": data.strftime("%Y-%m-%d")}
        for tipo in ("prefixado", "ipca"):
            row[tipo] = rate_at_tenor(g[g["tipo"] == tipo])
        if row["prefixado"] is not None and row["ipca"] is not None:
            row["inflacao_implicita"] = ((1 + row["prefixado"] / 100) / (1 + row["ipca"] / 100) - 1) * 100
        else:
            row["inflacao_implicita"] = None
        rows.append(row)
    return pd.DataFrame(rows)


def latest_curve(df: pd.DataFrame) -> dict:
    last = df["data"].max()
    g = df[df["data"] == last]
    return {
        "data": last.strftime("%Y-%m-%d"),
        "titulos": [{"tipo": r.tipo, "vencimento": r.vencimento.strftime("%Y-%m-%d"), "prazo_anos": round(r.prazo_anos, 2),
                     "taxa": r.taxa} for r in g.itertuples()],
    }


def quarter_average(series: pd.DataFrame) -> pd.DataFrame:
    """Média trimestral da série semanal, para casar com os trimestres das empresas."""
    s = series.copy()
    d = pd.to_datetime(s["data"])
    s["quarter"] = d.dt.year.astype(str) + "T" + ((d.dt.month - 1) // 3 + 1).astype(str)
    return s.drop(columns="data").groupby("quarter").mean(numeric_only=True).reset_index()
