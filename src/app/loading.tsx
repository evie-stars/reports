export default function Loading() {
  return (
    <div className="page-loading" role="status" aria-label="Loading page">
      <div className="skeleton skeleton-title" />
      <div className="skeleton skeleton-subtitle" />
      <div className="skeleton-grid">
        {Array.from({ length: 4 }, (_, index) => <div className="skeleton skeleton-panel" key={index} />)}
      </div>
      <span className="sr-only">Loading report data...</span>
    </div>
  );
}
