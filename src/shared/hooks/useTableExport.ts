import { useState } from "react";
import { toast } from "sonner";
import { http } from "@/lib/http";
import { downloadBlob } from "@/lib/download";

export type ExportFormat = "csv" | "xlsx" | "pdf";

/** Human labels for the format options shown in the export menu. */
export const EXPORT_FORMAT_LABELS: Record<ExportFormat, string> = {
  csv: "CSV",
  xlsx: "Excel (XLSX)",
  pdf: "PDF",
};

export const DEFAULT_FORMATS: ExportFormat[] = ["csv"];

interface UseTableExportOptions {
  /** Export endpoint path, e.g. "/admissions/applications/export". */
  endpoint: string;
  /** Current table query/filter state to forward as query params. */
  params?: Record<string, unknown> | undefined;
  /** Base filename without extension. Defaults to "export". */
  filename?: string | undefined;
  /** Format options offered for this table. Defaults to CSV + XLSX. */
  formats?: ExportFormat[] | undefined;
}

/** Drop empty/nullish values so we don't send `?status=` for inactive filters. */
function cleanParams(params: Record<string, unknown> = {}): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(params).filter(
      ([, value]) => value !== "" && value !== undefined && value !== null
    )
  );
}

/**
 * Reusable table export. Streams a file from `endpoint` with the current
 * filters + chosen format and triggers a browser download.
 *
 * @example
 * const { exportData, isExporting } = useTableExport({
 *   endpoint: "/admissions/applications/export",
 *   filename: "applications",
 *   params: { search, page, perPage, program, status, category },
 * });
 * // <DataTable onExport={exportData} isExporting={isExporting} />
 */
export function useTableExport({
  endpoint,
  params,
  filename = "export",
  formats = DEFAULT_FORMATS,
}: UseTableExportOptions) {
  const [isExporting, setIsExporting] = useState(false);

  async function exportData(format: ExportFormat) {
    if (isExporting) return;
    setIsExporting(true);
    try {
      const { data } = await http.get<Blob>(endpoint, {
        params: { ...cleanParams(params), format },
        responseType: "blob",
      });
      downloadBlob(data, `${filename}.${format}`);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Export failed");
    } finally {
      setIsExporting(false);
    }
  }

  return { exportData, isExporting, formats };
}
