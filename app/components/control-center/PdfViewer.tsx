"use client";

import { useEffect, useRef, useState, type KeyboardEvent, type RefObject } from "react";
import { Download, Minus, Plus, RotateCw, ChevronLeft, ChevronRight, PanelLeftClose, PanelLeftOpen } from "lucide-react";
import type { PDFDocumentProxy, PDFPageProxy, RenderTask } from "pdfjs-dist";
import styles from "./PdfViewer.module.css";

interface PdfViewerProps { src: string; fileName: string }
interface PageCanvasProps {
  document: PDFDocumentProxy;
  pageNumber: number;
  scale: number;
  rotation: number;
  observerRoot: RefObject<HTMLElement | null>;
  thumbnail?: boolean;
}

const MIN_SCALE = 0.5;
const MAX_SCALE = 3;
const SCALE_STEP = 0.25;

function PageCanvas({ document, pageNumber, scale, rotation, observerRoot, thumbnail = false }: PageCanvasProps) {
  const shellRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [page, setPage] = useState<PDFPageProxy | null>(null);
  const [visible, setVisible] = useState(pageNumber <= 2);
  const [size, setSize] = useState({ width: thumbnail ? 128 : 765 * scale, height: thumbnail ? 172 : 990 * scale });

  useEffect(() => {
    let cancelled = false;
    void document.getPage(pageNumber).then((loadedPage) => {
      if (cancelled) return;
      const viewport = loadedPage.getViewport({ scale, rotation });
      setPage(loadedPage);
      setSize({ width: viewport.width, height: viewport.height });
    });
    return () => { cancelled = true; };
  }, [document, pageNumber, rotation, scale]);

  useEffect(() => {
    const shell = shellRef.current;
    const root = observerRoot.current;
    if (!shell || !root || visible) return;
    const observer = new IntersectionObserver((entries) => {
      if (entries.some((entry) => entry.isIntersecting)) {
        setVisible(true);
        observer.disconnect();
      }
    }, { root, rootMargin: thumbnail ? "300px 0px" : "900px 0px" });
    observer.observe(shell);
    return () => observer.disconnect();
  }, [observerRoot, thumbnail, visible]);

  useEffect(() => {
    if (!visible || !page || !canvasRef.current) return;
    let cancelled = false;
    let task: RenderTask | null = null;
    void Promise.resolve().then(() => {
      if (cancelled || !canvasRef.current) return;
      const viewport = page.getViewport({ scale, rotation });
      const ratio = thumbnail ? 1 : Math.min(window.devicePixelRatio || 1, 2);
      const canvas = canvasRef.current;
      const context = canvas.getContext("2d", { alpha: false });
      if (!context) return;
      canvas.width = Math.floor(viewport.width * ratio);
      canvas.height = Math.floor(viewport.height * ratio);
      canvas.style.width = `${Math.floor(viewport.width)}px`;
      canvas.style.height = `${Math.floor(viewport.height)}px`;
      task = page.render({ canvas, canvasContext: context, viewport, transform: ratio === 1 ? undefined : [ratio, 0, 0, ratio, 0, 0] });
      return task.promise;
    }).catch((caught) => {
      if (!cancelled && !(caught instanceof Error && caught.name === "RenderingCancelledException")) console.error("PDF page render failed:", caught);
    });
    return () => { cancelled = true; task?.cancel(); };
  }, [page, rotation, scale, thumbnail, visible]);

  return (
    <div ref={shellRef} className={thumbnail ? styles.thumbnailCanvasShell : styles.pageCanvasShell} style={{ width: size.width, height: size.height }}>
      {visible && <canvas ref={canvasRef} className={styles.canvas} />}
      {!visible && <span className={styles.pagePlaceholder}>{pageNumber}</span>}
    </div>
  );
}

