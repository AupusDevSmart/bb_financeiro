# Aupus Control - Documentação Frontend

> **Prompt para equipe Frontend** - Implementação do lançamento de faturas no Aupus Control.

---

## 1. Contexto

O **Aupus Control** é o sistema financeiro interno que registra lançamentos de contas a pagar/receber. Esta documentação descreve como implementar a interface para enviar faturas de concessionárias (EQTL) para o Control.

### Importante
- O lançamento no Control é **independente** do lançamento no Banco do Brasil
- O frontend chama uma API do backend Laravel que faz a integração com o Control
- O usuário pode lançar **individualmente** ou **em lote**

---

## 2. Interface do Usuário

### 2.1 Localização

O botão de lançamento no Control fica na **aba "Pagamento em Lote"** da tela de Pagamentos de Concessionárias.

### 2.2 Elementos Visuais

```
┌─────────────────────────────────────────────────────────────────────────────┐
│ Pagamento de Faturas - Janeiro de 2026                                      │
├─────────────────────────────────────────────────────────────────────────────┤
│ [Para Pagamento 3] [Enviar para Cliente 2]                                  │
├─────────────────────────────────────────────────────────────────────────────┤
│ ☑ │ UC       │ Cliente      │ Valor    │ Status BB │ Control │ Ações       │
├───┼──────────┼──────────────┼──────────┼───────────┼─────────┼─────────────┤
│ ☑ │ 49166370 │ Lucas Gabriel│ R$ 150,00│ Lançado   │ --      │ 💰 ⬆️ 🗑️   │
│ ☑ │ 47268180 │ Maria Silva  │ R$ 24,00 │ Pago      │ ✓ OK    │ 💰 ⬆️ 🗑️   │
│ ☐ │ 10777539 │ João Santos  │ R$ 1,94  │ Pendente  │ Erro    │ 💰 ⬆️ 🗑️   │
└───┴──────────┴──────────────┴──────────┴───────────┴─────────┴─────────────┘
│                                                                             │
│ 2 pagamento(s) selecionado(s)                                               │
│ [Limpar seleção] [Lançar BB (2)] [Lançar Control (2)]                       │
└─────────────────────────────────────────────────────────────────────────────┘
```

### 2.3 Botões de Ação

| Ícone | Ação | Descrição |
|-------|------|-----------|
| 💰 (Banknote) | Lançar BB | Envia pagamento para API do Banco do Brasil |
| ⬆️ (Upload) | Lançar Control | Envia lançamento para Aupus Control |
| 🗑️ (Trash) | Cancelar | Cancela pagamento |

### 2.4 Coluna "Control"

| Valor | Exibição | Cor |
|-------|----------|-----|
| `null` | `--` | Cinza (muted) |
| `'lancado'` | `Control OK` | Verde (success) |
| `'erro'` | `Erro` | Vermelho (danger) |

---

## 3. Estados do Componente

### 3.1 Estado do Modal Individual

```typescript
const [showModalLancarControl, setShowModalLancarControl] = useState(false);
const [pagamentoParaLancar, setPagamentoParaLancar] = useState<Pagamento | null>(null);
const [lancandoPagamento, setLancandoPagamento] = useState(false);
```

### 3.2 Estado do Modal em Lote

```typescript
interface ModalLancamentoControlState {
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

const [modalLancamentoControl, setModalLancamentoControl] = useState<ModalLancamentoControlState>({
  show: false,
  processando: false,
  total: 0,
  atual: 0,
  sucessos: 0,
  erros: 0,
  resultados: [],
  concluido: false,
  itens: []
});
```

### 3.3 Interface de Resultado

```typescript
interface ResultadoLancamento {
  uc: string;
  nome: string | null;
  sucesso: boolean;
  mensagem: string;
}
```

---

## 4. Fluxos de Usuário

### 4.1 Fluxo Individual

```
┌─────────────┐     ┌──────────────┐     ┌─────────────┐     ┌──────────────┐
│ Clicar ⬆️   │────▶│ Abrir Modal  │────▶│ Confirmar   │────▶│ Chamar API   │
│ na linha    │     │ Confirmação  │     │ Lançamento  │     │ Backend      │
└─────────────┘     └──────────────┘     └─────────────┘     └──────────────┘
                                                                    │
                    ┌──────────────┐     ┌─────────────┐            │
                    │ Atualizar    │◀────│ Exibir      │◀───────────┘
                    │ Lista        │     │ Resultado   │
                    └──────────────┘     └─────────────┘
```

### 4.2 Fluxo em Lote

