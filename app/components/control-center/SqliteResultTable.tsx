interface SqliteResultTableProps {
  rows: Record<string, unknown>[];
  empty: string;
}

export function sqliteCellValue(value: unknown) {
  if (value === null)
    return <span className="text-slate-600 italic">NULL</span>;
  if (typeof value === "object") return JSON.stringify(value);
  return String(value);
}

export function SqliteResultTable({ rows, empty }: SqliteResultTableProps) {
  const columns = Array.from(new Set(rows.flatMap((row) => Object.keys(row))));
  if (!rows.length)
    return <div className="p-8 text-center text-xs text-slate-600">{empty}</div>;
  return (
    <div className="max-h-96 overflow-auto">
      <table className="min-w-full text-left text-[11px] font-mono">
        <thead className="sticky top-0 bg-[#151a18] text-slate-500">
          <tr>
            {columns.map((column) => (
              <th key={column} className="px-3 py-2 border-b border-r border-white/5 whitespace-nowrap">
                {column}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-white/5">
          {rows.map((row, index) => (
            <tr key={index} className="hover:bg-white/[0.02]">
              {columns.map((column) => (
                <td key={column} className="max-w-80 px-3 py-2 border-r border-white/5 text-slate-300 whitespace-pre-wrap break-all">
                  {sqliteCellValue(row[column])}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
