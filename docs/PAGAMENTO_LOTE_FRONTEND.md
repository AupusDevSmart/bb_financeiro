# Pagamento em Lote - Documentação Frontend (React)

Documentação técnica completa para implementação do módulo de **Pagamento de Boletos em Lote** via API do Banco do Brasil. Este documento é direcionado para o desenvolvimento do **frontend em React**.

---

## 1. Contexto do Negócio

### 1.1 Objetivo

O sistema permite que o usuário selecione múltiplas faturas de concessionárias de energia e realize o pagamento em lote através da API do Banco do Brasil. A interface deve ser intuitiva, mostrar progresso em tempo real e fornecer feedback claro sobre sucessos e erros.

### 1.2 Entidades Envolvidas

| Entidade | Descrição |
|----------|-----------|
| **Unidade Consumidora (UC)** | Identificador único do ponto de consumo |
| **Fatura** | Documento de cobrança da concessionária |
| **Pagamento** | Registro do pagamento de uma fatura |
| **Cliente** | Pessoa responsável pela UC |

### 1.3 Fluxo de Usuário

```
┌─────────────┐    ┌──────────────┐    ┌─────────────┐    ┌──────────────┐
│  Selecionar │───▶│   Confirmar  │───▶│  Processar  │───▶│   Resultado  │
│   Faturas   │    │    Lote      │    │   Um a Um   │    │    Final     │
└─────────────┘    └──────────────┘    └─────────────┘    └──────────────┘
```

---

## 2. Regras de Negócio (Frontend)

### 2.1 Regras de Seleção

| ID | Regra | Implementação |
|----|-------|---------------|
| RF01 | Usuário só pode selecionar faturas com `fatura_id` válido | Desabilitar checkbox se `fatura_id` é null |
| RF02 | Faturas com status `pago` ou `lancado` não podem ser selecionadas | Desabilitar checkbox + indicador visual |
| RF03 | Seleção "Todos" deve respeitar RF01 e RF02 | Filtrar apenas itens válidos |
| RF04 | Exibir contador de itens selecionados | Badge no botão de lançamento |
| RF05 | Botão de lançamento só habilitado se há itens selecionados | `disabled={selecionados.length === 0}` |

### 2.2 Regras de Validação Pré-Lançamento

| ID | Regra | Implementação |
|----|-------|---------------|
| RF06 | Exibir lista de itens antes de confirmar | Modal de confirmação |
| RF07 | Mostrar valor total do lote | Soma dos valores na tabela |
| RF08 | Alertar sobre itens sem código de barras | Warning na lista |
| RF09 | Permitir cancelar antes de iniciar | Botão "Cancelar" no modal |

### 2.3 Regras de Processamento

| ID | Regra | Implementação |
|----|-------|---------------|
| RF10 | Processar um item por vez, sequencialmente | Loop com await |
| RF11 | Delay de 500ms entre requisições | `setTimeout` ou `sleep` |
| RF12 | Não permitir fechar modal durante processamento | `backdrop="static"` |
| RF13 | Exibir progresso em tempo real | Barra de progresso + contador |
| RF14 | Mostrar resultado de cada item imediatamente | Lista de resultados |

### 2.4 Regras de Resultado

| ID | Regra | Implementação |
|----|-------|---------------|
| RF15 | Exibir resumo com total de sucessos e erros | Cards de estatísticas |
| RF16 | Listar detalhes de cada item processado | Tabela com ícones |
| RF17 | Recarregar dados da tela após fechar modal | Callback `onClose` |
| RF18 | Limpar seleção após conclusão | Reset do state |

### 2.5 Regras de Tratamento de Erro

| ID | Regra | Implementação |
|----|-------|---------------|
| RF19 | Se data passada, exibir mensagem específica | Tratamento do erro `dataPassada` |
| RF20 | Continuar processamento mesmo com erros | Não interromper o loop |
| RF21 | Permitir retry de itens com erro | Botão de reprocessar (opcional) |

---

## 3. Componentes

### 3.1 Estrutura de Componentes

