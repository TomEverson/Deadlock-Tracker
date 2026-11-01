import { useRouter, type ErrorComponentProps } from '@tanstack/react-router'

export function ErrorPanel({ error }: ErrorComponentProps) {
  const router = useRouter()
  return (
    <div className="mx-auto max-w-lg px-4 py-20">
      <div className="card p-5">
        <p className="text-base font-semibold">Something went wrong</p>
        <p className="mt-2 break-words text-sm text-ink-2">{error instanceof Error ? error.message : String(error)}</p>
        <button
          type="button"
          onClick={() => router.invalidate()}
          className="mt-4 h-8 rounded-md bg-accent px-3 text-sm font-medium text-white hover:bg-accent-strong"
        >
          Try again
        </button>
      </div>
    </div>
  )
}
