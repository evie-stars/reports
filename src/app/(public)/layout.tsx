export default function PublicLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-screen md:h-screen">
      <div className="flex-1 min-w-0 flex flex-col bg-paper md:m-3 md:rounded-2xl md:overflow-hidden md:shadow-lift md:ring-1 md:ring-white/10">
        <main className="flex-1 min-h-0 md:overflow-y-auto">{children}</main>
      </div>
    </div>
  );
}