```
┌─────────────┐     ┌──────────────┐     ┌─────────────┐     ┌──────────────┐
│ Selecionar  │────▶│ Clicar       │────▶│ Abrir Modal │────▶│ Confirmar    │
│ Checkboxes  │     │ "Lançar      │     │ com Lista   │     │ Lançamento   │
│             │     │  Control"    │     │             │     │              │
└─────────────┘     └──────────────┘     └─────────────┘     └──────────────┘
                                                                    │
                                                                    ▼
┌─────────────┐     ┌──────────────┐     ┌─────────────┐     ┌──────────────┐
│ Atualizar   │◀────│ Exibir       │◀────│ Processar   │◀────│ Loop: Chamar │
│ Lista       │     │ Resultado    │     │ Resultados  │     │ API p/ cada  │
└─────────────┘     └──────────────┘     └─────────────┘     └──────────────┘
```

---

## 5. Funções Principais

### 5.1 Lançamento Individual

```javascript
// Abrir modal de confirmação
const handleLancarControl = (pagamento) => {
  // Validar código de barras
  if (!pagamento.codigo_barras) {
    setErro('Código de barras não encontrado.');
    return;
  }
  
  setPagamentoParaLancar(pagamento);
  setShowModalLancarControl(true);
};

// Confirmar e executar lançamento
const confirmarLancamentoControl = async () => {
  if (!pagamentoParaLancar) return;
  
  try {
    setLancandoPagamento(true);
    setErro(null);

    const response = await fetch(
      `${API_URL}/api/pagamentos-concessionaria/lancar-control/${pagamentoParaLancar.fatura_id}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ 
          nome_cliente: pagamentoParaLancar?.nome_cliente || null 
        })
      }
    );

    const data = await response.json();

    if (response.ok) {
      setSucesso(`Lançado no Aupus Control! UC: ${pagamentoParaLancar.uc} - ID: ${data.control_lancamento_id}`);
      setShowModalLancarControl(false);
      setPagamentoParaLancar(null);
      carregarDados(); // Recarregar lista
    } else {
      setErro(data.error || data.message || 'Erro ao lançar no Control');
    }
  } catch (err) {
    setErro('Erro ao lançar no Control: ' + err.message);
  } finally {
    setLancandoPagamento(false);
  }
};
```

### 5.2 Lançamento em Lote

```javascript
// Iniciar lançamento em lote
const iniciarLancamentoLoteControl = () => {
  // Filtrar apenas itens elegíveis
  const itensParaLancar = pagamentos.filter(pag =>
    selecionados.includes(pag.fatura_id) &&
    pag.status_control !== 'lancado' &&  // Não lançado ainda
    pag.codigo_barras                     // Tem código de barras
  );

  if (itensParaLancar.length === 0) {
    setErro('Nenhum item selecionado é elegível para lançamento no Control');
    return;
  }

  setModalLancamentoControl({
    show: true,
    processando: false,
    total: itensParaLancar.length,
    atual: 0,
    sucessos: 0,
    erros: 0,
    resultados: [],
    concluido: false,
    itens: itensParaLancar
  });
};

// Executar lançamento em lote
const executarLancamentoLoteControl = async () => {
  const { itens } = modalLancamentoControl;

  setModalLancamentoControl(prev => ({ ...prev, processando: true }));

  const resultados = [];
  let sucessos = 0;
  let erros = 0;

  for (let i = 0; i < itens.length; i++) {
    const item = itens[i];

    // Atualizar progresso
    setModalLancamentoControl(prev => ({
      ...prev,
      atual: i + 1,
      resultados: [...resultados]
    }));

    try {
      const response = await fetch(
        `${API_URL}/api/pagamentos-concessionaria/lancar-control/${item.fatura_id}`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ nome_cliente: item.nome_cliente || null })
        }
      );

      const data = await response.json();

      if (response.ok) {
        resultados.push({
          uc: item.uc,
          nome: item.nome_cliente,
          sucesso: true,
          mensagem: `ID ${data.control_lancamento_id}`
        });
        sucessos++;
      } else {
        resultados.push({
          uc: item.uc,
          nome: item.nome_cliente,
          sucesso: false,
          mensagem: data.error || data.message || 'Erro desconhecido'
        });
        erros++;
      }
    } catch (error) {
      resultados.push({
        uc: item.uc,
        nome: item.nome_cliente,
        sucesso: false,
        mensagem: error.message
      });
      erros++;
    }

    // Delay entre requisições (evitar sobrecarga)
    if (i < itens.length - 1) {
      await new Promise(resolve => setTimeout(resolve, 500));
    }
  }

  // Finalizar
  setModalLancamentoControl(prev => ({
    ...prev,
    processando: false,
    concluido: true,
    sucessos,
    erros,
    resultados
  }));

  // Recarregar dados se houve sucesso
  if (sucessos > 0) {
    carregarDados();
  }
};