```
PagamentosConcessionaria/
├── index.tsx                    # Componente principal
├── components/
│   ├── TabelaPagamentos.tsx     # Tabela com checkboxes
│   ├── FiltrosMesReferencia.tsx # Filtros de período
│   ├── BotaoLancarLote.tsx      # Botão de ação
│   ├── ModalLancamentoLote.tsx  # Modal de processamento
│   ├── ProgressoLancamento.tsx  # Barra de progresso
│   ├── ResultadoLancamento.tsx  # Resumo final
│   └── ItemResultado.tsx        # Linha de resultado
├── hooks/
│   ├── usePagamentos.ts         # Fetch e estado dos pagamentos
│   ├── useSelecao.ts            # Lógica de seleção
│   └── useLancamentoLote.ts     # Lógica de processamento
├── services/
│   └── pagamentoService.ts      # Chamadas à API
└── types/
    └── pagamento.ts             # Interfaces TypeScript
```

### 3.2 Interfaces TypeScript

```typescript
// types/pagamento.ts

export interface Pagamento {
  id: number;
  fatura_id: number | null;
  uc: string;
  mes_referencia: string;
  valor_fatura: number;
  data_vencimento: string | null;
  data_pagamento: string | null;
  codigo_barras: string | null;
  pix_copia_cola: string | null;
  status: StatusPagamento;
  tipo_pagamento: 'BOLETO' | 'PIX';
  numero_requisicao: number | null;
  id_pagamento_bb: string | null;
  estado_requisicao: string | null;
  mensagem_erro: string | null;
  cliente?: {
    id: number;
    nome: string;
  };
}

export type StatusPagamento = 
  | 'pendente' 
  | 'lancado' 
  | 'pago' 
  | 'erro' 
  | 'rejeitado' 
  | 'cancelado';

export interface ResultadoLancamento {
  uc: string;
  nome: string | null;
  sucesso: boolean;
  mensagem: string;
  numero_requisicao?: number;
}

export interface ModalLancamentoState {
  show: boolean;
  processando: boolean;
  total: number;
  atual: number;
  sucessos: number;
  erros: number;
  resultados: ResultadoLancamento[];
  concluido: boolean;
  itens: Pagamento[];
}
```

---

## 4. Estados e Hooks

### 4.1 Hook de Seleção

```typescript
// hooks/useSelecao.ts

import { useState, useCallback, useMemo } from 'react';
import { Pagamento } from '../types/pagamento';

export function useSelecao(pagamentos: Pagamento[]) {
  const [selecionados, setSelecionados] = useState<string[]>([]);

  // RF01, RF02: Filtrar apenas itens válidos para seleção
  const itensValidos = useMemo(() => {
    return pagamentos.filter(p => 
      p.fatura_id !== null && 
      p.status !== 'pago' && 
      p.status !== 'lancado'
    );
  }, [pagamentos]);

  // Verificar se item pode ser selecionado
  const podeSelecionar = useCallback((pagamento: Pagamento): boolean => {
    return (
      pagamento.fatura_id !== null &&
      pagamento.status !== 'pago' &&
      pagamento.status !== 'lancado'
    );
  }, []);

  // Toggle individual
  const toggleSelecao = useCallback((uc: string) => {
    setSelecionados(prev => 
      prev.includes(uc) 
        ? prev.filter(u => u !== uc)
        : [...prev, uc]
    );
  }, []);

  // RF03: Selecionar/desselecionar todos (apenas válidos)
  const toggleTodos = useCallback(() => {
    if (selecionados.length === itensValidos.length) {
      setSelecionados([]);
    } else {
      setSelecionados(itensValidos.map(p => p.uc));
    }
  }, [selecionados.length, itensValidos]);

  // Limpar seleção
  const limparSelecao = useCallback(() => {
    setSelecionados([]);
  }, []);

  // Obter itens selecionados
  const itensSelecionados = useMemo(() => {
    return pagamentos.filter(p => selecionados.includes(p.uc));
  }, [pagamentos, selecionados]);

  // RF07: Valor total
  const valorTotal = useMemo(() => {
    return itensSelecionados.reduce((acc, p) => acc + (p.valor_fatura || 0), 0);
  }, [itensSelecionados]);

  return {
    selecionados,
    itensSelecionados,
    itensValidos,
    valorTotal,
    podeSelecionar,
    toggleSelecao,
    toggleTodos,
    limparSelecao,
    todosSelecionados: selecionados.length === itensValidos.length && itensValidos.length > 0
  };
}
```

