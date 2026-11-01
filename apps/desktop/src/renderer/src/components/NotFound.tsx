import { Link } from '@tanstack/react-router'

export function NotFound() {
  return (
    <div className="mx-auto max-w-md px-4 py-24 text-center">
      <p className="text-2xl font-semibold">Page not found</p>
      <p className="mt-2 text-sm text-muted">Nothing lives at this address.</p>
      <Link to="/" className="mt-5 inline-flex h-8 items-center rounded-md border border-line px-3 text-sm text-ink-2 hover:text-ink">
        Go home
      </Link>
    </div>
  )
}
