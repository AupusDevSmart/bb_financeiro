// ========================================
// 📄 GERADOR DE PDF DE BOLETOS BANCO DO BRASIL
// ========================================

const { jsPDF } = require('jspdf');
const QRCode = require('qrcode');
const bwipjs = require('bwip-js');
const fs = require('fs');
const { CONFIG } = require('./config');

/**
 * Formatar valor para PDF com R$
 */
function formatarValorPDF(valor) {
    if (!valor && valor !== 0) return 'R$ 0,00';
    const numero = typeof valor === 'string' ? parseFloat(valor.replace(/[^\d,.-]/g, '').replace(',', '.')) : valor;
    if (isNaN(numero)) return 'R$ 0,00';
    return 'R$ ' + numero.toFixed(2).replace('.', ',').replace(/\B(?=(\d{3})+(?!\d))/g, '.');
}

/**
 * Formatar data para exibição
 */
function formatarData(data) {
    if (!data) return 'N/A';
    if (typeof data === 'string') {
        // DD.MM.YYYY ou DD/MM/YYYY
        if (data.match(/^\d{2}[./]\d{2}[./]\d{4}$/)) {
            return data.replace(/\./g, '/');
        }
        // YYYY-MM-DD
        if (data.match(/^\d{4}-\d{2}-\d{2}/)) {
            const [ano, mes, dia] = data.split('-');
            return `${dia}/${mes}/${ano}`;
        }
    }
    return data;
}

/**
 * Gera um PDF de boleto do Banco do Brasil com layout bonito
 * @param {Object} dadosBoleto - Dados completos do boleto
 * @returns {Promise<Buffer>} - Buffer do PDF gerado
 */
