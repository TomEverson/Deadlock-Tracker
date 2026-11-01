import { useState } from 'react'
import { Card, HeroIcon, Segmented } from '~/components/ui'
import type { HeroInfo } from '@deadlock/core/domain/assets/types'
import { formatDuration, formatSouls, teamName } from '@deadlock/core/lib/format'
import { laneName } from '@deadlock/core/domain/matches/services/match-facts'
import type { Finding, LaneReport, MatchAnalysis, Moment, PlayerReport, Tone } from '@deadlock/core/domain/matches/services/analysis'

const TONE_TEXT: Record<Tone, string> = { good: 'text-win', bad: 'text-loss', info: 'text-ink-2' }
const TONE_DOT: Record<Tone, string> = { good: 'bg-win', bad: 'bg-loss', info: 'bg-muted' }
const GRADE_STYLE: Record<PlayerReport['grade'], string> = {
  S: 'bg-accent text-white',
  A: 'bg-win-bg text-win',
  B: 'bg-surface-2 text-ink',
  C: 'bg-surface-2 text-ink-2',
  D: 'bg-loss-bg text-loss',
}

export function GradeBadge({ grade, size = 'md' }: { grade: PlayerReport['grade']; size?: 'sm' | 'md' }) {
  return (
    <span
      className={`inline-grid shrink-0 place-items-center rounded font-semibold ${GRADE_STYLE[grade]} ${size === 'sm' ? 'h-4 w-4 text-[10px]' : 'h-7 w-7 text-sm'}`}
      title={`Impact grade ${grade}`}
    >
      {grade}
    </span>
  )
}

function FindingList({ findings, empty }: { findings: Finding[]; empty: string }) {
  if (findings.length === 0) return <p className="text-sm text-muted">{empty}</p>
  return (
    <ul className="grid gap-2.5">
      {findings.map((f, i) => (
        <li key={i} className="flex gap-2.5">
          <span className={`mt-1.5 h-2 w-2 shrink-0 rounded-full ${TONE_DOT[f.tone]}`} aria-hidden />
          <div className="min-w-0">
            <div className="text-sm">{f.title}</div>
            {f.detail && <div className="text-xs text-muted">{f.detail}</div>}
          </div>
        </li>
      ))}
    </ul>
  )
}

export function AnalysisSummary({ analysis, perspective }: { analysis: MatchAnalysis; perspective: string }) {
  const { won, finalSoulDiff } = analysis
  return (
    <Card
      title={won ? `Why ${perspective} won` : `Why ${perspective} lost`}
      right={
        <span className="num text-xs text-muted">
          final souls <span className={finalSoulDiff >= 0 ? 'text-win' : 'text-loss'}>{finalSoulDiff >= 0 ? '+' : '−'}{formatSouls(Math.abs(finalSoulDiff))}</span>
        </span>
      }
    >
      <div className="grid gap-6 p-4 md:grid-cols-2">
        <div>
          <div className="mb-3 text-xs font-medium text-loss">Where it went wrong</div>
          <FindingList findings={analysis.wentWrong.slice(0, 8)} empty="Nothing stood out — clean game." />
        </div>
        <div>
          <div className="mb-3 text-xs font-medium text-win">What went right</div>
          <FindingList findings={analysis.wentRight.slice(0, 8)} empty="Not much, this time." />
        </div>
      </div>
    </Card>
  )
}

export function KeyMoments({ moments }: { moments: Moment[] }) {
  return (
    <Card title="Key moments">
      {moments.length === 0 ? (
        <p className="p-4 text-sm text-muted">No big fights or objectives recorded.</p>
      ) : (
        <ol className="p-4">
          {moments.map((m, i) => (
            <li key={i} className="flex gap-3 pb-3 last:pb-0">
              <span className="num w-11 shrink-0 pt-0.5 text-right text-xs text-muted">{formatDuration(m.t)}</span>
              <span className={`mt-1.5 h-2 w-2 shrink-0 rounded-full ${TONE_DOT[m.tone]}`} aria-hidden />
              <span className={`text-sm ${m.tone === 'info' ? 'text-ink-2' : ''}`}>{m.text}</span>
            </li>
          ))}
        </ol>
      )}
    </Card>
  )
}

function heroOf(heroes: Record<number, HeroInfo>, id: number): HeroInfo {
  return heroes[id] ?? { id, name: `Hero ${id}`, icon: null, card: null }
}

