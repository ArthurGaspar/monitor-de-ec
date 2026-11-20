"""Boletins econômicos escritos por um LLM a partir do JSON publicado.

O modelo não vê a base inteira: recebe uma ficha de fatos já calculados (crescimentos, margens, alavancagem, taxas do
Tesouro), com os números formatados como devem aparecer no texto. A instrução é escrever só com esses números. Depois
conferimos: todo número do boletim que não está na ficha vai para "nao_verificados", e o painel mostra essa lista ao lado
do texto. Um modelo local de 7B erra mais que o Claude; a conferência existe para isso ficar visível, não escondido.

Provedor "auto": Claude quando há credencial da Anthropic (ANTHROPIC_API_KEY ou perfil do `ant auth login`), senão Ollama.
"""
import json
import os
import re
import shutil
import subprocess
from datetime import datetime, timezone

import httpx

from .config import SITE_DATA
from .metrics import TOTAL_NONFIN
from .quarters import shift_quarter

ANTHROPIC_MODEL = "claude-opus-5"
OLLAMA_MODEL = "qwen2.5:7b"
OLLAMA_URL = os.environ.get("OLLAMA_HOST", "http://localhost:11434").rstrip("/") + "/api/chat"

SYSTEM = """Você é um analista que escreve o boletim trimestral de um monitor da economia corporativa brasileira, feito com \
os demonstrativos que as companhias abertas entregam à CVM e com as taxas do Tesouro Direto.

Escreva em português do Brasil, em 4 ou 5 parágrafos curtos (350 a 450 palavras no total), com um título na primeira linha \
começando por "# ". Use apenas os números da ficha de fatos, copiados como estão escritos lá; não calcule números novos, não \
arredonde de outro jeito e não traga dados de fora (Selic, PIB, câmbio, notícias). Se um fato não basta para uma conclusão, \
não a tire. Crescimentos são "mesmas empresas": compare só com o mesmo trimestre do ano anterior. Explique a alavancagem \
como dívida líquida sobre o EBIT dos últimos 12 meses. Termine com um parágrafo sobre as taxas do Tesouro e o que elas \
dizem sobre o custo do dinheiro para as empresas, sem previsões. Sem listas, sem tabelas, sem recomendações de investimento."""


def pct(v: float | None, signed: bool = True) -> str | None:
    if v is None:
        return None
    s = f"{v * 100:+.1f}%" if signed else f"{v * 100:.1f}%"
    return s.replace(".", ",")


def num(v: float | None, digits: int = 1) -> str | None:
    if v is None:
        return None
    return f"{v:,.{digits}f}".replace(",", "X").replace(".", ",").replace("X", ".")


