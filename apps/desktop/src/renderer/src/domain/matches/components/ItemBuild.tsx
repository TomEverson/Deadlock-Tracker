import { Card, HeroIcon } from '~/components/ui'
import type { HeroInfo, ItemInfo } from '@deadlock/core/domain/assets/types'
import { formatDuration } from '@deadlock/core/lib/format'
import type { MatchDetailPlayer } from '@deadlock/core/domain/matches/validators/match-detail'
import { ItemHover, SLOT_COLOR } from './ItemHover'

function purchaseMeta(t: number, soldAt: number | null) {
  return (
    <>
      Bought at <span className="num text-ink-2">{formatDuration(t)}</span>
      {soldAt !== null && (
        <>
          {' '}
          · sold at <span className="num text-ink-2">{formatDuration(soldAt)}</span>
        </>
      )}
    </>
  )
}

function ItemTile({ item, faded = false, t, soldAt = null }: { item: ItemInfo; faded?: boolean; t: number; soldAt?: number | null }) {
  return (
    <ItemHover item={item} meta={purchaseMeta(t, soldAt)}>
      <div
        className={`relative grid h-10 w-10 place-items-center rounded-md bg-surface-2 transition-colors hover:bg-line-strong ${faded ? 'opacity-40' : ''}`}
        style={{ boxShadow: `inset 0 -2px 0 ${SLOT_COLOR[item.slot]}` }}
      >
        {item.icon ? <img src={item.icon} alt={item.name} width={30} height={30} loading="lazy" /> : <span className="px-1 text-center text-[9px] leading-tight text-ink-2">{item.name}</span>}
        {item.tier ? <span className="num absolute right-0.5 top-0 text-[9px] text-muted">{item.tier}</span> : null}
      </div>
    </ItemHover>
  )
}

function usePurchases(player: MatchDetailPlayer, items: Record<number, ItemInfo>) {
  const purchases = player.items
    .map((p) => ({ ...p, info: items[p.itemId] }))
    .filter((p): p is typeof p & { info: ItemInfo } => p.info !== undefined)
    .sort((a, b) => a.t - b.t)
  return { purchases, final: purchases.filter((p) => p.soldAt === null) }
}

function AimStats({ player }: { player: MatchDetailPlayer }) {
  return (
    <span className="flex gap-3 text-xs text-muted">
      {player.accuracy != null && <span>Accuracy <span className="num text-ink">{Math.round(player.accuracy * 100)}%</span></span>}
      {player.critRate != null && <span>Headshot <span className="num text-ink">{Math.round(player.critRate * 100)}%</span></span>}
    </span>
  )
}

/** Final items + purchase order. Used inline under a scoreboard row. */
export function ItemBuildBody({ player, items }: { player: MatchDetailPlayer; items: Record<number, ItemInfo> }) {
  const { purchases, final } = usePurchases(player, items)
  return (
    <div className="grid gap-5 sm:grid-cols-[auto_1fr]">
      <div>
        <div className="mb-2 flex items-center justify-between gap-4">
          <span className="label">Final items</span>
          <AimStats player={player} />
        </div>
        {final.length === 0 ? (
          <p className="text-sm text-muted">No item data.</p>
        ) : (
          <div className="grid w-fit grid-cols-6 gap-1.5">
            {final.map((p) => (
              <ItemTile key={`${p.itemId}-${p.t}`} item={p.info} t={p.t} />
            ))}
          </div>
        )}
      </div>
      {purchases.length > 0 && (
        <div className="min-w-0">
          <div className="label mb-2">Purchase order</div>
          <ol className="flex flex-wrap gap-x-1.5 gap-y-3">
            {purchases.map((p) => (
              <li key={`${p.itemId}-${p.t}`} className="flex flex-col items-center gap-1">
                <ItemTile item={p.info} faded={p.soldAt !== null} t={p.t} soldAt={p.soldAt} />
                <span className="num text-[10px] text-muted">{formatDuration(p.t)}</span>
              </li>
            ))}
          </ol>
          <p className="mt-3 text-xs text-muted">Hover an item for details. Faded = sold later. Bottom edge shows slot: weapon, vitality, spirit.</p>
        </div>
      )}
    </div>
  )
}

export function ItemBuild({ player, hero, items }: { player: MatchDetailPlayer; hero: HeroInfo; items: Record<number, ItemInfo> }) {
  return (
    <Card
      title={
        <span className="flex items-center gap-2 normal-case">
          <HeroIcon hero={hero} size={20} />
          <span className="label !text-ink-2">{player.name} · build</span>
        </span>
      }
    >
      <div className="p-4">
        <ItemBuildBody player={player} items={items} />
      </div>
    </Card>
  )
}
