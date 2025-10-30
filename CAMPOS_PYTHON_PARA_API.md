# CAMPOS ENVIADOS PELO PYTHON → API_BB_REACT

## RESUMO

A API agora aceita **exatamente** os campos que o `Integracao_API_Boletos.py` envia.

---

## MAPEAMENTO COMPLETO

### Campos Enviados pelo Python (preparar_payload_api)

```python
payload = {
    # Dados básicos
    "uc": str,
    "mes_referencia": str,

    # Dados do boleto
    "dataVencimento": str,        # Formatado como "DD/MM/YYYY"
    "valorBoleto": float,
    "descricao": str,

    # Dados do pagador
    "tipoPessoa": str,            # "CPF" ou "CNPJ"
    "documento": str,             # Limpo (apenas números)
    "nomeCompleto": str,

    # Endereço
    "endereco": str,              # Já limpo pelo Python
    "bairro": str,
    "cep": str,                   # Limpo (apenas números)
    "cidade": str,
    "uf": str,

    # Dados de energia
    "energiaNaoCompensado": float,
    "energiaCompensado": float,
    "energiaTotal": float,
    "valorEnergiaCompensada": float,
    "valorBandeiraCompensada": float,
    "tarifaMinimaConcessionaria": float,
    "valorComDescontoAupus": float,

    # Campos opcionais
    "email": str,                 # (opcional)
    "telefone": str               # (opcional)
}
```

---

## PROCESSAMENTO NO PYTHON

### 1. Limpeza de Dados

```python
def limpar_cpf_cnpj(cpf_cnpj):
    """Remove formatação (pontos, traços, barras)"""
    return re.sub(r'\D', '', cpf_cnpj)

def limpar_cep(cep):
    """Remove formatação"""
    return re.sub(r'\D', '', cep)
```

### 2. Formatação de Vencimento

```python
def formatar_data_vencimento(vencimento_consorcio, mes_referencia):
    """
    Retorna: "DD/MM/YYYY"

    - Se vencimento_consorcio é número: usa esse dia
    - Senão: usa dia 15 como padrão
    - Mês: sempre o mês seguinte ao mes_referencia
    """
```

### 3. Descrição do Boleto

```python
def criar_descricao_boleto(mes_referencia):
    """
    Retorna: "Fatura de Energia - Outubro/2025"
    """
```

---

## CAMPOS RECEBIDOS PELA API

### Backend (server.js)

O backend **aceita** todos os campos do Python e armazena em memória:

```javascript
{
    // Campos do Python
    uc,
    mes_referencia,
    dataVencimento,
    valorBoleto,
    descricao,
    tipoPessoa,
    documento,
    nomeCompleto,
    endereco,
    bairro,
    cep,
    cidade,
    uf,
    energiaNaoCompensado,
    energiaCompensado,
    energiaTotal,
    valorEnergiaCompensada,
    valorBandeiraCompensada,
    tarifaMinimaConcessionaria,
    valorComDescontoAupus,
    email,          // opcional
    telefone,       // opcional

    // Campos adicionados pela API
    status: 'Pendente',
    data_recebimento: ISO timestamp,
    numero_boleto: null
}
```

---

## FRONTEND (React)

### Tabela exibe:

| Coluna | Campo |
|--------|-------|
| Status | `status` |
| UC | `uc` |
| Mês | `mes_referencia` |
| Nome | `nomeCompleto` |
| Documento | `documento` (formatado com CPF/CNPJ) |
| Valor Boleto | `valorBoleto` |
| Economia | `energiaTotal` (exibido como valor) |
| Consumo Total | `energiaTotal` (em kWh) |
| Recebido em | `data_recebimento` |

---

## DADOS ENVIADOS PARA O BANCO DO BRASIL

Quando clicar "Gerar Boleto":

```javascript
{
    // Configurações BB
    numeroConvenio: '3648981',
    numeroCarteira: '17',
    numeroVariacaoCarteira: '19',
    codigoModalidade: '1',

    // Datas
    dataEmissao: 'DD.MM.YYYY',
    dataVencimento: 'DD.MM.YYYY',  // Do campo dataVencimento (DD/MM/YYYY → DD.MM.YYYY)
    dataMulta: 'DD.MM.YYYY',       // dataVencimento + 1 dia

    // Valores
    valorOriginal: valorBoleto,

    // Identificação
    numeroTituloCliente: '{uc}_{mes}',  // Ex: "13095584_102025"
    descricaoTitulo: descricao,

    // Pagador
    codigoTipoInscricaoSacado: 1 ou 2,  // 1=CPF, 2=CNPJ
    numeroInscricaoSacadoCobranca: documento,  // Já limpo
    nomeSacadoCobranca: nomeCompleto (MAIÚSCULO, sem acentos),
    textoEnderecoSacadoCobranca: endereco (MAIÚSCULO, sem acentos),
    numeroCepSacadoCobranca: cep,
    nomeMunicipioSacadoCobranca: cidade (MAIÚSCULO, sem acentos),
    nomeBairroSacadoCobranca: bairro (MAIÚSCULO, sem acentos),
    siglaUnidadeFederacaoSacadoCobranca: uf,

    // Juros e multa
    codigoTipoJuro: '3',
    percentualJuro: '1.00',
    codigoTipoMulta: '2',
    percentualMulta: '2.00',

    // PIX
    indicadorPix: 'S',

    // Dados para o PDF
    dadosEnergia: {
        ... (todos os campos recebidos do Python)
    }
}
```

---

## PDF GERADO

O PDF exibe todos os dados recebidos do Python:

```
┌──────────────────────────────────────┐
│ DETALHAMENTO DA FATURA DE ENERGIA    │
├──────────────────────────────────────┤
│ UC: {uc}                             │
│ Mês: {mes_referencia}                │
├──────────────────────────────────────┤
│ CONSUMO                              │
│ Compensado: {energiaCompensado} kWh  │
│ Não Comp.: {energiaNaoCompensado}    │
│ Total: {energiaTotal} kWh            │
├──────────────────────────────────────┤
│ VALORES DA CONCESSIONÁRIA            │
│ Energia: {valorEnergiaCompensada}    │
│ Bandeira: {valorBandeiraCompensada}  │
│ Tarifa: {tarifaMinimaConcessionaria} │
├──────────────────────────────────────┤
│ DESCONTO AUPUS                       │
│ Valor c/ Desc: {valorComDescontoAupus}│
├──────────────────────────────────────┤
│ VALOR BOLETO: {valorBoleto}          │
└──────────────────────────────────────┘
```

---

## TESTE

### 1. Executar o Python

```bash
cd "c:\Users\arthu\Dropbox\AUPUS SMART\05. SITE\Sistema_Faturas"
python Integracao_API_Boletos.py
```

### 2. Verificar no navegador

```
http://localhost:3002
```

Clicar em: **Gerar Boleto Energia**

### 3. Gerar boleto

Clicar em **"Gerar Boleto"** na linha da tabela

---

## RESUMO DOS AJUSTES FEITOS

✅ **Backend** aceita campos exatos do Python (sem normalização)
✅ **React** usa os mesmos nomes de campos do Python
✅ **PDF** recebe todos os dados via `dadosEnergia`
✅ **Nenhuma conversão** de camelCase ↔ snake_case

---

**Status:** ✅ Pronto para integração
**Data:** 27/10/2025