async function gerarPDFBoleto(dadosBoleto) {
    console.log('📄 Iniciando geração de PDF do boleto:', dadosBoleto.numeroTitulo || dadosBoleto.sequencial);
    console.log('📋 Campos do boleto recebido:', Object.keys(dadosBoleto));
    console.log('🔍 Campos relacionados a QR/PIX:', {
        qrCode: dadosBoleto.qrCode,
        textoQrCode: dadosBoleto.textoQrCode,
        qrcode: dadosBoleto.qrcode,
        pixCopiaECola: dadosBoleto.pixCopiaECola,
        codigoQrCode: dadosBoleto.codigoQrCode,
        textoCodigoQrCode: dadosBoleto.textoCodigoQrCode
    });

    // Detectar se é boleto de economia gerada (manual_cogeracao)
    const isEconomiaGerada = dadosBoleto.tipo_boleto === 'manual_cogeracao';
    if (isEconomiaGerada) {
        console.log('💰 Boleto de ECONOMIA GERADA detectado - layout simplificado');
    }

    try {
        // Criar novo PDF com compressão
        const doc = new jsPDF({
            orientation: 'portrait',
            unit: 'mm',
            format: 'a4',
            compress: true  // Ativa compressão do PDF
        });

        // Formatar dados
        const dados = formatarDadosParaPDF(dadosBoleto);

        // Adicionar conteúdo ao PDF
        let y = 5; // Posição Y inicial (reduzida margem superior)

        // ========== MARCA D'ÁGUA DE FUNDO (REMOVIDA) ==========
        // Marca d'água removida a pedido do usuário

        // ========== CABEÇALHO MODERNO (CORES AUPUS) ==========
        // Fundo branco limpo
        doc.setFillColor(255, 255, 255);
        doc.rect(0, 0, 210, 40, 'F');

        // Logo AUPUS no canto esquerdo (reduzido)
        // const logoPath = './public/imagens/logo_sf_1.jpeg';  Logo para fundo branco
        const logoPath = './public/imagens/logo_sf_3.png'; // Logo para fundo branco
        if (fs.existsSync(logoPath)) {
            try {
                const logoData = fs.readFileSync(logoPath).toString('base64');
                const logoBase64 = `data:image/jpeg;base64,${logoData}`;
                doc.addImage(logoBase64, 'JPEG', 15, y + 2, 40, 16);
            } catch (error) {
                console.warn('⚠️ Não foi possível carregar o logo:', error.message);
                // Fallback: nome da empresa
                doc.setTextColor(27, 31, 59); // Azul escuro AUPUS
                doc.setFontSize(14);
                doc.setFont('helvetica', 'bold');
                doc.text(CONFIG.beneficiario.nome, 17, y + 8);
            }
        } else {
            // Fallback: nome da empresa
            doc.setTextColor(27, 31, 59); // Azul escuro AUPUS
            doc.setFontSize(14);
            doc.setFont('helvetica', 'bold');
            doc.text(CONFIG.beneficiario.nome, 17, y + 8);
        }

        // Título do documento à direita
        doc.setTextColor(27, 31, 59); // Azul escuro AUPUS
        doc.setFontSize(16);
        doc.setFont('helvetica', 'bold');
        doc.text('BOLETO BANCÁRIO', 195, y + 9, { align: 'right' });

        // Banco do Brasil info
        doc.setFontSize(8);
        doc.setFont('helvetica', 'normal');
        doc.setTextColor(100, 100, 100);
        doc.text('Banco do Brasil | 001-9', 195, y + 15, { align: 'right' });

        // Linha verde (mesma cor do fundo "VOCÊ ECONOMIZOU:")
        doc.setDrawColor(0, 150, 0); // Verde RGB(0, 150, 0)
        doc.setLineWidth(1.2);
        doc.line(15, y + 21, 195, y + 21);

        // Número da fatura (Nosso Número - 8 dígitos) no cabeçalho - ESQUERDA
        const numeroTituloHeader = String(dadosBoleto.numeroTitulo || dados.numeroTitulo || '');
        const nossoNumeroHeader = numeroTituloHeader.length >= 8
            ? numeroTituloHeader.slice(-8)
            : numeroTituloHeader.padStart(8, '0');
        doc.setFontSize(9);
        doc.setFont('helvetica', 'bold');
        doc.setTextColor(27, 31, 59); // Azul escuro AUPUS
        doc.text(`Número da fatura: ${nossoNumeroHeader}`, 15, y + 25);

        // Informações de contato abaixo da linha - DIREITA
        doc.setFontSize(7);
        doc.setFont('helvetica', 'normal');
        doc.setTextColor(100, 100, 100);
        doc.text(`${CONFIG.beneficiario.telefone} | ${CONFIG.beneficiario.email}`, 195, y + 25, { align: 'right' });

        y = 38; // Reset Y após cabeçalho - mais compactado

        // ========== SEÇÃO DE DADOS DE ENERGIA (SE HOUVER E NÃO FOR ECONOMIA GERADA) ==========
        if (dadosBoleto.dadosEnergia && !isEconomiaGerada) {
            const de = dadosBoleto.dadosEnergia;

            // DEBUG: Verificar valores recebidos
            console.log('🔍 DEBUG PDF - Valores recebidos:', {
                valor_s_desconto: de.valor_s_desconto,
                valor_bandeira_com_desconto: de.valor_bandeira_com_desconto,
                valor_com_desconto: de.valor_com_desconto,
                valor_consorcio: de.valor_consorcio,
                valor_band_comp: de.valor_band_comp,
                valor_comp: de.valor_comp
            });

            // ========== BOX GRANDE: "VOCÊ IRÁ PAGAR APENAS" + VENCIMENTO ==========
            const boxPagamentoY = y - 2; // Reduzido espaçamento (era y)
            const boxPagamentoH = 22;

            // Box principal (esquerda) - "Você irá pagar apenas"
            doc.setFillColor(27, 31, 59); // Azul escuro
            doc.roundedRect(15, boxPagamentoY, 115, boxPagamentoH, 3, 3, 'F');

            doc.setFontSize(10);
            doc.setFont('helvetica', 'normal');
            doc.setTextColor(255, 255, 255);
            doc.text(isEconomiaGerada ? 'Valor da economia:' : 'Você irá pagar apenas:', 20, boxPagamentoY + 7);

            // Mostrar valor sem desconto riscado e valor com desconto ao lado
            const valorSDesconto = parseFloat(de.valor_s_desconto) || 0;
            const valorConsorcio = parseFloat(de.valor_consorcio) || 0;

            console.log('🔍 DEBUG PDF - Após parseFloat:', {
                valorSDesconto,
                valorConsorcio,
                condicaoIF: (valorSDesconto > 0 && valorSDesconto > valorConsorcio)
            });

            if (valorSDesconto > 0 && valorSDesconto > valorConsorcio) {
                // Valor SEM desconto (riscado) - este é o valor ORIGINAL maior
                doc.setFontSize(14);
                doc.setFont('helvetica', 'normal');
                doc.setTextColor(150, 150, 150); // Cinza
                const valorSemDesc = formatarValorPDF(valorSDesconto);
                doc.text(valorSemDesc, 20, boxPagamentoY + 16);

                // Linha riscando o valor
                const textWidth = doc.getTextWidth(valorSemDesc);
                doc.setDrawColor(150, 150, 150);
                doc.setLineWidth(0.5);
                doc.line(20, boxPagamentoY + 15, 20 + textWidth, boxPagamentoY + 15);

                // Valor COM desconto ao lado (grande e verde neon) - este é o valor que o cliente vai pagar
                doc.setFontSize(18);
                doc.setFont('helvetica', 'bold');
                doc.setTextColor(0, 255, 0); // Verde neon
                doc.text(formatarValorPDF(valorConsorcio), 20 + textWidth + 5, boxPagamentoY + 16);
            } else {
                // Se não houver desconto, apenas mostra o valor normal
                doc.setFontSize(18);
                doc.setFont('helvetica', 'bold');
                doc.setTextColor(0, 255, 0); // Verde neon
                doc.text(formatarValorPDF(valorConsorcio), 20, boxPagamentoY + 16);
            }

            // Box vencimento (direita)
            doc.setFillColor(27, 31, 59);
            doc.roundedRect(135, boxPagamentoY, 60, boxPagamentoH, 3, 3, 'F');

            doc.setFontSize(9);
            doc.setFont('helvetica', 'normal');
            doc.setTextColor(255, 255, 255);
            doc.text('Vencimento:', 140, boxPagamentoY + 7);

            doc.setFontSize(13);
            doc.setFont('helvetica', 'bold');
            doc.text(dados.dataVencimento || 'N/A', 140, boxPagamentoY + 16);

            y = boxPagamentoY + boxPagamentoH + 5;

            // Título da seção DETALHAMENTO
            doc.setFillColor(27, 31, 59); // Azul escuro AUPUS
            doc.rect(15, y, 180, 7, 'F');
            doc.setTextColor(255, 255, 255);
            doc.setFontSize(10);
            doc.setFont('helvetica', 'bold');
            doc.text('DETALHAMENTO DA FATURA DE ENERGIA - ARRENDAMENTO', 20, y + 5);
            y += 7; // Sem espaço após título - direto para faixa cinza

            // Informações de UC e Mês
            doc.setFillColor(245, 245, 245);
            doc.rect(15, y, 180, 7, 'F');
            doc.setTextColor(0, 0, 0);
            doc.setFontSize(9); // Aumentado de 8 para 9
            doc.setFont('helvetica', 'bold');
            doc.text(`UC: ${de.uc || 'N/A'}`, 20, y + 5);
            doc.text(`Mês de Referência: ${de.mes_referencia || 'N/A'}`, 105, y + 5);
            y += 10; // Espaço após UC/Mês

            // Layout limpo e moderno - lista com linhas alternadas
            const startX = 20;
            const labelX = 25;
            const valueX = 115;
            const lineHeight = 6; // Aumentado de 5 para 6

            // === CONSUMO ===
            doc.setFontSize(9);
            doc.setFont('helvetica', 'bold');
            doc.setTextColor(27, 31, 59);
            doc.text('CONSUMO DE ENERGIA', startX, y);
            y += 6;

            doc.setFontSize(9); // Aumentado de 8 para 9
            doc.setFont('helvetica', 'normal');
            doc.setTextColor(80, 80, 80);

            // Linha 1 - fundo cinza
            doc.setFillColor(250, 250, 250);
            doc.rect(15, y - 3, 180, lineHeight, 'F');
            doc.text('Consumo Compensado', labelX, y);
            doc.setFont('helvetica', 'bold');
            doc.setTextColor(0, 0, 0);
            doc.text(`${de.consumo_comp || '0'} kWh`, valueX, y);
            y += lineHeight;

            // Linha 2 - fundo branco
            doc.setFont('helvetica', 'normal');
            doc.setTextColor(80, 80, 80);
            doc.text('Consumo Não Compensado', labelX, y);
            doc.setFont('helvetica', 'bold');
            doc.setTextColor(0, 0, 0);
            doc.text(`${de.consumo_n_comp || '0'} kWh`, valueX, y);
            y += lineHeight;

            // Linha 3 - Total em destaque
            doc.setFillColor(245, 250, 255);
            doc.rect(15, y - 3, 180, lineHeight, 'F');
            doc.setFont('helvetica', 'bold');
            doc.setTextColor(0, 100, 200);
            doc.text('Total Consumo', labelX, y);
            doc.setFontSize(10); // Aumentado de 9 para 10
            doc.text(`${de.consumo || '0'} kWh`, valueX, y);
            y += 8;

            // === VALORES CONCESSIONÁRIA ===
            doc.setFontSize(9);
            doc.setFont('helvetica', 'bold');
            doc.setTextColor(27, 31, 59);
            doc.text('VALORES DA CONCESSIONÁRIA', startX, y);
            y += 6;

            doc.setFontSize(9); // Aumentado de 8 para 9
            doc.setFont('helvetica', 'normal');
            doc.setTextColor(80, 80, 80);

            // Energia Compensada com valor riscado e valor com desconto
            doc.setFillColor(250, 250, 250);
            doc.rect(15, y - 3, 180, lineHeight, 'F');
            doc.text('Energia Compensada', labelX, y);

            // Valor SEM desconto (riscado) se houver
            const valorComp = parseFloat(de.valor_comp) || 0;
            const valorComDesconto = parseFloat(de.valor_com_desconto) || 0;

            if (valorComDesconto > 0 && valorComp > valorComDesconto) {
                doc.setFont('helvetica', 'normal');
                doc.setTextColor(150, 150, 150);
                const valorSemDesc = formatarValorPDF(valorComp);
                doc.text(valorSemDesc, valueX, y);

                // Linha riscando
                const textWidth = doc.getTextWidth(valorSemDesc);
                doc.setDrawColor(150, 150, 150);
                doc.setLineWidth(0.3);
                doc.line(valueX, y - 1, valueX + textWidth, y - 1);

                // Valor COM desconto (verde)
                doc.setFont('helvetica', 'bold');
                doc.setTextColor(0, 150, 0);
                doc.text(formatarValorPDF(valorComDesconto), valueX + textWidth + 3, y);
            } else {
                doc.setFont('helvetica', 'bold');
                doc.setTextColor(0, 0, 0);
                doc.text(formatarValorPDF(valorComp), valueX, y);
            }
            y += lineHeight;

            // Bandeira Compensada com valor riscado e valor com desconto
            doc.setFont('helvetica', 'normal');
            doc.setTextColor(80, 80, 80);
            doc.text('Bandeira Compensada', labelX, y);

            // Valor SEM desconto (riscado) se houver
            const valorBandComp = parseFloat(de.valor_band_comp) || 0;
            const valorBandComDesconto = parseFloat(de.valor_bandeira_com_desconto) || 0;

            if (valorBandComDesconto > 0 && valorBandComp > valorBandComDesconto) {
                doc.setFont('helvetica', 'normal');
                doc.setTextColor(150, 150, 150);
                const valorSemDesc = formatarValorPDF(valorBandComp);
                doc.text(valorSemDesc, valueX, y);

                // Linha riscando
                const textWidth = doc.getTextWidth(valorSemDesc);
                doc.setDrawColor(150, 150, 150);
                doc.setLineWidth(0.3);
                doc.line(valueX, y - 1, valueX + textWidth, y - 1);

                // Valor COM desconto (verde)
                doc.setFont('helvetica', 'bold');
                doc.setTextColor(0, 150, 0);
                doc.text(formatarValorPDF(valorBandComDesconto), valueX + textWidth + 3, y);
            } else {
                doc.setFont('helvetica', 'bold');
                doc.setTextColor(0, 0, 0);
                doc.text(formatarValorPDF(valorBandComp), valueX, y);
            }
            y += 8;

            // === ITENS FINANCEIROS ===
            doc.setFontSize(9);
            doc.setFont('helvetica', 'bold');
            doc.setTextColor(27, 31, 59);
            doc.text('ITENS FINANCEIROS', startX, y);
            y += 6;

            doc.setFontSize(9); // Aumentado de 8 para 9
            doc.setFont('helvetica', 'normal');
            doc.setTextColor(80, 80, 80);

            // Valor Concessionária (usar tarifa_minima_concessionaria do DB)
            doc.setFillColor(250, 250, 250);
            doc.rect(15, y - 3, 180, lineHeight, 'F');
            doc.text('Valor Concessionária', labelX, y);
            doc.setFont('helvetica', 'bold');
            doc.setTextColor(200, 0, 0);
            doc.text(formatarValorPDF(de.tarifa_minima_concessionaria !== null && de.tarifa_minima_concessionaria !== undefined ? de.tarifa_minima_concessionaria : de.valor_concessionaria), valueX, y);
            y += lineHeight;

            // Valor AUPUS
            doc.setFont('helvetica', 'normal');
            doc.setTextColor(80, 80, 80);
            doc.text('Valor AUPUS', labelX, y);
            doc.setFont('helvetica', 'bold');
            doc.setTextColor(0, 150, 0);
            doc.text(formatarValorPDF(de.valor_aupus), valueX, y);
            y += lineHeight;

            // Abatimento (se houver) - com espaçamento reduzido
            if (de.valor_abatimento && parseFloat(de.valor_abatimento) > 0) {
                doc.setFont('helvetica', 'normal');
                doc.setTextColor(200, 0, 0);
                doc.text('Abatimento:', labelX, y);
                doc.setFont('helvetica', 'bold');
                doc.text('- ' + formatarValorPDF(de.valor_abatimento), valueX, y);
                y += lineHeight - 1; // Reduzido espaçamento

                // Motivo do abatimento (se houver)
                if (de.motivo_abatimento) {
                    doc.setFontSize(7);
                    doc.setFont('helvetica', 'italic');
                    doc.setTextColor(100, 100, 100);
                    const motivoTexto = String(de.motivo_abatimento).substring(0, 60);
                    doc.text(`Motivo: ${motivoTexto}`, labelX, y);
                    y += lineHeight - 2; // Reduzido espaçamento
                    doc.setFontSize(8);
                }
            }

            // Valor Boleto
            doc.setFillColor(245, 250, 255);
            doc.rect(15, y - 3, 180, lineHeight, 'F');
            doc.setFont('helvetica', 'bold');
            doc.setTextColor(0, 100, 200);
            doc.text('Valor Boleto', labelX, y);
            doc.setFontSize(10); // Aumentado de 9 para 10
            doc.text(formatarValorPDF(de.valor_consorcio), valueX, y);
            y += 6; // Reduzido de 8 para 6

            // === BOX VERDE: VOCÊ ECONOMIZOU ===
            // Usar valorEconomia do JSON (não calcular)
            const economiaValor = de.valorEconomia || de.valor_economia || 0;

            doc.setFillColor(0, 150, 0); // Mesmo tom verde dos descontos
            doc.roundedRect(15, y, 180, 10, 3, 3, 'F');

            doc.setFontSize(11);
            doc.setFont('helvetica', 'bold');
            doc.setTextColor(255, 255, 255);
            doc.text('VOCÊ ECONOMIZOU:', 20, y + 7);
            doc.text(formatarValorPDF(economiaValor), 175, y + 7, { align: 'right' });

            y += 13; // Espaço após box verde

            doc.setTextColor(0, 0, 0); // Reset cor
            doc.setFontSize(8); // Reset tamanho fonte

            // Linha separadora após economia
            doc.setDrawColor(200, 200, 200);
            doc.setLineWidth(0.5);
            doc.line(15, y, 195, y);
            y += 5; // Espaço reduzido após linha separadora
        }

        // ========== SEÇÃO ESPECIAL PARA ECONOMIA GERADA ==========
        if (isEconomiaGerada) {
            // Box de valor e vencimento simplificado
            const boxPagamentoY = y;
            const boxPagamentoH = 25;

            // Box principal (esquerda) - "Valor da economia"
            doc.setFillColor(27, 31, 59); // Azul escuro
            doc.roundedRect(15, boxPagamentoY, 115, boxPagamentoH, 3, 3, 'F');

            doc.setFontSize(10);
            doc.setFont('helvetica', 'normal');
            doc.setTextColor(255, 255, 255);
            doc.text('Valor da economia:', 20, boxPagamentoY + 8);

            // Valor grande em verde
            doc.setFontSize(20);
            doc.setFont('helvetica', 'bold');
            doc.setTextColor(0, 255, 0); // Verde neon
            doc.text(formatarValorPDF(dadosBoleto.valorBoleto || dadosBoleto.valor_boleto), 20, boxPagamentoY + 18);

            // Box vencimento (direita)
            doc.setFillColor(27, 31, 59);
            doc.roundedRect(135, boxPagamentoY, 60, boxPagamentoH, 3, 3, 'F');

            doc.setFontSize(9);
            doc.setFont('helvetica', 'normal');
            doc.setTextColor(255, 255, 255);
            doc.text('Vencimento:', 140, boxPagamentoY + 8);

            doc.setFontSize(14);
            doc.setFont('helvetica', 'bold');
            doc.text(dados.dataVencimento || 'N/A', 140, boxPagamentoY + 18);

            y = boxPagamentoY + boxPagamentoH + 10;

            // Indicador de economia gerada
            doc.setFillColor(23, 162, 184); // Azul info
            doc.roundedRect(15, y, 180, 12, 3, 3, 'F');

            doc.setFontSize(10);
            doc.setFont('helvetica', 'bold');
            doc.setTextColor(255, 255, 255);
            doc.text('BOLETO DE ECONOMIA GERADA', 105, y + 8, { align: 'center' });

            y += 20;
        }

        // ========== ESPAÇO EM BRANCO ==========
        // Se não houver dados de energia e não for economia gerada, mantém espaço original
        if (!dadosBoleto.dadosEnergia && !isEconomiaGerada) {
            y = 45 + 130; // Inicia conteúdo em 175mm do topo
        }

        // ========== SEÇÃO 1: PAGADOR (ESTILO BOLETO TRADICIONAL APERFEIÇOADO) ==========
        const startY = y;
        doc.setDrawColor(0, 0, 0);
        doc.setLineWidth(0.4);

        // Box externo
        const pagadorHeight = 27;
        doc.rect(15, y, 180, pagadorHeight);

        // Primeira linha: Pagador (Nome) | CPF/CNPJ
        doc.setFontSize(6);
        doc.setFont('helvetica', 'normal');
        doc.setTextColor(0, 0, 0);
        doc.text('Pagador', 17, y + 3.5);
        doc.text('CPF/CNPJ', 140, y + 3.5);

        doc.setFontSize(8);
        doc.setFont('helvetica', 'bold');
        doc.text(String(dados.pagadorNome || ''), 17, y + 8);
        doc.text(String(dados.pagadorDocumento || ''), 140, y + 8);

        // Linha vertical separando Nome e CPF/CNPJ
        doc.line(138, startY, 138, startY + 10);

        // Linha horizontal após primeira linha
        const linha1Y = startY + 10;
        doc.line(15, linha1Y, 195, linha1Y);

        // Segunda linha: Endereço (sozinho, sem divisória)
        doc.setFontSize(6);
        doc.setFont('helvetica', 'normal');
        doc.text('Endereço', 17, linha1Y + 3.5);

        doc.setFontSize(7.5);
        doc.setFont('helvetica', 'normal');
        // Quebrar endereço em múltiplas linhas se necessário (largura máxima: 195mm - 17mm = 178mm)
        const enderecoCompleto = String(dados.pagadorEndereco || '');
        const enderecoLinhas = doc.splitTextToSize(enderecoCompleto, 178);
        doc.text(enderecoLinhas, 17, linha1Y + 7.5);

        // Terceira linha: Cidade/UF | Bairro | CEP
        const linha2Y = startY + 19;
        doc.line(15, linha2Y, 195, linha2Y);

        doc.setFontSize(6);
        doc.setFont('helvetica', 'normal');
        doc.text('Cidade/UF', 17, linha2Y + 3.5);
        doc.text('Bairro', 85, linha2Y + 3.5);
        doc.text('CEP', 140, linha2Y + 3.5);

        doc.setFontSize(7.5);
        doc.text(String(`${dados.pagadorCidade || ''}-${dados.pagadorUF || ''}`), 17, linha2Y + 7);
        doc.text(String(dados.pagadorBairro || '').substring(0, 18), 85, linha2Y + 7);
        doc.text(String(dados.pagadorCEP || ''), 140, linha2Y + 7);

        // Linhas verticais: separando Cidade/UF e Bairro, e Bairro e CEP
        doc.line(83, linha2Y, 83, startY + pagadorHeight);
        doc.line(138, linha2Y, 138, startY + pagadorHeight);

        y = startY + pagadorHeight + 3;

        // ========== SEÇÃO 2: BENEFICIÁRIO (ESTILO BOLETO TRADICIONAL APERFEIÇOADO) ==========
        const benefStartY = y;
        doc.setDrawColor(0, 0, 0);
        doc.setLineWidth(0.4);

        // Box externo (reduzido de 36 para 29mm - removida quarta linha)
        const benefHeight = 29;
        doc.rect(15, y, 180, benefHeight);

        // Primeira linha: Beneficiário | CNPJ
        doc.setFontSize(6);
        doc.setFont('helvetica', 'normal');
        doc.setTextColor(0, 0, 0);
        doc.text('Beneficiário', 17, benefStartY + 3.5);
        doc.text('CNPJ', 140, benefStartY + 3.5);

        doc.setFontSize(8);
        doc.setFont('helvetica', 'bold');
        doc.text(String(dados.beneficiarioNome || ''), 17, benefStartY + 8);
        doc.text(String(dados.beneficiarioCNPJ || ''), 140, benefStartY + 8);

        // Linha horizontal (ajustada para não sobrepor texto)
        const benefLinha1Y = benefStartY + 10;
        doc.line(15, benefLinha1Y, 195, benefLinha1Y);

        // Segunda linha: Endereço
        doc.setFontSize(6);
        doc.setFont('helvetica', 'normal');
        doc.text('Endereço', 17, benefLinha1Y + 3.5);

        doc.setFontSize(7.5);
        doc.text(String(dados.beneficiarioEndereco || '').substring(0, 70), 17, benefLinha1Y + 7.5);

        // Terceira linha: Nº Documento | Nosso Número | Emissão | Vencimento | Valor
        const benefLinha2Y = benefStartY + 19;
        doc.line(15, benefLinha2Y, 195, benefLinha2Y);

        doc.setFontSize(6);
        doc.setFont('helvetica', 'normal');
        doc.text('Nº Documento', 17, benefLinha2Y + 3.5);
        doc.text('Nosso Número', 60, benefLinha2Y + 3.5);
        doc.text('Emissão', 100, benefLinha2Y + 3.5);
        doc.text('Vencimento', 130, benefLinha2Y + 3.5);
        doc.text('Valor', 165, benefLinha2Y + 3.5);

        // Nosso Número: pegar últimos 8 dígitos do número do boleto
        const numeroTitulo = String(dados.numeroTitulo || '');
        const nossoNumero = numeroTitulo.length >= 8
            ? numeroTitulo.slice(-8)
            : numeroTitulo.padStart(8, '0');

        doc.setFontSize(7);
        doc.setFont('helvetica', 'normal');
        doc.text(String(dados.numeroTitulo || ''), 17, benefLinha2Y + 7.5);
        doc.text(nossoNumero, 60, benefLinha2Y + 7.5);
        doc.text(String(dados.dataEmissao || ''), 100, benefLinha2Y + 7.5);
        doc.setTextColor(200, 0, 0);
        doc.setFont('helvetica', 'bold');
        doc.text(String(dados.dataVencimento || ''), 130, benefLinha2Y + 7.5);
        doc.setTextColor(0, 150, 0);
        doc.setFontSize(8);
        doc.text(String(dados.valorAtual || ''), 165, benefLinha2Y + 7.5);

        doc.setTextColor(0, 0, 0);

        // Linhas verticais separando campos (5 divisórias)
        doc.line(138, benefStartY, 138, benefLinha1Y);
        doc.line(58, benefLinha2Y, 58, benefStartY + benefHeight);
        doc.line(98, benefLinha2Y, 98, benefStartY + benefHeight);
        doc.line(128, benefLinha2Y, 128, benefStartY + benefHeight);
        doc.line(163, benefLinha2Y, 163, benefStartY + benefHeight);

        y = benefStartY + benefHeight + 3;

        // ========== SEÇÃO 3: LINHA DIGITÁVEL + CÓDIGO DE BARRAS + QR CODE ==========
        // Verificar se boleto foi liquidado (pago)
        // Códigos de estado: 1=Normal, 2=Movimento cartório, 3=Em cartório, 4=Título com ocorrência de cartório,
        // 5=Protestado eletronicamente, 6=Liquidado, 7=Baixado, 8=Título com pendência de cartório,
        // 9=Título protestado manual, 10=Título baixado/pago em cartório, 11=Título liquidado/baixado e não registrado,
        // 12=Título em liquidação, 13=Título agendado, 14=Título creditado, 15=Pago em cartório
        const codigoEstado = dadosBoleto.codigoEstadoTituloCobranca;
        const estadosLiquidados = [6, 10, 11, 12, 14, 15]; // Estados que indicam pagamento
        const boletoLiquidado = estadosLiquidados.includes(parseInt(codigoEstado));

        console.log('🔍 Verificando status do boleto:', {
            codigoEstado: codigoEstado,
            boletoLiquidado: boletoLiquidado
        });

        // Buscar QR Code em diferentes campos possíveis da API BB
        // Nota: BB API retorna campos com dot notation como 'qrCode.emv'
        const textoQRCode = dadosBoleto.qrCode?.emv  // Campo EMV direto no qrCode
            || dadosBoleto.qrCode?.txId
            || dadosBoleto.qrCode?.url
            || dadosBoleto.dadosPix?.['qrCode.emv']  // Campo EMV (PIX Copia e Cola)
            || dadosBoleto.dadosPix?.['qrCode.url']
            || dadosBoleto.dadosPix?.['qrCode.txId']
            || dadosBoleto.dadosPix?.qrcode
            || dadosBoleto.dadosPix?.emv
            || dadosBoleto.dadosPix?.txId
            || dadosBoleto.dadosPix?.url
            || dadosBoleto.qrCode?.qrcode
            || dadosBoleto.textoQrCode
            || dadosBoleto.qrcode
            || dadosBoleto.pixCopiaECola;

        console.log('🔍 Verificando QR Code:', {
            temQRCode: !!textoQRCode,
            textoQRCode: textoQRCode,
            dadosPix: dadosBoleto.dadosPix,
            campoQRCode: dadosBoleto.qrCode,
            textoQrCode: dadosBoleto.textoQrCode,
            qrcode: dadosBoleto.qrcode,
            pixCopiaECola: dadosBoleto.pixCopiaECola
        });

        // Empurrar seção de pagamento para baixo (próximo ao fim da página)
        // Página A4 tem 297mm de altura, deixando margem de ~20mm no final
        y = 230; // Posicionar com espaçamento adequado do fim

        // Variáveis para controlar o layout final
        let qrcodeBase64 = null;
        let barcodeBase64 = null;

        // Se boleto foi liquidado, não gerar QR Code nem código de barras
        if (boletoLiquidado) {
            console.log('💰 Boleto liquidado - exibindo status de pagamento');
        } else {
            // Gerar QR Code se disponível (tamanho reduzido)
            if (textoQRCode) {
                try {
                    console.log('📱 Gerando QR Code PIX...');
                    qrcodeBase64 = await gerarQRCodeBase64(textoQRCode);
                    console.log(qrcodeBase64 ? '✅ QR Code gerado' : '⚠️ QR Code falhou');
                } catch (error) {
                    console.error('❌ Erro ao gerar QR Code:', error.message);
                }
            }

            // Gerar código de barras se disponível (tamanho reduzido)
            if (dados.codigoBarras && dados.codigoBarras.length === 44) {
                try {
                    barcodeBase64 = await gerarCodigoBarrasBase64(dados.codigoBarras);
                } catch (error) {
                    console.warn('⚠️ Erro ao gerar código de barras:', error.message);
                }
            }
        }

        // Layout: Linha digitável + Código de barras (esquerda) + QR Code (extrema direita)
        const qrSize = 35; // QR Code fixo
        const qrX = 195 - qrSize; // Extrema direita (210mm - 15mm margem = 195mm)
        const barcodeWidth = qrX - 22; // Largura até onde começa o QR Code (com gap maior)
        const barcodeHeight = 25; // Altura maior para melhor legibilidade

        // Adicionar espaçamento do quadro de informações acima (descendo 8mm)
        const offsetY = 8;

        // Alinhar o FIM do código de barras com o FIM do QR Code
        // QR Code começa em y + offsetY
        const qrY = y + offsetY;
        // Barcode deve terminar onde o QR Code termina: barcodeY + barcodeHeight = qrY + qrSize
        // Portanto: barcodeY = qrY + qrSize - barcodeHeight
        const barcodeY = qrY + qrSize - barcodeHeight;

        // SE BOLETO LIQUIDADO: Exibir status de pagamento
        if (boletoLiquidado) {
            // Box verde grande com status de liquidado
            const liquidadoBoxY = qrY;
            const liquidadoBoxWidth = 180; // Largura total
            const liquidadoBoxHeight = 40;

            // Fundo verde claro
            doc.setFillColor(220, 255, 220); // Verde muito claro
            doc.roundedRect(15, liquidadoBoxY, liquidadoBoxWidth, liquidadoBoxHeight, 5, 5, 'F');

            // Borda verde escura
            doc.setDrawColor(0, 150, 0);
            doc.setLineWidth(2);
            doc.roundedRect(15, liquidadoBoxY, liquidadoBoxWidth, liquidadoBoxHeight, 5, 5, 'S');

            // Ícone de check - removido caractere especial para evitar problemas de encoding

            // Texto "BOLETO LIQUIDADO"
            doc.setTextColor(0, 150, 0);
            doc.setFontSize(20);
            doc.setFont('helvetica', 'bold');
            doc.text('BOLETO LIQUIDADO', 105, liquidadoBoxY + 18, { align: 'center' });

            // Subtexto
            doc.setFontSize(11);
            doc.setFont('helvetica', 'normal');
            doc.setTextColor(80, 80, 80);
            doc.text('Este boleto já foi pago', 105, liquidadoBoxY + 30, { align: 'center' });

            // Data de liquidação (se disponível)
            if (dadosBoleto.dataRecebimentoTitulo || dadosBoleto.dataLiquidacao) {
                const dataLiquidacao = formatarData(dadosBoleto.dataRecebimentoTitulo || dadosBoleto.dataLiquidacao);
                doc.setFontSize(9);
                doc.text(`Data do pagamento: ${dataLiquidacao}`, 105, liquidadoBoxY + 37, { align: 'center' });
            }

            doc.setTextColor(0, 0, 0);
        } else {
            // BOLETO NÃO LIQUIDADO: Exibir código de barras e QR Code normalmente

            // Código de barras (maior e mais legível)
            if (barcodeBase64) {
                doc.addImage(barcodeBase64, 'PNG', 15, barcodeY, barcodeWidth, barcodeHeight);
            }

            // Linha digitável ABAIXO do código de barras
            if (dados.linhaDigitavel) {
                doc.setTextColor(0, 0, 0);
                doc.setFontSize(10);
                doc.setFont('courier', 'bold');
                // Centralizar apenas na área do código de barras, abaixo da barra
                doc.text(dados.linhaDigitavel, 15 + (barcodeWidth / 2), barcodeY + barcodeHeight + 5, { align: 'center' });
            }

            // QR Code à extrema direita (alinhado com a barra)
            if (qrcodeBase64) {
                // QR Code (sem textos acima ou abaixo)
                doc.addImage(qrcodeBase64, 'PNG', qrX, qrY, qrSize, qrSize);

                // Código PIX Copia e Cola abaixo (espaçamento reduzido)
                if (textoQRCode) {
                    doc.setFontSize(6.5); // Aumentado de 5.5 para 6.5 para melhor legibilidade
                    doc.setTextColor(40, 40, 40); // Mais escuro para melhor contraste
                    doc.setFont('courier', 'normal');

                    // Quebrar o texto do PIX em múltiplas linhas (largura do QR Code)
                    const maxWidth = qrSize;
                    const lines = doc.splitTextToSize(textoQRCode, maxWidth);

                    // Limitar a 5 linhas para melhor legibilidade
                    const linesToShow = lines.slice(0, 5);
                    let textY = qrY + qrSize + 3; // Reduzido de 6 para 3mm

                    linesToShow.forEach((line) => {
                        doc.text(line, qrX + (qrSize / 2), textY, { align: 'center' });
                        textY += 2.5; // Espaçamento aumentado de 2 para 2.5
                    });

                    // Se tiver mais linhas, adicionar "..."
                    if (lines.length > 5) {
                        doc.text('...', qrX + (qrSize / 2), textY, { align: 'center' });
                    }
                }

                doc.setTextColor(0, 0, 0);
            }
        }

        // Retornar buffer do PDF
        const pdfBuffer = Buffer.from(doc.output('arraybuffer'));

        console.log(`✅ PDF gerado com sucesso - Tamanho: ${pdfBuffer.length} bytes`);
        return pdfBuffer;

    } catch (error) {
        console.error('❌ Erro ao gerar PDF:', error.message);
        console.error('Stack:', error.stack);
        throw error;
    }
}

