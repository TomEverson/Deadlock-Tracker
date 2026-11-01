import { createFileRoute, Link, notFound, useNavigate, useRouter } from '@tanstack/react-router'
import { useEffect, useState } from 'react'
import { z } from 'zod'
import { Card, LocalDateTime, RankBadge, TabBar, tabClass } from '~/components/ui'
import { useSyncStatus } from '~/domain/sync/hooks'
import { AnalysisSummary, KeyMoments, LanesCard, PlayerReports } from '~/domain/matches/components/MatchAnalysis'
import { AreaReview, DeathMapCard, FightReviewCard, FocusCard, ThreatsCard, VerdictCard } from '~/domain/matches/components/MatchReview'
import { NetWorthChart } from '~/domain/matches/components/NetWorthChart'
import { Scoreboard } from '~/domain/matches/components/Scoreboard'
import { analyzeMatch, hasAnalysisData } from '@deadlock/core/domain/matches/services/analysis'
import { coachReview } from '@deadlock/core/domain/matches/services/coach'
import { MAJOR_THREAT } from '@deadlock/core/domain/matches/services/match-facts'
import { hasObjectiveData, objectivesReport } from '@deadlock/core/domain/matches/services/objectives'
import { ObjectivesView } from '~/domain/matches/components/ObjectivesView'
import { MATCH_DETAIL_VERSION } from '@deadlock/core/domain/matches/validators/match-detail'
import { formatDuration, modeLabel, teamName } from '@deadlock/core/lib/format'

const matchIdParam = z.coerce.number().int().positive()
const TABS = ['overview', 'scoreboard', 'fights', 'objectives', 'counters', 'players', 'timeline'] as const
type Tab = (typeof TABS)[number]

export const Route = createFileRoute('/matches/$matchId')({
  params: {
    parse: (raw) => {
      const parsed = matchIdParam.safeParse(raw.matchId)
      if (!parsed.success) throw notFound()
      return { matchId: parsed.data }
    },
    stringify: ({ matchId }) => ({ matchId: String(matchId) }),
  },
  validateSearch: z.object({
    // The player whose page you came from (breadcrumb; analysis side if you weren't in the match).
    player: z.coerce.number().int().positive().optional(),
    tab: z.enum(TABS).optional().catch(undefined), // unknown (e.g. the old 'coach' tab) → Overview
    // Scoreboard row whose build is open; 0 = none.
    sel: z.coerce.number().int().nonnegative().optional(),
  }),
  loader: ({ params }) => window.api.matches.detail(params.matchId),
  component: MatchPage,
})

