/**
 * Who made the map, in the map's own hand.
 *
 * One component, used on the outreach page and inside the About drawer, so the
 * details are written once and read the same way in both places.
 */
import { AUTHOR } from '../../data/author';

interface MakerCreditProps {
  /** `full` lists every way to make contact; `compact` is a single line. */
  readonly variant?: 'full' | 'compact';
}

function Row({ label, href, children }: { label: string; href: string; children: string }): JSX.Element {
  return (
    <li className="flex flex-wrap items-baseline gap-x-2">
      <span className="w-20 shrink-0 text-sm text-ink-faded">{label}</span>
      <a
        href={href}
        target={href.startsWith('http') ? '_blank' : undefined}
        rel={href.startsWith('http') ? 'noreferrer noopener' : undefined}
        className="min-w-0 break-all text-base text-ink underline decoration-dotted underline-offset-4 hover:text-ember"
      >
        {children}
      </a>
    </li>
  );
}

export function MakerCredit({ variant = 'full' }: MakerCreditProps): JSX.Element {
  if (variant === 'compact') {
    return (
      <p className="text-sm text-ink-faded">
        Made by{' '}
        <a
          href={AUTHOR.portfolio}
          target="_blank"
          rel="noreferrer noopener"
          className="hand text-base text-ink underline decoration-dotted underline-offset-4 hover:text-ember"
        >
          {AUTHOR.name}
        </a>
      </p>
    );
  }

  return (
    <section>
      <h3 className="hand text-lg text-ink">Made by {AUTHOR.name}</h3>
      <ul className="mt-2 flex flex-col gap-1.5">
        <Row label="Email" href={`mailto:${AUTHOR.email}`}>
          {AUTHOR.email}
        </Row>
        <Row label="GitHub" href={AUTHOR.github}>
          {AUTHOR.githubHandle}
        </Row>
        <Row label="Portfolio" href={AUTHOR.portfolio}>
          {AUTHOR.portfolioLabel}
        </Row>
        <Row label="Source" href={AUTHOR.repo}>
          {AUTHOR.repoLabel}
        </Row>
      </ul>
    </section>
  );
}