/**
 * Formata dados do boleto para exibição no PDF
 */
function formatarDadosParaPDF(boleto) {
    // Formatar documento (CPF/CNPJ)
    const formatarDocumento = (numero, tipo) => {
        if (!numero) return 'N/A';
        const numStr = numero.toString().padStart(tipo === 1 ? 11 : 14, '0');
        if (tipo === 1) {
            // CPF
            return numStr.replace(/(\d{3})(\d{3})(\d{3})(\d{2})/, '$1.$2.$3-$4');
        } else {
            // CNPJ
            return numStr.replace(/(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})/, '$1.$2.$3/$4-$5');
        }
    };

    // Formatar valor
    const formatarValor = (valor) => {
        if (!valor && valor !== 0) return 'R$ 0,00';
        return `R$ ${parseFloat(valor).toFixed(2).replace('.', ',')}`;
    };

    // Formatar data
    const formatarData = (data) => {
        if (!data) return 'N/A';
        if (typeof data === 'string') {
            // DD.MM.YYYY ou DD/MM/YYYY
            if (data.match(/^\d{2}[./]\d{2}[./]\d{4}$/)) {
                return data.replace(/\./g, '/');
            }
            // YYYY-MM-DD
            if (data.match(/^\d{4}-\d{2}-\d{2}/)) {
                const [ano, mes, dia] = data.split('-');
                return `${dia}/${mes}/${ano}`;
            }
        }
        return data;
    };

    // Formatar linha digitável
    const formatarLinhaDigitavel = (linha) => {
        if (!linha) return '';
        const limpa = linha.replace(/\D/g, '');
        if (limpa.length === 47) {
            return `${limpa.substr(0,5)}.${limpa.substr(5,5)} ${limpa.substr(10,5)}.${limpa.substr(15,6)} ${limpa.substr(21,5)}.${limpa.substr(26,6)} ${limpa.substr(32,1)} ${limpa.substr(33,14)}`;
        }
        return linha;
    };

    // Primeira letra maiúscula
    const formatarNome = (texto) => {
        if (!texto || texto === 'N/A') return texto;
        return texto.toLowerCase().replace(/(?:^|\s)\S/g, letra => letra.toUpperCase());
    };

    // Formatar valor para PDF (sem símbolo R$)
    const formatarValorPDF = (valor) => {
        if (!valor && valor !== 0) return 'R$ 0,00';
        const numero = typeof valor === 'string' ? parseFloat(valor.replace(/[^\d,.-]/g, '').replace(',', '.')) : valor;
        if (isNaN(numero)) return 'R$ 0,00';
        return 'R$ ' + numero.toFixed(2).replace('.', ',').replace(/\B(?=(\d{3})+(?!\d))/g, '.');
    };

    return {
        // Dados do boleto - garantir que tudo seja string
        numeroTitulo: String(boleto.sequencial || boleto.numeroTitulo || boleto.numeroTituloCliente || 'N/A'),
        numeroBoletoBB: String(boleto.numeroBoletoBB || 'N/A'),
        valorOriginal: String(formatarValor(boleto.valorOriginal || boleto.valorOriginalTituloCobranca || 0)),
        valorAtual: String(formatarValor(boleto.valorAtual || boleto.valorAtualTituloCobranca || 0)),
        dataVencimento: String(formatarData(boleto.dataVencimento || boleto.dataVencimentoTituloCobranca) || 'N/A'),
        dataEmissao: String(formatarData(boleto.dataRegistro || boleto.dataRegistroTituloCobranca || boleto.dataEmissao) || 'N/A'),
        linhaDigitavel: String(formatarLinhaDigitavel(boleto.codigoLinhaDigitavel || boleto.linhaDigitavel || '') || ''),
        codigoBarras: String(boleto.textoCodigoBarrasTituloCobranca || boleto.codigoBarras || ''),

        // Dados do pagador
        pagadorNome: String(formatarNome(boleto.nomeSacadoCobranca || 'N/A')),
        pagadorDocumento: String(formatarDocumento(
            boleto.numeroInscricaoSacadoCobranca,
            boleto.codigoTipoInscricaoSacado
        )),
        // Para boletos de energia, pegar de dadosEnergia.endereco; senão de textoEnderecoSacadoCobranca
        pagadorEndereco: String(formatarNome(boleto.dadosEnergia?.endereco || boleto.pagador?.endereco || boleto.textoEnderecoSacadoCobranca || '') || ''),
        pagadorBairro: String(formatarNome(boleto.dadosEnergia?.bairro || boleto.pagador?.bairro || boleto.nomeBairroSacadoCobranca || '') || ''),
        pagadorCidade: String(formatarNome(boleto.dadosEnergia?.cidade || boleto.pagador?.cidade || boleto.nomeMunicipioSacadoCobranca || '') || ''),
        pagadorUF: String(boleto.dadosEnergia?.uf || boleto.pagador?.uf || boleto.siglaUnidadeFederacaoSacadoCobranca || ''),
        pagadorCEP: String(boleto.numeroCepSacadoCobranca || ''),

        // Dados do beneficiário (do config)
        beneficiarioNome: CONFIG.beneficiario.nome,
        beneficiarioCNPJ: CONFIG.beneficiario.cnpj,
        beneficiarioEndereco: CONFIG.beneficiario.endereco,
        beneficiarioCidade: CONFIG.beneficiario.cidade,
        beneficiarioUF: CONFIG.beneficiario.uf,
        beneficiarioCEP: CONFIG.beneficiario.cep,
        beneficiarioTelefone: CONFIG.beneficiario.telefone,
        beneficiarioEmail: CONFIG.beneficiario.email,
        beneficiarioSite: CONFIG.beneficiario.site,

        // Instruções
        instrucoes: [
            '- Multa de 2% após o vencimento',
            '- Juros de mora de 1% ao mês'
        ]
    };
}