function MatchPage() {
  const result = Route.useLoaderData()
  const { player, sel, tab = 'overview' } = Route.useSearch()
  const { matchId } = Route.useParams()
  const router = useRouter()
  const navigate = useNavigate({ from: Route.fullPath })

  if (result.kind === 'unavailable') {
    return (
      <div className="mx-auto max-w-md py-16">
        <Card title={`Match ${matchId}`}>
          <div className="p-4">
            <p className="text-sm text-ink-2">{result.message}</p>
            <div className="mt-4 grid gap-3">
              <DownloadButton matchId={matchId} onDone={() => void router.invalidate()} />
              {player && (
                <Link
                  to="/players/$accountId"
                  params={{ accountId: player }}
                  className="inline-flex h-8 w-fit items-center rounded-md border border-line px-3 text-sm text-ink-2 hover:text-ink"
                >
                  Back to player
                </Link>
              )}
            </div>
          </div>
        </Card>
      </div>
    )
  }

  const { detail, heroes, items, avgRank, selfAccountId } = result
  // Your side if you played; otherwise the player whose page you came from.
  const viewer = detail.players.find((p) => p.accountId === selfAccountId) ?? detail.players.find((p) => p.accountId === player)
  const perspectiveTeam = viewer?.team ?? detail.winningTeam
  const perspective = viewer?.accountId === selfAccountId ? 'you' : viewer ? `${viewer.name}'s team` : teamName(perspectiveTeam)
  const won = perspectiveTeam === detail.winningTeam
  const teamColor = (team: number) => (team === 0 ? 'var(--color-team0)' : 'var(--color-team1)')
  const backTo = player ? detail.players.find((p) => p.accountId === player) : undefined

  // Open build: the tapped row, else whoever's perspective this is.
  const selected = sel === 0 ? null : (sel ?? viewer?.accountId ?? null)
  const toggle = (accountId: number) =>
    void navigate({ search: (prev) => ({ ...prev, sel: selected === accountId ? 0 : accountId }), replace: true, resetScroll: false })

  // Cheap (12 players), so no memo — and hooks can't follow the early return above.
  const analysis = hasAnalysisData(detail) ? analyzeMatch(detail, perspectiveTeam, (id) => heroes[id]?.name ?? `Hero ${id}`, items) : null
  const heroName = (id: number) => heroes[id]?.name ?? `Hero ${id}`
  const review = analysis ? coachReview(detail, analysis, heroName, viewer ? { accountId: viewer.accountId, isSelf: viewer.accountId === selfAccountId } : null) : null
  const reports = new Map((analysis?.players ?? []).map((r) => [r.accountId, r]))
  const tabs: { id: Tab; label: string; needsAnalysis?: boolean }[] = [
    { id: 'overview', label: 'Overview' },
    { id: 'scoreboard', label: 'Scoreboard' },
    { id: 'fights', label: 'Fights', needsAnalysis: true },
    { id: 'objectives', label: 'Objectives', needsAnalysis: true },
    { id: 'counters', label: 'Counters', needsAnalysis: true },
    { id: 'players', label: 'Players', needsAnalysis: true },
    { id: 'timeline', label: 'Timeline', needsAnalysis: true },
  ]
  const active: Tab = !analysis && tabs.find((t) => t.id === tab)?.needsAnalysis ? 'overview' : tab

  return (
    <div className="grid gap-6">
      <header className="grid gap-3">
        <nav className="flex items-center gap-1.5 text-sm text-muted" aria-label="Breadcrumb">
          {player ? (
            <Link to="/players/$accountId" params={{ accountId: player }} className="hover:text-ink">
              {backTo?.name ?? 'Player'}
            </Link>
          ) : (
            <Link to="/" className="hover:text-ink">
              Home
            </Link>
          )}
          <span aria-hidden>/</span>
          <span className="num text-ink-2">Match {detail.matchId}</span>
        </nav>
        <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
          <h1 className={`text-2xl font-semibold tracking-tight ${viewer ? (won ? 'text-win' : 'text-loss') : ''}`}>
            {viewer ? (won ? 'Victory' : 'Defeat') : `${teamName(detail.winningTeam)} won`}
          </h1>
          {viewer && (
            <span className="flex items-center gap-1.5 text-sm text-ink-2">
              <span className="h-2 w-2 rounded-full" style={{ background: teamColor(perspectiveTeam) }} />
              {viewer.accountId === selfAccountId ? '' : `${viewer.name} · `}
              {teamName(perspectiveTeam)}
            </span>
          )}
        </div>
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-muted">
          <span>{modeLabel(detail.gameMode, detail.matchMode)}</span>
          <span aria-hidden>·</span>
          <span className="num">{formatDuration(detail.durationS)}</span>
          <span aria-hidden>·</span>
          <LocalDateTime at={detail.startTime * 1000} />
          <span aria-hidden>·</span>
          <RankBadge rank={avgRank[perspectiveTeam] ?? avgRank[0] ?? null} size={14} />
        </div>
      </header>

      <TabBar>
        {tabs
          .filter((t) => !t.needsAnalysis || analysis)
          .map((t) => (
            <Link
              key={t.id}
              to="."
              search={(prev) => ({ ...prev, tab: t.id === 'overview' ? undefined : t.id })}
              replace
              resetScroll={false}
              role="tab"
              aria-selected={active === t.id}
              className={tabClass(active === t.id)}
            >
              {t.label}
            </Link>
          ))}
      </TabBar>

      {active === 'overview' && (
        <div className="grid gap-4">
          {review && (
            <div className="grid gap-4 lg:grid-cols-[3fr_2fr]">
              <VerdictCard review={review} won={won} />
              <FocusCard review={review} />
            </div>
          )}
          {analysis ? (
            <AnalysisSummary analysis={analysis} perspective={perspective} />
          ) : (
            <Card title="Analysis">
              <div className="grid gap-3 p-4">
                <p className="text-sm text-ink-2">
                  This match's details were saved by an older version. Download them again from Steam to see the full analysis.
                </p>
                <DownloadButton matchId={matchId} onDone={() => void router.invalidate()} />
              </div>
            </Card>
          )}
          <div className={`grid gap-4 ${analysis ? 'lg:grid-cols-[3fr_2fr]' : ''}`}>
            <Card title="Soul lead">
              <NetWorthChart timeline={detail.netWorthTimeline} />
            </Card>
            {analysis && <LanesCard lanes={analysis.lanes} heroes={heroes} />}
          </div>
        </div>
      )}

      {detail.v < MATCH_DETAIL_VERSION && <UpgradeBanner key={matchId} matchId={matchId} onDone={() => void router.invalidate()} />}

      {active === 'fights' && review && (
        <div className="grid gap-4">
          <FightReviewCard fights={review.fights} heroes={heroes} hasPositions={review.hasPositions} />
          {review.deathMap && <DeathMapCard map={review.deathMap} heroes={heroes} highlight={viewer?.accountId ?? null} />}
        </div>
      )}

      {active === 'objectives' &&
        analysis &&
        (hasObjectiveData(detail) ? (
          <ObjectivesView report={objectivesReport(detail, perspectiveTeam)} team={perspectiveTeam} heroes={heroes} highlight={viewer?.accountId ?? null} />
        ) : (
          <Card title="Objectives">
            <p className="p-4 text-sm text-ink-2">This match was saved before objective stats were recorded. It updates automatically when the cloud or community cache has the new version.</p>
          </Card>
        ))}

      {active === 'counters' && analysis && (
        <ThreatsCard counters={analysis.counters} heroes={heroes} items={items} highlight={viewer?.accountId ?? null} majorThreat={MAJOR_THREAT} />
      )}

      {active === 'scoreboard' && (
        <div className="grid gap-2">
          <Scoreboard detail={detail} heroes={heroes} items={items} avgRank={avgRank} selected={selected} onSelect={toggle} reports={reports} />
          <p className="text-xs text-muted">Click a row to see that player's build.</p>
        </div>
      )}

      {active === 'players' && analysis && (
        <div className="grid gap-4">
          {viewer && (
            <AreaReview
              analysis={analysis}
              accountId={viewer.accountId}
              title={viewer.accountId === selfAccountId ? 'Your game, by area' : `${viewer.name}'s game, by area`}
            />
          )}
          <PlayerReports analysis={analysis} heroes={heroes} highlight={viewer?.accountId ?? null} />
        </div>
      )}

      {active === 'timeline' && analysis && (
        <div className="grid gap-4">
          <Card title="Soul lead">
            <NetWorthChart timeline={detail.netWorthTimeline} />
          </Card>
          <KeyMoments moments={analysis.moments} />
        </div>
      )}
    </div>
  )
}