### 4.2 Hook de Lançamento em Lote

```typescript
// hooks/useLancamentoLote.ts

import { useState, useCallback } from 'react';
import { Pagamento, ModalLancamentoState, ResultadoLancamento } from '../types/pagamento';
import { lancarPagamento } from '../services/pagamentoService';

const DELAY_ENTRE_REQUISICOES = 500; // RF11

const estadoInicial: ModalLancamentoState = {
  show: false,
  processando: false,
  total: 0,
  atual: 0,
  sucessos: 0,
  erros: 0,
  resultados: [],
  concluido: false,
  itens: []
};

export function useLancamentoLote(onConcluido?: () => void) {
  const [modal, setModal] = useState<ModalLancamentoState>(estadoInicial);

  // Abrir modal com itens para lançar
  const abrirModal = useCallback((itens: Pagamento[]) => {
    // RF08: Filtrar itens sem código de barras (warning)
    const itensComCodigo = itens.filter(i => i.codigo_barras);
    const itensSemCodigo = itens.filter(i => !i.codigo_barras);

    if (itensSemCodigo.length > 0) {
      console.warn(`${itensSemCodigo.length} itens sem código de barras serão ignorados`);
    }

    setModal({
      ...estadoInicial,
      show: true,
      total: itensComCodigo.length,
      itens: itensComCodigo
    });
  }, []);

  // RF09: Fechar modal
  const fecharModal = useCallback(() => {
    // RF12: Não permitir fechar durante processamento
    if (modal.processando) return;

    setModal(estadoInicial);

    // RF17: Recarregar dados após conclusão
    if (modal.concluido && onConcluido) {
      onConcluido();
    }
  }, [modal.processando, modal.concluido, onConcluido]);

  // RF10: Executar lançamento sequencial
  const executarLancamento = useCallback(async () => {
    const { itens } = modal;

    setModal(prev => ({ ...prev, processando: true }));

    const resultados: ResultadoLancamento[] = [];
    let sucessos = 0;
    let erros = 0;

    for (let i = 0; i < itens.length; i++) {
      const item = itens[i];

      // RF13: Atualizar progresso
      setModal(prev => ({
        ...prev,
        atual: i + 1,
        resultados: [...resultados]
      }));

      try {
        const response = await lancarPagamento(item.fatura_id!);

        if (response.success && response.pagamento) {
          // Sucesso
          resultados.push({
            uc: item.uc,
            nome: item.cliente?.nome || null,
            sucesso: true,
            mensagem: `Requisição ${response.pagamento.numero_requisicao}`,
            numero_requisicao: response.pagamento.numero_requisicao
          });
          sucessos++;
        } else {
          // Erro retornado pela API
          resultados.push({
            uc: item.uc,
            nome: item.cliente?.nome || null,
            sucesso: false,
            mensagem: response.error || response.message || 'Erro desconhecido'
          });
          erros++;
        }
      } catch (error: any) {
        // RF19: Tratamento de erro específico
        let mensagem = error.message || 'Erro de conexão';

        if (error.response?.data) {
          const data = error.response.data;
          
          // Erro de data passada
          if (data.data_passada) {
            mensagem = `Data ${data.data_original} já passou`;
          } else {
            mensagem = data.error || data.message || mensagem;
          }
        }

        // RF20: Continuar mesmo com erro
        resultados.push({
          uc: item.uc,
          nome: item.cliente?.nome || null,
          sucesso: false,
          mensagem
        });
        erros++;
      }

      // RF14: Atualizar resultados em tempo real
      setModal(prev => ({
        ...prev,
        resultados: [...resultados],
        sucessos,
        erros
      }));

      // RF11: Delay entre requisições
      if (i < itens.length - 1) {
        await new Promise(resolve => setTimeout(resolve, DELAY_ENTRE_REQUISICOES));
      }
    }

    // Finalizar
    setModal(prev => ({
      ...prev,
      processando: false,
      concluido: true,
      resultados,
      sucessos,
      erros
    }));
  }, [modal.itens]);

  return {
    modal,
    abrirModal,
    fecharModal,
    executarLancamento
  };
}
```

