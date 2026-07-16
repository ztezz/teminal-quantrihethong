"use client";

import { useDeferredValue, useMemo, useRef, useState, type KeyboardEvent } from "react";
import Prism from "prismjs";
import "prismjs/components/prism-markup";
import "prismjs/components/prism-css";
import "prismjs/components/prism-clike";
import "prismjs/components/prism-javascript";
import "prismjs/components/prism-typescript";
import "prismjs/components/prism-jsx";
import "prismjs/components/prism-tsx";
import "prismjs/components/prism-json";
import "prismjs/components/prism-bash";
import "prismjs/components/prism-powershell";
import "prismjs/components/prism-sql";
import "prismjs/components/prism-python";
import "prismjs/components/prism-markup-templating";
import "prismjs/components/prism-php";
import "prismjs/components/prism-yaml";
import "prismjs/components/prism-markdown";
import "prismjs/components/prism-docker";
import styles from "./CodeEditor.module.css";

const MAX_HIGHLIGHT_LENGTH = 250_000;

const languageMap: Record<string, { id: string; label: string }> = {
  html: { id: "markup", label: "HTML" }, htm: { id: "markup", label: "HTML" }, xml: { id: "markup", label: "XML" }, svg: { id: "markup", label: "SVG" },
  css: { id: "css", label: "CSS" }, js: { id: "javascript", label: "JavaScript" }, mjs: { id: "javascript", label: "JavaScript" }, cjs: { id: "javascript", label: "JavaScript" },
  jsx: { id: "jsx", label: "JSX" }, ts: { id: "typescript", label: "TypeScript" }, mts: { id: "typescript", label: "TypeScript" }, cts: { id: "typescript", label: "TypeScript" }, tsx: { id: "tsx", label: "TSX" },
  json: { id: "json", label: "JSON" }, jsonc: { id: "javascript", label: "JSONC" }, sh: { id: "bash", label: "Shell" }, bash: { id: "bash", label: "Bash" }, zsh: { id: "bash", label: "Zsh" },
  ps1: { id: "powershell", label: "PowerShell" }, psm1: { id: "powershell", label: "PowerShell" }, sql: { id: "sql", label: "SQL" }, py: { id: "python", label: "Python" },
  php: { id: "php", label: "PHP" }, yml: { id: "yaml", label: "YAML" }, yaml: { id: "yaml", label: "YAML" }, md: { id: "markdown", label: "Markdown" }, markdown: { id: "markdown", label: "Markdown" },
};

function detectLanguage(fileName: string) {
  const base = fileName.replace(/\\/g, "/").split("/").pop()?.toLowerCase() || "";
  if (["dockerfile", "containerfile"].includes(base)) return { id: "docker", label: "Dockerfile" };
  if ([".bashrc", ".zshrc", ".profile"].includes(base)) return { id: "bash", label: "Shell" };
  if (base === "package.json" || base === "tsconfig.json") return { id: "json", label: "JSON" };
  const extension = base.includes(".") ? base.split(".").pop() || "" : "";
  return languageMap[extension] || { id: "plain", label: extension ? extension.toUpperCase() : "Plain text" };
}

