import React, { createContext, useState, useContext, useEffect } from 'react';

const AuthContext = createContext();

export const useAuth = () => {
    const context = useContext(AuthContext);
    if (!context) {
        throw new Error('useAuth deve ser usado dentro de um AuthProvider');
    }
    return context;
};

export const AuthProvider = ({ children }) => {
    const [isAuthenticated, setIsAuthenticated] = useState(false);
    const [token, setToken] = useState(null);
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        // Verificar se há token salvo no localStorage
        const savedToken = localStorage.getItem('auth_token');
        if (savedToken) {
            setToken(savedToken);
            setIsAuthenticated(true);
        }
        setLoading(false);
    }, []);

    const login = (newToken) => {
        setToken(newToken);
        setIsAuthenticated(true);
        localStorage.setItem('auth_token', newToken);
    };

    const logout = () => {
        setToken(null);
        setIsAuthenticated(false);
        localStorage.removeItem('auth_token');
        localStorage.removeItem('user_email');
    };

    const value = {
        isAuthenticated,
        token,
        login,
        logout,
        loading
    };

    return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
};
