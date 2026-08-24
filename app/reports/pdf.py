import io

from reportlab.lib import colors
from reportlab.lib.pagesizes import A4, landscape
from reportlab.lib.styles import getSampleStyleSheet
from reportlab.platypus import Paragraph, SimpleDocTemplate, Spacer, Table, TableStyle


def create_pdf_report(period, headings, values):
    output = io.BytesIO()
    document = SimpleDocTemplate(output, pagesize=landscape(A4), title="Отчёт посещаемости")
    styles = getSampleStyleSheet()
    table = Table([headings] + values, repeatRows=1)
    table.setStyle(TableStyle([
        ("BACKGROUND", (0, 0), (-1, 0), colors.HexColor("#1d67cf")),
        ("TEXTCOLOR", (0, 0), (-1, 0), colors.white),
        ("GRID", (0, 0), (-1, -1), .25, colors.HexColor("#d9e1ed")),
        ("FONTSIZE", (0, 0), (-1, -1), 7),
        ("VALIGN", (0, 0), (-1, -1), "MIDDLE"),
    ]))
    document.build([
        Paragraph(f"Отчёт посещаемости: {period}", styles["Title"]),
        Spacer(1, 12),
        table,
    ])
    return output.getvalue()