---

## 5. Componentes de UI

### 5.1 Modal de Lançamento em Lote

```tsx
// components/ModalLancamentoLote.tsx

import React from 'react';
import { Modal, Button, Table, Alert, Spinner, ProgressBar } from 'react-bootstrap';
import { Banknote, CheckCircle, XCircle, AlertTriangle } from 'lucide-react';
import { ModalLancamentoState, Pagamento } from '../types/pagamento';
import { formatarValor } from '../utils/formatters';

interface Props {
  modal: ModalLancamentoState;
  onClose: () => void;
  onConfirmar: () => void;
}

export function ModalLancamentoLote({ modal, onClose, onConfirmar }: Props) {
  const { show, processando, concluido, total, atual, sucessos, erros, resultados, itens } = modal;

  // Calcular progresso
  const progresso = total > 0 ? Math.round((atual / total) * 100) : 0;

  // Calcular valor total
  const valorTotal = itens.reduce((acc, i) => acc + (i.valor_fatura || 0), 0);

  return (
    <Modal
      show={show}
      onHide={onClose}
      centered
      backdrop={processando ? 'static' : true}  // RF12
      keyboard={!processando}
      size="lg"
    >
      <Modal.Header 
        closeButton={!processando} 
        className="bg-success text-white"
      >
        <Modal.Title>
          <Banknote size={20} className="me-2" />
          Lançamento em Lote - {total} Pagamentos
        </Modal.Title>
      </Modal.Header>

      <Modal.Body>
        {/* ESTADO: Confirmação inicial */}
        {!processando && !concluido && (
          <ConfirmacaoInicial itens={itens} valorTotal={valorTotal} />
        )}

        {/* ESTADO: Processando */}
        {processando && (
          <ProcessandoLote 
            atual={atual} 
            total={total} 
            progresso={progresso}
            resultados={resultados}
          />
        )}

        {/* ESTADO: Concluído */}
        {concluido && (
          <ResultadoFinal 
            sucessos={sucessos} 
            erros={erros} 
            resultados={resultados}
          />
        )}
      </Modal.Body>

      <Modal.Footer>
        {/* Botões de confirmação inicial */}
        {!processando && !concluido && (
          <>
            <Button variant="secondary" onClick={onClose}>
              Cancelar
            </Button>
            <Button variant="success" onClick={onConfirmar}>
              <Banknote size={16} className="me-1" />
              Confirmar Lançamento
            </Button>
          </>
        )}

        {/* Botão de fechar após conclusão */}
        {concluido && (
          <Button
            variant={erros === 0 ? 'success' : 'secondary'}
            onClick={onClose}
          >
            Fechar
          </Button>
        )}
      </Modal.Footer>
    </Modal>
  );
}

// Sub-componente: Confirmação inicial
function ConfirmacaoInicial({ itens, valorTotal }: { itens: Pagamento[], valorTotal: number }) {
  // RF08: Verificar itens sem código de barras
  const itensSemCodigo = itens.filter(i => !i.codigo_barras);

  return (
    <>
      {/* RF06: Alerta de confirmação */}
      <Alert variant="warning" className="mb-3">
        <AlertTriangle size={16} className="me-2" />
        <strong>Atenção:</strong> Todos os pagamentos selecionados serão enviados 
        para a API do Banco do Brasil e debitados da conta da empresa.
      </Alert>

      {/* RF08: Warning para itens sem código */}
      {itensSemCodigo.length > 0 && (
        <Alert variant="danger" className="mb-3">
          <strong>{itensSemCodigo.length} item(ns)</strong> não possuem código de barras 
          e serão ignorados.
        </Alert>
      )}

      {/* RF06: Lista de itens */}
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
              <tr key={idx} className={!item.codigo_barras ? 'table-danger' : ''}>
                <td><code>{item.uc}</code></td>
                <td className="text-truncate" style={{ maxWidth: '200px' }}>
                  {item.cliente?.nome || '-'}
                </td>
                <td className="text-end">{formatarValor(item.valor_fatura)}</td>
              </tr>
            ))}
          </tbody>
          {/* RF07: Valor total */}
          <tfoot>
            <tr className="table-dark">
              <td colSpan={2}><strong>Total</strong></td>
              <td className="text-end">
                <strong>{formatarValor(valorTotal)}</strong>
              </td>
            </tr>
          </tfoot>
        </Table>
      </div>
    </>
  );
}

// Sub-componente: Processando
function ProcessandoLote({ 
  atual, 
  total, 
  progresso, 
  resultados 
}: { 
  atual: number; 
  total: number; 
  progresso: number;
  resultados: any[];
}) {
  return (
    <div>
      {/* RF13: Contador de progresso */}
      <div className="d-flex align-items-center justify-content-between mb-2">
        <span>
          <Spinner size="sm" className="me-2" />
          Processando...
        </span>
        <span className="text-muted">
          {atual} / {total}
        </span>
      </div>

      {/* RF13: Barra de progresso */}
      <ProgressBar 
        now={progresso} 
        label={`${progresso}%`}
        animated 
        striped 
        variant="success"
        className="mb-3"
        style={{ height: '25px' }}
      />

      {/* RF14: Resultados em tempo real */}
      {resultados.length > 0 && (
        <div style={{ maxHeight: '200px', overflowY: 'auto' }}>
          {resultados.map((res, idx) => (
            <div 
              key={idx} 
              className={`d-flex align-items-center gap-2 py-1 ${idx > 0 ? 'border-top' : ''}`}
            >
              {res.sucesso ? (
                <CheckCircle size={16} className="text-success flex-shrink-0" />
              ) : (
                <XCircle size={16} className="text-danger flex-shrink-0" />
              )}
              <code className="flex-shrink-0">{res.uc}</code>
              <span className="text-truncate">{res.mensagem}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// Sub-componente: Resultado final
function ResultadoFinal({ 
  sucessos, 
  erros, 
  resultados 
}: { 
  sucessos: number; 
  erros: number; 
  resultados: any[];
}) {
  return (
    <div>
      {/* RF15: Resumo de estatísticas */}
      <div className="d-flex gap-4 mb-3 justify-content-center">
        <div className="text-center">
          <div className="display-6 text-success">{sucessos}</div>
          <small className="text-muted">Sucesso</small>
        </div>
        <div className="text-center">
          <div className="display-6 text-danger">{erros}</div>
          <small className="text-muted">Erros</small>
        </div>
      </div>

      {/* RF16: Lista detalhada */}
      <div style={{ maxHeight: '300px', overflowY: 'auto' }}>
        {resultados.map((res, idx) => (
          <div 
            key={idx} 
            className={`d-flex align-items-center gap-2 py-2 ${idx > 0 ? 'border-top' : ''}`}
          >
            {res.sucesso ? (
              <CheckCircle size={16} className="text-success flex-shrink-0" />
            ) : (
              <XCircle size={16} className="text-danger flex-shrink-0" />
            )}
            <code className="flex-shrink-0">{res.uc}</code>
            <span className="text-truncate flex-grow-1" title={res.nome}>
              {res.nome || '-'}
            </span>
            <small className={res.sucesso ? 'text-success' : 'text-danger'}>
              {res.mensagem}
            </small>
          </div>
        ))}
      </div>
    </div>
  );
}
```

