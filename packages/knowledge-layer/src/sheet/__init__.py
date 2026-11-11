"""Reading a drawing sheet out of a PDF: its frame, linework, characters and stored scale regions.

Everything that touches PDFium or pdfminer for a sheet lives here. The values
that leave are plain (tuples, dicts, ``array`` columns): the measuring lives in
``agent.drawings`` and may not import this package's types.
"""
