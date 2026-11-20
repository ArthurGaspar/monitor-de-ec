"""Download dos arquivos abertos, com cache local.

Os zips da CVM são republicados quando uma empresa reapresenta um formulário, então o arquivo do ano corrente muda toda
semana e o de anos antigos quase nunca. Um GET condicional (ETag / Last-Modified) evita baixar de novo o que não mudou.
"""
import json
import re
from datetime import date
from pathlib import Path

import httpx

from .config import CAD_URL, CVM_BASE, FIRST_YEAR, RAW_DIR, TESOURO_URL

TIMEOUT = httpx.Timeout(30.0, read=300.0)


def fetch(url: str, dest: Path, client: httpx.Client) -> tuple[Path, bool]:
    """Baixa url para dest se mudou desde a última vez. Retorna (caminho, se baixou)."""
    meta_path = dest.with_suffix(dest.suffix + ".meta.json")
    headers = {}
    if dest.exists() and meta_path.exists():
        meta = json.loads(meta_path.read_text())
        if meta.get("etag"):
            headers["If-None-Match"] = meta["etag"]
        if meta.get("last_modified"):
            headers["If-Modified-Since"] = meta["last_modified"]
    with client.stream("GET", url, headers=headers, follow_redirects=True) as resp:
        if resp.status_code == 304:
            return dest, False
        resp.raise_for_status()
        dest.parent.mkdir(parents=True, exist_ok=True)
        tmp = dest.with_suffix(dest.suffix + ".part")
        with tmp.open("wb") as f:
            for chunk in resp.iter_bytes(1 << 20):
                f.write(chunk)
        tmp.replace(dest)
        meta_path.write_text(json.dumps({"url": url, "etag": resp.headers.get("etag"),
                                         "last_modified": resp.headers.get("last-modified")}))
    return dest, True


def available_years(kind: str, client: httpx.Client) -> list[int]:
    """Anos publicados no diretório da CVM para DFP ou ITR, a partir de FIRST_YEAR."""
    listing = client.get(f"{CVM_BASE}/DOC/{kind.upper()}/DADOS/").text
    years = {int(y) for y in re.findall(rf"{kind}_cia_aberta_(\d{{4}})\.zip", listing)}
    return sorted(y for y in years if FIRST_YEAR <= y <= date.today().year)


def extract_all(log=print) -> dict:
    """Baixa cadastro, DFP, ITR e Tesouro Direto. Retorna os caminhos locais."""
    out = {"dfp": {}, "itr": {}}
    with httpx.Client(timeout=TIMEOUT) as client:
        for kind in ("dfp", "itr"):
            for year in available_years(kind, client):
                url = f"{CVM_BASE}/DOC/{kind.upper()}/DADOS/{kind}_cia_aberta_{year}.zip"
                path, new = fetch(url, RAW_DIR / kind / f"{kind}_cia_aberta_{year}.zip", client)
                out[kind][year] = path
                log(f"  {kind.upper()} {year}: {'baixado' if new else 'em cache'}")
        out["cad"], new = fetch(CAD_URL, RAW_DIR / "cad_cia_aberta.csv", client)
        log(f"  cadastro: {'baixado' if new else 'em cache'}")
        out["tesouro"], new = fetch(TESOURO_URL, RAW_DIR / "PrecoTaxaTesouroDireto.csv", client)
        log(f"  Tesouro Direto: {'baixado' if new else 'em cache'}")
    return out
