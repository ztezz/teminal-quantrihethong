"use client";

import { useEffect, useRef, useState, type KeyboardEvent } from "react";
import { Download, Minus, Plus, RotateCw, ChevronLeft, ChevronRight } from "lucide-react";
import type { PDFDocumentProxy, RenderTask } from "pdfjs-dist";
import styles from "./PdfViewer.module.css";

interface PdfViewerProps {
  src: string;
  fileName: string;
}

const MIN_SCALE = 0.5;
const MAX_SCALE = 3;
const SCALE_STEP = 0.25;

export function PdfViewer({ src, fileName }: PdfViewerProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [pdfDocument, setPdfDocument] = useState<PDFDocumentProxy | null>(null);
  const [pdfData, setPdfData] = useState<ArrayBuffer | null>(null);
  const [pageNumber, setPageNumber] = useState(1);
  const [pageInput, setPageInput] = useState("1");
  const [scale, setScale] = useState(1.25);
  const [rotation, setRotation] = useState(0);
  const [loading, setLoading] = useState(true);
  const [rendering, setRendering] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    let loadedDocument: PDFDocumentProxy | null = null;
    let loadingTask: { destroy: () => Promise<void> } | null = null;
    void (async () => {
      try {
        const response = await fetch(src, { credentials: "include", signal: controller.signal });
        if (!response.ok) {
          const contentType = response.headers.get("content-type") || "";
          const message = contentType.includes("application/json")
            ? ((await response.json()) as { error?: string }).error
            : await response.text();
          throw new Error(message || `Không thể tải PDF (HTTP ${response.status})`);
        }
        const data = await response.arrayBuffer();
        if (controller.signal.aborted) return;
        const pdfjs = await import("pdfjs-dist");
        pdfjs.GlobalWorkerOptions.workerSrc = new URL("pdfjs-dist/build/pdf.worker.min.mjs", import.meta.url).toString();
        const task = pdfjs.getDocument({ data: data.slice(0) });
        loadingTask = task;
        loadedDocument = await task.promise;
        if (controller.signal.aborted) return;
        setPdfData(data);
        setPdfDocument(loadedDocument);
      } catch (caught) {
        if (!controller.signal.aborted) setError(caught instanceof Error ? caught.message : "Không thể mở tài liệu PDF");
      } finally {
        if (!controller.signal.aborted) setLoading(false);
      }
    })();

    return () => {
      controller.abort();
      void loadingTask?.destroy();
      void loadedDocument?.destroy();
    };
  }, [src]);

  useEffect(() => {
    if (!pdfDocument) return;
    let cancelled = false;
    let renderTask: RenderTask | null = null;
    void Promise.resolve().then(() => { if (!cancelled) setRendering(true); });
    void pdfDocument.getPage(pageNumber).then((page) => {
      if (cancelled || !canvasRef.current) return;
      const viewport = page.getViewport({ scale, rotation });
      const pixelRatio = Math.min(window.devicePixelRatio || 1, 2);
      const canvas = canvasRef.current;
      const context = canvas.getContext("2d", { alpha: false });
      if (!context) throw new Error("Trình duyệt không hỗ trợ Canvas 2D");
      canvas.width = Math.floor(viewport.width * pixelRatio);
      canvas.height = Math.floor(viewport.height * pixelRatio);
      canvas.style.width = `${Math.floor(viewport.width)}px`;
      canvas.style.height = `${Math.floor(viewport.height)}px`;
      renderTask = page.render({ canvas, canvasContext: context, viewport, transform: pixelRatio === 1 ? undefined : [pixelRatio, 0, 0, pixelRatio, 0, 0] });
      return renderTask.promise;
    }).catch((caught) => {
      if (!cancelled && !(caught instanceof Error && caught.name === "RenderingCancelledException"))
        setError(caught instanceof Error ? caught.message : "Không thể render trang PDF");
    }).finally(() => {
      if (!cancelled) setRendering(false);
    });
    return () => {
      cancelled = true;
      renderTask?.cancel();
    };
  }, [pdfDocument, pageNumber, rotation, scale]);

  const goToPage = (nextPage: number) => {
    if (!pdfDocument) return;
    const bounded = Math.min(pdfDocument.numPages, Math.max(1, Math.trunc(nextPage)));
    setPageNumber(bounded);
    setPageInput(String(bounded));
  };

  const updateScale = (nextScale: number) => setScale(Math.min(MAX_SCALE, Math.max(MIN_SCALE, nextScale)));

  const download = () => {
    if (!pdfData) return;
    const url = URL.createObjectURL(new Blob([pdfData], { type: "application/pdf" }));
    const link = window.document.createElement("a");
    link.href = url;
    link.download = fileName.toLowerCase().endsWith(".pdf") ? fileName : `${fileName.replace(/\.[^.]+$/, "")}.pdf`;
    window.document.body.appendChild(link);
    link.click();
    link.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 1_000);
  };

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.target instanceof HTMLInputElement) return;
    if (event.key === "ArrowLeft" || event.key === "PageUp") { event.preventDefault(); goToPage(pageNumber - 1); }
    else if (event.key === "ArrowRight" || event.key === "PageDown") { event.preventDefault(); goToPage(pageNumber + 1); }
    else if ((event.ctrlKey || event.metaKey) && ["+", "="].includes(event.key)) { event.preventDefault(); updateScale(scale + SCALE_STEP); }
    else if ((event.ctrlKey || event.metaKey) && event.key === "-") { event.preventDefault(); updateScale(scale - SCALE_STEP); }
    else if ((event.ctrlKey || event.metaKey) && event.key === "0") { event.preventDefault(); setScale(1.25); }
  };

  return (
    <div className={styles.viewer} tabIndex={0} onKeyDown={onKeyDown} aria-label={`Trình xem PDF ${fileName}`}>
      <div className={styles.toolbar}>
        <div className={styles.group}>
          <button type="button" className={styles.button} onClick={() => goToPage(pageNumber - 1)} disabled={!pdfDocument || pageNumber <= 1} title="Trang trước"><ChevronLeft size={15} /></button>
          <input className={styles.pageInput} value={pageInput} onChange={(event) => setPageInput(event.target.value.replace(/\D/g, ""))} onBlur={() => goToPage(Number(pageInput) || pageNumber)} onKeyDown={(event) => { if (event.key === "Enter") goToPage(Number(pageInput) || pageNumber); }} inputMode="numeric" aria-label="Số trang" />
          <span className={styles.pageTotal}>/ {pdfDocument?.numPages || "-"}</span>
          <button type="button" className={styles.button} onClick={() => goToPage(pageNumber + 1)} disabled={!pdfDocument || pageNumber >= pdfDocument.numPages} title="Trang sau"><ChevronRight size={15} /></button>
        </div>
        <div className={styles.group}>
          <button type="button" className={styles.button} onClick={() => updateScale(scale - SCALE_STEP)} disabled={!pdfDocument || scale <= MIN_SCALE} title="Thu nhỏ"><Minus size={14} /></button>
          <span className={styles.zoomValue}>{Math.round(scale * 100)}%</span>
          <button type="button" className={styles.button} onClick={() => updateScale(scale + SCALE_STEP)} disabled={!pdfDocument || scale >= MAX_SCALE} title="Phóng to"><Plus size={14} /></button>
          <button type="button" className={styles.button} onClick={() => setScale(1.25)} disabled={!pdfDocument}>Đặt lại</button>
        </div>
        <div className={styles.group}>
          <button type="button" className={styles.button} onClick={() => setRotation((current) => (current + 90) % 360)} disabled={!pdfDocument} title="Xoay 90 độ"><RotateCw size={14} /></button>
          <button type="button" className={styles.button} onClick={download} disabled={!pdfData} title="Tải PDF"><Download size={14} /><span>Tải xuống</span></button>
        </div>
        <span className={styles.spacer} />
        <span className={styles.documentName} title={fileName}>{fileName}</span>
      </div>
      <div className={styles.stage} aria-busy={loading || rendering}>
        <div className={styles.pageShell}><canvas ref={canvasRef} className={styles.canvas} /></div>
        {(loading || error) && (
          <div className={styles.centerState}>
            <div className={styles.stateCard}>
              {loading ? <><span className={styles.spinner} /><span>Đang tải tài liệu PDF...</span></> : <><span className={styles.error}>{error}</span><button type="button" className={styles.button} onClick={() => window.open(src, "_blank", "noopener,noreferrer")}>Mở trực tiếp</button></>}
            </div>
          </div>
        )}
      </div>
      <div className={styles.status}><span>PDF.js</span><span>Trang {pageNumber}/{pdfDocument?.numPages || 0}</span><span>{rendering ? "Đang render..." : loading ? "Đang tải..." : error ? "Lỗi" : "Sẵn sàng"}</span><span className={styles.spacer} /><span>← → chuyển trang · Ctrl +/- zoom</span></div>
    </div>
  );
}