export function PdfViewer({ src, fileName }: PdfViewerProps) {
  const stageRef = useRef<HTMLDivElement>(null);
  const sidebarRef = useRef<HTMLElement>(null);
  const scrollFrameRef = useRef<number | null>(null);
  const [pdfDocument, setPdfDocument] = useState<PDFDocumentProxy | null>(null);
  const [pdfData, setPdfData] = useState<ArrayBuffer | null>(null);
  const [pageNumber, setPageNumber] = useState(1);
  const [pageInput, setPageInput] = useState("1");
  const [scale, setScale] = useState(1.1);
  const [rotation, setRotation] = useState(0);
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [loading, setLoading] = useState(true);
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
          const message = contentType.includes("application/json") ? ((await response.json()) as { error?: string }).error : await response.text();
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
      if (scrollFrameRef.current !== null) cancelAnimationFrame(scrollFrameRef.current);
      void loadingTask?.destroy();
      void loadedDocument?.destroy();
    };
  }, [src]);

  const goToPage = (nextPage: number, behavior: ScrollBehavior = "smooth") => {
    if (!pdfDocument) return;
    const bounded = Math.min(pdfDocument.numPages, Math.max(1, Math.trunc(nextPage)));
    setPageNumber(bounded);
    setPageInput(String(bounded));
    stageRef.current?.querySelector<HTMLElement>(`[data-page="${bounded}"]`)?.scrollIntoView({ behavior, block: "start" });
  };

  const trackCurrentPage = () => {
    if (scrollFrameRef.current !== null) return;
    scrollFrameRef.current = requestAnimationFrame(() => {
      scrollFrameRef.current = null;
      const stage = stageRef.current;
      if (!stage) return;
      const targetY = stage.getBoundingClientRect().top + Math.min(stage.clientHeight * 0.32, 220);
      let closestPage = pageNumber;
      let closestDistance = Number.POSITIVE_INFINITY;
      for (const element of stage.querySelectorAll<HTMLElement>("[data-page]")) {
        const number = Number(element.dataset.page);
        const rect = element.getBoundingClientRect();
        const distance = rect.top <= targetY && rect.bottom >= targetY ? 0 : Math.min(Math.abs(rect.top - targetY), Math.abs(rect.bottom - targetY));
        if (distance < closestDistance) { closestDistance = distance; closestPage = number; }
      }
      if (closestPage !== pageNumber) {
        setPageNumber(closestPage);
        setPageInput(String(closestPage));
      }
    });
  };

  const updateScale = (nextScale: number) => setScale(Math.min(MAX_SCALE, Math.max(MIN_SCALE, nextScale)));
  const download = () => {
    if (!pdfData) return;
    const url = URL.createObjectURL(new Blob([pdfData], { type: "application/pdf" }));
    const link = window.document.createElement("a");
    link.href = url;
    link.download = fileName.toLowerCase().endsWith(".pdf") ? fileName : `${fileName.replace(/\.[^.]+$/, "")}.pdf`;
    window.document.body.appendChild(link); link.click(); link.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 1_000);
  };

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.target instanceof HTMLInputElement) return;
    if ((event.ctrlKey || event.metaKey) && ["+", "="].includes(event.key)) { event.preventDefault(); updateScale(scale + SCALE_STEP); }
    else if ((event.ctrlKey || event.metaKey) && event.key === "-") { event.preventDefault(); updateScale(scale - SCALE_STEP); }
    else if ((event.ctrlKey || event.metaKey) && event.key === "0") { event.preventDefault(); setScale(1.1); }
    else if (event.key === "Home") { event.preventDefault(); goToPage(1); }
    else if (event.key === "End" && pdfDocument) { event.preventDefault(); goToPage(pdfDocument.numPages); }
  };

  const pages = pdfDocument ? Array.from({ length: pdfDocument.numPages }, (_, index) => index + 1) : [];
  return (
    <div className={styles.viewer} tabIndex={0} onKeyDown={onKeyDown} aria-label={`Trình xem PDF ${fileName}`}>
      <div className={styles.toolbar}>
        <div className={styles.group}>
          <button type="button" className={styles.button} onClick={() => setSidebarOpen((open) => !open)} disabled={!pdfDocument} title={sidebarOpen ? "Ẩn tổng quan trang" : "Hiện tổng quan trang"}>{sidebarOpen ? <PanelLeftClose size={15} /> : <PanelLeftOpen size={15} />}</button>
          <button type="button" className={styles.button} onClick={() => goToPage(pageNumber - 1)} disabled={!pdfDocument || pageNumber <= 1} title="Trang trước"><ChevronLeft size={15} /></button>
          <input className={styles.pageInput} value={pageInput} onChange={(event) => setPageInput(event.target.value.replace(/\D/g, ""))} onBlur={() => goToPage(Number(pageInput) || pageNumber)} onKeyDown={(event) => { if (event.key === "Enter") goToPage(Number(pageInput) || pageNumber); }} inputMode="numeric" aria-label="Nhảy đến trang" />
          <span className={styles.pageTotal}>/ {pdfDocument?.numPages || "-"}</span>
          <button type="button" className={styles.button} onClick={() => goToPage(pageNumber + 1)} disabled={!pdfDocument || pageNumber >= pdfDocument.numPages} title="Trang sau"><ChevronRight size={15} /></button>
        </div>
        <div className={styles.group}>
          <button type="button" className={styles.button} onClick={() => updateScale(scale - SCALE_STEP)} disabled={!pdfDocument || scale <= MIN_SCALE} title="Thu nhỏ"><Minus size={14} /></button>
          <span className={styles.zoomValue}>{Math.round(scale * 100)}%</span>
          <button type="button" className={styles.button} onClick={() => updateScale(scale + SCALE_STEP)} disabled={!pdfDocument || scale >= MAX_SCALE} title="Phóng to"><Plus size={14} /></button>
          <button type="button" className={styles.button} onClick={() => setScale(1.1)} disabled={!pdfDocument}>Vừa trang</button>
        </div>
        <div className={styles.group}>
          <button type="button" className={styles.button} onClick={() => setRotation((current) => (current + 90) % 360)} disabled={!pdfDocument} title="Xoay 90 độ"><RotateCw size={14} /></button>
          <button type="button" className={styles.button} onClick={download} disabled={!pdfData} title="Tải PDF"><Download size={14} /><span>Tải xuống</span></button>
        </div>
        <span className={styles.spacer} /><span className={styles.documentName} title={fileName}>{fileName}</span>
      </div>
      <div className={styles.workspace}>
        {sidebarOpen && pdfDocument && (
          <aside ref={sidebarRef} className={styles.sidebar} aria-label="Tổng quan các trang PDF">
            <div className={styles.sidebarTitle}><span>TRANG</span><span>{pdfDocument.numPages}</span></div>
            {pages.map((number) => <button key={number} type="button" className={`${styles.thumbnail} ${number === pageNumber ? styles.thumbnailActive : ""}`} onClick={() => goToPage(number)} aria-label={`Đi đến trang ${number}`}><PageCanvas document={pdfDocument} pageNumber={number} scale={0.19} rotation={rotation} observerRoot={sidebarRef} thumbnail /><span>{number}</span></button>)}
          </aside>
        )}
        <div ref={stageRef} className={styles.stage} onScroll={trackCurrentPage} aria-busy={loading}>
          <div className={styles.pages}>
            {pdfDocument && pages.map((number) => <div key={number} className={styles.pageItem} data-page={number}><PageCanvas document={pdfDocument} pageNumber={number} scale={scale} rotation={rotation} observerRoot={stageRef} /><span className={styles.pageLabel}>Trang {number} / {pdfDocument.numPages}</span></div>)}
          </div>
          {(loading || error) && <div className={styles.centerState}><div className={styles.stateCard}>{loading ? <><span className={styles.spinner} /><span>Đang tải tài liệu PDF...</span></> : <><span className={styles.error}>{error}</span><button type="button" className={styles.button} onClick={() => window.open(src, "_blank", "noopener,noreferrer")}>Mở trực tiếp</button></>}</div></div>}
        </div>
      </div>
      <div className={styles.status}><span>PDF.js · Cuộn liên tục</span><span>Trang {pageNumber}/{pdfDocument?.numPages || 0}</span><span>{loading ? "Đang tải..." : error ? "Lỗi" : "Sẵn sàng"}</span><span className={styles.spacer} /><span>Cuộn để xem toàn bộ · Home/End · Ctrl +/- zoom</span></div>
    </div>
  );
}