/**
 * Matches saved before positions were stored: try the free sources (cloud,
 * community cache) on open; only if both miss, offer the Steam download.
 */
function UpgradeBanner({ matchId, onDone }: { matchId: number; onDone: () => void }) {
  const [state, setState] = useState<'checking' | 'failed'>('checking')
  useEffect(() => {
    let alive = true
    void window.api.matches.upgrade(matchId).then((ok) => {
      if (!alive) return
      if (ok) onDone()
      else setState('failed')
    })
    return () => {
      alive = false
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- run once per match
  }, [matchId])
  return (
    <div className="card grid gap-3 p-4 text-sm">
      {state === 'checking' ? (
        <p className="text-ink-2">Updating this match with player positions…</p>
      ) : (
        <>
          <p className="text-ink-2">
            This match was saved before player positions were recorded, so rotation, fight presence and the death map aren't available. Neither the cloud nor the
            community cache has the new version yet.
          </p>
          <DownloadButton matchId={matchId} onDone={onDone} />
        </>
      )}
    </div>
  )
}

function DownloadButton({ matchId, onDone }: { matchId: number; onDone: () => void }) {
  const [state, setState] = useState<{ kind: 'idle' | 'busy' } | { kind: 'error'; message: string }>({ kind: 'idle' })
  const status = useSyncStatus()
  // getSyncStatus() clears expired pauses, and useSyncStatus refreshes at the
  // deadline, so a non-null backoff means Steam is paused right now.
  const pausedUntil = status?.detailsBackoffUntil ? new Date(status.detailsBackoffUntil) : null
  const paused = pausedUntil !== null
  return (
    <div className="grid gap-2">
      <button
        type="button"
        disabled={state.kind === 'busy'}
        onClick={() => {
          setState({ kind: 'busy' })
          void window.api.sync.match(matchId).then((r) => (r.ok ? onDone() : setState({ kind: 'error', message: r.message })))
        }}
        className="h-8 rounded-md bg-accent px-3 text-sm font-medium text-white hover:bg-accent-strong disabled:opacity-60"
      >
        {state.kind === 'busy' ? 'Downloading…' : 'Download match'}
      </button>
      {state.kind === 'error' ? (
        <p className="text-xs text-loss">{state.message}</p>
      ) : paused && pausedUntil ? (
        <p className="text-xs text-ink-2">
          Steam is paused until {pausedUntil.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}. Cached matches still download now; anything else
          waits.
        </p>
      ) : (
        <p className="text-xs text-muted">Uses one Steam request only if the match isn't already cached. Steam limits these, so avoid repeat downloads.</p>
      )}
    </div>
  )
}
