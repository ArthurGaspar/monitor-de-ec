"""O que o ETL baixa e quais contas ele lê.

As DFP/ITR seguem o plano de contas padronizado da CVM para empresas não financeiras: 3.01 é receita líquida, 3.11 é o
lucro consolidado do período, 2.01.04/2.02.01 são empréstimos e financiamentos. Bancos e seguradoras usam outro plano
(3.01 lá é "receitas de intermediação financeira"), então eles entram no lucro mas ficam fora de receita e dívida.
"""
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
RAW_DIR = ROOT / ".data" / "raw"
DB_PATH = ROOT / ".data" / "monitor.duckdb"
SITE_DATA = ROOT / "web" / "public" / "data"

CVM_BASE = "https://dados.cvm.gov.br/dados/CIA_ABERTA"
CAD_URL = f"{CVM_BASE}/CAD/DADOS/cad_cia_aberta.csv"
TESOURO_URL = ("https://www.tesourotransparente.gov.br/ckan/dataset/df56aa42-484a-4a59-8184-7676580c81e3/resource/"
               "796d2059-14e9-44e3-80c9-2d9e30b405c1/download/PrecoTaxaTesouroDireto.csv")

# 2019 entra só como base de comparação: o primeiro crescimento anual publicado é o de 2020.
FIRST_YEAR = 2019

# Contas lidas de cada demonstração consolidada. A chave vira o nome da métrica.
DRE_ACCOUNTS = {"3.01": "receita", "3.05": "ebit", "3.11": "lucro"}
BPA_ACCOUNTS = {"1": "ativo", "1.01.01": "caixa", "1.01.02": "aplicacoes"}
BPP_ACCOUNTS = {"2.01.04": "divida_cp", "2.02.01": "divida_lp", "2.03": "pl"}

# Setores da CVM agrupados num conjunto que cabe num mapa de calor. "Emp. Adm. Part. - X" (holdings) vai para X.
SECTOR_GROUPS = {
    "Financeiro": ["Bancos", "Intermediação Financeira", "Seguradoras e Corretoras", "Crédito Imobiliário",
                   "Securitização de Recebíveis", "Bolsas de Valores/Mercadorias e Futuros", "Arrendamento Mercantil",
                   "Factoring"],
    "Energia elétrica": ["Energia Elétrica"],
    "Petróleo, gás e química": ["Petróleo e Gás", "Petroquímicos e Borracha", "Químico"],
    "Mineração e siderurgia": ["Extração Mineral", "Metalurgia e Siderurgia"],
    "Papel, celulose e embalagens": ["Papel e Celulose", "Embalagens", "Reflorestamento"],
    "Agro e alimentos": ["Agricultura (Açúcar, Álcool e Cana)", "Alimentos", "Bebidas e Fumo"],
    "Varejo e consumo": ["Comércio (Atacado e Varejo)", "Têxtil e Vestuário", "Brinquedos e Lazer",
                         "Hospedagem e Turismo", "Educação"],
    "Construção e imóveis": ["Construção Civil, Mat. Constr. e Decoração", "Const. Civil, Mat. Const. e Decoração"],
    "Indústria e bens de capital": ["Máquinas, Equipamentos, Veículos e Peças", "Máqs., Equip., Veíc. e Peças",
                                    "Gráficas e Editoras"],
    "Transporte e logística": ["Serviços Transporte e Logística"],
    "Saneamento e gás": ["Saneamento, Serv. Água e Gás"],
    "Saúde": ["Serviços Médicos", "Farmacêutico e Higiene"],
    "Telecom e tecnologia": ["Telecomunicações", "Comunicação e Informática"],
}
FINANCIAL = "Financeiro"
OTHER = "Outros"

# Holdings cujo resultado é, quase todo, equivalência patrimonial de outra listada (Itaúsa sobre o Itaú, Bradespar sobre
# a Vale). Somá-las contaria o mesmo lucro duas vezes. As que consolidam a controlada linha a linha (Suzano Holding,
# Metalúrgica Gerdau) são achadas sozinhas por quality.duplicate_holdings.
EQUITY_HOLDINGS = {7617: "Itaúsa", 18724: "Bradespar"}

# Tipos do Tesouro Direto acompanhados no painel. Os de cupom semestral entram na mesma curva: a taxa deles também é
# rendimento anual, e são eles que cobrem os prazos longos quando não há título sem cupom tão longo à venda.
TESOURO_TYPES = {"Tesouro Selic": "selic", "Tesouro Prefixado": "prefixado", "Tesouro Prefixado com Juros Semestrais": "prefixado",
                 "Tesouro IPCA+": "ipca", "Tesouro IPCA+ com Juros Semestrais": "ipca"}

# Abaixo disso, um setor/trimestre não tem empresas suficientes para um crescimento confiável.
MIN_COMPANIES = 3
