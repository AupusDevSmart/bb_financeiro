# ⚡ Guia Rápido - Boletos BB React

## 🚀 Começar Agora

```bash
INICIAR.bat          # Duplo clique para iniciar
http://localhost:3001 # Abrir no navegador
PARAR.bat            # Duplo clique para parar
```

---

## 📋 Comandos Mais Usados

```bash
npm start            # Iniciar tudo
npm run client       # Só React
npm run server       # Só backend
npm install          # Instalar dependências
```

---

## 🔧 Resolver Problemas

### Porta em uso
```bash
PARAR.bat
INICIAR.bat
```

### Erro ao instalar
```bash
npm cache clean --force
rm -rf node_modules
npm install
```

### Frontend não atualiza
```
Ctrl + Shift + R (no navegador)
```

---

## 🌐 URLs

| URL | O que é |
|-----|---------|
| http://localhost:3001 | Interface React ✨ |
| http://localhost:3000 | Backend API |
| http://localhost:3000/health | Status |

---

## ⌨️ Atalhos VSCode

```
Ctrl + `         # Terminal
Ctrl + P         # Buscar arquivo
Ctrl + /         # Comentar
Shift + Alt + F  # Formatar
```

---

## 📦 Gerenciar Portas (Windows)

```bash
# Ver processos
netstat -ano | findstr :3000
netstat -ano | findstr :3001

# Matar processo
taskkill //F //PID <numero>
```

---

## 🐛 Troubleshooting

| Problema | Solução |
|----------|---------|
| Porta em uso | Execute `PARAR.bat` |
| Erro ao instalar | `npm cache clean --force && npm install` |
| Não atualiza | `Ctrl+Shift+R` no navegador |
| Módulo não encontrado | `npm install` |

---

## ✅ Checklist

- [ ] Executou `INICIAR.bat`?
- [ ] Aguardou 30 segundos?
- [ ] Abriu http://localhost:3001?
- [ ] Funcionou? 🎉

---

## 📞 Ajuda Rápida

**Não funciona?**
1. Execute `PARAR.bat`
2. Execute `INICIAR.bat`
3. Aguarde 30 segundos
4. Abra http://localhost:3001

**Ainda não funciona?**
```bash
npm cache clean --force
rm -rf node_modules
npm install
INICIAR.bat
```

---

**💡 Para mais detalhes, consulte [README.md](README.md)**
