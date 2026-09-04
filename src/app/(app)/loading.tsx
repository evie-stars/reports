export default function Loading() {
  return (
    <div role="status" aria-label="Loading page" className="animate-pulse">
      <div className="h-7 w-48 rounded-lg bg-line/70 mb-2" />
      <div className="h-4 w-72 rounded-lg bg-line/50 mb-6" />
      <div className="flex flex-wrap gap-2.5 mb-6">
        {Array.from({ length: 4 }, (_, index) => <div key={index} className="h-16 w-36 rounded-xl bg-white border border-line" />)}
      </div>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {Array.from({ length: 2 }, (_, index) => <div key={index} className="h-56 rounded-xl bg-white border border-line" />)}
      </div>
      <span className="sr-only">Loading report data...</span>
    </div>
  );
}
