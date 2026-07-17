function getXlsxLibrary() {
  return globalThis.XLSX;
}

function sanitizeSheetName(name) {
  return String(name || "Sheet")
    .replace(/[\\/*?:[\]]/g, " ")
    .slice(0, 31)
    .trim() || "Sheet";
}

function normalizeCellValue(value) {
  if (value == null) {
    return "";
  }

  if (Array.isArray(value)) {
    return value.join(", ");
  }

  if (typeof value === "boolean") {
    return value ? "Yes" : "No";
  }

  return String(value);
}

export function exportLeadRowsToExcel({
  rows,
  columns,
  fileName,
  sheetName = "Leads",
  summary = []
}) {
  const XLSX = getXlsxLibrary();
  if (!XLSX) {
    return {
      ok: false,
      message: "Excel export is unavailable because the spreadsheet library did not load."
    };
  }

  const normalizedRows = Array.isArray(rows) ? rows : [];
  const normalizedColumns = Array.isArray(columns) ? columns : [];

  const workbook = XLSX.utils.book_new();

  if (summary.length) {
    const summarySheet = XLSX.utils.json_to_sheet(
      summary.map(([metric, value]) => ({
        Metric: normalizeCellValue(metric),
        Value: normalizeCellValue(value)
      }))
    );
    XLSX.utils.book_append_sheet(workbook, summarySheet, sanitizeSheetName("Summary"));
  }

  const exportRows = normalizedRows.map((row) => {
    const nextRow = {};
    normalizedColumns.forEach((column) => {
      nextRow[column.label] = normalizeCellValue(column.getter(row));
    });
    return nextRow;
  });

  const dataSheet = XLSX.utils.json_to_sheet(exportRows);
  XLSX.utils.book_append_sheet(workbook, dataSheet, sanitizeSheetName(sheetName));
  XLSX.writeFile(workbook, fileName);

  return {
    ok: true,
    message: "Lead export completed successfully."
  };
}
