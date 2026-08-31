"use client";

import { Plus, Trash2 } from "lucide-react";

interface SpreadsheetEditorProps {
  value: string;
  readOnly: boolean;
  onChange: (value: string) => void;
}

const columnName = (index: number) => {
  let name = "";
  let value = index + 1;
  while (value > 0) {
    const remainder = (value - 1) % 26;
    name = String.fromCharCode(65 + remainder) + name;
    value = Math.floor((value - 1) / 26);
  }
  return name;
};

const parseCsv = (value: string) => {
  const rows: string[][] = [[]];
  let cell = "";
  let quoted = false;
  for (let index = 0; index < value.length; index += 1) {
    const character = value[index];
    if (character === '"') {
      if (quoted && value[index + 1] === '"') { cell += '"'; index += 1; }
      else quoted = !quoted;
    } else if (character === "," && !quoted) { rows.at(-1)?.push(cell); cell = ""; }
    else if ((character === "\n" || character === "\r") && !quoted) {
      if (character === "\r" && value[index + 1] === "\n") index += 1;
      rows.at(-1)?.push(cell); rows.push([]); cell = "";
    } else cell += character;
  }
  rows.at(-1)?.push(cell);
  if (rows.length > 1 && rows.at(-1)?.every((item) => !item)) rows.pop();
  const width = Math.max(1, ...rows.map((row) => row.length));
  return rows.length ? rows.map((row) => [...row, ...Array(Math.max(0, width - row.length)).fill("")]) : [[""]];
};

const stringifyCsv = (rows: string[][]) => rows.map((row) => row.map((cell) => `"${cell.replaceAll('"', '""')}"`).join(",")).join("\n");

export function SpreadsheetEditor({ value, readOnly, onChange }: SpreadsheetEditorProps) {
  const rows = parseCsv(value);
  const update = (next: string[][]) => onChange(stringifyCsv(next));
  const columns = Math.max(1, ...rows.map((row) => row.length));

  return <div className="flex h-full min-h-0 flex-col bg-[#0b1018]">
    <div className="flex shrink-0 items-center justify-between gap-3 border-b border-white/10 px-4 py-2.5"><span className="text-[11px] text-slate-500">Bảng tính CSV. Tương thích Excel và LibreOffice.</span>{!readOnly && <div className="flex gap-2"><button type="button" onClick={() => update([...rows, Array(columns).fill("")])} className="inline-flex items-center gap-1 rounded border border-sky-400/20 px-2 py-1 text-[10px] text-sky-200 hover:bg-sky-400/10"><Plus className="h-3 w-3" />Hàng</button><button type="button" onClick={() => update(rows.map((row) => [...row, ""]))} className="inline-flex items-center gap-1 rounded border border-sky-400/20 px-2 py-1 text-[10px] text-sky-200 hover:bg-sky-400/10"><Plus className="h-3 w-3" />Cột</button></div>}</div>
    <div className="min-h-0 flex-1 overflow-auto p-3"><table className="border-separate border-spacing-0 text-xs"><thead><tr><th className="sticky left-0 top-0 z-20 w-10 border-b border-r border-white/10 bg-[#111925]" />{Array.from({ length: columns }, (_, index) => <th key={index} className="sticky top-0 z-10 min-w-40 border-b border-r border-white/10 bg-[#111925] px-3 py-2 text-center font-mono text-[10px] font-semibold text-slate-500">{columnName(index)}</th>)}{!readOnly && <th className="sticky top-0 z-10 w-9 border-b border-white/10 bg-[#111925]" />}</tr></thead><tbody>{rows.map((row, rowIndex) => <tr key={rowIndex}><th className="sticky left-0 z-10 border-b border-r border-white/10 bg-[#111925] px-3 text-right font-mono text-[10px] font-medium text-slate-600">{rowIndex + 1}</th>{Array.from({ length: columns }, (_, columnIndex) => <td key={columnIndex} className="border-b border-r border-white/10 p-0"><input value={row[columnIndex] || ""} readOnly={readOnly} onChange={(event) => update(rows.map((current, index) => index === rowIndex ? current.map((cell, cellIndex) => cellIndex === columnIndex ? event.target.value : cell) : current))} className="h-10 w-40 bg-transparent px-3 text-slate-300 outline-none focus:bg-sky-400/10" /></td>)}{!readOnly && <td className="border-b border-white/10 text-center"><button type="button" onClick={() => update(rows.length > 1 ? rows.filter((_, index) => index !== rowIndex) : [[...Array(columns).fill("")]])} className="p-2 text-slate-600 hover:text-rose-300" aria-label={`Xóa hàng ${rowIndex + 1}`}><Trash2 className="h-3.5 w-3.5" /></button></td>}</tr>)}</tbody></table></div>
  </div>;
}