function escapeHtml(value: string) {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function findMatches(value: string, query: string, caseSensitive: boolean) {
  if (!query) return [];
  const source = caseSensitive ? value : value.toLocaleLowerCase();
  const needle = caseSensitive ? query : query.toLocaleLowerCase();
  const matches: number[] = [];
  let offset = 0;
  while (offset <= source.length - needle.length) {
    const index = source.indexOf(needle, offset);
    if (index < 0) break;
    matches.push(index);
    offset = index + Math.max(needle.length, 1);
  }
  return matches;
}

interface CodeEditorProps {
  value: string;
  fileName: string;
  readOnly: boolean;
  dirty: boolean;
  onChange: (value: string) => void;
  onSave: () => void;
}

export function CodeEditor({ value, fileName, readOnly, dirty, onChange, onSave }: CodeEditorProps) {
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const highlightRef = useRef<HTMLPreElement>(null);
  const gutterRef = useRef<HTMLDivElement>(null);
  const [query, setQuery] = useState("");
  const [replacement, setReplacement] = useState("");
  const [caseSensitive, setCaseSensitive] = useState(false);
  const [matchIndex, setMatchIndex] = useState(-1);
  const [position, setPosition] = useState({ line: 1, column: 1 });
  const deferredValue = useDeferredValue(value);
  const language = useMemo(() => detectLanguage(fileName), [fileName]);
  const matches = useMemo(() => findMatches(value, query, caseSensitive), [value, query, caseSensitive]);
  const lineCount = useMemo(() => value.split("\n").length, [value]);
  const highlightDisabled = deferredValue.length > MAX_HIGHLIGHT_LENGTH;
  const highlighted = useMemo(() => {
    const source = deferredValue.endsWith("\n") ? `${deferredValue} ` : deferredValue || " ";
    const grammar = Prism.languages[language.id];
    return !highlightDisabled && grammar ? Prism.highlight(source, grammar, language.id) : escapeHtml(source);
  }, [deferredValue, highlightDisabled, language.id]);

  const syncPosition = (area = textareaRef.current) => {
    if (!area) return;
    const before = area.value.slice(0, area.selectionStart);
    const lines = before.split("\n");
    setPosition({ line: lines.length, column: lines[lines.length - 1].length + 1 });
  };

  const selectMatch = (direction: 1 | -1) => {
    const area = textareaRef.current;
    if (!area || matches.length === 0) return;
    const current = matches.findIndex((start) => start >= area.selectionEnd);
    const next = direction === 1
      ? (current >= 0 ? current : 0)
      : ((current <= 0 ? matches.length : current) - 1);
    const start = matches[next];
    area.focus();
    area.setSelectionRange(start, start + query.length);
    const line = value.slice(0, start).split("\n").length;
    area.scrollTop = Math.max(0, (line - 4) * 21.45);
    setMatchIndex(next);
    syncPosition(area);
  };

  const replaceCurrent = () => {
    if (readOnly || !query) return;
    const area = textareaRef.current;
    if (!area) return;
    const selected = value.slice(area.selectionStart, area.selectionEnd);
    const matchesSelection = caseSensitive ? selected === query : selected.toLocaleLowerCase() === query.toLocaleLowerCase();
    if (!matchesSelection) return selectMatch(1);
    const start = area.selectionStart;
    onChange(`${value.slice(0, start)}${replacement}${value.slice(area.selectionEnd)}`);
    requestAnimationFrame(() => {
      area.focus();
      area.setSelectionRange(start, start + replacement.length);
      syncPosition(area);
    });
  };

  const replaceAll = () => {
    if (readOnly || !query || matches.length === 0) return;
    let cursor = 0;
    let next = "";
    for (const start of matches) {
      next += value.slice(cursor, start) + replacement;
      cursor = start + query.length;
    }
    onChange(next + value.slice(cursor));
    setMatchIndex(-1);
  };

  const applyIndent = (area: HTMLTextAreaElement, outdent: boolean) => {
    const start = area.selectionStart;
    const end = area.selectionEnd;
    const lineStart = value.lastIndexOf("\n", start - 1) + 1;
    const lineEndIndex = value.indexOf("\n", end);
    const lineEnd = lineEndIndex < 0 ? value.length : lineEndIndex;
    const block = value.slice(lineStart, lineEnd);
    if (start === end && !outdent) {
      onChange(`${value.slice(0, start)}  ${value.slice(end)}`);
      requestAnimationFrame(() => area.setSelectionRange(start + 2, start + 2));
      return;
    }
    const lines = block.split("\n");
    const adjusted = lines.map((line) => outdent ? line.replace(/^( {1,2}|\t)/, "") : `  ${line}`);
    const nextBlock = adjusted.join("\n");
    const delta = nextBlock.length - block.length;
    onChange(`${value.slice(0, lineStart)}${nextBlock}${value.slice(lineEnd)}`);
    requestAnimationFrame(() => {
      area.focus();
      area.setSelectionRange(lineStart, Math.max(lineStart, end + delta));
      syncPosition(area);
    });
  };

  const onKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.nativeEvent.isComposing) return;
    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "s") {
      event.preventDefault();
      if (!readOnly && dirty) onSave();
      return;
    }
    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "f") {
      event.preventDefault();
      document.getElementById("code-editor-find")?.focus();
      return;
    }
    if (!readOnly && event.key === "Tab") {
      event.preventDefault();
      applyIndent(event.currentTarget, event.shiftKey);
    }
  };

  const syncScroll = (area: HTMLTextAreaElement) => {
    if (highlightRef.current) highlightRef.current.style.transform = `translate(${-area.scrollLeft}px, ${-area.scrollTop}px)`;
    if (gutterRef.current) gutterRef.current.style.transform = `translateY(${-area.scrollTop}px)`;
  };

  return (
    <div className={styles.editor}>
      <div className={styles.toolbar}>
        <input id="code-editor-find" value={query} onChange={(event) => { setQuery(event.target.value); setMatchIndex(-1); }} onKeyDown={(event) => { if (event.key === "Enter") { event.preventDefault(); selectMatch(event.shiftKey ? -1 : 1); } }} placeholder="Tìm trong tệp" aria-label="Tìm trong mã nguồn" className={styles.searchInput} />
        <input value={replacement} onChange={(event) => setReplacement(event.target.value)} placeholder="Thay thế" aria-label="Nội dung thay thế" className={styles.searchInput} disabled={readOnly} />
        <button type="button" onClick={() => selectMatch(-1)} disabled={!query || matches.length === 0} className={styles.toolButton}>Trước</button>
        <button type="button" onClick={() => selectMatch(1)} disabled={!query || matches.length === 0} className={styles.toolButton}>Tiếp</button>
        <span className={styles.matchCount}>{matches.length ? `${Math.max(matchIndex + 1, 1)}/${matches.length}` : "0 kết quả"}</span>
        <button type="button" onClick={() => setCaseSensitive((current) => !current)} aria-pressed={caseSensitive} className={styles.toolButton}>{caseSensitive ? "Aa: bật" : "Aa"}</button>
        <button type="button" onClick={replaceCurrent} disabled={readOnly || !query || matches.length === 0} className={styles.toolButton}>Thay</button>
        <button type="button" onClick={replaceAll} disabled={readOnly || !query || matches.length === 0} className={styles.toolButton}>Thay tất cả</button>
        {!readOnly && <button type="button" onClick={() => textareaRef.current && applyIndent(textareaRef.current, false)} className={styles.toolButton}>Thụt dòng</button>}
      </div>
      <div className={styles.viewport}>
        <div className={styles.gutter} aria-hidden="true"><div ref={gutterRef} className={styles.gutterContent}>{Array.from({ length: lineCount }, (_, index) => <div key={index}>{index + 1}</div>)}</div></div>
        <div className={styles.codeStage}>
          <pre ref={highlightRef} className={styles.highlight} aria-hidden="true"><code dangerouslySetInnerHTML={{ __html: highlighted }} /></pre>
          <textarea ref={textareaRef} value={value} onChange={(event) => onChange(event.target.value)} onSelect={(event) => syncPosition(event.currentTarget)} onScroll={(event) => syncScroll(event.currentTarget)} onKeyDown={onKeyDown} readOnly={readOnly} wrap="off" spellCheck={false} autoCapitalize="off" autoCorrect="off" aria-label={`Trình sửa mã nguồn ${fileName}`} aria-keyshortcuts="Control+S Meta+S Control+F Meta+F" className={styles.input} placeholder="Nội dung tệp rỗng..." />
        </div>
      </div>
      <div className={styles.statusbar}>
        <span className={styles.language}>{language.label}</span>
        <span>UTF-8</span><span>Spaces: 2</span>
        {highlightDisabled && <span className={styles.warning}>Tắt tô màu cho tệp lớn</span>}
        <span className={styles.statusSpacer} />
        <span>Ln {position.line}, Col {position.column}</span><span>{lineCount} dòng</span><span>{value.length} ký tự</span>
        <span>{readOnly ? "READ ONLY" : dirty ? "UNSAVED" : "SAVED"}</span>
      </div>
    </div>
  );
}
