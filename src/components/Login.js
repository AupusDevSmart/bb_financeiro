import React, { useState } from 'react';
import { Building2, Mail, Lock, AlertCircle, Loader } from 'lucide-react';
import axios from 'axios';

const API_URL = process.env.REACT_APP_API_URL || 'http://localhost:3001';

function Login({ onLoginSuccess }) {
    const [email, setEmail] = useState('');
    const [senha, setSenha] = useState('');
    const [erro, setErro] = useState('');
    const [carregando, setCarregando] = useState(false);

    const handleSubmit = async (e) => {
        e.preventDefault();
        setErro('');
        setCarregando(true);

        try {
            const response = await axios.post(`${API_URL}/api/login`, {
                email,
                senha
            });

            if (response.data.success) {
                localStorage.setItem('auth_token', response.data.token);
                localStorage.setItem('user_email', email);
                onLoginSuccess(response.data.token);
            }
        } catch (error) {
            console.error('Erro no login:', error);
            setErro(error.response?.data?.message || 'Erro ao fazer login. Verifique suas credenciais.');
        } finally {
            setCarregando(false);
        }
    };

    return (
        <div className="loading-container">
            <div style={{
                width: '100%',
                maxWidth: '420px',
                padding: '2rem'
            }}>
                <div className="card">
                    <div className="card-body" style={{ padding: '2.5rem' }}>
                        {/* Logo e Título */}
                        <div style={{
                            textAlign: 'center',
                            marginBottom: '2rem'
                        }}>
                            <div style={{
                                display: 'inline-flex',
                                alignItems: 'center',
                                justifyContent: 'center',
                                width: '64px',
                                height: '64px',
                                background: 'var(--bb-blue)',
                                borderRadius: '12px',
                                marginBottom: '1rem'
                            }}>
                                <Building2 size={32} color="white" />
                            </div>
                            <h2 style={{
                                fontSize: '1.5rem',
                                fontWeight: '700',
                                marginBottom: '0.5rem'
                            }}>
                                Banco do Brasil
                            </h2>
                            <p style={{
                                color: 'var(--text-secondary)',
                                fontSize: '0.9rem',
                                margin: 0
                            }}>
                                Gerador de Boletos v3.0
                            </p>
                        </div>

                        {/* Erro */}
                        {erro && (
                            <div className="alert alert-danger" style={{ marginBottom: '1.5rem' }}>
                                <AlertCircle size={18} />
                                <span>{erro}</span>
                            </div>
                        )}

                        {/* Formulário */}
                        <form onSubmit={handleSubmit}>
                            <div style={{ marginBottom: '1.25rem' }}>
                                <label className="form-label">
                                    <Mail size={16} style={{ marginRight: '0.5rem', verticalAlign: 'middle' }} />
                                    Email
                                </label>
                                <input
                                    type="email"
                                    className="form-control"
                                    placeholder="seu@email.com"
                                    value={email}
                                    onChange={(e) => setEmail(e.target.value)}
                                    required
                                    disabled={carregando}
                                    autoComplete="username"
                                    style={{ paddingLeft: '1rem' }}
                                />
                            </div>

                            <div style={{ marginBottom: '1.5rem' }}>
                                <label className="form-label">
                                    <Lock size={16} style={{ marginRight: '0.5rem', verticalAlign: 'middle' }} />
                                    Senha
                                </label>
                                <input
                                    type="password"
                                    className="form-control"
                                    placeholder="Digite sua senha"
                                    value={senha}
                                    onChange={(e) => setSenha(e.target.value)}
                                    required
                                    disabled={carregando}
                                    autoComplete="current-password"
                                    style={{ paddingLeft: '1rem' }}
                                />
                            </div>

                            <button
                                type="submit"
                                className="btn btn-primary w-100"
                                disabled={carregando}
                                style={{
                                    padding: '0.875rem',
                                    fontSize: '1rem',
                                    fontWeight: '600'
                                }}
                            >
                                {carregando ? (
                                    <>
                                        <Loader size={18} style={{ animation: 'spin 1s linear infinite' }} />
                                        Entrando...
                                    </>
                                ) : (
                                    'Entrar'
                                )}
                            </button>
                        </form>

                        {/* Footer */}
                        <div style={{
                            marginTop: '2rem',
                            paddingTop: '1.5rem',
                            borderTop: '1px solid var(--border-color)',
                            textAlign: 'center',
                            color: 'var(--text-secondary)',
                            fontSize: '0.85rem'
                        }}>
                            <p style={{ margin: 0 }}>Sistema de Geração de Boletos</p>
                            <p style={{ margin: '0.25rem 0 0 0' }}>Aupus Energia</p>
                        </div>
                    </div>
                </div>
            </div>
        </div>
    );
}

export default Login;
