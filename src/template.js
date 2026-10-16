const esc = (v = "") => String(v).replace(/[&<>"']/g, c => ({
  "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
})[c]);

export function renderDocumentHtml(doc) {
  const title = doc.type === "purchase_order" ? "Purchase Order" : "Invoice";
  const rows = doc.items.map(item => {
    const qty = Number(item.quantity), price = Number(item.unitPrice);
    return `<tr><td>${esc(item.description)}</td><td class="num">${qty}</td><td class="num">${price.toFixed(2)}</td><td class="num">${(qty * price).toFixed(2)}</td></tr>`;
  }).join("");
  const total = doc.items.reduce((sum, item) => sum + Number(item.quantity) * Number(item.unitPrice), 0);
  return `<!doctype html><html><head><meta charset="utf-8"><style>
  body{font:12px Arial,sans-serif;color:#202735}header{border-bottom:2px solid #243b63;padding-bottom:16px}
  h1{color:#243b63;font-size:25px}table{width:100%;border-collapse:collapse;margin-top:24px}
  th{background:#edf1f7;text-align:left}thead{display:table-header-group}tr{break-inside:avoid;page-break-inside:avoid}th,td{padding:10px 8px;border-bottom:1px solid #d9deea}
  .num{text-align:right}.total{text-align:right;font-size:16px;font-weight:bold;margin-top:20px}
  </style></head><body><header><h1>${title}</h1>
  <p><b>Document:</b> ${esc(doc.number || doc.id || "N/A")}<br>
  <b>Date:</b> ${esc(doc.date || new Date().toISOString().slice(0,10))}<br>
  <b>Customer / Vendor:</b> ${esc(doc.customer || doc.vendor || "N/A")}</p></header>
  <table><thead><tr><th>Description</th><th class="num">Qty</th><th class="num">Unit Price</th><th class="num">Amount</th></tr></thead>
  <tbody>${rows || '<tr><td colspan="4">No line items</td></tr>'}</tbody></table>
  <p class="total">Total: ${total.toFixed(2)}</p></body></html>`;
}