### 5.2 Tabela de Pagamentos com Seleção

```tsx
// components/TabelaPagamentos.tsx

import React from 'react';
import { Table, Form, Badge } from 'react-bootstrap';
import { Pagamento, StatusPagamento } from '../types/pagamento';
import { formatarValor, formatarData } from '../utils/formatters';

interface Props {
  pagamentos: Pagamento[];
  selecionados: string[];
  todosSelecionados: boolean;
  onToggleSelecao: (uc: string) => void;
  onToggleTodos: () => void;
  podeSelecionar: (pagamento: Pagamento) => boolean;
}

export function TabelaPagamentos({
  pagamentos,
  selecionados,
  todosSelecionados,
  onToggleSelecao,
  onToggleTodos,
  podeSelecionar
}: Props) {
  return (
    <Table hover responsive>
      <thead>
        <tr>
          <th style={{ width: '40px' }}>
            {/* RF03: Checkbox "Selecionar todos" */}
            <Form.Check
              type="checkbox"
              checked={todosSelecionados}
              onChange={onToggleTodos}
              title="Selecionar todos"
            />
          </th>
          <th>UC</th>
          <th>Cliente</th>
          <th>Mês Ref.</th>
          <th className="text-end">Valor</th>
          <th>Vencimento</th>
          <th>Status</th>
        </tr>
      </thead>
      <tbody>
        {pagamentos.map(pagamento => {
          const selecionado = selecionados.includes(pagamento.uc);
          const habilitado = podeSelecionar(pagamento);

          return (
            <tr 
              key={pagamento.id}
              className={selecionado ? 'table-primary' : ''}
            >
              <td>
                {/* RF01, RF02: Checkbox com validação */}
                <Form.Check
                  type="checkbox"
                  checked={selecionado}
                  disabled={!habilitado}
                  onChange={() => onToggleSelecao(pagamento.uc)}
                />
              </td>
              <td><code>{pagamento.uc}</code></td>
              <td className="text-truncate" style={{ maxWidth: '200px' }}>
                {pagamento.cliente?.nome || '-'}
              </td>
              <td>{pagamento.mes_referencia}</td>
              <td className="text-end">{formatarValor(pagamento.valor_fatura)}</td>
              <td>{formatarData(pagamento.data_vencimento)}</td>
              <td>
                <StatusBadge status={pagamento.status} />
              </td>
            </tr>
          );
        })}
      </tbody>
    </Table>
  );
}

// Badge de status com cores
function StatusBadge({ status }: { status: StatusPagamento }) {
  const config: Record<StatusPagamento, { bg: string; label: string }> = {
    pendente: { bg: 'secondary', label: 'Pendente' },
    lancado: { bg: 'warning', label: 'Lançado' },
    pago: { bg: 'success', label: 'Pago' },
    erro: { bg: 'danger', label: 'Erro' },
    rejeitado: { bg: 'danger', label: 'Rejeitado' },
    cancelado: { bg: 'dark', label: 'Cancelado' }
  };

  const { bg, label } = config[status] || { bg: 'secondary', label: status };

  return <Badge bg={bg}>{label}</Badge>;
}
```

