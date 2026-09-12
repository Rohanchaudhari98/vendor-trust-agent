"""Extract vendor_name / remittance address / invoice amount from a PDF.

Deterministic text parse first (works on labeled demo invoices and common
AP layouts). The trust pipeline is unchanged — this only supplies the same
three fields the typed form already sends.
"""

from __future__ import annotations

import io
import re
from dataclasses import dataclass

import pdfplumber


@dataclass(frozen=True)
class InvoiceFields:
    vendor_name: str | None
    address: str | None
    invoice_amount: float | None
    raw_text_preview: str
    warnings: list[str]


_LABEL_VENDOR = re.compile(
    r"(?im)^\s*Vendor\s*name\s*:\s*(.+?)\s*$"
)
_LABEL_ADDRESS = re.compile(
    r"(?im)^\s*Address\s*:\s*(.+?)\s*$"
)
_LABEL_AMOUNT = re.compile(
    r"(?im)^\s*Invoice\s*amount\s*:\s*\$?\s*([0-9][0-9,]*(?:\.[0-9]{1,2})?)\s*$"
)
_TOTAL_DUE = re.compile(
    r"(?im)Total\s+due\s*:?\s*\$?\s*([0-9][0-9,]*(?:\.[0-9]{1,2})?)"
)
_INVOICE_TITLE = re.compile(
    r"(?im)^\s*(.+?)\s+INVOICE\s*$"
)
_REMIT_BLOCK = re.compile(
    r"(?is)Remit\s+Payment\s+To\s*\n(.+?)(?:\n(?:Line items|Payment instructions|ACH:)|$)"
)


def extract_text_from_pdf(pdf_bytes: bytes) -> str:
    if not pdf_bytes:
        raise ValueError("Empty PDF upload")
    with pdfplumber.open(io.BytesIO(pdf_bytes)) as pdf:
        parts: list[str] = []
        for page in pdf.pages:
            parts.append(page.extract_text() or "")
    text = "\n".join(parts).strip()
    if not text:
        raise ValueError(
            "No text found in this PDF. Scanned images need OCR — paste fields manually for now."
        )
    return text


def _parse_money(raw: str) -> float | None:
    try:
        return float(raw.replace(",", "").strip())
    except ValueError:
        return None


def parse_invoice_fields(text: str) -> InvoiceFields:
    warnings: list[str] = []
    vendor_name: str | None = None
    address: str | None = None
    invoice_amount: float | None = None

    m = _LABEL_VENDOR.search(text)
    if m:
        vendor_name = m.group(1).strip() or None

    m = _LABEL_ADDRESS.search(text)
    if m:
        address = m.group(1).strip() or None

    m = _LABEL_AMOUNT.search(text)
    if m:
        invoice_amount = _parse_money(m.group(1))

    if not vendor_name:
        m = _INVOICE_TITLE.search(text)
        if m:
            candidate = m.group(1).strip()
            if candidate.upper() not in {"SAMPLE / DEMO", "DEMO"} and len(candidate) > 2:
                vendor_name = candidate.title() if candidate.isupper() else candidate
                warnings.append("Vendor name inferred from invoice title")

    if not address:
        m = _REMIT_BLOCK.search(text)
        if m:
            lines = [ln.strip() for ln in m.group(1).splitlines() if ln.strip()]
            kept: list[str] = []
            for ln in lines:
                if re.search(r"remittance", ln, re.I):
                    continue
                if re.search(r"^ACH:", ln, re.I):
                    break
                kept.append(ln)
            if kept:
                address = ", ".join(kept)
                warnings.append("Address inferred from Remit Payment To block")

    if invoice_amount is None:
        m = _TOTAL_DUE.search(text)
        if m:
            invoice_amount = _parse_money(m.group(1))
            warnings.append("Amount inferred from Total due")

    preview = text if len(text) <= 400 else text[:400] + "…"
    return InvoiceFields(
        vendor_name=vendor_name,
        address=address,
        invoice_amount=invoice_amount,
        raw_text_preview=preview,
        warnings=warnings,
    )


def extract_invoice_fields(pdf_bytes: bytes) -> InvoiceFields:
    return parse_invoice_fields(extract_text_from_pdf(pdf_bytes))
