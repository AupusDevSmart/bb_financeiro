# Integração Aupus Control - Documentação Frontend

> **Guia para implementação do Frontend** - Lançamento de faturas no sistema Aupus Control.

---

## 📋 Índice

1. [Visão Geral](#1-visão-geral)
2. [Fluxo de Lançamento](#2-fluxo-de-lançamento)
3. [Interface do Usuário](#3-interface-do-usuário)
4. [Integração com API](#4-integração-com-api)
5. [Estados e Status](#5-estados-e-status)
6. [Componentes](#6-componentes)
7. [Regras de Negócio](#7-regras-de-negócio)
8. [Exemplos de Código](#8-exemplos-de-código)

---

## 1. Visão Geral

### 1.1 O que é o Aupus Control?

O **Aupus Control** é o sistema financeiro interno da AUPUS que gerencia:
- Lançamentos de contas a pagar/receber
- Fluxo de caixa
- Conciliação bancária
- Aprovações de pagamentos

### 1.2 Relação BB vs Control

| Sistema | Função | Quando Usar |
|---------|--------|-------------|
| **Banco do Brasil** | Efetua o débito real na conta | Pagamento via API BB |
| **Aupus Control** | Registra o lançamento financeiro | Controle interno |

⚠️ **IMPORTANTE:** Os lançamentos são **INDEPENDENTES**:
- Lançar no BB **NÃO** lança automaticamente no Control
- Lançar no Control **NÃO** efetua pagamento no BB
- O usuário deve fazer **ambos** separadamente

### 1.3 Fluxo Completo

```
┌─────────────────────────────────────────────────────────────────────┐
│                    FLUXO DE PAGAMENTO COMPLETO                      │
├─────────────────────────────────────────────────────────────────────┤
│                                                                     │
│  1. LANÇAR NO BB (Pagamento Real)                                   │
│     └─▶ POST /api/pagamentos-concessionaria/lancar/{id}             │
│         └─▶ Status: pendente → lancado → pago                       │
│                                                                     │
│  2. LANÇAR NO CONTROL (Registro Financeiro)                         │
│     └─▶ POST /api/pagamentos-concessionaria/lancar-control/{id}     │
│         └─▶ Status Control: null → lancado                          │
│                                                                     │
└─────────────────────────────────────────────────────────────────────┘
```

---

## 2. Fluxo de Lançamento

### 2.1 Fluxo Individual

```
┌─────────────┐     ┌──────────────┐     ┌─────────────┐     ┌──────────────┐
│ Clicar no   │────▶│ Confirmar    │────▶│ Enviar para │────▶│ Atualizar    │
│ botão ⬆️    │     │ Lançamento   │     │ API Control │     │ status_control│
└─────────────┘     └──────────────┘     └─────────────┘     └──────────────┘
```

### 2.2 Fluxo em Lote

```
┌─────────────┐     ┌──────────────┐     ┌─────────────┐     ┌──────────────┐
│ Selecionar  │────▶│ Clicar       │────▶│ Modal com   │────▶│ Processar    │
│ Checkboxes  │     │ "Lançar Ctrl"│     │ Confirmação │     │ Um a Um      │
└─────────────┘     └──────────────┘     └─────────────┘     └──────────────┘
                                                                    │
                                         ┌──────────────┐           │
                                         │ Exibir       │◀──────────┘
                                         │ Resultado    │
                                         └──────────────┘
```

### 2.3 Quando Lançar no Control?

| Cenário | Lançar BB? | Lançar Control? |
|---------|------------|-----------------|
| Fatura com compensação real | ✅ Sim | ✅ Sim (APROVADO) |
| Fatura sem compensação | ✅ Sim | ✅ Sim (PENDENTE) |
| Fatura já paga (boleto) | ❌ Não | ✅ Sim (PAGO) |
| Fatura para enviar ao cliente | ❌ Não | ❌ Não |

---

## 3. Interface do Usuário

### 3.1 Botões na Tabela

Na aba **"Pagamento em Lote"**, cada linha possui dois botões de lançamento:

```
┌─────────────────────────────────────────────────────────────────────┐
│ UC       │ Cliente      │ Valor    │ Status BB │ Control │ Ações   │
├──────────┼──────────────┼──────────┼───────────┼─────────┼─────────┤
│ 49166370 │ Lucas Gabriel│ R$ 150,00│ Lançado   │ --      │ 💰 ⬆️ 🗑️│
└──────────┴──────────────┴──────────┴───────────┴─────────┴─────────┘
                                                              │  │
                                                              │  └─ Lançar Control
                                                              └──── Lançar BB
```

**Ícones:**
- 💰 (Banknote) - Lançar no Banco do Brasil
- ⬆️ (Upload) - Lançar no Aupus Control
- 🗑️ (Trash) - Cancelar

### 3.2 Coluna "Control"

| Status | Badge | Descrição |
|--------|-------|-----------|
| `null` | `--` | Não lançado |
| `lancado` | `Control OK` (verde) | Lançado com sucesso |
| `erro` | `Erro` (vermelho) | Falha no lançamento |

### 3.3 Footer com Ações em Lote

```
┌─────────────────────────────────────────────────────────────────────┐
│ 3 pagamento(s) selecionado(s)                                       │
│                                                                     │
│ [Limpar seleção] [Lançar BB (3)] [Lançar Control (3)]               │
└─────────────────────────────────────────────────────────────────────┘
```

---

## 4. Integração com API

### 4.1 Endpoints

| Método | Endpoint | Descrição |
|--------|----------|-----------|
| POST | `/api/pagamentos-concessionaria/lancar-control/{faturaId}` | Lançar individual |
| POST | `/api/boletos-energia/lancar-control/{boletoId}` | Lançar boleto (entrada) |

### 4.2 Request - Lançar Individual

```http
POST /api/pagamentos-concessionaria/lancar-control/01JNMEWG39CRAZN20SFK684A13
Content-Type: application/json

{
    "nome_cliente": "Lucas Gabriel"
}
```

### 4.3 Response - Sucesso

```json
{
    "success": true,
    "message": "Lançamento enviado para Aupus Control com sucesso",
    "control_lancamento_id": "01JNMEWG39CRAZN20SFK684A13",
    "pagamento": {
        "id": 123,
        "uc": "49166370",
        "valor": 150.50,
        "status_control": "lancado",
        "control_lancamento_id": "01JNMEWG39CRAZN20SFK684A13"
    }
}
```

### 4.4 Response - Já Lançado

```json
{
    "error": "Já lançado no Aupus Control",
    "message": "ID: 01JNMEWG39CRAZN20SFK684A13",
    "control_lancamento_id": "01JNMEWG39CRAZN20SFK684A13"
}
```

### 4.5 Response - Erro

```json
{
    "error": "Erro ao enviar para Aupus Control",
    "message": "Lançamento duplicado",
    "detalhes": { ... }
}
```

---

## 5. Estados e Status

### 5.1 Status do Control

```typescript
type StatusControl = 'lancado' | 'erro' | null;
```

### 5.2 Status Enviado ao Control

O backend determina automaticamente o status baseado em regras:

| Condição | Status Control |
|----------|----------------|
| Boleto de energia já pago | `PAGO` |
| Pagamento BB já pago | `PAGO` |
| Fatura com compensação real | `APROVADO` |
| Demais casos | `PENDENTE` |

### 5.3 Fluxo de Status no Control

```
┌──────────┐     ┌──────────┐     ┌──────────┐
│ PENDENTE │────▶│ APROVADO │────▶│   PAGO   │
└──────────┘     └──────────┘     └──────────┘
     │                │                 │
     │                │                 │
     ▼                ▼                 ▼
┌──────────┐     ┌──────────┐     ┌──────────┐
│CANCELADO │     │CANCELADO │     │ ESTORNADO│
└──────────┘     └──────────┘     └──────────┘
```

---

## 6. Componentes

### 6.1 Estrutura de Componentes

```
PagamentoFaturas/
├── components/
│   ├── BotaoLancarControl.tsx      # Botão individual
│   ├── ControlStatusBadge.tsx      # Badge de status
│   └── FooterAcoesLote.tsx         # Footer com lançamento em lote
├── modals/
│   ├── ModalLancarControl.tsx      # Confirmação individual
│   └── ModalLancamentoLoteControl.tsx  # Lançamento em lote
├── hooks/
│   └── useLancamentoControl.ts     # Lógica de lançamento
└── services/
    └── controlService.ts           # Chamadas à API
```

### 6.2 Interfaces TypeScript

```typescript
// types/control.ts

export interface LancarControlResponse {
  success: boolean;
  message: string;
  control_lancamento_id?: string;
  pagamento?: {
    id: number;
    uc: string;
    valor: number;
    status_control: StatusControl;
    control_lancamento_id: string;
  };
  error?: string;
  detalhes?: any;
}

export interface ModalLancamentoControlState {
  show: boolean;
  processando: boolean;
  total: number;
  atual: number;
  sucessos: number;
  erros: number;
  resultados: ResultadoLancamentoControl[];
  concluido: boolean;
  itens: Fatura[];
}

export interface ResultadoLancamentoControl {
  uc: string;
  nome: string | null;
  sucesso: boolean;
  mensagem: string;
  controlId?: string;
}
```

---

## 7. Regras de Negócio

### 7.1 Regras de Habilitação do Botão

| Regra | Condição | Botão |
|-------|----------|-------|
| Já lançado | `status_control === 'lancado'` | Desabilitado |
| Sem código de barras | `!codigo_barras` | Desabilitado |
| Elegível | Demais casos | Habilitado |

### 7.2 Regras de Seleção em Lote

```typescript
// Verificar se item pode ser lançado no Control
const podeSerLancadoControl = (fatura: Fatura): boolean => {
  return (
    fatura.status_control !== 'lancado' &&
    !!fatura.codigo_barras
  );
};

// Contar itens elegíveis
const itensElegiveisControl = selecionados.filter(id => {
  const fatura = faturas.find(f => f.fatura_id === id);
  return fatura && podeSerLancadoControl(fatura);
});
```

### 7.3 Regras de Processamento em Lote

1. Processar um item por vez
2. Delay de 500ms entre requisições
3. Não interromper em caso de erro individual
4. Exibir resultado final com sucessos e erros

---

## 8. Exemplos de Código

### 8.1 Componente BotaoLancarControl

```tsx
// components/BotaoLancarControl.tsx

import { Button, OverlayTrigger, Tooltip } from 'react-bootstrap';
import { Upload } from 'lucide-react';

interface Props {
  fatura: Fatura;
  onLancar: (fatura: Fatura) => void;
}

export function BotaoLancarControl({ fatura, onLancar }: Props) {
  const jaLancado = fatura.status_control === 'lancado';
  const semCodigo = !fatura.codigo_barras;
  const desabilitado = jaLancado || semCodigo;

  const tooltipText = jaLancado
    ? `Já lançado no Control (${fatura.control_lancamento_id || ''})`
    : semCodigo
    ? 'Falta código de barras'
    : 'Lançar no Aupus Control';

  return (
    <OverlayTrigger
      placement="top"
      overlay={<Tooltip>{tooltipText}</Tooltip>}
    >
      <span>
        <Button
          size="sm"
          variant={desabilitado ? 'outline-secondary' : 'outline-primary'}
          onClick={() => onLancar(fatura)}
          disabled={desabilitado}
          style={desabilitado ? { pointerEvents: 'none', opacity: 0.35 } : {}}
        >
          <Upload size={16} />
        </Button>
      </span>
    </OverlayTrigger>
  );
}
```

### 8.2 Componente ControlStatusBadge

```tsx
// components/ControlStatusBadge.tsx

import { Badge } from 'react-bootstrap';

interface Props {
  statusControl: 'lancado' | 'erro' | null;
  controlId?: string | null;
}

export function ControlStatusBadge({ statusControl, controlId }: Props) {
  if (!statusControl) {
    return <span className="text-muted small">--</span>;
  }

  const configs = {
    lancado: { bg: 'success', text: 'Control OK' },
    erro: { bg: 'danger', text: 'Erro' },
  };

  const config = configs[statusControl] || { bg: 'secondary', text: statusControl };

  return (
    <Badge bg={config.bg} title={controlId ? `ID: ${controlId}` : ''}>
      {config.text}
    </Badge>
  );
}
```

### 8.3 Hook useLancamentoControl

```tsx
// hooks/useLancamentoControl.ts

import { useState, useCallback } from 'react';
import { Fatura, ModalLancamentoControlState, ResultadoLancamentoControl } from '../types';
import { lancarControl } from '../services/controlService';

const DELAY_ENTRE_REQUISICOES = 500;

const estadoInicial: ModalLancamentoControlState = {
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

export function useLancamentoControl(onConcluido?: () => void) {
  const [modal, setModal] = useState<ModalLancamentoControlState>(estadoInicial);

  const abrirModal = useCallback((itens: Fatura[]) => {
    const itensValidos = itens.filter(i => 
      i.status_control !== 'lancado' && i.codigo_barras
    );

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

    const resultados: ResultadoLancamentoControl[] = [];
    let sucessos = 0;
    let erros = 0;

    for (let i = 0; i < itens.length; i++) {
      const item = itens[i];

      setModal(prev => ({ ...prev, atual: i + 1 }));

      try {
        const response = await lancarControl(item.fatura_id, item.nome_cliente);

        if (response.success) {
          resultados.push({
            uc: item.uc,
            nome: item.nome_cliente,
            sucesso: true,
            mensagem: `ID ${response.control_lancamento_id}`,
            controlId: response.control_lancamento_id,
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

### 8.4 Service controlService

```typescript
// services/controlService.ts

const API_URL = process.env.REACT_APP_API_URL || 'http://localhost:3001';

export interface LancarControlResponse {
  success: boolean;
  message: string;
  control_lancamento_id?: string;
  error?: string;
}

export async function lancarControl(
  faturaId: string,
  nomeCliente?: string | null
): Promise<LancarControlResponse> {
  const response = await fetch(
    `${API_URL}/api/pagamentos-concessionaria/lancar-control/${faturaId}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ nome_cliente: nomeCliente }),
    }
  );

  return response.json();
}

export async function lancarBoletoControl(
  boletoId: string
): Promise<LancarControlResponse> {
  const response = await fetch(
    `${API_URL}/api/boletos-energia/lancar-control/${boletoId}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
    }
  );

  return response.json();
}
```

### 8.5 Modal de Lançamento em Lote

```tsx
// modals/ModalLancamentoLoteControl.tsx

import { Modal, Button, Table, Alert, ProgressBar, Badge } from 'react-bootstrap';
import { Upload, CheckCircle, XCircle } from 'lucide-react';
import { ModalLancamentoControlState } from '../types';
import { formatarValor } from '../utils/formatters';

interface Props {
  modal: ModalLancamentoControlState;
  onFechar: () => void;
  onExecutar: () => void;
}

export function ModalLancamentoLoteControl({ modal, onFechar, onExecutar }: Props) {
  const { show, processando, concluido, total, atual, sucessos, erros, resultados, itens } = modal;

  const progresso = total > 0 ? (atual / total) * 100 : 0;

  return (
    <Modal
      show={show}
      onHide={onFechar}
      centered
      backdrop={processando ? 'static' : true}
      size="lg"
    >
      <Modal.Header closeButton={!processando} className="bg-primary text-white">
        <Modal.Title>
          <Upload size={20} className="me-2" />
          Lançamento Control - {total} Pagamentos
        </Modal.Title>
      </Modal.Header>

      <Modal.Body>
        {/* Estado inicial: confirmação */}
        {!processando && !concluido && (
          <>
            <Alert variant="info" className="mb-3">
              <strong>Atenção:</strong> Os lançamentos serão enviados para o Aupus Control
              para registro financeiro.
            </Alert>

            <div style={{ maxHeight: '300px', overflowY: 'auto' }}>
              <Table size="sm" hover>
                <thead>
                  <tr>
                    <th>UC</th>
                    <th>Cliente</th>
                    <th className="text-end">Valor</th>
                  </tr>
                </thead>
                <tbody>
                  {itens.map((item, idx) => (
                    <tr key={idx}>
                      <td><code>{item.uc}</code></td>
                      <td className="text-truncate" style={{ maxWidth: '200px' }}>
                        {item.nome_cliente || '-'}
                      </td>
                      <td className="text-end">{formatarValor(item.valor_fatura)}</td>
                    </tr>
                  ))}
                </tbody>
              </Table>
            </div>

            <div className="mt-3 text-end">
              <strong>Total: {formatarValor(itens.reduce((s, i) => s + i.valor_fatura, 0))}</strong>
            </div>
          </>
        )}

        {/* Estado: processando */}
        {processando && (
          <>
            <div className="text-center mb-3">
              <h5>Processando... {atual} / {total}</h5>
              <ProgressBar now={progresso} label={`${Math.round(progresso)}%`} animated />
            </div>

            <div style={{ maxHeight: '200px', overflowY: 'auto' }}>
              {resultados.map((r, idx) => (
                <div key={idx} className="d-flex align-items-center mb-1">
                  {r.sucesso ? (
                    <CheckCircle size={16} className="text-success me-2" />
                  ) : (
                    <XCircle size={16} className="text-danger me-2" />
                  )}
                  <code className="me-2">{r.uc}</code>
                  <span className="text-muted">{r.mensagem}</span>
                </div>
              ))}
            </div>
          </>
        )}

        {/* Estado: concluído */}
        {concluido && (
          <>
            <div className="text-center mb-4">
              <div className="d-flex justify-content-center gap-4">
                <div>
                  <Badge bg="success" className="fs-4 p-3">{sucessos}</Badge>
                  <div className="mt-1">Sucesso</div>
                </div>
                <div>
                  <Badge bg="danger" className="fs-4 p-3">{erros}</Badge>
                  <div className="mt-1">Erros</div>
                </div>
              </div>
            </div>

            <div style={{ maxHeight: '250px', overflowY: 'auto' }}>
              {resultados.map((r, idx) => (
                <div key={idx} className="d-flex align-items-center mb-1">
                  {r.sucesso ? (
                    <CheckCircle size={16} className="text-success me-2" />
                  ) : (
                    <XCircle size={16} className="text-danger me-2" />
                  )}
                  <code className="me-2">{r.uc}</code>
                  <span className={r.sucesso ? '' : 'text-danger'}>{r.mensagem}</span>
                </div>
              ))}
            </div>
          </>
        )}
      </Modal.Body>

      <Modal.Footer>
        {!processando && !concluido && (
          <>
            <Button variant="secondary" onClick={onFechar}>
              Cancelar
            </Button>
            <Button variant="primary" onClick={onExecutar}>
              <Upload size={16} className="me-1" />
              Confirmar Lançamento
            </Button>
          </>
        )}

        {concluido && (
          <Button variant="primary" onClick={onFechar}>
            Fechar
          </Button>
        )}
      </Modal.Footer>
    </Modal>
  );
}
```

---

## 9. Checklist de Implementação

### Componentes
- [ ] Criar `BotaoLancarControl` com tooltip e estados
- [ ] Criar `ControlStatusBadge` para coluna Control
- [ ] Adicionar botão "Lançar Control" no footer

### Modais
- [ ] Criar `ModalLancarControl` para confirmação individual
- [ ] Criar `ModalLancamentoLoteControl` com progresso

### Hooks
- [ ] Criar `useLancamentoControl` para lógica de lote

### Services
- [ ] Criar `controlService.ts` com chamadas à API

### Integração
- [ ] Adicionar coluna "Control" na tabela
- [ ] Implementar lançamento individual
- [ ] Implementar lançamento em lote
- [ ] Atualizar dados após lançamento

### Validações
- [ ] Verificar se já foi lançado antes de habilitar botão
- [ ] Verificar código de barras antes de lançar
- [ ] Tratar erros de API
