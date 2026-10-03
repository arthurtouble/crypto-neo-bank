/** An error from an operator API, with a way to ask again when there's something to retry. */
export function ErrorNotice({ error, onRetry }: { error: Error; onRetry?: () => void }) {
  return <div className="notice error" role="alert"><span>{error.message}</span>
    {onRetry && <button type="button" className="button quiet" onClick={onRetry}>Try again</button>}</div>;
}
