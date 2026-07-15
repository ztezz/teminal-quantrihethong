import { useEffect, useState, type Dispatch, type SetStateAction } from "react";
import { Braces, Plus, X } from "lucide-react";
import type { SqliteObject } from "./types";

interface SqlTab {
  id: string;
  name: string;
  sql: string;
  savedSql: string;
}

const DEFAULT_SQL = "SELECT name, type FROM sqlite_schema ORDER BY type, name;";
const STORAGE_PREFIX = "nodeshell_sql_tabs:";

function loadTabs(database: string): SqlTab[] {
  if (!database || typeof window === "undefined") return [];
  try {
    const value = JSON.parse(localStorage.getItem(`${STORAGE_PREFIX}${database}`) ?? "[]") as SqlTab[];
    return value.slice(0, 10).filter((tab) => tab.id && typeof tab.sql === "string");
  } catch {
    return [];
  }
}

function formatSql(sql: string) {
  const keywords = new Set(["select", "from", "where", "group by", "order by", "having", "limit", "offset", "join", "left join", "right join", "inner join", "outer join", "union", "values", "set", "returning"]);
  let quoted = false;
  let quote = "";
  let chunk = "";
  let result = "";
  const flush = () => {
    if (!chunk) return;
    const formatted = chunk.replace(/\b(group\s+by|order\s+by|left\s+join|right\s+join|inner\s+join|outer\s+join|select|from|where|having|limit|offset|join|union|values|set|returning|insert|update|delete|create|alter|drop)\b/gi, (word) => {
      const normalized = word.toLowerCase().replace(/\s+/g, " ");
      return `${keywords.has(normalized) ? "\n" : ""}${word.toUpperCase()}`;
    });
    result += formatted;
    chunk = "";
  };
  for (const character of sql) {
    if (!quoted && (character === "'" || character === '"' || character === "`")) {
      flush();
      quoted = true;
      quote = character;
      result += character;
    } else if (quoted) {
      result += character;
      if (character === quote) quoted = false;
    } else if (character === ";") {
      flush();
      result += ";\n";
    } else chunk += character;
  }
  flush();
  return result.trim();
}

interface SqlConsoleTabsProps {
  database: string;
  sql: string;
  setSql: Dispatch<SetStateAction<string>>;
  objects: SqliteObject[];
  loading: boolean;
  onRun: () => void;
}

