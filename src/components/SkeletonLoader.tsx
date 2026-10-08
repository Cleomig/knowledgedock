export default function SkeletonLoader({ type }: { type: 'chat' | 'list' }) {
  if (type === 'list') {
    return (
      <div className="flex flex-col gap-3 animate-pulse">
        {[1, 2, 3].map((i) => (
          <div key={i} className="flex items-center gap-3 rounded-xl border border-border bg-background p-4">
            <div className="h-10 w-10 rounded-lg bg-muted"></div>
            <div className="flex flex-col gap-2">
              <div className="h-4 w-48 rounded bg-muted"></div>
              <div className="h-3 w-24 rounded bg-muted"></div>
            </div>
          </div>
        ))}
      </div>
    );
  }

  // Chat skeleton
  return (
    <div className="flex w-full justify-start mb-6 animate-pulse">
      <div className="w-[70%] max-w-[85%] rounded-xl rounded-bl-sm bg-muted px-5 py-4 space-y-3">
        <div className="h-4 w-full rounded bg-border"></div>
        <div className="h-4 w-5/6 rounded bg-border"></div>
        <div className="h-4 w-4/6 rounded bg-border"></div>
      </div>
    </div>
  );
}