def facts_for(quarter: str, setores: dict, tesouro: dict, meta: dict) -> dict:
    """Ficha de fatos de um trimestre, com números já no formato do texto."""
    def row(sector: str, q: str) -> dict:
        return next((r for r in setores.get(sector, []) if r["q"] == q), {})

    ago = shift_quarter(quarter, -4)
    tot, tot_ago = row(TOTAL_NONFIN, quarter), row(TOTAL_NONFIN, ago)
    allc = row("Todas as empresas", quarter)
    fin, fin_ago = row("Financeiro", quarter), row("Financeiro", ago)

    sectors = []
    for s in meta["setores"]:
        r, r0 = row(s, quarter), row(s, ago)
        if not r:
            continue
        sectors.append({"setor": s, "empresas": r["empresas"], "receita_liquida_bi": num(r["receita"]),
                        "crescimento_receita": pct(r["receita_aa"]), "lucro_liquido_bi": num(r["lucro"]),
                        "crescimento_lucro_liquido": pct(r["lucro_aa"]), "margem_liquida": pct(r["margem"], False),
                        "margem_liquida_um_ano_antes": pct(r0.get("margem"), False),
                        "div_liq_ebit": num(r["div_liq_ebit"]), "div_liq_ebit_um_ano_antes": num(r0.get("div_liq_ebit"))})
    ranked = [s for s in sectors if s["setor"] != "Financeiro" and s["crescimento_receita"] is not None]
    ranked.sort(key=lambda s: float(s["crescimento_receita"].replace(",", ".").rstrip("%")), reverse=True)

    def tes_avg(q: str) -> dict:
        rows = [r for r in tesouro["semanal"] if _quarter_of(r["data"]) == q]
        avg = lambda k: sum(r[k] for r in rows if r[k] is not None) / max(1, sum(r[k] is not None for r in rows))
        return {k: avg(k) for k in ("prefixado", "ipca", "inflacao_implicita")} if rows else {}

    t, t_prev = tes_avg(quarter), tes_avg(shift_quarter(quarter, -1))
    names = {"prefixado": "taxa_prefixado_5_anos", "ipca": "juro_real_ipca_mais_5_anos", "inflacao_implicita": "inflacao_implicita_5_anos"}
    tes = {f"{names[k]}_media_no_trimestre": num(v, 2) + "%" for k, v in t.items()}
    tes.update({f"{names[k]}_media_no_trimestre_anterior": num(v, 2) + "%" for k, v in t_prev.items()})

    return {
        "trimestre": f"{quarter[-1]}º trimestre de {quarter[:4]}",
        "codigo_trimestre": quarter,
        "nao_financeiras": {
            "empresas": tot.get("empresas"), "receita_liquida_bi": num(tot.get("receita")),
            "crescimento_receita": pct(tot.get("receita_aa")), "empresas_comparadas_receita": tot.get("receita_aa_n"),
            "lucro_liquido_bi": num(tot.get("lucro")), "crescimento_lucro_liquido": pct(tot.get("lucro_aa")),
            "margem_liquida": pct(tot.get("margem"), False), "margem_liquida_um_ano_antes": pct(tot_ago.get("margem"), False),
            "empresas_com_prejuizo": tot.get("prejuizo"),
            "div_liq_ebit": num(tot.get("div_liq_ebit")), "div_liq_ebit_um_ano_antes": num(tot_ago.get("div_liq_ebit")),
        },
        "financeiro": {"lucro_liquido_bi": num(fin.get("lucro")), "lucro_liquido_bi_um_ano_antes": num(fin_ago.get("lucro")),
                       "crescimento_lucro_liquido": pct(fin.get("lucro_aa"))},
        "todas_empresas_lucro_liquido_bi": num(allc.get("lucro")),
        "setores_maior_crescimento_receita": ranked[:3],
        "setores_menor_crescimento_receita": ranked[-3:][::-1],
        "todos_os_setores": sectors,
        "tesouro": tes,
        "notas": ["valores em R$ bilhões, somando as empresas que publicaram no trimestre",
                  "crescimentos comparam as mesmas empresas com o mesmo trimestre do ano anterior",
                  "receita, margem e dívida excluem bancos e seguradoras"],
    }


def _quarter_of(date: str) -> str:
    return f"{date[:4]}T{(int(date[5:7]) - 1) // 3 + 1}"


NUMBER = re.compile(r"(?<![\w])[-+]?\d{1,3}(?:\.\d{3})*(?:,\d+)?|(?<![\w])[-+]?\d+(?:,\d+)?")


def _numbers(text: str) -> set[str]:
    return {n.lstrip("+-") for n in NUMBER.findall(text)}


def check(text: str, facts: dict) -> list[str]:
    """Números do boletim que não aparecem na ficha (anos, trimestres e contagens pequenas não contam)."""
    allowed = _numbers(json.dumps(facts, ensure_ascii=False))
    out = []
    for n in sorted(_numbers(text)):
        plain = n.replace(".", "")
        if n in allowed or (plain.isdigit() and (int(plain) <= 12 or 1990 <= int(plain) <= 2100)):
            continue
        out.append(n)
    return out


