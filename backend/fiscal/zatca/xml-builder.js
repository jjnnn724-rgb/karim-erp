'use strict';
/**
 * zatca/xml-builder.js — بناء UBL 2.1 invoice كسلسلة نصية (preparation scaffold).
 * لا توقيع، لا إرسال، لا شهادة. التحقق من البنية المخططية لا يزال UNVERIFIED.
 */

function esc(value) {
    return String(value ?? '')
        .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;').replace(/'/g, '&apos;');
}

/** مبلغ رقمي صحيح بمنزلين — لا عمليات فاصلة عائمة للعملة في منطق المال الحقيقي. */
function amount(value) {
    const n = Number(value);
    if (!Number.isFinite(n)) {throw new Error('INVALID_AMOUNT');}
    return n.toFixed(2);
}

/**
 * @param {object} invoice
 * @param {string} invoice.uuid - UUID الفاتورة
 * @param {string} invoice.issueDate - ISO date
 * @param {string} invoice.issueTime - ISO time + TZ
 * @param {string} invoice.sellerName
 * @param {string} invoice.vatNumber
 * @param {string} [invoice.pih] - Previous Invoice Hash (base64)
 * @param {number} invoice.total
 * @param {number} invoice.vatTotal
 * @param {Array<{name:string, quantity:number, unitPrice:number, vatRate:number}>} invoice.lines
 */
function buildUblInvoice(invoice) {
    if (!invoice || !invoice.uuid || !invoice.vatNumber) {throw new Error('INVALID_INVOICE');}
    const lines = Array.isArray(invoice.lines) ? invoice.lines : [];
    const lineXml = lines.map((line, i) => `    <cac:InvoiceLine>
      <cbc:ID>${i + 1}</cbc:ID>
      <cbc:InvoicedQuantity unitCode="EA">${Number(line.quantity) || 0}</cbc:InvoicedQuantity>
      <cbc:LineExtensionAmount currencyID="SAR">${amount((line.quantity || 0) * (line.unitPrice || 0))}</cbc:LineExtensionAmount>
      <cac:Item><cbc:Name>${esc(line.name)}</cbc:Name></cac:Item>
      <cac:Price><cbc:PriceAmount currencyID="SAR">${amount(line.unitPrice)}</cbc:PriceAmount></cac:Price>
    </cac:InvoiceLine>`).join('\n');
    return `<?xml version="1.0" encoding="UTF-8"?>
<ubl:Invoice xmlns:ubl="urn:oasis:names:specification:ubl:schema:xsd:Invoice-2"
             xmlns:cac="urn:oasis:names:specification:ubl:schema:xsd:CommonAggregateComponents-2"
             xmlns:cbc="urn:oasis:names:specification:ubl:schema:xsd:CommonBasicComponents-2">
  <cbc:UBLVersionID>2.1</cbc:UBLVersionID>
  <cbc:CustomizationID>urn:cen.eu:en16931:2017#compliant#urn:fdc:zatca.gov.sa:2025:simplified</cbc:CustomizationID>
  <cbc:ProfileID>urn:fdc:zatca.gov.sa:2025:simplified</cbc:ProfileID>
  <cbc:ID>${esc(invoice.uuid)}</cbc:ID>
  <cbc:IssueDate>${esc(invoice.issueDate)}</cbc:IssueDate>
  <cbc:IssueTime>${esc(invoice.issueTime)}</cbc:IssueTime>
  <cbc:InvoiceTypeCode codeListID="UNCL1001">391</cbc:InvoiceTypeCode>
  <cbc:DocumentCurrencyCode>SAR</cbc:DocumentCurrencyCode>
${invoice.pih ? `  <cac:AdditionalDocumentReference>
    <cbc:ID>PIH</cbc:ID>
    <cac:Attachment><cbc:EmbeddedDocumentBinaryObject mimeCode="text/plain">${esc(invoice.pih)}</cbc:EmbeddedDocumentBinaryObject></cac:Attachment>
  </cac:AdditionalDocumentReference>\n` : ''}  <cac:AccountingSupplierParty>
    <cac:Party>
      <cac:PartyLegalEntity><cbc:RegistrationName>${esc(invoice.sellerName)}</cbc:RegistrationName></cac:PartyLegalEntity>
      <cac:PartyTaxScheme><cbc:CompanyID>${esc(invoice.vatNumber)}</cbc:CompanyID></cac:PartyTaxScheme>
    </cac:Party>
  </cac:AccountingSupplierParty>
  <cac:TaxTotal>
    <cbc:TaxAmount currencyID="SAR">${amount(invoice.vatTotal)}</cbc:TaxAmount>
  </cac:TaxTotal>
  <cac:LegalMonetaryTotal>
    <cbc:PayableAmount currencyID="SAR">${amount(invoice.total)}</cbc:PayableAmount>
  </cac:LegalMonetaryTotal>
${lineXml}
</ubl:Invoice>`;
}

module.exports = { buildUblInvoice, esc, amount };