export function LanesCard({ lanes, heroes }: { lanes: LaneReport[]; heroes: Record<number, HeroInfo> }) {
  return (
    <Card title={lanes[0] ? `Lanes at ${formatDuration(lanes[0].at)}` : 'Lanes'}>
      {lanes.length === 0 ? (
        <p className="p-4 text-sm text-muted">No lane data.</p>
      ) : (
        <ul className="divide-y divide-line">
          {lanes.map((l) => {
            const tone: Tone = l.soulDiff >= 500 ? 'good' : l.soulDiff <= -500 ? 'bad' : 'info'
            return (
              <li key={l.lane} className="flex items-center gap-3 px-4 py-3">
                <span className="w-24 shrink-0 text-xs text-ink-2">{laneName(l.lane)}</span>
                <div className="flex -space-x-1">
                  {l.ours.map((p) => (
                    <HeroIcon key={p.accountId} hero={heroOf(heroes, p.heroId)} size={28} />
                  ))}
                </div>
                <span className="text-xs text-muted">vs</span>
                <div className="flex -space-x-1">
                  {l.theirs.map((p) => (
                    <HeroIcon key={p.accountId} hero={heroOf(heroes, p.heroId)} size={28} />
                  ))}
                </div>
                <div className="ml-auto text-right">
                  <div className={`num text-sm ${TONE_TEXT[tone]}`}>
                    {l.soulDiff >= 0 ? '+' : '−'}
                    {formatSouls(Math.abs(l.soulDiff))}
                  </div>
                  <div className="num text-xs text-muted">LH {l.lastHitDiff >= 0 ? '+' : ''}{l.lastHitDiff}</div>
                </div>
              </li>
            )
          })}
        </ul>
      )}
    </Card>
  )
}

function PlayerReportCard({ report, hero, highlight }: { report: PlayerReport; hero: HeroInfo; highlight: boolean }) {
  const [expanded, setExpanded] = useState(false)
  const bad = report.findings.filter((f) => f.tone === 'bad')
  const good = report.findings.filter((f) => f.tone === 'good')
  const shown = expanded ? report.findings : [...bad.slice(0, 3), ...good.slice(0, 2)]
  const hidden = report.findings.length - shown.length
  return (
    <section className={`card flex flex-col ${highlight ? 'ring-1 ring-accent/50' : ''}`}>
      <header className="flex items-center gap-3 border-b border-line px-4 py-3">
        <HeroIcon hero={hero} size={36} />
        <div className="min-w-0 flex-1">
          <div className="truncate font-medium">{report.name}</div>
          <div className="text-xs text-muted">
            {hero.name} · impact #{report.impactRank} of 12
            {report.mvpRank === 1 ? <span className="text-ink-2"> · MVP</span> : null}
          </div>
        </div>
        <GradeBadge grade={report.grade} />
      </header>
      <dl className="grid grid-cols-3 gap-px border-b border-line bg-line">
        {report.metrics.map((m) => (
          <div key={m.label} className="bg-surface px-3 py-2">
            <dt className="truncate text-[11px] text-muted">{m.label}</dt>
            <dd className={`num text-sm ${TONE_TEXT[m.tone]}`}>{m.value}</dd>
            {m.compare && <dd className="num truncate text-[10px] text-muted">{m.compare}</dd>}
          </div>
        ))}
      </dl>
      <div className="flex-1 p-4">
        <FindingList findings={shown} empty="Solid, nothing flagged." />
        {hidden > 0 && (
          <button type="button" onClick={() => setExpanded(true)} className="mt-3 text-xs text-muted hover:text-ink">
            Show {hidden} more
          </button>
        )}
      </div>
    </section>
  )
}

export function PlayerReports({
  analysis,
  heroes,
  highlight,
}: {
  analysis: MatchAnalysis
  heroes: Record<number, HeroInfo>
  highlight: number | null
}) {
  const [side, setSide] = useState<'ours' | 'theirs'>('ours')
  const team = side === 'ours' ? analysis.team : 1 - analysis.team
  const reports = analysis.players.filter((r) => r.team === team)
  return (
    <div className="grid gap-3">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <Segmented<'ours' | 'theirs'>
          value={side}
          onChange={setSide}
          options={[
            { value: 'ours', label: `Your side · ${teamName(analysis.team)}` },
            { value: 'theirs', label: `Enemy · ${teamName(1 - analysis.team)}` },
          ]}
        />
      </div>
      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
        {reports.map((r) => (
          <PlayerReportCard key={r.accountId} report={r} hero={heroOf(heroes, r.heroId)} highlight={r.accountId === highlight} />
        ))}
      </div>
      <p className="text-xs text-muted">
        Grades compare each player with the other 11 in this lobby (souls, damage, objective damage, KDA, deaths, healing), so they adapt to rank and game length.
      </p>
    </div>
  )
}