export function SqlConsoleTabs({ database, sql, setSql, objects, loading, onRun }: SqlConsoleTabsProps) {
  const [tabs, setTabs] = useState<SqlTab[]>(() => {
    const stored = loadTabs(database);
    return stored.length ? stored : [{ id: crypto.randomUUID(), name: "Query 1", sql: sql || DEFAULT_SQL, savedSql: sql || DEFAULT_SQL }];
  });
  const [activeId, setActiveId] = useState(() => tabs[0].id);
  const [suggestion, setSuggestion] = useState("");

  useEffect(() => {
    const timer = window.setTimeout(() => setSql(tabs[0].sql), 0);
    return () => window.clearTimeout(timer);
  // This component remounts for each database, so only the initial tab is synchronized.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [setSql]);

  useEffect(() => {
    if (!database || !tabs.length) return;
    localStorage.setItem(`${STORAGE_PREFIX}${database}`, JSON.stringify(tabs.slice(0, 10)));
  }, [database, tabs]);

  useEffect(() => {
    const active = tabs.find((tab) => tab.id === activeId);
    if (!active || active.sql === sql) return;
    const timer = window.setTimeout(() => {
      setTabs((items) => items.map((tab) => tab.id === activeId ? { ...tab, sql } : tab));
    }, 0);
    return () => window.clearTimeout(timer);
  }, [activeId, sql, tabs]);

  const updateSql = (value: string) => {
    setSql(value);
    setTabs((items) => items.map((tab) => tab.id === activeId ? { ...tab, sql: value } : tab));
  };
  const activate = (tab: SqlTab) => {
    setActiveId(tab.id);
    setSql(tab.sql);
  };
  const add = () => {
    if (tabs.length >= 10) return;
    const tab = { id: crypto.randomUUID(), name: `Query ${tabs.length + 1}`, sql: "", savedSql: "" };
    setTabs((items) => [...items, tab]);
    activate(tab);
  };
  const rename = (tab: SqlTab) => {
    const name = window.prompt("Tên tab SQL:", tab.name)?.trim();
    if (name) setTabs((items) => items.map((item) => item.id === tab.id ? { ...item, name: name.slice(0, 40) } : item));
  };
  const close = (tab: SqlTab) => {
    if (tab.sql !== tab.savedSql && !window.confirm(`Đóng ${tab.name} với thay đổi chưa chạy?`)) return;
    const remaining = tabs.filter((item) => item.id !== tab.id);
    const next = remaining.length ? remaining : [{ id: crypto.randomUUID(), name: "Query 1", sql: "", savedSql: "" }];
    setTabs(next);
    if (tab.id === activeId) activate(next[0]);
  };
  const run = () => {
    if (!sql.trim() || loading) return;
    setTabs((items) => items.map((tab) => tab.id === activeId ? { ...tab, savedSql: tab.sql } : tab));
    onRun();
  };
  const insertSuggestion = () => {
    if (!suggestion) return;
    updateSql(`${sql}${sql && !/\s$/.test(sql) ? " " : ""}\"${suggestion.replaceAll('"', '""')}\"`);
    setSuggestion("");
  };

  return <>
    <div className="flex items-center overflow-x-auto border-b border-white/10 bg-black/20 px-2 pt-2">
      {tabs.map((tab) => <div key={tab.id} className={`group flex shrink-0 items-center rounded-t border border-b-0 px-2 py-1.5 text-[10px] ${tab.id === activeId ? "border-emerald-500/30 bg-[#070908] text-emerald-200" : "border-transparent text-slate-500"}`}>
        <button type="button" onClick={() => activate(tab)} onDoubleClick={() => rename(tab)} title="Nhấp đúp để đổi tên" className="max-w-32 truncate">{tab.name}{tab.sql !== tab.savedSql ? " *" : ""}</button>
        <button type="button" onClick={() => close(tab)} aria-label={`Đóng ${tab.name}`} className="ml-2 text-slate-600 hover:text-red-400"><X className="h-3 w-3" /></button>
      </div>)}
      <button type="button" onClick={add} disabled={tabs.length >= 10} title="Tab SQL mới" className="mb-1 ml-1 p-1.5 text-slate-500 hover:text-emerald-300 disabled:opacity-30"><Plus className="h-3.5 w-3.5" /></button>
    </div>
    <div className="flex flex-wrap items-center gap-2 border-b border-white/10 px-3 py-2">
      <input list="sqlite-object-suggestions" value={suggestion} onChange={(event) => setSuggestion(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter") { event.preventDefault(); insertSuggestion(); } }} placeholder="Chèn table / object..." className="min-w-44 flex-1 rounded border border-white/10 bg-black px-2 py-1.5 text-[10px]" />
      <datalist id="sqlite-object-suggestions">{objects.map((object) => <option key={`${object.type}:${object.name}`} value={object.name}>{object.type}</option>)}</datalist>
      <button type="button" onClick={insertSuggestion} disabled={!suggestion} className="rounded border border-white/10 px-2 py-1.5 text-[10px] disabled:opacity-30">Chèn</button>
      <button type="button" onClick={() => updateSql(formatSql(sql))} disabled={!sql.trim()} className="rounded border border-white/10 px-2 py-1.5 text-[10px] disabled:opacity-30"><Braces className="mr-1 inline h-3 w-3" />Format SQL</button>
    </div>
    <textarea value={sql} onChange={(event) => updateSql(event.target.value)} onKeyDown={(event) => { if ((event.ctrlKey || event.metaKey) && event.key === "Enter") { event.preventDefault(); run(); } }} spellCheck={false} aria-keyshortcuts="Control+Enter Meta+Enter" className="w-full min-h-52 p-4 resize-y bg-[#070908] text-emerald-200 font-mono text-xs outline-none" />
  </>;
}
