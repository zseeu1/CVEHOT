import { Link } from "react-router";
import type { HotStripEntry } from "@aihot/contracts/site";
import { IconArrowRight } from "../../components/icons";
import { Faces } from "../hot/Faces";

// As on the original list: the top three in the ranking colours at the heaviest weight.
const RANK_COLOR = ["text-[15px] font-black text-rank-1", "text-[15px] font-black text-rank-2", "text-[15px] font-black text-rank-3"];

function hrefOf(e: HotStripEntry): string {
  return e.storyPublicId ? `/story/${e.storyPublicId}` : e.itemId ? `/items/${e.itemId}` : "/hot";
}

/**
 * The top of the hot ranking on the home page, kept quiet: a live dot, coloured ranks and titles, then
 * columns of fixed width so every row lines up — who is covering it (精选组 faces, from sm) and the
 * handling priority. The whole row lights up on hover. Phones show the top three in one line each, so
 * the feed starts on the first screen.
 */
export function HotTopics({ entries }: { entries: HotStripEntry[] }) {
  if (entries.length === 0) return null;
  return (
    <section
      aria-labelledby="hot-topics"
      className="card relative mb-4 overflow-hidden bg-[radial-gradient(120%_90%_at_100%_0%,var(--hot-soft),transparent_55%)] px-3.5 pb-1 pt-2.5 lg:mb-6 lg:px-5 lg:pb-2 lg:pt-3.5"
    >
      <div className="flex items-center justify-between lg:mb-1">
        <h2 id="hot-topics" className="flex items-center gap-2 text-[14px] font-semibold text-ink">
          <span className="relative flex size-2" aria-hidden="true">
            <span className="absolute inline-flex size-full animate-ping rounded-full bg-hot opacity-40" />
            <span className="relative inline-flex size-2 rounded-full bg-hot" />
          </span>
          当前热点
        </h2>
        <Link to="/hot" className="group -my-2 -mr-1.5 inline-flex h-10 items-center gap-1 px-1.5 text-[12.5px] text-ink-3 transition-colors hover:text-accent lg:my-0 lg:mr-0 lg:h-auto lg:px-0">
          完整榜单 <IconArrowRight size={13} className="transition-transform duration-200 group-hover:translate-x-0.5" />
        </Link>
      </div>
      <ol>
        {entries.slice(0, 5).map((e, i) => (
          <li key={e.rank} className={i >= 3 ? "max-sm:hidden" : undefined}>
            <Link viewTransition
              to={hrefOf(e)}
              className="group -mx-2 grid min-h-10 sm:min-h-0 grid-cols-[20px_minmax(0,1fr)_auto] items-center gap-x-3 rounded-tile px-2 py-1.5 transition-colors hover:bg-bg-sunk/70 active:bg-bg-sunk sm:grid-cols-[20px_minmax(0,1fr)_120px_64px] sm:gap-x-4 sm:py-2 dark:hover:bg-bg-muted/40"
            >
              <span className={`num text-center leading-none ${RANK_COLOR[i] ?? "text-[14px] font-bold text-rank-rest"}`}>{e.rank}</span>
              <span className="line-clamp-1 min-w-0 text-[14.5px] font-semibold leading-[1.5] text-ink transition-colors group-hover:text-accent lg:text-[14px]">{e.title}</span>
              <span className="hidden justify-end sm:flex">
                <Faces participants={e.participants} total={e.participantCount} size={20} interactive={false} />
              </span>
              <span className="whitespace-nowrap text-right text-[12.5px] text-ink-4" title="处置优先级">
                <span className="num text-[13.5px] font-semibold text-ink-2">{Math.round(e.heat)}</span> 分
              </span>
            </Link>
          </li>
        ))}
      </ol>
    </section>
  );
}