### 5.3 Botão de Lançar em Lote

```tsx
// components/BotaoLancarLote.tsx

import React from 'react';
import { Button, Badge } from 'react-bootstrap';
import { Banknote } from 'lucide-react';

interface Props {
  quantidade: number;
  valorTotal: number;
  onClick: () => void;
  disabled?: boolean;
}

export function BotaoLancarLote({ quantidade, valorTotal, onClick, disabled }: Props) {
  return (
    <Button
      variant="success"
      onClick={onClick}
      disabled={disabled || quantidade === 0}  // RF05
      className="d-flex align-items-center gap-2"
    >
      <Banknote size={18} />
      Lançar Selecionados
      {/* RF04: Badge com contador */}
      {quantidade > 0 && (
        <Badge bg="light" text="dark">
          {quantidade}
        </Badge>
      )}
    </Button>
  );
}
```

---

## 6. Serviços de API

### 6.1 Serviço de Pagamentos

```typescript
// services/pagamentoService.ts

import api from './api';
import { Pagamento } from '../types/pagamento';

const BASE_URL = '/api/pagamentos-concessionaria';

export interface LancarPagamentoResponse {
  success: boolean;
  message?: string;
  error?: string;
  pagamento?: {
    id: number;
    uc: string;
    valor: number;
    status: string;
    numero_requisicao: number;
    id_pagamento_bb: string;
    data_pagamento: string;
  };
  data_passada?: boolean;
  data_original?: string;
}

/**
 * Lançar pagamento individual na API do BB
 */
export async function lancarPagamento(
  faturaId: number,
  dados?: { codigo_barras?: string; data_pagamento?: string }
): Promise<LancarPagamentoResponse> {
  const response = await api.post(`${BASE_URL}/${faturaId}/lancar`, dados || {});
  return response.data;
}

/**
 * Cancelar pagamento pendente
 */
export async function cancelarPagamento(id: number): Promise<{ success: boolean; message?: string }> {
  const response = await api.post(`${BASE_URL}/${id}/cancelar`);
  return response.data;
}

/**
 * Sincronizar status com API do BB
 */
export async function sincronizarStatus(): Promise<{
  success: boolean;
  sincronizados: number;
  detalhes: Array<{ id: number; status_anterior: string; status_novo: string }>;
}> {
  const response = await api.post(`${BASE_URL}/sincronizar-status`);
  return response.data;
}

/**
 * Listar pagamentos por mês de referência
 */
export async function listarPagamentos(mesReferencia: string): Promise<Pagamento[]> {
  const response = await api.get(`${BASE_URL}`, {
    params: { mes_referencia: mesReferencia }
  });
  return response.data;
}

/**
 * Consultar pagamento específico
 */
export async function consultarPagamento(id: number): Promise<Pagamento> {
  const response = await api.get(`${BASE_URL}/${id}`);
  return response.data;
}
```

