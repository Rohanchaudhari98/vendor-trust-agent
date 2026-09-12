"""Unit + API tests for invoice PDF field extraction."""

from __future__ import annotations

from pathlib import Path

from backend.invoice_extract import extract_invoice_fields, parse_invoice_fields

DEMO_DIR = Path.home() / "Downloads"
HOLD_PDF = DEMO_DIR / "Invoice_PG_HOLD_Dallas_48500.pdf"
PAY_PDF = DEMO_DIR / "Invoice_PG_PAY_Cincinnati_48500.pdf"

LABELED = """
SAMPLE / DEMO INVOICE
Type into Vendor Trust
Vendor name: Procter & Gamble
Address: 500 Commerce Street, Suite 200, Dallas, TX 75201
Invoice amount: 48500
"""

FALLBACK = """
ACME SUPPLIES INVOICE
Bill To Remit Payment To
PAR Apparel LLC Acme Supplies — Remittance
Accounts Payable 100 Main Street
Cincinnati, OH 45202
Line items
Total due: $12,345.67 USD
"""


def test_parse_labeled_demo_block():
    fields = parse_invoice_fields(LABELED)
    assert fields.vendor_name == "Procter & Gamble"
    assert fields.address == "500 Commerce Street, Suite 200, Dallas, TX 75201"
    assert fields.invoice_amount == 48500.0


def test_parse_fallback_heuristics():
    fields = parse_invoice_fields(FALLBACK)
    assert fields.vendor_name == "Acme Supplies"
    assert fields.address is not None
    assert "100 Main Street" in fields.address
    assert fields.invoice_amount == 12345.67


def test_extract_demo_hold_pdf():
    if not HOLD_PDF.exists():
        return
    fields = extract_invoice_fields(HOLD_PDF.read_bytes())
    assert fields.vendor_name == "Procter & Gamble"
    assert "Dallas" in (fields.address or "")
    assert fields.invoice_amount == 48500.0


def test_extract_demo_pay_pdf():
    if not PAY_PDF.exists():
        return
    fields = extract_invoice_fields(PAY_PDF.read_bytes())
    assert fields.vendor_name == "Procter & Gamble"
    assert "Cincinnati" in (fields.address or "")
    assert fields.invoice_amount == 48500.0


def test_extract_endpoint(client, tmp_path):
    # Minimal labeled PDF via pdfplumber-writable text PDF is hard without
    # reportlab; exercise API with real demo PDF when present, else skip body.
    if not HOLD_PDF.exists():
        return
    with HOLD_PDF.open("rb") as fh:
        res = client.post(
            "/api/invoices/extract",
            files={"file": ("hold.pdf", fh, "application/pdf")},
        )
    assert res.status_code == 200, res.text
    body = res.json()
    assert body["vendor_name"] == "Procter & Gamble"
    assert "Dallas" in body["address"]
    assert body["invoice_amount"] == 48500.0


def test_extract_endpoint_rejects_non_pdf(client):
    res = client.post(
        "/api/invoices/extract",
        files={"file": ("note.txt", b"hello", "text/plain")},
    )
    assert res.status_code == 400
