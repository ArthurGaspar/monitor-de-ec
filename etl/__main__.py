"""python -m etl run [--offline] | bulletin [--provider ollama|anthropic] [--quarters N]"""
import argparse

from .pipeline import run


def main() -> None:
    parser = argparse.ArgumentParser(prog="python -m etl", description="Monitor da economia corporativa")
    sub = parser.add_subparsers(dest="cmd", required=True)
    r = sub.add_parser("run", help="baixa, transforma, carrega no DuckDB e publica o JSON do painel")
    r.add_argument("--offline", action="store_true", help="usa só os arquivos já baixados em .data/raw")
    b = sub.add_parser("bulletin", help="escreve boletins com um LLM a partir do JSON publicado")
    b.add_argument("--provider", choices=["auto", "anthropic", "ollama"], default="auto")
    b.add_argument("--model", help="modelo (padrão: claude-sonnet-5 ou qwen2.5:7b)")
    b.add_argument("--quarters", type=int, default=1, help="quantos trimestres, do mais recente para trás")
    args = parser.parse_args()
    if args.cmd == "run":
        run(offline=args.offline)
    else:
        from .bulletin import generate
        generate(provider=args.provider, model=args.model, quarters=args.quarters)


if __name__ == "__main__":
    main()
