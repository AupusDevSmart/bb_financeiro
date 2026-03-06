#!/usr/bin/env python3
"""Gera PDF estilizado a partir do markdown de documentação."""

import markdown
import sys
import os

def gerar_html(md_path):
    with open(md_path, 'r', encoding='utf-8') as f:
        md_content = f.read()

    # Converter markdown para HTML
    html_body = markdown.markdown(md_content, extensions=['tables', 'fenced_code'])

    # Extrair título (primeiro h1)
    titulo = "Documentação"
    for line in md_content.split('\n'):
        if line.startswith('# '):
            titulo = line[2:].strip()
            break

    html = f"""<!DOCTYPE html>
<html lang="pt-BR">
<head>
<meta charset="UTF-8">
<style>
@page {{
    size: A4;
    margin: 0;
}}
@page content {{
    margin: 2.5cm 2.5cm 2.5cm 2.5cm;
    @top-left {{
        content: "AUPUS Energia Solar";
        font-family: 'DejaVu Sans', sans-serif;
        font-size: 8.5pt;
        font-weight: bold;
        color: #455A64;
        border-bottom: 2px solid #2E7D32;
        padding-bottom: 6px;
    }}
    @top-right {{
        content: "Documentação API-BB";
        font-family: 'DejaVu Sans', sans-serif;
        font-size: 8.5pt;
        color: #78909C;
        border-bottom: 2px solid #2E7D32;
        padding-bottom: 6px;
    }}
    @bottom-center {{
        content: counter(page);
        font-family: 'DejaVu Sans', sans-serif;
        font-size: 9pt;
        color: #90A4AE;
    }}
}}

/* ===== CAPA ===== */
.cover {{
    page: cover;
    width: 100%;
    height: 100vh;
    position: relative;
    font-family: 'DejaVu Sans', sans-serif;
    page-break-after: always;
}}
.cover-header {{
    background: linear-gradient(135deg, #1B5E20 0%, #2E7D32 40%, #388E3C 100%);
    height: 280px;
    padding: 80px 60px 40px 60px;
    position: relative;
}}
.cover-header::after {{
    content: '';
    display: block;
    height: 6px;
    background: #1B5E20;
    position: absolute;
    bottom: 0;
    left: 0;
    right: 0;
}}
.cover-title {{
    font-size: 38pt;
    font-weight: bold;
    color: white;
    margin: 0;
    line-height: 1.1;
    letter-spacing: -0.5px;
}}
.cover-subtitle {{
    font-size: 14pt;
    color: rgba(255,255,255,0.85);
    margin-top: 12px;
}}
.cover-tagline {{
    font-size: 11pt;
    color: rgba(255,255,255,0.6);
    margin-top: 6px;
}}
.cover-info {{
    margin: 80px 60px 0 60px;
    border-left: 4px solid #2E7D32;
    padding: 20px 24px;
    background: #FAFAFA;
    border-radius: 0 6px 6px 0;
}}
.cover-info table {{
    border-collapse: collapse;
    font-size: 11pt;
}}
.cover-info td {{
    padding: 8px 0;
    vertical-align: top;
}}
.cover-info td:first-child {{
    font-weight: bold;
    color: #616161;
    padding-right: 24px;
    white-space: nowrap;
}}
.cover-info td:last-child {{
    color: #212121;
}}
.cover-footer {{
    position: absolute;
    bottom: 60px;
    left: 60px;
    right: 60px;
}}
.cover-footer-line {{
    height: 1px;
    background: #E0E0E0;
    margin-bottom: 10px;
}}
.cover-footer-text {{
    font-size: 9pt;
    color: #9E9E9E;
}}
.cover-accent {{
    position: absolute;
    bottom: 0;
    left: 0;
    right: 0;
    height: 8px;
    background: #2E7D32;
}}

/* ===== CONTEÚDO ===== */
.content {{
    page: content;
    font-family: 'DejaVu Sans', sans-serif;
    font-size: 10pt;
    color: #212121;
    line-height: 1.55;
}}

/* Títulos */
.content h1 {{
    font-size: 22pt;
    color: #1B5E20;
    margin-top: 0;
    margin-bottom: 8px;
    padding-bottom: 8px;
    border-bottom: 3px solid #2E7D32;
    page-break-after: avoid;
}}
.content h2 {{
    font-size: 15pt;
    color: #1565C0;
    margin-top: 28px;
    margin-bottom: 6px;
    padding-bottom: 5px;
    border-bottom: 1.5px solid rgba(21,101,192,0.2);
    page-break-after: avoid;
}}
.content h3 {{
    font-size: 11.5pt;
    color: #37474F;
    margin-top: 22px;
    margin-bottom: 4px;
    padding: 7px 14px;
    background: #ECEFF1;
    border-left: 4px solid #2E7D32;
    border-radius: 0 4px 4px 0;
    page-break-after: avoid;
    page-break-inside: avoid;
}}
/* Evitar quebra de card: h3 + ul + p ficam juntos */
.content h3 + ul {{
    page-break-before: avoid;
}}
.content h3 + ul + p {{
    page-break-before: avoid;
}}
.content h3 + p {{
    page-break-before: avoid;
}}

/* Parágrafos */
.content p {{
    margin: 8px 0;
}}

/* Primeiro parágrafo após lista = explicação do card */
.content ul + p {{
    color: #455A64;
    font-style: italic;
    margin: 6px 0 16px 0;
    padding-left: 4px;
    border-left: 2px solid #C8E6C9;
    padding: 4px 0 4px 10px;
}}

/* Listas */
.content ul {{
    margin: 6px 0;
    padding-left: 18px;
}}
.content li {{
    margin: 3px 0;
    padding-left: 4px;
}}
.content li::marker {{
    color: #43A047;
}}

/* Código inline */
.content code {{
    font-family: 'DejaVu Sans Mono', monospace;
    font-size: 8.5pt;
    background: #F5F5F5;
    border: 1px solid #E0E0E0;
    border-radius: 3px;
    padding: 1px 5px;
    color: #C62828;
}}

/* Bold labels nas listas */
.content strong {{
    color: #1B5E20;
}}

/* Separador visual entre h2 sections */
.content h2 + h3 {{
    margin-top: 14px;
}}

/* Tabelas */
.content table {{
    width: 100%;
    border-collapse: collapse;
    margin: 16px 0;
    font-size: 8.5pt;
    page-break-inside: avoid;
}}
.content thead th {{
    background: #2E7D32;
    color: white;
    font-weight: bold;
    padding: 10px 10px;
    text-align: left;
    border: none;
}}
.content thead th:first-child {{
    border-radius: 6px 0 0 0;
}}
.content thead th:last-child {{
    border-radius: 0 6px 0 0;
}}
.content tbody td {{
    padding: 8px 10px;
    border-bottom: 1px solid #E8F5E9;
    vertical-align: top;
}}
.content tbody tr:nth-child(even) {{
    background: #F1F8E9;
}}
.content tbody tr:nth-child(odd) {{
    background: white;
}}
.content tbody tr:hover {{
    background: #DCEDC8;
}}
.content tbody tr:last-child td:first-child {{
    border-radius: 0 0 0 6px;
}}
.content tbody tr:last-child td:last-child {{
    border-radius: 0 0 6px 0;
}}
</style>
</head>
<body>

<!-- CAPA -->
<div class="cover">
    <div class="cover-header">
        <div class="cover-title">{titulo}</div>
        <div class="cover-subtitle">AUPUS Energia Solar</div>
        <div class="cover-tagline">Sistema de Gestão de Faturas e Boletos</div>
    </div>
    <div class="cover-info">
        <table>
            <tr><td>Sistema</td><td>API-BB</td></tr>
            <tr><td>Componente</td><td>DashboardFaturas.js</td></tr>
            <tr><td>Tipo</td><td>Documentação Técnica</td></tr>
            <tr><td>Data</td><td>26 de fevereiro de 2026</td></tr>
        </table>
    </div>
    <div class="cover-footer">
        <div class="cover-footer-line"></div>
        <div class="cover-footer-text">Documento interno — Gerado automaticamente</div>
    </div>
    <div class="cover-accent"></div>
</div>

<!-- CONTEÚDO -->
<div class="content">
{html_body}
</div>

</body>
</html>"""
    return html


def main():
    md_path = sys.argv[1] if len(sys.argv) > 1 else '/var/www/api-bb/docs/01-dashboard.md'
    pdf_path = md_path.replace('.md', '.pdf')
    html_path = md_path.replace('.md', '.html')

    # Gerar HTML
    html = gerar_html(md_path)

    # Salvar HTML (para debug)
    with open(html_path, 'w', encoding='utf-8') as f:
        f.write(html)

    # Converter para PDF
    from weasyprint import HTML
    HTML(string=html, base_url=os.path.dirname(md_path)).write_pdf(pdf_path)

    print(f"PDF gerado: {pdf_path}")
    print(f"HTML salvo: {html_path}")


if __name__ == '__main__':
    main()
