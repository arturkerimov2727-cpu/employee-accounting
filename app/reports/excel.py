import io

from openpyxl import Workbook


def create_excel_report(period, headings, values):
    workbook = Workbook()
    sheet = workbook.active
    sheet.title = "Посещаемость"
    sheet.append([f"Период: {period}"])
    sheet.append(headings)

    for value in values:
        sheet.append(value)

    for column in sheet.columns:
        width = max(len(str(cell.value or "")) for cell in column) + 2
        sheet.column_dimensions[column[0].column_letter].width = min(28, max(12, width))

    output = io.BytesIO()
    workbook.save(output)
    return output.getvalue()
