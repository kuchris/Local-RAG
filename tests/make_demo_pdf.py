"""Generate a fictional PDF fixture; no user documents are required."""
from pathlib import Path
import sys

from reportlab.pdfgen import canvas


def make_demo_pdf(path):
    doc = canvas.Canvas(str(path))
    doc.setTitle('Fictional timer experiment')
    doc.setAuthor('Local RAG test fixture')
    doc.setFont('Helvetica', 16)
    doc.drawString(50, 760, 'Fictional timer experiment')
    doc.setFont('Helvetica', 12)
    for y, line in zip(range(720, 600, -24), [
        'This is an invented test document, not a real experiment.',
        'The measured delay of Timer A was 7.4 +/- 0.3 milliseconds.',
        'The measured delay of Timer B was 12.8 +/- 0.5 milliseconds.',
        'These uncertainties belong to their respective timers.',
    ]):
        doc.drawString(50, y, line)
    doc.showPage()
    doc.drawString(50, 760, 'Method: read each fictional timer after pressing its start button.')
    doc.drawString(50, 730, 'No other timers or measurements were tested.')
    doc.save()


if __name__ == '__main__':
    make_demo_pdf(Path(sys.argv[1]))