/**
 * Gera código de barras em base64 usando bwip-js (Interleaved 2 of 5)
 */
async function gerarCodigoBarrasBase64(codigoBarras) {
    if (!codigoBarras || codigoBarras.length !== 44) {
        return null;
    }

    try {
        // Gerar código de barras Interleaved 2 of 5 (padrão para boletos)
        const png = await bwipjs.toBuffer({
            bcid: 'interleaved2of5',  // Barcode type
            text: codigoBarras,         // Text to encode
            scale: 2,                   // 2x scaling factor (reduzido de 3 para otimizar tamanho)
            height: 10,                 // Bar height reduzida de 15 para 10mm
            includetext: false,         // Don't show human-readable text
            textxalign: 'center',       // Always good to set this
        });

        // Converter buffer para base64
        return `data:image/png;base64,${png.toString('base64')}`;
    } catch (error) {
        console.warn('⚠️ Erro ao gerar código de barras:', error.message);
        return null;
    }
}

/**
 * Gera QR Code em base64 com alta qualidade
 */
async function gerarQRCodeBase64(textoQRCode) {
    if (!textoQRCode) {
        return null;
    }

    try {
        return await QRCode.toDataURL(textoQRCode, {
            errorCorrectionLevel: 'M',  // Média correção de erros (reduzido de H para otimizar)
            type: 'image/png',
            width: 200,                  // Resolução otimizada (reduzido de 400 para 200 - suficiente para 35mm)
            margin: 1,                   // Margem reduzida (de 2 para 1)
            color: {
                dark: '#000000',         // Preto puro
                light: '#FFFFFF'         // Branco puro
            }
        });
    } catch (error) {
        console.warn('⚠️ Erro ao gerar QR Code:', error.message);
        return null;
    }
}

