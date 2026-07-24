# Pagamento de Faturas - Documentação Frontend

> **Guia para implementação do Frontend** - Especificação completa da interface de pagamento de faturas de concessionárias.

---

## 📋 Índice

1. [Visão Geral](#1-visão-geral)
2. [Estrutura da Tela](#2-estrutura-da-tela)
3. [Fluxos de Usuário](#3-fluxos-de-usuário)
4. [Componentes](#4-componentes)
5. [Estados e Dados](#5-estados-e-dados)
6. [Integração com API](#6-integração-com-api)
7. [Regras de Negócio (Frontend)](#7-regras-de-negócio-frontend)
8. [Modais](#8-modais)
9. [Exemplos de Código](#9-exemplos-de-código)

---

## 1. Visão Geral

### 1.1 Objetivo

A tela de **Pagamento de Faturas** permite gerenciar o pagamento de faturas de concessionárias de energia (EQTL). O sistema possui duas abas principais:

| Aba | Descrição | Ação Principal |
|-----|-----------|----------------|
| **Pagamento em Lote** | Faturas que a empresa paga via BB | Lançar pagamento no Banco do Brasil |
| **Enviar ao Cliente** | Faturas que o cliente paga diretamente | Enviar fatura via WhatsApp/Email |

### 1.2 Screenshot de Referência

```
┌─────────────────────────────────────────────────────────────────────────────┐
│ Pagamento de Faturas - Janeiro de 2026                                      │
│ 3 faturas encontradas                                                       │
├─────────────────────────────────────────────────────────────────────────────┤
│ [Para Pagamento 3] [Enviar para Cliente 2]  | Buscar UC... | Todos | [Lançar]│
├─────────────────────────────────────────────────────────────────────────────┤
│ ☑ │ Cliente        │ UC       │ Consumo │ Compensado │ Valor   │ Status    │
├───┼────────────────┼──────────┼─────────┼────────────┼─────────┼───────────┤
│ ☑ │ Lucas Gabriel  │ 49166370 │ 0 kWh   │ 2,709 kWh  │ R$ 0,57 │ ✓ Pago    │
│ ☑ │ Lucas Gabriel  │ 47268180 │ 0 kWh   │ 100 kWh    │ R$ 24,00│ ✓ Pago    │
│ ☐ │ Lucas Gabriel  │ 10777539 │ 0 kWh   │ 1,067 kWh  │ R$ 1,94 │ ⚠ Vencido │
└─────────────────────────────────────────────────────────────────────────────┘
│ 3 fatura(s) selecionada(s)                    [Lançar Pagamento em Lote]    │
└─────────────────────────────────────────────────────────────────────────────┘
```

---

## 2. Estrutura da Tela

### 2.1 Header com Filtros

```
┌─────────────────────────────────────────────────────────────────┐
│ Mês Referência │ Status │ Filtrar UC │ [Buscar] │ [Sincronizar] │
│ [01/2026    ▼] │[Todos▼]│ [________] │          │               │
└─────────────────────────────────────────────────────────────────┘
```

**Campos:**
- **Mês Referência**: Dropdown com meses disponíveis (carregado da API)
- **Status**: Filtro por status (Todos, Pendente, Lançado, Pago, etc.)
- **Filtrar UC**: Campo de texto para buscar por UC específica
- **Buscar**: Recarrega dados com filtros
- **Sincronizar Status**: Sincroniza status dos pagamentos com API do BB

### 2.2 Cards de Resumo

```
┌──────────────┐ ┌──────────────┐ ┌──────────────┐
│      15      │ │  R$ 1.250,00 │ │ Pend: 5      │
│    Total     │ │  Valor Total │ │ Pago: 10     │
└──────────────┘ └──────────────┘ └──────────────┘
```

### 2.3 Abas de Navegação

```
┌─────────────────────────┬─────────────────────────┐
│ 💰 Pagamento em Lote (8)│ 📤 Enviar ao Cliente (7)│
└─────────────────────────┴─────────────────────────┘
```

**Regra de separação:**
- **Pagamento em Lote**: Faturas onde a empresa paga (titularidade Aupus)
- **Enviar ao Cliente**: Faturas onde o cliente paga (nome diferente na fatura)

### 2.4 Tabela de Faturas

#### Aba "Pagamento em Lote"

| Coluna | Descrição |
|--------|-----------|
| ☑ | Checkbox para seleção (apenas pendentes com código de barras) |
| UC | Número da unidade consumidora |
| Cliente | Nome do cliente |
| Valor EQTL | Valor da fatura da concessionária |
| Vencimento | Data de vencimento |
| PIX | Indicador se tem PIX (clicável para copiar) |
| Cod. Barras | Indicador se tem código de barras (clicável para copiar) |
| Status BB | Status do pagamento no Banco do Brasil |
| Control | Status no sistema Aupus Control |
| Ações | Botões de ação |

#### Aba "Enviar ao Cliente"

| Coluna | Descrição |
|--------|-----------|
| UC | Número da unidade consumidora |
| Cliente | Nome do cliente |
| Valor EQTL | Valor da fatura |
| Vencimento | Data de vencimento |
| Titularidade | ✓ ou ✗ indicando se é titular Aupus |
| Status | Status de envio (WhatsApp OK, Email OK) |
| Ações | Botão de enviar fatura |

### 2.5 Footer com Ações em Lote

```
┌─────────────────────────────────────────────────────────────────┐
│ 3 pagamento(s) selecionado(s)  [Limpar] [Lançar BB] [Lançar Ctrl]│
└─────────────────────────────────────────────────────────────────┘
```

---

## 3. Fluxos de Usuário

### 3.1 Fluxo: Lançar Pagamento Individual

```
┌─────────────┐     ┌──────────────┐     ┌─────────────┐     ┌──────────────┐
│ Clicar no   │────▶│ Modal de     │────▶│ Confirmar   │────▶│ Atualizar    │
│ botão 💰    │     │ Confirmação  │     │ Lançamento  │     │ Status       │
└─────────────┘     └──────────────┘     └─────────────┘     └──────────────┘
```

**Detalhes:**
1. Usuário clica no botão 💰 (Banknote) na linha da fatura
2. Se vencimento passou, modal pede nova data
3. Modal exibe dados do pagamento para confirmação
4. Usuário confirma
5. Sistema envia para API do BB
6. Status atualiza para "Lançado"

### 3.2 Fluxo: Lançamento em Lote

```
┌─────────────┐     ┌──────────────┐     ┌─────────────┐     ┌──────────────┐
│ Selecionar  │────▶│ Clicar       │────▶│ Modal com   │────▶│ Processar    │
│ Checkboxes  │     │ "Lançar BB"  │     │ Lista       │     │ Um a Um      │
└─────────────┘     └──────────────┘     └─────────────┘     └──────────────┘
                                                                    │
                                         ┌──────────────┐           │
                                         │ Exibir       │◀──────────┘
                                         │ Resultado    │
                                         └──────────────┘
```

**Detalhes:**
1. Usuário seleciona múltiplas faturas via checkbox
2. Clica em "Lançar BB (N)"
3. Modal exibe lista de itens selecionados com valor total
4. Usuário confirma
5. Sistema processa um a um com delay de 500ms
6. Barra de progresso mostra andamento
7. Resultado final exibe sucessos e erros

### 3.3 Fluxo: Enviar Fatura ao Cliente

```
┌─────────────┐     ┌──────────────┐     ┌─────────────┐     ┌──────────────┐
│ Clicar no   │────▶│ Modal de     │────▶│ Escolher    │────▶│ Enviar       │
│ botão 📤    │     │ Envio        │     │ Canal       │     │ Mensagem     │
└─────────────┘     └──────────────┘     └─────────────┘     └──────────────┘
```

**Detalhes:**
1. Usuário clica no botão 📤 (Send) na aba "Enviar ao Cliente"
2. Modal abre com dados pré-preenchidos (telefone, email do cliente)
3. Usuário escolhe canal: WhatsApp, Email ou Ambos
4. Pode personalizar mensagem
5. Clica em "Enviar"
6. Sistema envia via API
7. Status atualiza para "WhatsApp OK" / "Email OK"

### 3.4 Fluxo: Cancelar Pagamento

```
┌─────────────┐     ┌──────────────┐     ┌─────────────┐
│ Clicar no   │────▶│ Confirmar    │────▶│ Cancelar    │
│ botão 🗑️    │     │ Cancelamento │     │ no BB       │
└─────────────┘     └──────────────┘     └─────────────┘
```

**Regras:**
- Só pode cancelar pagamentos com status "Lançado"
- Se já foi processado pelo BB, não pode cancelar
- Opção de "forçar cancelamento" (apenas local)

---

## 4. Componentes

### 4.1 Estrutura de Componentes

```
PagamentoFaturas/
├── index.tsx                    # Componente principal
├── components/
│   ├── FiltrosHeader.tsx        # Filtros e ações do header
│   ├── CardsResumo.tsx          # Cards de estatísticas
│   ├── AbasNavegacao.tsx        # Tabs Lote/Enviar
│   ├── TabelaFaturas.tsx        # Tabela principal
│   ├── LinhaFatura.tsx          # Linha individual da tabela
│   ├── FooterSelecao.tsx        # Footer com ações em lote
│   ├── StatusBadge.tsx          # Badge de status colorido
│   └── BotoesAcao.tsx           # Botões de ação da linha
├── modals/
│   ├── ModalLancarIndividual.tsx
│   ├── ModalLancamentoLote.tsx
│   ├── ModalEnvioFatura.tsx
│   ├── ModalCancelar.tsx
│   └── ModalConfig.tsx
├── hooks/
│   ├── useFaturas.ts            # Fetch e estado das faturas
│   ├── useSelecao.ts            # Lógica de seleção
│   ├── useLancamentoLote.ts     # Processamento em lote
│   └── useEnvioFatura.ts        # Envio WhatsApp/Email
├── services/
│   └── pagamentoService.ts      # Chamadas à API
└── types/
    └── pagamento.ts             # Interfaces TypeScript
```

### 4.2 Interfaces TypeScript

```typescript
// types/pagamento.ts

export interface Fatura {
  fatura_id: string;
  uc: string;
  mes_referencia: string;
  nome_cliente: string | null;
  valor_fatura: number;
  data_vencimento_fatura: string | null;
  codigo_barras: string | null;
  pix_copia_cola: string | null;
  status: StatusPagamento;
  status_control: 'lancado' | 'erro' | null;
  control_lancamento_id: string | null;
  
  // Flags de tipo
  tem_boleto_energia: boolean;
  is_ug: boolean;
  nome_diferente: boolean;
  tipo_forcado: 'lote' | 'enviar' | null;
  
  // Dados de envio
  data_envio_whatsapp: string | null;
  data_envio_email: string | null;
  whatsapp: string | null;
  email: string | null;
  
  // Dados do BB
  pagamento_id: number | null;
  numero_requisicao: number | null;
  id_pagamento_bb: string | null;
}

export type StatusPagamento = 
  | 'pendente'
  | 'lancado'
  | 'aguardando_aprovacao'
  | 'processando_pagamento'
  | 'pago'
  | 'vencido'
  | 'erro'
  | 'rejeitado'
  | 'cancelado';

export type TipoAba = 'lote' | 'enviar';

export type TipoEnvio = 'whatsapp' | 'email' | 'ambos';

export interface ModalLancamentoLoteState {
  show: boolean;
  processando: boolean;
  total: number;
  atual: number;
  sucessos: number;
  erros: number;
  resultados: ResultadoLancamento[];
  concluido: boolean;
  itens: Fatura[];
}

export interface ResultadoLancamento {
  uc: string;
  nome: string | null;
  sucesso: boolean;
  mensagem: string;
}

export interface ModalEnvioFaturaState {
  show: boolean;
  pagamento: Fatura | null;
  tipoEnvio: TipoEnvio;
  telefone: string;
  email: string;
  emailSecundario: string;
  enviando: boolean;
  statusEnvio: StatusEnvio | null;
  forcarReenvio: boolean;
  mensagemWhatsapp: string;
  mensagemEmail: string;
  assuntoEmail: string;
}

export interface StatusEnvio {
  tipo: 'success' | 'error' | 'warning';
  mensagem: string;
  jaEnviado?: boolean;
}
```

---

## 5. Estados e Dados

### 5.1 Estados Principais

```typescript
// Estados de dados
const [faturas, setFaturas] = useState<Fatura[]>([]);
const [resumo, setResumo] = useState<Resumo | null>(null);
const [loading, setLoading] = useState(false);
const [erro, setErro] = useState<string | null>(null);
const [sucesso, setSucesso] = useState<string | null>(null);

// Estados de filtro
const [mesReferencia, setMesReferencia] = useState('');
const [filtroStatus, setFiltroStatus] = useState('');
const [filtroUC, setFiltroUC] = useState('');
const [mesesDisponiveis, setMesesDisponiveis] = useState<string[]>([]);

// Estados de navegação
const [abaAtiva, setAbaAtiva] = useState<TipoAba>('lote');

// Estados de seleção
const [selecionados, setSelecionados] = useState<string[]>([]);

// Estados de modais
const [modalLancamentoLote, setModalLancamentoLote] = useState<ModalLancamentoLoteState>({...});
const [modalEnvioFatura, setModalEnvioFatura] = useState<ModalEnvioFaturaState>({...});
```

### 5.2 Funções de Filtragem

```typescript
// Determinar tipo efetivo do item (considera tipo_forcado)
const getTipoEfetivo = (fatura: Fatura): TipoAba => {
  if (fatura.tipo_forcado) {
    return fatura.tipo_forcado;
  }
  
  // Se não tem boleto energia E não é UG → vai para "enviar"
  if (!fatura.tem_boleto_energia && !fatura.is_ug) {
    return 'enviar';
  }
  
  // Se tem nome diferente → vai para "enviar"
  return fatura.nome_diferente ? 'enviar' : 'lote';
};

// Verificar se item pode ser selecionado
const isItemSelecionavel = (fatura: Fatura): boolean => {
  return (
    fatura.status === 'pendente' &&
    !!fatura.codigo_barras &&
    (fatura.tem_boleto_energia || fatura.is_ug) &&
    getTipoEfetivo(fatura) === 'lote'
  );
};

// Filtrar faturas por aba
const faturasFiltradas = faturas.filter(f => 
  getTipoEfetivo(f) === abaAtiva &&
  (!filtroUC || f.uc.includes(filtroUC))
);
```

---

## 6. Integração com API

### 6.1 Endpoints Utilizados

| Método | Endpoint | Descrição |
|--------|----------|-----------|
| GET | `/api/meses-disponiveis-boletos` | Lista meses disponíveis |
| GET | `/api/pagamentos-concessionaria?mes_referencia=XX/XXXX` | Lista faturas |
| GET | `/api/pagamentos-concessionaria/resumo/{mes}` | Resumo estatístico |
| POST | `/api/pagamentos-concessionaria/lancar/{fatura_id}` | Lançar pagamento BB |
| POST | `/api/pagamentos-concessionaria/{id}/cancelar-bb` | Cancelar no BB |
| POST | `/api/pagamentos-concessionaria/sincronizar-status` | Sincronizar status |
| POST | `/api/pagamentos-concessionaria/enviar-fatura-whatsapp` | Enviar WhatsApp |
| POST | `/api/pagamentos-concessionaria/enviar-fatura-email` | Enviar Email |

### 6.2 Service de API

```typescript
// services/pagamentoService.ts

const API_URL = process.env.REACT_APP_API_URL || 'http://localhost:3001';

export async function listarFaturas(mesReferencia: string, status?: string): Promise<Fatura[]> {
  let url = `${API_URL}/api/pagamentos-concessionaria?mes_referencia=${mesReferencia}`;
  if (status) url += `&status=${status}`;
  
  const response = await fetch(url);
  const data = await response.json();
  return data.pagamentos || [];
}

export async function lancarPagamento(faturaId: string, dataPagamento?: string): Promise<LancarResponse> {
  const response = await fetch(`${API_URL}/api/pagamentos-concessionaria/lancar/${faturaId}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ data_pagamento: dataPagamento }),
  });
  return response.json();
}

export async function enviarWhatsApp(dados: EnvioWhatsAppPayload): Promise<EnvioResponse> {
  const response = await fetch(`${API_URL}/api/pagamentos-concessionaria/enviar-fatura-whatsapp`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(dados),
  });
  return response.json();
}

export async function enviarEmail(dados: EnvioEmailPayload): Promise<EnvioResponse> {
  const response = await fetch(`${API_URL}/api/pagamentos-concessionaria/enviar-fatura-email`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(dados),
  });
  return response.json();
}

export async function sincronizarStatus(): Promise<SincronizarResponse> {
  const response = await fetch(`${API_URL}/api/pagamentos-concessionaria/sincronizar-status`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
  });
  return response.json();
}
```

---

## 7. Regras de Negócio (Frontend)

### 7.1 Regras de Seleção

| ID | Regra | Implementação |
|----|-------|---------------|
| RF01 | Só pode selecionar faturas pendentes | `status === 'pendente'` |
| RF02 | Só pode selecionar faturas com código de barras | `!!codigo_barras` |
| RF03 | Só pode selecionar faturas da aba "Lote" | `getTipoEfetivo(f) === 'lote'` |
| RF04 | "Selecionar todos" respeita RF01-RF03 | Filtrar antes de selecionar |

### 7.2 Regras de Lançamento

| ID | Regra | Implementação |
|----|-------|---------------|
| RF05 | Exigir código de barras para lançar | Validar antes de abrir modal |
| RF06 | Se vencimento passou, pedir nova data | Comparar com `new Date()` |
| RF07 | Processar em lote com delay de 500ms | `setTimeout` entre requisições |
| RF08 | Não fechar modal durante processamento | `backdrop="static"` |

### 7.3 Regras de Envio

| ID | Regra | Implementação |
|----|-------|---------------|
| RF09 | Exigir telefone se canal = WhatsApp/Ambos | Validar antes de enviar |
| RF10 | Exigir email se canal = Email/Ambos | Validar antes de enviar |
| RF11 | Permitir personalizar mensagem | Campo editável no modal |
| RF12 | Mostrar status de envio anterior | Badges "WhatsApp OK", "Email OK" |

### 7.4 Regras de Cancelamento

| ID | Regra | Implementação |
|----|-------|---------------|
| RF13 | Só pode cancelar status "Lançado" | Verificar `status === 'lancado'` |
| RF14 | Se BB retorna "já processado", marcar como pago | Tratar resposta da API |
| RF15 | Opção de forçar cancelamento local | Botão secundário no modal |

---

## 8. Modais

### 8.1 Modal de Lançamento Individual

```
┌─────────────────────────────────────────────────────┐
│ 💰 Confirmar Lançamento                         [X] │
├─────────────────────────────────────────────────────┤
│                                                     │
│ UC: 49166370                                        │
│ Cliente: Lucas Gabriel                              │
│ Valor: R$ 150,00                                    │
│ Vencimento: 06/02/2026                              │
│                                                     │
│ ⚠️ A data de vencimento já passou!                  │
│                                                     │
│ Nova data de pagamento:                             │
│ [2026-03-15        ]                                │
│                                                     │
├─────────────────────────────────────────────────────┤
│                      [Cancelar] [Confirmar Lançamento]│
└─────────────────────────────────────────────────────┘
```

### 8.2 Modal de Lançamento em Lote

**Estado: Confirmação**
```
┌─────────────────────────────────────────────────────┐
│ 💰 Lançamento em Lote - 5 Pagamentos            [X] │
├─────────────────────────────────────────────────────┤
│ ⚠️ Atenção: Todos os pagamentos serão enviados     │
│ para a API do BB e debitados da conta.             │
├─────────────────────────────────────────────────────┤
│ UC       │ Cliente        │ Valor                   │
│ 49166370 │ Lucas Gabriel  │ R$ 150,00               │
│ 47268180 │ Maria Silva    │ R$ 200,00               │
│ 10777539 │ João Santos    │ R$ 75,00                │
├─────────────────────────────────────────────────────┤
│ Total: R$ 425,00                                    │
├─────────────────────────────────────────────────────┤
│                      [Cancelar] [Confirmar Lançamento]│
└─────────────────────────────────────────────────────┘
```

**Estado: Processando**
```
┌─────────────────────────────────────────────────────┐
│ 💰 Lançamento em Lote - 5 Pagamentos                │
├─────────────────────────────────────────────────────┤
│ ⏳ Processando... 3 / 5                             │
│ [████████████░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░] 60%    │
├─────────────────────────────────────────────────────┤
│ ✅ 49166370 - Requisição 1234567                    │
│ ✅ 47268180 - Requisição 1234568                    │
│ ❌ 10777539 - Código de barras inválido             │
└─────────────────────────────────────────────────────┘
```

**Estado: Concluído**
```
┌─────────────────────────────────────────────────────┐
│ 💰 Lançamento em Lote - Concluído                   │
├─────────────────────────────────────────────────────┤
│        ┌───────┐    ┌───────┐                       │
│        │   4   │    │   1   │                       │
│        │Sucesso│    │ Erros │                       │
│        └───────┘    └───────┘                       │
├─────────────────────────────────────────────────────┤
│ ✅ 49166370 - Lucas Gabriel - Req 1234567           │
│ ✅ 47268180 - Maria Silva - Req 1234568             │
│ ✅ 12345678 - João Santos - Req 1234569             │
│ ✅ 87654321 - Ana Costa - Req 1234570               │
│ ❌ 10777539 - Pedro Lima - Código inválido          │
├─────────────────────────────────────────────────────┤
│                                          [Fechar]   │
└─────────────────────────────────────────────────────┘
```

### 8.3 Modal de Envio de Fatura

```
┌─────────────────────────────────────────────────────┐
│ 📤 Enviar Fatura ao Cliente                     [X] │
├─────────────────────────────────────────────────────┤
│ UC: 49166370 - Lucas Gabriel                        │
│ Valor: R$ 150,00 | Vencimento: 06/02/2026           │
├─────────────────────────────────────────────────────┤
│ Canal de envio:                                     │
│ (●) WhatsApp  ( ) Email  ( ) Ambos                  │
├─────────────────────────────────────────────────────┤
│ Telefone WhatsApp:                                  │
│ [11999998888      ]                                 │
├─────────────────────────────────────────────────────┤
│ Mensagem:                                           │
│ ┌─────────────────────────────────────────────────┐ │
│ │ Olá Lucas! Segue sua fatura de energia EQTL    │ │
│ │ referente a 01/2026.                           │ │
│ │                                                │ │
│ │ UC: 49166370                                   │ │
│ │ Valor: R$ 150,00                               │ │
│ │ Vencimento: 06/02/2026                         │ │
│ │                                                │ │
│ │ [LINK]                                         │ │
│ │                                                │ │
│ │ Atenciosamente, AUPUS Energia                  │ │
│ └─────────────────────────────────────────────────┘ │
├─────────────────────────────────────────────────────┤
│                           [Cancelar] [Enviar Fatura]│
└─────────────────────────────────────────────────────┘
```

---

## 9. Exemplos de Código

### 9.1 Componente StatusBadge

```tsx
// components/StatusBadge.tsx

import { Badge } from 'react-bootstrap';
import { StatusPagamento } from '../types/pagamento';

interface Props {
  status: StatusPagamento;
  dataVencimento?: string | null;
}

export function StatusBadge({ status, dataVencimento }: Props) {
  const config: Record<StatusPagamento, { bg: string; label: string }> = {
    pendente: { bg: 'secondary', label: 'Pendente' },
    lancado: { bg: 'primary', label: 'Lançado' },
    aguardando_aprovacao: { bg: 'warning', label: 'Aguard. Aprovação' },
    processando_pagamento: { bg: 'info', label: 'Processando' },
    pago: { bg: 'success', label: 'Pago' },
    vencido: { bg: 'danger', label: 'Vencido' },
    erro: { bg: 'danger', label: 'Erro' },
    rejeitado: { bg: 'danger', label: 'Rejeitado' },
    cancelado: { bg: 'dark', label: 'Cancelado' },
  };

  // Para pendente, verificar proximidade do vencimento
  let bgColor = config[status]?.bg || 'secondary';
  
  if (status === 'pendente' && dataVencimento) {
    const dataVenc = parseDataBrasileira(dataVencimento);
    if (dataVenc) {
      const hoje = new Date();
      hoje.setHours(0, 0, 0, 0);
      const diffDias = Math.ceil((dataVenc.getTime() - hoje.getTime()) / (1000 * 60 * 60 * 24));
      
      if (diffDias <= 1) bgColor = 'danger';
      else if (diffDias <= 5) bgColor = 'warning';
    }
  }

  return (
    <Badge bg={bgColor}>
      {config[status]?.label || status}
    </Badge>
  );
}
```

### 9.2 Hook de Lançamento em Lote

```tsx
// hooks/useLancamentoLote.ts

import { useState, useCallback } from 'react';
import { Fatura, ModalLancamentoLoteState, ResultadoLancamento } from '../types/pagamento';
import { lancarPagamento } from '../services/pagamentoService';

const DELAY_ENTRE_REQUISICOES = 500;

const estadoInicial: ModalLancamentoLoteState = {
  show: false,
  processando: false,
  total: 0,
  atual: 0,
  sucessos: 0,
  erros: 0,
  resultados: [],
  concluido: false,
  itens: [],
};

export function useLancamentoLote(onConcluido?: () => void) {
  const [modal, setModal] = useState<ModalLancamentoLoteState>(estadoInicial);

  const abrirModal = useCallback((itens: Fatura[]) => {
    const itensValidos = itens.filter(i => i.status === 'pendente' && i.codigo_barras);
    
    setModal({
      ...estadoInicial,
      show: true,
      total: itensValidos.length,
      itens: itensValidos,
    });
  }, []);

  const fecharModal = useCallback(() => {
    if (modal.processando) return;
    setModal(estadoInicial);
    if (modal.concluido && onConcluido) onConcluido();
  }, [modal.processando, modal.concluido, onConcluido]);

  const executar = useCallback(async () => {
    const { itens } = modal;
    setModal(prev => ({ ...prev, processando: true }));

    const resultados: ResultadoLancamento[] = [];
    let sucessos = 0;
    let erros = 0;

    for (let i = 0; i < itens.length; i++) {
      const item = itens[i];

      setModal(prev => ({ ...prev, atual: i + 1 }));

      try {
        const response = await lancarPagamento(item.fatura_id);

        if (response.success) {
          resultados.push({
            uc: item.uc,
            nome: item.nome_cliente,
            sucesso: true,
            mensagem: `Requisição ${response.pagamento?.numero_requisicao}`,
          });
          sucessos++;
        } else {
          resultados.push({
            uc: item.uc,
            nome: item.nome_cliente,
            sucesso: false,
            mensagem: response.error || 'Erro desconhecido',
          });
          erros++;
        }
      } catch (error: any) {
        resultados.push({
          uc: item.uc,
          nome: item.nome_cliente,
          sucesso: false,
          mensagem: error.message,
        });
        erros++;
      }

      setModal(prev => ({ ...prev, resultados: [...resultados], sucessos, erros }));

      if (i < itens.length - 1) {
        await new Promise(resolve => setTimeout(resolve, DELAY_ENTRE_REQUISICOES));
      }
    }

    setModal(prev => ({
      ...prev,
      processando: false,
      concluido: true,
    }));
  }, [modal.itens]);

  return { modal, abrirModal, fecharModal, executar };
}
```

### 9.3 Geração de Mensagem Padrão

```typescript
// utils/mensagens.ts

import { Fatura } from '../types/pagamento';
import { formatarValor } from './formatters';

export function gerarMensagemWhatsApp(fatura: Fatura): string {
  const primeiroNome = (fatura.nome_cliente || 'Cliente').split(' ')[0];
  
  return `Olá ${primeiroNome}! Segue sua fatura de energia EQTL referente a ${fatura.mes_referencia}.

Unidade Consumidora: ${fatura.uc}
Valor: ${formatarValor(fatura.valor_fatura)}
Vencimento: ${fatura.data_vencimento_fatura || '-'}

[LINK]

Atenciosamente,
AUPUS Energia`;
}

export function gerarMensagemEmail(fatura: Fatura): string {
  return `Prezado(a) ${fatura.nome_cliente || 'Cliente'},

Segue em anexo sua fatura de energia EQTL referente ao mês de ${fatura.mes_referencia}.

Unidade Consumidora: ${fatura.uc}
Valor: ${formatarValor(fatura.valor_fatura)}
Vencimento: ${fatura.data_vencimento_fatura || '-'}

Atenciosamente,
AUPUS Energia`;
}

export function gerarAssuntoEmail(fatura: Fatura): string {
  return `Fatura EQTL - UC ${fatura.uc} - ${fatura.mes_referencia}`;
}
```

---

## 10. Checklist de Implementação

### Componentes
- [ ] Criar componente principal `PagamentoFaturas`
- [ ] Criar `FiltrosHeader` com filtros e ações
- [ ] Criar `CardsResumo` com estatísticas
- [ ] Criar `AbasNavegacao` (Lote/Enviar)
- [ ] Criar `TabelaFaturas` com colunas dinâmicas por aba
- [ ] Criar `StatusBadge` com cores por status
- [ ] Criar `FooterSelecao` com ações em lote

### Modais
- [ ] Criar `ModalLancarIndividual`
- [ ] Criar `ModalLancamentoLote` com progresso
- [ ] Criar `ModalEnvioFatura` com WhatsApp/Email
- [ ] Criar `ModalCancelar`

### Hooks
- [ ] Criar `useFaturas` para fetch e estado
- [ ] Criar `useSelecao` para checkboxes
- [ ] Criar `useLancamentoLote` para processamento
- [ ] Criar `useEnvioFatura` para WhatsApp/Email

### Integração
- [ ] Criar `pagamentoService.ts` com chamadas à API
- [ ] Implementar tratamento de erros
- [ ] Implementar loading states
- [ ] Implementar toasts de sucesso/erro

### Validações
- [ ] Validar seleção apenas de itens elegíveis
- [ ] Validar data de pagamento não passada
- [ ] Validar telefone/email antes de enviar
- [ ] Tratar respostas de erro da API
