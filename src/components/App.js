import React, { useState, useEffect } from 'react';
import {
  Building2,
  LogOut,
  Sun,
  Moon,
  Server,
  User,
  Clock,
  Plus,
  Search,
  List,
  Zap,
  FolderOpen,
  Activity,
  Database,
  LayoutDashboard,
  ClipboardList,
  SunMedium
} from 'lucide-react';
import { AuthProvider, useAuth } from '../contexts/AuthContext';
import Login from './Login';
import CriarBoleto from './CriarBoleto';
import ListarBoletos from './ListarBoletos';
import ConsultarBoleto from './ConsultarBoleto';
import GerarBoletoEnergia from './GerarBoletoEnergia';
import ControleEnergia from './ControleEnergia';
import SistemaFaturas from './SistemaFaturas';
import MicroservicosPanel from './MicroservicosPanel';
import DashboardFaturas from './DashboardFaturas';
import ControleMensal from './ControleMensal';
import PainelUGs from './PainelUGs';
import PagamentosConcessionaria from './PagamentosConcessionaria';

function AppContent() {
  const { isAuthenticated, login, logout, loading } = useAuth();
  const [activeTab, setActiveTab] = useState('dashboard');
  const [alert, setAlert] = useState(null);
  const [serverStatus, setServerStatus] = useState('Conectando...');
  const [theme, setTheme] = useState(() => {
    const savedTheme = localStorage.getItem('theme');
    return savedTheme || 'light';
  });

  // Aplicar tema ao body
  useEffect(() => {
    document.body.setAttribute('data-theme', theme);
    localStorage.setItem('theme', theme);
  }, [theme]);

  // Verificar status do servidor
  useEffect(() => {
    if (isAuthenticated) {
      fetch('/health')
        .then(() => setServerStatus('Online'))
        .catch(() => setServerStatus('Offline'));
    }
  }, [isAuthenticated]);

  // Auto-esconder alertas após 5 segundos
  useEffect(() => {
    if (alert) {
      const timer = setTimeout(() => setAlert(null), 5000);
      return () => clearTimeout(timer);
    }
  }, [alert]);

  const toggleTheme = () => {
    setTheme(prev => prev === 'light' ? 'dark' : 'light');
  };

  const showAlert = (message, type = 'info') => {
    setAlert({ message, type });
  };

  const handleBoletoCreated = (boleto) => {
    showAlert('Boleto criado com sucesso!', 'success');
  };

  const handleBoletoSelected = (boleto) => {
    console.log('Boleto selecionado:', boleto);
  };

  const handleLogout = () => {
    logout();
    setActiveTab('dashboard');
  };

  // Tela de carregamento
  if (loading) {
    return (
      <div className="loading-container">
        <div className="spinner"></div>
        <p className="mt-3">Carregando...</p>
      </div>
    );
  }

  // Se não está autenticado, mostrar tela de login
  if (!isAuthenticated) {
    return <Login onLoginSuccess={login} />;
  }

  // Usuário autenticado - mostrar aplicação
  return (
    <div className="app-container">
      <div className="main-container">
        {/* Header */}
        <header className="header">
          <div className="header-left">
            <div className="header-logo">
              <Building2 size={28} />
              <div>
                <h1>Banco do Brasil</h1>
                <p className="header-subtitle">Sistema de Geração de Boletos</p>
              </div>
            </div>
          </div>

          <div className="header-right">
            <button
              className="theme-toggle"
              onClick={toggleTheme}
              aria-label="Alternar tema"
            >
              {theme === 'light' ? <Moon size={20} /> : <Sun size={20} />}
            </button>

            <button
              className="logout-btn"
              onClick={handleLogout}
            >
              <LogOut size={18} />
              Sair
            </button>
          </div>
        </header>

        {/* Status Bar */}
        <div className="status-bar">
          <div className="status-item">
            <Server size={16} />
            <span>Servidor:</span>
            <strong className={serverStatus === 'Online' ? 'status-online' : 'status-offline'}>
              {serverStatus}
            </strong>
          </div>

          <div className="status-item">
            <User size={16} />
            <span>{localStorage.getItem('user_email')}</span>
          </div>

          <div className="status-item">
            <Clock size={16} />
            <span>{new Date().toLocaleString('pt-BR')}</span>
          </div>
        </div>

        {/* Alerts */}
        {alert && (
          <div style={{ padding: '0 2rem', paddingTop: '1rem' }}>
            <div className={`alert alert-${alert.type}`}>
              {alert.message}
            </div>
          </div>
        )}

        {/* Navigation Tabs */}
        <div className="nav-tabs-container">
          <nav className="nav-tabs-custom">
            <button
              className={`nav-tab ${activeTab === 'dashboard' ? 'active' : ''}`}
              onClick={() => setActiveTab('dashboard')}
            >
              <LayoutDashboard size={18} />
              Dashboard
            </button>

            <button
              className={`nav-tab ${activeTab === 'controle-mensal' ? 'active' : ''}`}
              onClick={() => setActiveTab('controle-mensal')}
            >
              <ClipboardList size={18} />
              Controle Mensal
            </button>

            <button
              className={`nav-tab ${activeTab === 'ugs' ? 'active' : ''}`}
              onClick={() => setActiveTab('ugs')}
            >
              <SunMedium size={18} />
              UGs
            </button>

            <button
              className={`nav-tab ${activeTab === 'energia' ? 'active' : ''}`}
              onClick={() => setActiveTab('energia')}
            >
              <Zap size={18} />
              Boletos de Energia
            </button>

            <button
              className={`nav-tab ${activeTab === 'listar' ? 'active' : ''}`}
              onClick={() => setActiveTab('listar')}
            >
              <List size={18} />
              Listar Boletos
            </button>

            <button
              className={`nav-tab ${activeTab === 'sistema' ? 'active' : ''}`}
              onClick={() => setActiveTab('sistema')}
            >
              <FolderOpen size={18} />
              Sistema
            </button>

            <button
              className={`nav-tab ${activeTab === 'microservicos' ? 'active' : ''}`}
              onClick={() => setActiveTab('microservicos')}
            >
              <Activity size={18} />
              Microserviços
            </button>

            <button
              className={`nav-tab ${activeTab === 'pagamentos' ? 'active' : ''}`}
              onClick={() => setActiveTab('pagamentos')}
            >
              <Database size={18} />
              Pagamentos EQTL
            </button>
          </nav>
        </div>

        {/* Tab Content */}
        <div className="tab-content">
          {activeTab === 'dashboard' && (
            <DashboardFaturas mostrarAlerta={showAlert} />
          )}

          {activeTab === 'controle-mensal' && (
            <ControleMensal mostrarAlerta={showAlert} />
          )}

          {activeTab === 'ugs' && (
            <PainelUGs mostrarAlerta={showAlert} />
          )}

          {activeTab === 'energia' && (
            <GerarBoletoEnergia mostrarAlerta={showAlert} />
          )}

          {activeTab === 'listar' && (
            <ListarBoletos onBoletoSelect={handleBoletoSelected} />
          )}

          {activeTab === 'sistema' && (
            <SistemaFaturas mostrarAlerta={showAlert} />
          )}

          {activeTab === 'microservicos' && (
            <MicroservicosPanel mostrarAlerta={showAlert} />
          )}

          {activeTab === 'pagamentos' && (
            <PagamentosConcessionaria mostrarAlerta={showAlert} />
          )}
        </div>
      </div>
    </div>
  );
}

function App() {
  return (
    <AuthProvider>
      <AppContent />
    </AuthProvider>
  );
}

export default App;
