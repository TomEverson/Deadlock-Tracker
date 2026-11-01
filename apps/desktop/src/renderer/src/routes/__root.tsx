import { createRootRoute, Outlet } from '@tanstack/react-router'
import { ErrorPanel } from '~/components/ErrorPanel'
import { NotFound } from '~/components/NotFound'
import { Sidebar, TopBar } from '~/domain/players/components/Sidebar'
import { TitleBar } from '~/components/TitleBar'
import { useReloadOnDataChange } from '~/domain/sync/hooks'

export const Route = createRootRoute({
  // You + friends for the sidebar (local database, instant).
  loader: () => window.api.players.friends(),
  component: Root,
  errorComponent: ErrorPanel,
  notFoundComponent: NotFound,
})

function Root() {
  const friendList = Route.useLoaderData()
  useReloadOnDataChange()
  return (
    <div className="md:grid md:h-screen md:grid-cols-[232px_1fr] md:grid-rows-[auto_minmax(0,1fr)]">
      <TitleBar />
      <aside className="hidden min-h-0 border-r border-line bg-sidebar md:block">
        <Sidebar friendList={friendList} />
      </aside>
      <TopBar />
      <main className="min-w-0 md:min-h-0 md:overflow-y-auto">
        <div className="mx-auto max-w-[1080px] px-4 py-6 md:px-8 md:py-8">
          <Outlet />
        </div>
      </main>
    </div>
  )
}
