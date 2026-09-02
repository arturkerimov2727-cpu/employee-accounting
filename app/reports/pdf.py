import io
from pathlib import Path
from xml.sax.saxutils import escape

from reportlab.lib import colors
from reportlab.lib.pagesizes import A4, landscape
from reportlab.lib.styles import ParagraphStyle, getSampleStyleSheet
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont
from reportlab.platypus import Paragraph, SimpleDocTemplate, Spacer, Table, TableStyle


FONT_REGULAR = "AttendanceSans"
FONT_BOLD = "AttendanceSansBold"


def find_cyrillic_fonts():
    report_fonts = Path(__file__).resolve().parent / "fonts"
    candidates = [
        (report_fonts / "DejaVuSans.ttf", report_fonts / "DejaVuSans-Bold.ttf"),
        (Path("C:/Windows/Fonts/arial.ttf"), Path("C:/Windows/Fonts/arialbd.ttf")),
        (Path("/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf"), Path("/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf")),
        (Path("/usr/share/fonts/truetype/liberation2/LiberationSans-Regular.ttf"), Path("/usr/share/fonts/truetype/liberation2/LiberationSans-Bold.ttf")),
        (Path("/System/Library/Fonts/Supplemental/Arial.ttf"), Path("/System/Library/Fonts/Supplemental/Arial Bold.ttf")),
    ]
    for regular, bold in candidates:
        if regular.is_file() and bold.is_file():
            return regular, bold
    raise RuntimeError("Не найден системный шрифт с поддержкой кириллицы")


REGULAR_FONT_PATH, BOLD_FONT_PATH = find_cyrillic_fonts()
pdfmetrics.registerFont(TTFont(FONT_REGULAR, REGULAR_FONT_PATH))
pdfmetrics.registerFont(TTFont(FONT_BOLD, BOLD_FONT_PATH))


def create_pdf_report(period, headings, values):
    output = io.BytesIO()
    document = SimpleDocTemplate(output, pagesize=landscape(A4), title="Отчёт посещаемости")
    styles = getSampleStyleSheet()
    title_style = styles["Title"].clone("AttendanceTitle")
    title_style.fontName = FONT_BOLD
    heading_style = ParagraphStyle(
        "AttendanceHeading",
        fontName=FONT_BOLD,
        fontSize=7,
        leading=9,
        textColor=colors.white,
        alignment=1,
    )
    cell_style = ParagraphStyle(
        "AttendanceCell",
        fontName=FONT_REGULAR,
        fontSize=7,
        leading=9,
    )
    table_data = [
        [Paragraph(escape(str(value)), heading_style) for value in headings],
        *[
            [Paragraph(escape(str(value)), cell_style) for value in row]
            for row in values
        ],
    ]
    table = Table(
        table_data,
        repeatRows=1,
        colWidths=[120, 88, 43, 67, 57, 69, 67, 60, 60],
    )
    table.setStyle(TableStyle([
        ("BACKGROUND", (0, 0), (-1, 0), colors.HexColor("#1d67cf")),
        ("TEXTCOLOR", (0, 0), (-1, 0), colors.white),
        ("GRID", (0, 0), (-1, -1), .25, colors.HexColor("#d9e1ed")),
        ("VALIGN", (0, 0), (-1, -1), "MIDDLE"),
        ("LEFTPADDING", (0, 0), (-1, -1), 4),
        ("RIGHTPADDING", (0, 0), (-1, -1), 4),
    ]))
    document.build([
        Paragraph(f"Отчёт посещаемости: {escape(period)}", title_style),
        Spacer(1, 12),
        table,
    ])
    return output.getvalue()
