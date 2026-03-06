#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Script para combinar PDFs: Fatura Original + Boleto Aupus
Adiciona marca d'água "PAGO" na fatura original
"""

import os
import sys
import json
from PIL import Image
from io import BytesIO
import PyPDF2
import fitz  # PyMuPDF

def adicionar_imagem_no_pdf(pdf_path, imagem_path):
    """Adiciona marca d'água PAGO em todas as páginas do PDF"""
    try:
        pdf_document = fitz.open(pdf_path)
        imagem = Image.open(imagem_path)

        for pagina_num in range(pdf_document.page_count):
            pagina = pdf_document[pagina_num]
            pdf_width, pdf_height = int(pagina.rect.width), int(pagina.rect.height)
            imagem_resized = imagem.resize((pdf_width, pdf_height), Image.LANCZOS)
            png_buffer = BytesIO()
            imagem_resized.save(png_buffer, format="PNG", optimize=True, quality=85)
            png_data = png_buffer.getvalue()
            imagem_rect = fitz.Rect(0, 0, pdf_width, pdf_height)
            pagina.insert_image(imagem_rect, stream=png_data, keep_proportion=False)

        return pdf_document
    except Exception as e:
        print(json.dumps({"error": f"Erro ao adicionar imagem: {str(e)}"}), file=sys.stderr)
        return None

def otimizar_pdf(pdf_document, output_path):
    """Otimiza PDF para reduzir tamanho"""
    try:
        pdf_document.save(output_path, garbage=4, deflate=True)
        pdf_document.close()
        return True
    except Exception as e:
        print(json.dumps({"error": f"Erro ao otimizar PDF: {str(e)}"}), file=sys.stderr)
        return False

def combinar_pdfs(pdf_files, output_path):
    """Combina múltiplos PDFs em um único arquivo"""
    try:
        pdf_writer = PyPDF2.PdfWriter()

        for pdf_file in pdf_files:
            if not os.path.exists(pdf_file):
                print(json.dumps({"error": f"Arquivo não encontrado: {pdf_file}"}), file=sys.stderr)
                return False

            with open(pdf_file, "rb") as f:
                pdf_reader = PyPDF2.PdfReader(f)
                for page_num in range(len(pdf_reader.pages)):
                    pdf_writer.add_page(pdf_reader.pages[page_num])

        with open(output_path, "wb") as output_pdf:
            pdf_writer.write(output_pdf)

        return True
    except Exception as e:
        print(json.dumps({"error": f"Erro ao combinar PDFs: {str(e)}"}), file=sys.stderr)
        return False

def extrair_uc_do_nome(arquivo):
    """
    Extrai o número da UC do nome do arquivo
    Exemplos:
    - 10676740_Nome.pdf -> 10676740
    - Boleto Aupus - 10676740 - Nome.pdf -> 10676740
    """
    import re
    match = re.search(r'(?:^|[\s\-_])(\d{8,11})(?:[\s\-_\.]|$)', arquivo)
    if match:
        return match.group(1)
    return None