/**
 * Gera um PDF de boleto de COGERAÇÃO com layout personalizado
 * @param {Object} dadosBoleto - Dados completos do boleto de cogeração
 * @returns {Promise<Buffer>} - Buffer do PDF gerado
 */
async function gerarPDFBoletoCogeracao(dadosBoleto) {
    console.log('📄 Gerando PDF de boleto de ECONOMIA GERADA');
    console.log('📋 Dados recebidos:', JSON.stringify(dadosBoleto, null, 2));

    try {
        const doc = new jsPDF({
            orientation: 'portrait',
            unit: 'mm',
            format: 'a4',
            compress: true
        });

        let y = 10;

        // ========== CABEÇALHO ==========
        // Logo AUPUS
        const logoPath = './public/imagens/logo_sf_3.png';
        if (fs.existsSync(logoPath)) {
            try {
                const logoData = fs.readFileSync(logoPath).toString('base64');
                const logoBase64 = `data:image/png;base64,${logoData}`;
                doc.addImage(logoBase64, 'PNG', 15, y, 40, 16);
            } catch (error) {
                console.warn('⚠️ Não foi possível carregar o logo:', error.message);
                doc.setTextColor(27, 31, 59);
                doc.setFontSize(14);
                doc.setFont('helvetica', 'bold');
                doc.text('AUPUS ENERGIA', 17, y + 8);
            }
        }

        // Título
        doc.setTextColor(27, 31, 59);
        doc.setFontSize(16);
        doc.setFont('helvetica', 'bold');
        doc.text('BOLETO - ECONOMIA GERADA', 195, y + 9, { align: 'right' });

        doc.setFontSize(8);
        doc.setFont('helvetica', 'normal');
        doc.setTextColor(100, 100, 100);
        doc.text('Banco do Brasil | 001-9', 195, y + 15, { align: 'right' });

        // Linha decorativa
        doc.setDrawColor(23, 162, 184); // Cor info (azul claro)
        doc.setLineWidth(1.2);
        doc.line(15, y + 21, 195, y + 21);

        y = 38;

        // Formatar data de vencimento corretamente
        let dataVencFormatada = 'N/A';
        if (dadosBoleto.dataVencimento || dadosBoleto.data_vencimento) {
            const dataVenc = dadosBoleto.dataVencimento || dadosBoleto.data_vencimento;
            // Se for formato YYYY-MM-DD
            if (dataVenc.match(/^\d{4}-\d{2}-\d{2}/)) {
                const [ano, mes, dia] = dataVenc.split('-');
                dataVencFormatada = `${dia}/${mes}/${ano}`;
            } else {
                dataVencFormatada = formatarData(dataVenc);
            }
        }

        // ========== BOX VALOR E VENCIMENTO ==========
        const boxY = y;
        const boxH = 25;

        // Box valor (esquerda)
        doc.setFillColor(23, 162, 184); // Azul info
        doc.roundedRect(15, boxY, 115, boxH, 3, 3, 'F');

        doc.setFontSize(10);
        doc.setFont('helvetica', 'normal');
        doc.setTextColor(255, 255, 255);
        doc.text('Economia Gerada - Valor a Pagar:', 20, boxY + 8);

        doc.setFontSize(22);
        doc.setFont('helvetica', 'bold');
        doc.text(formatarValorPDF(dadosBoleto.valorBoleto || dadosBoleto.valor_boleto), 20, boxY + 19);

        // Box vencimento (direita)
        doc.setFillColor(27, 31, 59);
        doc.roundedRect(135, boxY, 60, boxH, 3, 3, 'F');

        doc.setFontSize(9);
        doc.setFont('helvetica', 'normal');
        doc.setTextColor(255, 255, 255);
        doc.text('Vencimento:', 140, boxY + 8);

        doc.setFontSize(14);
        doc.setFont('helvetica', 'bold');
        doc.text(dataVencFormatada, 140, boxY + 18);

        y = boxY + boxH + 8;

        // ========== DADOS DO PAGADOR ==========
        doc.setFillColor(27, 31, 59);
        doc.rect(15, y, 180, 7, 'F');
        doc.setTextColor(255, 255, 255);
        doc.setFontSize(10);
        doc.setFont('helvetica', 'bold');
        doc.text('DADOS DO PAGADOR', 20, y + 5);
        y += 10;

        // Linhas de dados do pagador
        const dadosPagador = [
            { label: 'UC:', valor: dadosBoleto.uc || 'N/A' },
            { label: 'Nome:', valor: dadosBoleto.nome || dadosBoleto.nome_completo || 'N/A' },
            { label: 'CPF/CNPJ:', valor: formatarDocumento(dadosBoleto.documento || dadosBoleto.cpf_cnpj || 'N/A') },
            { label: 'Endereço:', valor: dadosBoleto.endereco || 'N/A' },
            { label: 'Bairro:', valor: dadosBoleto.bairro || 'N/A' },
            { label: 'Cidade/UF:', valor: `${dadosBoleto.cidade || 'N/A'} - ${dadosBoleto.uf || 'N/A'}` },
            { label: 'CEP:', valor: formatarCEP(dadosBoleto.cep || 'N/A') }
        ];

        doc.setFontSize(9);
        dadosPagador.forEach((item, idx) => {
            if (idx % 2 === 0) {
                doc.setFillColor(248, 249, 250);
                doc.rect(15, y - 3, 180, 6, 'F');
            }
            doc.setFont('helvetica', 'bold');
            doc.setTextColor(27, 31, 59);
            doc.text(item.label, 20, y);
            doc.setFont('helvetica', 'normal');
            doc.setTextColor(0, 0, 0);
            doc.text(item.valor, 50, y);
            y += 6;
        });

        y += 5;

        // ========== ECONOMIA GERADA (em destaque) ==========
        doc.setFillColor(23, 162, 184);
        doc.rect(15, y, 180, 7, 'F');
        doc.setTextColor(255, 255, 255);
        doc.setFontSize(10);
        doc.setFont('helvetica', 'bold');
        doc.text('ECONOMIA GERADA', 20, y + 5);
        y += 10;

        // Box com valor em destaque
        doc.setFillColor(227, 242, 253); // Azul claro
        doc.roundedRect(15, y, 180, 30, 3, 3, 'F');

        doc.setFontSize(12);
        doc.setFont('helvetica', 'normal');
        doc.setTextColor(100, 100, 100);
        doc.text('Valor da Economia Gerada', 105, y + 10, { align: 'center' });

        doc.setFontSize(24);
        doc.setFont('helvetica', 'bold');
        doc.setTextColor(23, 162, 184);
        doc.text(formatarValorPDF(dadosBoleto.valorBoleto || dadosBoleto.valor_boleto), 105, y + 23, { align: 'center' });

        y += 38;

        // ========== INSTRUÇÕES DE PAGAMENTO ==========
        doc.setFillColor(27, 31, 59);
        doc.rect(15, y, 180, 7, 'F');
        doc.setTextColor(255, 255, 255);
        doc.setFontSize(10);
        doc.setFont('helvetica', 'bold');
        doc.text('INSTRUÇÕES DE PAGAMENTO', 20, y + 5);
        y += 10;

        doc.setFontSize(8);
        doc.setFont('helvetica', 'normal');
        doc.setTextColor(0, 0, 0);
        const instrucoes = [
            '• Não receber após o vencimento.',
            '• Pagamento exclusivamente via PIX ou boleto bancário.',
            '• Em caso de dúvidas, entre em contato: financeiro@aupusenergia.com.br'
        ];
        instrucoes.forEach(instr => {
            doc.text(instr, 20, y);
            y += 5;
        });

        y += 5;

        // ========== QR CODE PIX (se disponível) ==========
        if (dadosBoleto.qrCode || dadosBoleto.textoQrCode || dadosBoleto.pixCopiaECola) {
            const textoQR = dadosBoleto.textoQrCode || dadosBoleto.qrCode || dadosBoleto.pixCopiaECola;

            doc.setFillColor(27, 31, 59);
            doc.rect(15, y, 180, 7, 'F');
            doc.setTextColor(255, 255, 255);
            doc.setFontSize(10);
            doc.setFont('helvetica', 'bold');
            doc.text('PAGUE COM PIX', 20, y + 5);
            y += 10;

            try {
                const qrCodeBase64 = await gerarQRCodeBase64(textoQR);
                if (qrCodeBase64) {
                    doc.addImage(qrCodeBase64, 'PNG', 80, y, 50, 50);
                    y += 55;

                    // Código Pix Copia e Cola (truncado)
                    doc.setFontSize(7);
                    doc.setFont('helvetica', 'normal');
                    doc.setTextColor(100, 100, 100);
                    const pixTruncado = textoQR.length > 80 ? textoQR.substring(0, 80) + '...' : textoQR;
                    doc.text('Pix Copia e Cola:', 20, y);
                    doc.text(pixTruncado, 20, y + 4);
                }
            } catch (error) {
                console.warn('⚠️ Erro ao gerar QR Code:', error.message);
            }
        }

        // ========== CÓDIGO DE BARRAS (se disponível) ==========
        if (dadosBoleto.linhaDigitavel || dadosBoleto.codigoBarras) {
            y += 15;

            doc.setFillColor(27, 31, 59);
            doc.rect(15, y, 180, 7, 'F');
            doc.setTextColor(255, 255, 255);
            doc.setFontSize(10);
            doc.setFont('helvetica', 'bold');
            doc.text('CÓDIGO DE BARRAS', 20, y + 5);
            y += 10;

            if (dadosBoleto.codigoBarras) {
                try {
                    const barcodeBase64 = await gerarCodigoBarrasBase64(dadosBoleto.codigoBarras);
                    if (barcodeBase64) {
                        doc.addImage(barcodeBase64, 'PNG', 15, y, 180, 15);
                        y += 18;
                    }
                } catch (error) {
                    console.warn('⚠️ Erro ao gerar código de barras:', error.message);
                }
            }

            if (dadosBoleto.linhaDigitavel) {
                doc.setFontSize(10);
                doc.setFont('courier', 'bold');
                doc.setTextColor(0, 0, 0);
                doc.text(dadosBoleto.linhaDigitavel, 105, y, { align: 'center' });
            }
        }

        // ========== AVISO - BOLETO MANUAL ==========
        y = 260;
        doc.setFillColor(255, 243, 205); // Amarelo claro (warning)
        doc.roundedRect(15, y, 180, 18, 2, 2, 'F');
        doc.setFontSize(8);
        doc.setFont('helvetica', 'bold');
        doc.setTextColor(133, 100, 4);
        doc.text('ATENÇÃO: Este é um boleto de Economia Gerada criado manualmente.', 105, y + 6, { align: 'center' });
        doc.setFont('helvetica', 'normal');
        doc.text('Para efetuar o pagamento, aguarde a geração do boleto registrado com código de barras e PIX.', 105, y + 12, { align: 'center' });

        // ========== RODAPÉ ==========
        doc.setFontSize(7);
        doc.setFont('helvetica', 'normal');
        doc.setTextColor(150, 150, 150);
        doc.text('AUPUS Energia - Documento gerado automaticamente', 105, 285, { align: 'center' });
        doc.text(`Gerado em: ${new Date().toLocaleString('pt-BR')}`, 105, 289, { align: 'center' });

        // Retornar buffer
        return Buffer.from(doc.output('arraybuffer'));

    } catch (error) {
        console.error('❌ Erro ao gerar PDF de economia gerada:', error);
        throw error;
    }
}

/**
 * Formata documento (CPF ou CNPJ)
 */
function formatarDocumento(doc) {
    if (!doc) return 'N/A';
    const numeros = doc.replace(/\D/g, '');
    if (numeros.length === 11) {
        return numeros.replace(/(\d{3})(\d{3})(\d{3})(\d{2})/, '$1.$2.$3-$4');
    } else if (numeros.length === 14) {
        return numeros.replace(/(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})/, '$1.$2.$3/$4-$5');
    }
    return doc;
}

/**
 * Formata CEP
 */
function formatarCEP(cep) {
    if (!cep) return 'N/A';
    const numeros = cep.replace(/\D/g, '');
    if (numeros.length === 8) {
        return numeros.replace(/(\d{5})(\d{3})/, '$1-$2');
    }
    return cep;
}

module.exports = {
    gerarPDFBoleto,
    gerarPDFBoletoCogeracao
};
