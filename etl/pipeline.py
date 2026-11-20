"""Orquestra o ETL: baixa, transforma, grava no DuckDB e publica o JSON que o painel lê.

O DuckDB (.data/monitor.duckdb) guarda tudo em tabelas consultáveis por SQL; o JSON em web/public/data é o recorte que o
site precisa, em R$ bilhões e com poucas casas, para caber num carregamento de página.
"""
import json
import math
import time
from datetime import datetime, timezone
from pathlib import Path

import duckdb
import pandas as pd

from . import config
from .config import DB_PATH, EQUITY_HOLDINGS, RAW_DIR, SITE_DATA
from .cvm import read_cadastro, read_zip
from .extract import extract_all
from .metrics import TOTAL, TOTAL_NONFIN, company_panel, company_snapshot, sector_quarters
from .quality import duplicate_holdings, fix_scale
from .quarters import standalone_quarters, wide
from .tesouro import latest_curve, quarter_average, read_tesouro, weekly_series

BI = 1e6                 # valores chegam em R$ mil
# O último trimestre é "parcial" enquanto menos empresas publicaram do que no anterior; o prazo do ITR é 45 dias.
PARTIAL_COVERAGE = 0.95


def local_sources() -> dict:
    return {
        "dfp": {int(p.stem[-4:]): p for p in sorted((RAW_DIR / "dfp").glob("*.zip"))},
        "itr": {int(p.stem[-4:]): p for p in sorted((RAW_DIR / "itr").glob("*.zip"))},
        "cad": RAW_DIR / "cad_cia_aberta.csv",
        "tesouro": RAW_DIR / "PrecoTaxaTesouroDireto.csv",
    }


def transform(sources: dict, log=print) -> dict:
    t = time.time()
    facts = pd.concat([read_zip(p, kind) for kind in ("dfp", "itr") for p in sources[kind].values()], ignore_index=True)
    log(f"  {len(facts):,} linhas de demonstrações lidas ({time.time() - t:.0f}s)")
    cad = read_cadastro(sources["cad"])
    facts, scale_log = fix_scale(facts)
    log(f"  {len(scale_log)} formulários com escala corrigida")
    qwide = wide(standalone_quarters(facts))

    draft = company_panel(qwide, cad)
    duplicates = duplicate_holdings(draft)
    exclude = set(duplicates) | set(EQUITY_HOLDINGS)
    panel = company_panel(qwide, cad, exclude)
    names = draft.drop_duplicates("cd_cvm").set_index("cd_cvm")["nome_comercial"].to_dict()
    log(f"  {panel['cd_cvm'].nunique()} empresas no painel; fora: "
        + ", ".join(f"{names.get(h, h)} (duplica {names.get(s, s)})" for h, s in duplicates.items())
        + ", " + ", ".join(f"{n} (equivalência patrimonial)" for n in EQUITY_HOLDINGS.values()))

    sectors = sector_quarters(panel)
    tes = read_tesouro(sources["tesouro"])
    weekly = weekly_series(tes)
    return {"facts": facts, "cad": cad, "panel": panel, "sectors": sectors, "tesouro": tes, "tesouro_semanal": weekly,
            "tesouro_curva": latest_curve(tes), "tesouro_trimestral": quarter_average(weekly),
            "scale_log": scale_log, "excluded": {**{h: f"duplica {names.get(s, s)}" for h, s in duplicates.items()},
                                                 **{h: "equivalência patrimonial de outra listada" for h in EQUITY_HOLDINGS}},
            "names": names}


def load(data: dict, db_path: Path = DB_PATH) -> None:
    db_path.parent.mkdir(parents=True, exist_ok=True)
    con = duckdb.connect(str(db_path))
    tables = {"fatos": data["facts"], "empresas": data["cad"], "painel": data["panel"], "setores": data["sectors"],
              "tesouro_titulos": data["tesouro"], "tesouro_5a": data["tesouro_semanal"]}
    for name, df in tables.items():
        con.register("df", df)
        con.execute(f"CREATE OR REPLACE TABLE {name} AS SELECT * FROM df")
        con.unregister("df")
    con.close()


def _clean(v, digits: int = 4):
    if v is None or (isinstance(v, float) and (math.isnan(v) or math.isinf(v))):
        return None
    if isinstance(v, float):
        return round(v, digits)
    return v


def _bi(v):
    return _clean(v / BI if v is not None and not pd.isna(v) else None, 2)