def processar_boleto(uc, nome, mes_referencia, ano, boleto_path, imagem_path, temp_dir, output_dir):
    """
    Processa um boleto: busca fatura original, adiciona PAGO, combina com boleto

    Args:
        uc: Número da UC
        nome: Nome do cliente
        mes_referencia: Mês de referência (ex: "10.2025")
        ano: Ano (ex: "2025")
        boleto_path: Caminho do boleto Aupus já gerado
        imagem_path: Caminho da imagem PAGO.png
        temp_dir: Diretório temporário
        output_dir: Diretório de saída

    Returns:
        dict com {success: bool, output_path: str, error: str}
    """
    try:
        # 1. Buscar fatura original em arquivos (novo caminho microservicos)
        base_path = "/var/www/aupus-microservicos-faturas/dados"
        pasta_faturas = f"{base_path}/arquivos/{ano}/{mes_referencia}"

        # Tentar encontrar arquivo da fatura por UC (busca recursiva em subpastas)
        fatura_path = None
        if os.path.exists(pasta_faturas):
            # Primeiro tentar na pasta raiz
            for arquivo in os.listdir(pasta_faturas):
                arquivo_path = os.path.join(pasta_faturas, arquivo)
                if os.path.isfile(arquivo_path) and arquivo.endswith('.pdf'):
                    uc_arquivo = extrair_uc_do_nome(arquivo)
                    if uc_arquivo == str(uc):
                        fatura_path = arquivo_path
                        break

            # Se não encontrou, buscar nas subpastas (Grupo A, Grupo B, etc.)
            if not fatura_path:
                for subpasta in os.listdir(pasta_faturas):
                    subpasta_path = os.path.join(pasta_faturas, subpasta)
                    if os.path.isdir(subpasta_path):
                        for arquivo in os.listdir(subpasta_path):
                            if arquivo.endswith('.pdf'):
                                uc_arquivo = extrair_uc_do_nome(arquivo)
                                if uc_arquivo == str(uc):
                                    fatura_path = os.path.join(subpasta_path, arquivo)
                                    break
                    if fatura_path:
                        break

        if not fatura_path:
            return {
                "success": False,
                "error": f"Fatura original não encontrada para UC {uc} em {pasta_faturas}"
            }

        # 2. Adicionar marca d'água PAGO na fatura
        pdf_modificado = adicionar_imagem_no_pdf(fatura_path, imagem_path)
        if not pdf_modificado:
            return {
                "success": False,
                "error": f"Erro ao adicionar marca PAGO na fatura da UC {uc}"
            }

        pdf_modificado_path = os.path.join(temp_dir, f"{uc}_fatura_pago.pdf")
        pdf_modificado.save(pdf_modificado_path)
        pdf_modificado.close()

        # 3. Otimizar PDF com marca d'água
        pdf_modificado_otimizado_path = os.path.join(temp_dir, f"{uc}_fatura_pago_otimizado.pdf")
        if not otimizar_pdf(fitz.open(pdf_modificado_path), pdf_modificado_otimizado_path):
            return {
                "success": False,
                "error": f"Erro ao otimizar PDF da UC {uc}"
            }

        # 4. Criar pasta de saída se não existir
        os.makedirs(output_dir, exist_ok=True)

        # 5. Combinar: Boleto Aupus PRIMEIRO + Fatura com PAGO depois
        nome_arquivo_saida = f"Fatura AUPUS - {uc} - {nome}.pdf"
        output_path = os.path.join(output_dir, nome_arquivo_saida)

        if not combinar_pdfs([boleto_path, pdf_modificado_otimizado_path], output_path):
            return {
                "success": False,
                "error": f"Erro ao combinar PDFs da UC {uc}"
            }

        # 6. Limpar arquivos temporários
        try:
            os.remove(pdf_modificado_path)
            os.remove(pdf_modificado_otimizado_path)
        except:
            pass  # Ignorar erros de limpeza

        return {
            "success": True,
            "output_path": output_path,
            "filename": nome_arquivo_saida
        }

    except Exception as e:
        return {
            "success": False,
            "error": f"Erro ao processar UC {uc}: {str(e)}"
        }

def main():
    """
    Função principal - recebe JSON via stdin
    Formato esperado:
    {
        "uc": "12345678",
        "nome": "Cliente Nome",
        "mes_referencia": "10.2025",
        "ano": "2025",
        "boleto_path": "/path/to/boleto.pdf",
        "imagem_path": "/path/to/PAGO.png",
        "temp_dir": "/path/to/temp",
        "output_dir": "/path/to/output"
    }
    """
    try:
        # Ler JSON do stdin
        input_data = json.loads(sys.stdin.read())

        # Processar boleto
        result = processar_boleto(
            uc=input_data['uc'],
            nome=input_data['nome'],
            mes_referencia=input_data['mes_referencia'],
            ano=input_data['ano'],
            boleto_path=input_data['boleto_path'],
            imagem_path=input_data['imagem_path'],
            temp_dir=input_data['temp_dir'],
            output_dir=input_data['output_dir']
        )

        # Retornar resultado como JSON
        print(json.dumps(result))
        sys.exit(0 if result['success'] else 1)

    except Exception as e:
        print(json.dumps({"success": False, "error": str(e)}))
        sys.exit(1)

if __name__ == "__main__":
    main()
