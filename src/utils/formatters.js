// Formatar CPF/CNPJ com leading zeros (APENAS NÚMEROS PARA API)
export const formatarCpfCnpj = (numero, tipo) => {
  if (!numero) return '';

  // Remove qualquer caractere não numérico
  let numeroStr = numero.toString().replace(/\D/g, '');

  if (tipo === 1) { // CPF
    return numeroStr.padStart(11, '0');
  } else if (tipo === 2) { // CNPJ
    return numeroStr.padStart(14, '0');
  }

  return numeroStr;
};

// Formatar primeira letra maiúscula (Title Case)
export const formatarPrimeiraMaiuscula = (texto) => {
  if (!texto || texto === 'N/A') return texto;
  return texto.toLowerCase().replace(/(?:^|\s)\S/g, letra => letra.toUpperCase());
};

// Remover acentos e caracteres especiais
export const removerAcentos = (texto) => {
  if (!texto) return texto;
  return texto
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '') // Remove diacríticos
    .replace(/º/g, 'o') // Substitui º por o
    .replace(/ª/g, 'a') // Substitui ª por a
    .replace(/[^\w\s,.-]/g, ''); // Remove outros caracteres especiais, mantendo letras, números, espaços, vírgula, ponto e hífen
};

// Formatar CEP (APENAS NÚMEROS PARA API - retorna INTEGER)
export const formatarCep = (cep) => {
  if (!cep) return 0;
  // Remove caracteres não numéricos e converte para integer
  const cepLimpo = cep.toString().replace(/\D/g, '');
  return parseInt(cepLimpo, 10);
};

// Formatar data de DD.MM.YYYY para YYYY-MM-DD
export const formatarDataParaInput = (data) => {
  if (!data) return '';
  const partes = data.split('.');
  if (partes.length === 3) {
    return `${partes[2]}-${partes[1]}-${partes[0]}`;
  }
  return data;
};

// Formatar data de YYYY-MM-DD para DD.MM.YYYY
export const formatarDataParaAPI = (data) => {
  if (!data) return '';
  const partes = data.split('-');
  if (partes.length === 3) {
    return `${partes[2]}.${partes[1]}.${partes[0]}`;
  }
  return data;
};

// Formatar valor monetário
export const formatarValor = (valor) => {
  if (!valor && valor !== 0) return 'R$ 0,00';
  return `R$ ${parseFloat(valor).toFixed(2).replace('.', ',')}`;
};

// Calcular data de multa (1 dia após vencimento, timezone-safe)
export const calcularDataMulta = (dataVencimento) => {
  const [ano, mes, dia] = dataVencimento.split('-').map(Number);
  const vencimentoDate = new Date(ano, mes - 1, dia);
  vencimentoDate.setDate(vencimentoDate.getDate() + 1);

  const diaMulta = String(vencimentoDate.getDate()).padStart(2, '0');
  const mesMulta = String(vencimentoDate.getMonth() + 1).padStart(2, '0');
  const anoMulta = vencimentoDate.getFullYear();

  return `${diaMulta}.${mesMulta}.${anoMulta}`;
};

// Adicionar dias a uma data
export const adicionarDias = (data, dias) => {
  if (!data) return '';
  const [ano, mes, dia] = data.split('-').map(Number);
  const dataObj = new Date(ano, mes - 1, dia);
  dataObj.setDate(dataObj.getDate() + dias);

  const diaFinal = String(dataObj.getDate()).padStart(2, '0');
  const mesFinal = String(dataObj.getMonth() + 1).padStart(2, '0');
  const anoFinal = dataObj.getFullYear();

  return `${diaFinal}.${mesFinal}.${anoFinal}`;
};

// Formatar data no formato DD/MM/YYYY
export const formatarData = (data) => {
  if (!data) return '';

  if (typeof data === 'string') {
    // Se já está no formato DD.MM.YYYY ou DD/MM/YYYY
    if (data.match(/^\d{2}[./]\d{2}[./]\d{4}$/)) {
      return data.replace(/\./g, '/');
    }

    // Se está no formato YYYY-MM-DD
    if (data.match(/^\d{4}-\d{2}-\d{2}/)) {
      const [ano, mes, dia] = data.split('-');
      return `${dia}/${mes}/${ano}`;
    }
  }

  if (data instanceof Date) {
    const dia = String(data.getDate()).padStart(2, '0');
    const mes = String(data.getMonth() + 1).padStart(2, '0');
    const ano = data.getFullYear();
    return `${dia}/${mes}/${ano}`;
  }

  return data;
};

// Formatar CPF com máscara
export const formatarCPFComMascara = (cpf) => {
  if (!cpf) return '';
  const cpfLimpo = cpf.toString().replace(/\D/g, '').padStart(11, '0');
  return cpfLimpo.replace(/(\d{3})(\d{3})(\d{3})(\d{2})/, '$1.$2.$3-$4');
};

// Formatar CNPJ com máscara
export const formatarCNPJComMascara = (cnpj) => {
  if (!cnpj) return '';
  const cnpjLimpo = cnpj.toString().replace(/\D/g, '').padStart(14, '0');
  return cnpjLimpo.replace(/(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})/, '$1.$2.$3/$4-$5');
};

// Formatar CEP com máscara
export const formatarCEPComMascara = (cep) => {
  if (!cep) return '';
  const cepLimpo = cep.toString().replace(/\D/g, '').padStart(8, '0');
  return cepLimpo.replace(/(\d{5})(\d{3})/, '$1-$2');
};