def latest_quarter(sectors: pd.DataFrame) -> tuple[str, bool]:
    """Último trimestre publicado e se ele ainda está parcial."""
    total = sectors[sectors["setor"] == TOTAL].set_index("quarter")["empresas"]
    last = total.index.max()
    prev = total.iloc[-2] if len(total) > 1 else total.iloc[-1]
    return last, bool(total[last] < PARTIAL_COVERAGE * prev)


def publish(data: dict, out_dir: Path = SITE_DATA) -> dict:
    out_dir.mkdir(parents=True, exist_ok=True)
    sectors, panel = data["sectors"], data["panel"]
    quarter, partial = latest_quarter(sectors)
    quarters = sorted(q for q in sectors["quarter"].unique() if q >= f"{config.FIRST_YEAR + 1}T1")

    def series(g: pd.DataFrame) -> list[dict]:
        g = g[g["quarter"].isin(quarters)]
        return [{"q": r.quarter, "empresas": r.empresas, "receita": _bi(r.receita), "lucro": _bi(r.lucro),
                 "margem": _clean(r.margem), "receita_aa": _clean(r.receita_aa), "receita_aa_n": r.receita_aa_n,
                 "lucro_aa": _clean(r.lucro_aa), "lucro_aa_n": r.lucro_aa_n, "prejuizo": r.empresas_prejuizo,
                 "divida_liquida": _bi(r.divida_liquida), "div_liq_pl": _clean(r.div_liq_pl),
                 "div_liq_ebit": _clean(r.div_liq_ebit, 2)} for r in g.itertuples()]

    by_sector = {s: series(g) for s, g in sectors.groupby("setor")}
    at_latest = lambda rows, key: next((r[key] for r in rows if r["q"] == quarter), None) or 0
    order = sorted((s for s in by_sector if s not in (TOTAL, TOTAL_NONFIN)), key=lambda s: -at_latest(by_sector[s], "receita"))
    sector_names = {s: g["setor_cvm"].value_counts().index.tolist()[:6] for s, g in panel.groupby("setor")}

    # Com o trimestre parcial, a tabela de empresas usa o anterior, em que todas já publicaram.
    snap_quarter = quarters[-2] if partial else quarter
    snap = company_snapshot(panel, snap_quarter)
    companies = [{"cd_cvm": int(r.cd_cvm), "nome": r.nome_comercial, "setor": r.setor, "receita_12m": _bi(r.receita_12m),
                  "lucro_12m": _bi(r.lucro_12m), "receita_12m_aa": _clean(r.receita_12m_aa), "margem_12m": _clean(r.margem_12m),
                  "div_liq_ebit": _clean(r.div_liq_ebit, 2), "div_liq_pl": _clean(r.div_liq_pl), "ativo": _bi(r.ativo)}
                 for r in snap.sort_values("ativo", ascending=False).itertuples()]

    meta = {
        "gerado_em": datetime.now(timezone.utc).isoformat(timespec="seconds"),
        "trimestres": quarters, "ultimo_trimestre": quarter, "parcial": partial, "trimestre_empresas": snap_quarter,
        "setores": order, "totais": [TOTAL, TOTAL_NONFIN], "setores_cvm": sector_names,
        "empresas_no_painel": int(panel["cd_cvm"].nunique()),
        "correcoes_escala": len(data["scale_log"]),
        "excluidas": [{"cd_cvm": int(k), "nome": data["names"].get(k, str(k)), "motivo": v} for k, v in data["excluded"].items()],
        "fontes": {"cvm": config.CVM_BASE, "tesouro": config.TESOURO_URL},
    }
    tesouro = {"semanal": [{k: _clean(v, 3) for k, v in r.items()} for r in data["tesouro_semanal"].to_dict("records")],
               "curva": data["tesouro_curva"]}
    files = {"meta.json": meta, "setores.json": by_sector, "empresas.json": companies, "tesouro.json": tesouro}
    for name, payload in files.items():
        (out_dir / name).write_text(json.dumps(payload, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
    return meta


def run(offline: bool = False, log=print) -> dict:
    t = time.time()
    log("Extração" + (" (offline, só cache)" if offline else ""))
    sources = local_sources() if offline else extract_all(log)
    log("Transformação")
    data = transform(sources, log)
    log("Carga no DuckDB")
    load(data)
    meta = publish(data)
    log(f"Publicado em {SITE_DATA.relative_to(config.ROOT)}: até {meta['ultimo_trimestre']}"
        f"{' (parcial)' if meta['parcial'] else ''}, {meta['empresas_no_painel']} empresas, {time.time() - t:.0f}s")
    return data