// Fechar modal
const fecharModalLancamentoControl = () => {
  setModalLancamentoControl({
    show: false,
    processando: false,
    total: 0,
    atual: 0,
    sucessos: 0,
    erros: 0,
    resultados: [],
    concluido: false,
    itens: []
  });
  setSelecionados([]);
};
```

---

## 6. Componentes de UI

### 6.1 Badge de Status Control

```jsx
const getControlStatusBadge = (statusControl, controlId) => {
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
};
```

### 6.2 Botão de Lançamento Individual

```jsx
<OverlayTrigger
  placement="top"
  overlay={
    <Tooltip>
      {pag.status_control === 'lancado'
        ? `Já lançado no Control (${pag.control_lancamento_id || ''})`
        : pag.codigo_barras
          ? 'Lançar no Aupus Control'
          : 'Falta código de barras'
      }
    </Tooltip>
  }
>
  <span>
    <Button
      size="sm"
      variant={pag.status_control !== 'lancado' && pag.codigo_barras 
        ? 'outline-primary' 
        : 'outline-secondary'}
      onClick={() => handleLancarControl(pag)}
      disabled={pag.status_control === 'lancado' || !pag.codigo_barras}
      style={pag.status_control === 'lancado' || !pag.codigo_barras 
        ? { pointerEvents: 'none', opacity: 0.35 } 
        : {}}
    >
      <Upload size={16} />
    </Button>
  </span>
</OverlayTrigger>
```

### 6.3 Botão de Lançamento em Lote (Footer)

```jsx
<Button
  variant="primary"
  size="sm"
  onClick={iniciarLancamentoLoteControl}
>
  <Upload size={16} className="me-1" />
  Lançar Control ({selecionados.filter(id => {
    const p = pagamentos.find(x => x.fatura_id === id);
    return p && p.status_control !== 'lancado' && p.codigo_barras;
  }).length})
</Button>
```

### 6.4 Modal de Confirmação Individual

```jsx
<Modal show={showModalLancarControl} onHide={() => setShowModalLancarControl(false)} centered>
  <Modal.Header closeButton className="bg-primary text-white">
    <Modal.Title>
      <Upload size={20} className="me-2" />
      Lançar no Aupus Control
    </Modal.Title>
  </Modal.Header>
  <Modal.Body>
    {pagamentoParaLancar && (
      <>
        <Alert variant="info" className="mb-3">
          O lançamento será enviado para o Aupus Control para registro financeiro.
        </Alert>
        <Row className="mb-2">
          <Col xs={4}><strong>UC:</strong></Col>
          <Col xs={8}><code>{pagamentoParaLancar.uc}</code></Col>
        </Row>
        <Row className="mb-2">
          <Col xs={4}><strong>Cliente:</strong></Col>
          <Col xs={8}>{pagamentoParaLancar.nome_cliente || '-'}</Col>
        </Row>
        <Row className="mb-2">
          <Col xs={4}><strong>Valor:</strong></Col>
          <Col xs={8}>{formatarValor(pagamentoParaLancar.valor_fatura)}</Col>
        </Row>
        <Row className="mb-2">
          <Col xs={4}><strong>Mês Ref:</strong></Col>
          <Col xs={8}>{pagamentoParaLancar.mes_referencia}</Col>
        </Row>
      </>
    )}
  </Modal.Body>
  <Modal.Footer>
    <Button variant="secondary" onClick={() => setShowModalLancarControl(false)}>
      Cancelar
    </Button>
    <Button 
      variant="primary" 
      onClick={confirmarLancamentoControl}
      disabled={lancandoPagamento}
    >
      {lancandoPagamento ? (
        <>
          <Spinner size="sm" className="me-1" />
          Lançando...
        </>
      ) : (
        <>
          <Upload size={16} className="me-1" />
          Confirmar Lançamento
        </>
      )}
    </Button>
  </Modal.Footer>
</Modal>
```

### 6.5 Modal de Lançamento em Lote

```jsx
<Modal
  show={modalLancamentoControl.show}
  onHide={fecharModalLancamentoControl}
  centered
  backdrop={modalLancamentoControl.processando ? 'static' : true}
  size="lg"