# Termos que contradizem a ficha: o painel só tem receita e lucro líquidos, e IPCA+ é juro real, não inflação.
WRONG_TERMS = {r"receita bruta": "a receita é líquida", r"lucro bruto": "o lucro é líquido", r"margem bruta": "a margem é líquida",
               r"infla[çc][ãa]o (?:medida pelo |do )?ipca": "a taxa do IPCA+ é juro real, não a inflação"}


def check_terms(text: str) -> list[str]:
    low = text.lower()
    return [f"\"{m.group(0)}\": {why}" for pat, why in WRONG_TERMS.items() for m in [re.search(pat, low)] if m]


def has_anthropic_credentials() -> bool:
    if os.environ.get("ANTHROPIC_API_KEY") or os.environ.get("ANTHROPIC_AUTH_TOKEN"):
        return True
    if shutil.which("ant"):
        res = subprocess.run(["ant", "auth", "status"], capture_output=True, text=True)
        return res.returncode == 0 and "no active" not in (res.stdout + res.stderr).lower()
    return False


def write_anthropic(facts: dict, model: str) -> str:
    import anthropic

    client = anthropic.Anthropic()
    # Fallback no servidor: se o modelo recusar, a própria API reexecuta em outro modelo.
    response = client.beta.messages.create(
        model=model, max_tokens=4000, system=SYSTEM,
        betas=["server-side-fallback-2026-07-01"], fallbacks="default",
        messages=[{"role": "user", "content": "Ficha de fatos:\n" + json.dumps(facts, ensure_ascii=False, indent=1)}],
    )
    if response.stop_reason == "refusal":
        raise RuntimeError("o modelo recusou o pedido")
    return "".join(b.text for b in response.content if b.type == "text").strip()


def write_ollama(facts: dict, model: str) -> str:
    payload = {"model": model, "stream": False, "options": {"temperature": 0.3, "num_ctx": 8192},
               "messages": [{"role": "system", "content": SYSTEM},
                            {"role": "user", "content": "Ficha de fatos:\n" + json.dumps(facts, ensure_ascii=False, indent=1)}]}
    resp = httpx.post(OLLAMA_URL, json=payload, timeout=httpx.Timeout(30.0, read=1800.0))
    resp.raise_for_status()
    return resp.json()["message"]["content"].strip()


def generate(provider: str = "auto", model: str | None = None, quarters: int = 1, log=print) -> list[dict]:
    meta = json.loads((SITE_DATA / "meta.json").read_text(encoding="utf-8"))
    setores = json.loads((SITE_DATA / "setores.json").read_text(encoding="utf-8"))
    tesouro = json.loads((SITE_DATA / "tesouro.json").read_text(encoding="utf-8"))
    if provider == "auto":
        provider = "anthropic" if has_anthropic_credentials() else "ollama"
    model = model or (ANTHROPIC_MODEL if provider == "anthropic" else OLLAMA_MODEL)
    write = write_anthropic if provider == "anthropic" else write_ollama

    path = SITE_DATA / "boletins.json"
    existing = json.loads(path.read_text(encoding="utf-8")) if path.exists() else []
    # O trimestre ainda parcial fica de fora: o boletim usa o último em que todas as empresas já publicaram.
    last = meta["trimestre_empresas"]
    targets = [shift_quarter(last, -i) for i in range(quarters)]
    for q in targets:
        facts = facts_for(q, setores, tesouro, meta)
        log(f"  {q}: escrevendo com {provider}/{model}...")
        text = write(facts, model)
        flagged, terms = check(text, facts), check_terms(text)
        log(f"  {q}: {len(text.split())} palavras, {len(flagged)} números fora da ficha, {len(terms)} termos errados")
        entry = {"trimestre": q, "provedor": provider, "modelo": model,
                 "gerado_em": datetime.now(timezone.utc).isoformat(timespec="seconds"),
                 "texto": text, "nao_verificados": flagged, "termos_errados": terms, "fatos": facts}
        existing = [e for e in existing if e["trimestre"] != q] + [entry]
    existing.sort(key=lambda e: e["trimestre"], reverse=True)
    path.write_text(json.dumps(existing, ensure_ascii=False, indent=1), encoding="utf-8")
    return existing