---

## 7. Utilitários

### 7.1 Formatadores

```typescript
// utils/formatters.ts

/**
 * Formatar valor em Real brasileiro
 */
export function formatarValor(valor: number | null | undefined): string {
  if (valor === null || valor === undefined) return '-';
  
  return new Intl.NumberFormat('pt-BR', {
    style: 'currency',
    currency: 'BRL'
  }).format(valor);
}

/**
 * Formatar data para exibição
 */
export function formatarData(data: string | null | undefined): string {
  if (!data) return '-';
  
  try {
    const d = new Date(data);
    return d.toLocaleDateString('pt-BR');
  } catch {
    return data;
  }
}

/**
 * Parsear data brasileira "DD/MM/YYYY" para Date
 */
export function parsearDataBR(dataStr: string): Date | null {
  if (!dataStr) return null;
  
  const partes = dataStr.split('/');
  if (partes.length !== 3) return null;
  
  const [dia, mes, ano] = partes;
  const anoCompleto = ano.length === 2 ? `20${ano}` : ano;
  
  return new Date(`${anoCompleto}-${mes}-${dia}`);
}
```

---

## 8. Fluxo Completo de Uso

### 8.1 Componente Principal

```tsx
// PagamentosConcessionaria/index.tsx

import React, { useState, useEffect, useCallback } from 'react';
import { Container, Card, Row, Col, Alert } from 'react-bootstrap';
import { TabelaPagamentos } from './components/TabelaPagamentos';
import { BotaoLancarLote } from './components/BotaoLancarLote';
import { ModalLancamentoLote } from './components/ModalLancamentoLote';
import { FiltrosMesReferencia } from './components/FiltrosMesReferencia';
import { useSelecao } from './hooks/useSelecao';
import { useLancamentoLote } from './hooks/useLancamentoLote';
import { listarPagamentos } from './services/pagamentoService';
import { Pagamento } from './types/pagamento';

export function PagamentosConcessionaria() {
  // Estado dos dados
  const [pagamentos, setPagamentos] = useState<Pagamento[]>([]);
  const [mesReferencia, setMesReferencia] = useState<string>('');
  const [loading, setLoading] = useState(false);
  const [erro, setErro] = useState<string | null>(null);

  // Hooks customizados
  const selecao = useSelecao(pagamentos);
  const lancamento = useLancamentoLote(() => {
    // RF17, RF18: Recarregar e limpar seleção
    carregarDados();
    selecao.limparSelecao();
  });

  // Carregar dados
  const carregarDados = useCallback(async () => {
    if (!mesReferencia) return;

    setLoading(true);
    setErro(null);

    try {
      const dados = await listarPagamentos(mesReferencia);
      setPagamentos(dados);
    } catch (err: any) {
      setErro(err.message || 'Erro ao carregar dados');
    } finally {
      setLoading(false);
    }
  }, [mesReferencia]);

  useEffect(() => {
    carregarDados();
  }, [carregarDados]);

  // Iniciar lançamento em lote
  const handleLancarLote = () => {
    lancamento.abrirModal(selecao.itensSelecionados);
  };

  return (
    <Container fluid className="py-4">
      <Card>
        <Card.Header className="d-flex justify-content-between align-items-center">
          <h5 className="mb-0">Pagamentos de Concessionária</h5>
          
          <div className="d-flex gap-2">
            {/* Filtro de mês */}
            <FiltrosMesReferencia
              value={mesReferencia}
              onChange={setMesReferencia}
            />

            {/* RF04, RF05: Botão de lançamento */}
            <BotaoLancarLote
              quantidade={selecao.selecionados.length}
              valorTotal={selecao.valorTotal}
              onClick={handleLancarLote}
              disabled={loading}
            />
          </div>
        </Card.Header>

        <Card.Body>
          {erro && <Alert variant="danger">{erro}</Alert>}

          {/* Tabela com seleção */}
          <TabelaPagamentos
            pagamentos={pagamentos}
            selecionados={selecao.selecionados}
            todosSelecionados={selecao.todosSelecionados}
            onToggleSelecao={selecao.toggleSelecao}
            onToggleTodos={selecao.toggleTodos}
            podeSelecionar={selecao.podeSelecionar}
          />
        </Card.Body>
      </Card>

      {/* Modal de lançamento em lote */}
      <ModalLancamentoLote
        modal={lancamento.modal}
        onClose={lancamento.fecharModal}
        onConfirmar={lancamento.executarLancamento}
      />
    </Container>
  );
}
```

