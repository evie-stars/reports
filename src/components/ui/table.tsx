/** Bounded, scrollable wrapper for a `.table`. Use `sticky` when the table is tall enough to scroll internally. */
export function TableWrap({
  children,
  className = "",
  maxHeight
}: {
  children: React.ReactNode;
  className?: string;
  maxHeight?: string;
}) {
  return (
    <div className={`table-wrap ${className}`} style={maxHeight ? { maxHeight } : undefined}>
      {children}
    </div>
  );
}

export function EmptyRow({ colSpan, children }: { colSpan: number; children: React.ReactNode }) {
  return (
    <tr>
      <td colSpan={colSpan} className="px-3 py-6 text-center text-slate italic text-sm">{children}</td>
    </tr>
  );
}