>
  <Modal.Header 
    closeButton={!modalLancamentoControl.processando} 
    className="bg-primary text-white"
  >
    <Modal.Title>
      <Upload size={20} className="me-2" />
      Lançamento Control - {modalLancamentoControl.total} Pagamentos
    </Modal.Title>
  </Modal.Header>

  <Modal.Body>
    {/* Estado: Confirmação inicial */}
    {!modalLancamentoControl.processando && !modalLancamentoControl.concluido && (
      <>
        <Alert variant="info" className="mb-3">
          Os lançamentos serão enviados para o Aupus Control.
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
              {modalLancamentoControl.itens.map((item, idx) => (
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
      </>
    )}

    {/* Estado: Processando */}
    {modalLancamentoControl.processando && (
      <>
        <div className="text-center mb-3">
          <h5>Processando... {modalLancamentoControl.atual} / {modalLancamentoControl.total}</h5>
          <ProgressBar 
            now={(modalLancamentoControl.atual / modalLancamentoControl.total) * 100} 
            animated 
          />
        </div>
        <div style={{ maxHeight: '200px', overflowY: 'auto' }}>
          {modalLancamentoControl.resultados.map((r, idx) => (
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

    {/* Estado: Concluído */}
    {modalLancamentoControl.concluido && (
      <>
        <div className="text-center mb-4">
          <div className="d-flex justify-content-center gap-4">
            <div>
              <Badge bg="success" className="fs-4 p-3">
                {modalLancamentoControl.sucessos}
              </Badge>
              <div className="mt-1">Sucesso</div>
            </div>
            <div>
              <Badge bg="danger" className="fs-4 p-3">
                {modalLancamentoControl.erros}
              </Badge>
              <div className="mt-1">Erros</div>
            </div>
          </div>
        </div>
        <div style={{ maxHeight: '250px', overflowY: 'auto' }}>
          {modalLancamentoControl.resultados.map((r, idx) => (
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
    {!modalLancamentoControl.processando && !modalLancamentoControl.concluido && (
      <>
        <Button variant="secondary" onClick={fecharModalLancamentoControl}>
          Cancelar
        </Button>
        <Button variant="primary" onClick={executarLancamentoLoteControl}>
          <Upload size={16} className="me-1" />
          Confirmar Lançamento
        </Button>
      </>
    )}
    {modalLancamentoControl.concluido && (
      <Button variant="primary" onClick={fecharModalLancamentoControl}>
        Fechar
      </Button>
    )}
  </Modal.Footer>
</Modal>
```

---

## 7. Regras de Negócio (Frontend)

### 7.1 Elegibilidade para Lançamento

Um pagamento pode ser lançado no Control se:

| Regra | Condição |
|-------|----------|
| Não lançado ainda | `status_control !== 'lancado'` |
| Tem código de barras | `codigo_barras` existe e não é vazio |

### 7.2 Desabilitação do Botão

```javascript
const botaoDesabilitado = pag.status_control === 'lancado' || !pag.codigo_barras;
```

### 7.3 Contagem de Elegíveis no Footer

```javascript
const elegiveisControl = selecionados.filter(id => {
  const p = pagamentos.find(x => x.fatura_id === id);
  return p && p.status_control !== 'lancado' && p.codigo_barras;
}).length;
```

---

## 8. Checklist de Implementação

### Estados
- [ ] `showModalLancarControl` - Modal individual
- [ ] `pagamentoParaLancar` - Pagamento selecionado
- [ ] `lancandoPagamento` - Loading do botão
- [ ] `modalLancamentoControl` - Modal em lote

### Funções
- [ ] `handleLancarControl` - Abrir modal individual
- [ ] `confirmarLancamentoControl` - Executar lançamento individual
- [ ] `iniciarLancamentoLoteControl` - Abrir modal em lote
- [ ] `executarLancamentoLoteControl` - Executar lançamento em lote
- [ ] `fecharModalLancamentoControl` - Fechar modal em lote
- [ ] `getControlStatusBadge` - Badge de status

### UI
- [ ] Coluna "Control" na tabela
- [ ] Botão ⬆️ (Upload) nas ações
- [ ] Botão "Lançar Control" no footer
- [ ] Modal de confirmação individual
- [ ] Modal de lançamento em lote com progresso

### Integração
- [ ] Endpoint: `POST /api/pagamentos-concessionaria/lancar-control/{fatura_id}`
- [ ] Body: `{ nome_cliente: string | null }`
- [ ] Response: `{ success, control_lancamento_id, ... }`
