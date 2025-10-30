import React, { useState, useEffect } from 'react';
import { Container, Nav, Alert } from 'react-bootstrap';
import CriarBoleto from './CriarBoleto';
import ListarBoletos from './ListarBoletos';
import ConsultarBoleto from './ConsultarBoleto';
import GerarBoletoEnergia from './GerarBoletoEnergia';

function App() {
  const [activeTab, setActiveTab] = useState('criar');
  const [alert, setAlert] = useState(null);
  const [serverStatus, setServerStatus] = useState('Conectando...');

  useEffect(() => {
    // Verificar status do servidor
    fetch('/health')
      .then(() => setServerStatus('Online'))
      .catch(() => setServerStatus('Offline'));
  }, []);

  const showAlert = (message, type = 'info') => {
    setAlert({ message, type });
    setTimeout(() => setAlert(null), 5000);
  };

  const handleBoletoCreated = (boleto) => {
    showAlert('Boleto criado com sucesso!', 'success');
  };

  const handleBoletoSelected = (boleto) => {
    console.log('Boleto selecionado:', boleto);
  };

  return (
    <div className="app-container">
      <Container className="main-container p-0">
        {/* Header com logo do Banco do Brasil */}
        <div className="header">
          <h1>
            <i className="fas fa-university"></i> Banco do Brasil
          </h1>
          <p className="mb-0">Sistema de Geração de Boletos</p>
        </div>

        {/* Status Bar */}
        <div className="status-bar">
          <div>
            <i className="fas fa-server me-2"></i>
            Servidor: <strong>{serverStatus}</strong>
          </div>
          <div>
            <i className="fas fa-clock me-2"></i>
            {new Date().toLocaleString('pt-BR')}
          </div>
        </div>

        {/* Alerts */}
        {alert && (
          <div className="mx-4 mt-3">
            <Alert variant={alert.type} dismissible onClose={() => setAlert(null)}>
              {alert.message}
            </Alert>
          </div>
        )}

        {/* Navigation Tabs */}
        <Nav variant="tabs" className="nav-tabs">
          <Nav.Item>
            <Nav.Link
              active={activeTab === 'criar'}
              onClick={() => setActiveTab('criar')}
            >
              <i className="fas fa-plus-circle me-2"></i>
              Criar Boleto
            </Nav.Link>
          </Nav.Item>
          <Nav.Item>
            <Nav.Link
              active={activeTab === 'consultar'}
              onClick={() => setActiveTab('consultar')}
            >
              <i className="fas fa-search me-2"></i>
              Consultar Boleto
            </Nav.Link>
          </Nav.Item>
          <Nav.Item>
            <Nav.Link
              active={activeTab === 'listar'}
              onClick={() => setActiveTab('listar')}
            >
              <i className="fas fa-list me-2"></i>
              Listar Boletos
            </Nav.Link>
          </Nav.Item>
          <Nav.Item>
            <Nav.Link
              active={activeTab === 'energia'}
              onClick={() => setActiveTab('energia')}
            >
              <i className="fas fa-bolt me-2"></i>
              Gerar Boleto Energia
            </Nav.Link>
          </Nav.Item>
        </Nav>

        {/* Tab Content */}
        <div className="tab-content">
          {activeTab === 'criar' && (
            <CriarBoleto onSuccess={handleBoletoCreated} />
          )}

          {activeTab === 'consultar' && (
            <ConsultarBoleto />
          )}

          {activeTab === 'listar' && (
            <ListarBoletos onBoletoSelect={handleBoletoSelected} />
          )}

          {activeTab === 'energia' && (
            <GerarBoletoEnergia mostrarAlerta={showAlert} />
          )}
        </div>
      </Container>
    </div>
  );
}

export default App;