---

## 9. Tratamento de Erros

### 9.1 Tipos de Erro

| Tipo | Origem | Tratamento |
|------|--------|------------|
| `data_passada` | Backend | Exibir mensagem específica com data original |
| `sem_codigo_barras` | Frontend | Filtrar antes de enviar |
| `erro_api_bb` | Backend | Exibir mensagem do BB |
| `erro_conexao` | Network | Exibir "Erro de conexão" |
| `status_invalido` | Backend | Exibir status atual |

### 9.2 Mensagens de Erro

```typescript
// utils/errorMessages.ts

export function formatarMensagemErro(error: any): string {
  if (!error.response) {
    return 'Erro de conexão. Verifique sua internet.';
  }

  const data = error.response.data;

  if (data.data_passada) {
    return `Data de pagamento ${data.data_original} já passou. Selecione uma nova data.`;
  }

  if (data.error) {
    return data.error;
  }

  if (data.message) {
    return data.message;
  }

  return 'Erro desconhecido. Tente novamente.';
}
```

---

## 10. Acessibilidade e UX

### 10.1 Feedback Visual

- **Checkbox desabilitado**: Cor cinza + cursor `not-allowed`
- **Linha selecionada**: Background azul claro
- **Status com cores**: Verde (pago), Amarelo (lançado), Vermelho (erro)
- **Progresso**: Barra animada com porcentagem

### 10.2 Confirmações

- **Antes de lançar**: Modal com lista e valor total
- **Durante processamento**: Impedir fechamento
- **Após conclusão**: Resumo claro de sucessos/erros

### 10.3 Loading States

- **Carregando dados**: Spinner na tabela
- **Processando lote**: Barra de progresso
- **Enviando individual**: Spinner no botão

---

## 11. Checklist de Implementação

### Componentes
- [ ] `TabelaPagamentos` com checkboxes
- [ ] `BotaoLancarLote` com badge
- [ ] `ModalLancamentoLote` com 3 estados
- [ ] `FiltrosMesReferencia`
- [ ] `StatusBadge`

### Hooks
- [ ] `useSelecao` - lógica de seleção
- [ ] `useLancamentoLote` - processamento em lote
- [ ] `usePagamentos` - fetch de dados

### Serviços
- [ ] `lancarPagamento(faturaId)`
- [ ] `cancelarPagamento(id)`
- [ ] `sincronizarStatus()`
- [ ] `listarPagamentos(mesReferencia)`

### Utilitários
- [ ] `formatarValor()`
- [ ] `formatarData()`
- [ ] `formatarMensagemErro()`

### Tipos
- [ ] Interface `Pagamento`
- [ ] Interface `ModalLancamentoState`
- [ ] Interface `ResultadoLancamento`
- [ ] Type `StatusPagamento`

### Testes
- [ ] Teste de seleção (RF01-RF05)
- [ ] Teste de validação (RF06-RF09)
- [ ] Teste de processamento (RF10-RF14)
- [ ] Teste de resultado (RF15-RF18)
- [ ] Teste de erros (RF19-RF21)
