import Image from "next/image";
import { Suspense, type ReactNode } from "react";

import { COPY } from "@/lib/copy";
import { MAX_SIGNATURES, getCounter, type CounterData } from "@/lib/counter";
import { STATUS, explorerAddress, explorerTx } from "@/lib/status";

import styles from "./page.module.css";

/** Renders the prompt's `*italic*` markup as <em>. */
function Rich({ text }: { text: string }) {
  const parts = text.split("*");
  return (
    <>
      {parts.map((p, i) => (i % 2 === 1 ? <em key={i}>{p}</em> : p))}
    </>
  );
}

function Section({ id, title, children }: { id: string; title: ReactNode; children: ReactNode }) {
  return (
    <section id={id} className={styles.section} aria-labelledby={`${id}-h`}>
      <h2 id={`${id}-h`}>{title}</h2>
      {children}
    </section>
  );
}

const sol = (lamports: number) => `${(lamports / 1e9).toFixed(9).replace(/0+$/, "").replace(/\.$/, "")} SOL`;
const pct = (bps: number) => `${(bps / 100).toFixed(2).replace(/\.?0+$/, "")}%`;
const utc = (ms: number) => new Date(ms).toISOString().slice(0, 16).replace("T", " ") + " UTC";

export default function Home() {
  return (
    <main className={styles.main}>
      <header className={styles.hero}>
        <h1>{COPY.title}</h1>
        <p className={styles.lead}>{COPY.intro}</p>
        <ul className={styles.bullets}>
          {COPY.bullets.map((b) => (
            <li key={b}>{b}</li>
          ))}
        </ul>
        <p className={styles.status}>
          <span className={styles.badge}>{STATUS.network}</span> {STATUS.networkLine} · {STATUS.audit} ·{" "}
          {STATUS.devices}
        </p>
      </header>

      <Section id="terms" title={COPY.termsHeading}>
        {COPY.terms.map((t) => (
          <p key={t}>
            <Rich text={t} />
          </p>
        ))}
      </Section>

      <Section id="pluses" title={COPY.plusesHeading}>
        <ul className={styles.plain}>
          {COPY.pluses.map((t) => (
            <li key={t}>
              <Rich text={t} />
            </li>
          ))}
        </ul>
      </Section>

      <Section id="modes" title={COPY.modesHeading}>
        <div className={styles.tableWrap}>
          <table>
            <thead>
              <tr>
                {COPY.modeHeader.map((h) => (
                  <th key={h} scope="col">
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {COPY.modes.map((row) => (
                <tr key={row[0]}>
                  {row.map((cell, i) =>
                    i === 0 ? (
                      <th key={i} scope="row">
                        {cell}
                      </th>
                    ) : (
                      <td key={i}>{cell}</td>
                    ),
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p>
          <Rich text={COPY.modesNote} />
        </p>
      </Section>

      <Section id="numbers" title={COPY.numbersHeading}>
        <ul className={styles.plain}>
          {COPY.numbers.map((t) => (
            <li key={t}>{t}</li>
          ))}
        </ul>
        <h3>{COPY.sourcesHeading}</h3>
        <ul className={styles.links}>
          {COPY.sources.map((u) => (
            <li key={u}>
              <a href={u} rel="noopener noreferrer">
                {u}
              </a>
            </li>
          ))}
        </ul>
      </Section>

      <Section id="try" title={COPY.tryHeading}>
        <p>
          {STATUS.apkUrl ? (
            <>
              {COPY.apkReady} <a href={STATUS.apkUrl}>{STATUS.apkUrl}</a>
            </>
          ) : (
            COPY.apkNotYet
          )}
        </p>
        <p>{COPY.trySource}</p>
        <ul className={styles.links}>
          <li>
            <a href={STATUS.repoUrl}>{STATUS.repoUrl}</a>
          </li>
          {COPY.trySections.map((s) => (
            <li key={s.anchor}>
              <a href={`${STATUS.repoUrl}#${s.anchor}`}>README: {s.label}</a>
            </li>
          ))}
        </ul>
        <p>{COPY.shotsIntro}</p>
        <div className={styles.shots}>
          {COPY.shots.map((s) => (
            <figure key={s.src}>
              <Image src={s.src} alt={s.alt} width={1080} height={2400} sizes="(max-width: 640px) 80vw, 220px" />
              <figcaption>{s.caption}</figcaption>
            </figure>
          ))}
        </div>
      </Section>

      <Suspense
        fallback={
          <Section id="counter" title={COPY.counterHeading}>
            <p>{COPY.counterLoading}</p>
          </Section>
        }
      >
        <Live />
      </Suspense>

      <footer className={styles.footer}>
        <p>
          {COPY.footerOpenSource} · {COPY.footerLicense} {STATUS.license} ·{" "}
          <a href={STATUS.repoUrl}>{COPY.footerRepo}</a>
        </p>
        <p>
          {COPY.footerProgram} ({STATUS.network}):{" "}
          <a className={styles.mono} href={explorerAddress(STATUS.programId)}>
            {STATUS.programId}
          </a>
        </p>
      </footer>
    </main>
  );
}

async function Live() {
  const result = await getCounter();
  const heading = (
    <>
      {COPY.counterHeading} <span className={styles.badge}>{STATUS.network}</span>
    </>
  );
  if (!result.ok) {
    return (
      <>
        <Section id="counter" title={heading}>
          <p className={styles.warn}>
            {COPY.counterUnavailable}. {COPY.lastRead}{" "}
            {result.lastGood ? utc(result.lastGood.readAt) : COPY.neverRead}.
          </p>
          {result.lastGood && <CounterBody d={result.lastGood} />}
        </Section>
        {result.lastGood && <Recent d={result.lastGood} />}
      </>
    );
  }
  return (
    <>
      <Section id="counter" title={heading}>
        <CounterBody d={result.data} />
      </Section>
      <Recent d={result.data} />
    </>
  );
}

function CounterBody({ d }: { d: CounterData }) {
  const L = COPY.labels;
  const rows: [string, string][] = [
    [L.opened, String(d.opened)],
    [L.filled, String(d.filled)],
    [L.notBought, String(d.notBought)],
    [L.cancelled, String(d.cancelled)],
    ...(d.stillOpen ? [[L.open, String(d.stillOpen)] as [string, string]] : []),
    [L.avgRung, d.avgRungBps === null ? "–" : pct(d.avgRungBps)],
    [L.doubleBuys, String(d.doubleBuys)],
    [L.feesTotal, sol(d.feesLamports.total)],
    [L.feesOpen, sol(d.feesLamports.openOrder)],
    [L.feesTries, sol(d.feesLamports.tryRung)],
    [L.feesOther, sol(d.feesLamports.refundCancel)],
  ];
  return (
    <>
      <dl className={styles.stats}>
        {rows.map(([k, v]) => (
          <div key={k}>
            <dt>{k}</dt>
            <dd>{v}</dd>
          </div>
        ))}
      </dl>
      <p className={styles.small}>{COPY.doubleBuyDefinition}</p>
      <p className={styles.small}>
        {COPY.failedTriesLine(d.failedTries.slippage, d.failedTries.orderFilled, d.failedTries.other)}
      </p>

      <h3>{COPY.rungDistHeading}</h3>
      <div className={styles.tableWrap}>
        <table>
          <thead>
            <tr>
              {COPY.rungDistHeader.map((h) => (
                <th key={h} scope="col">
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {d.rungs.map((r) => (
              <tr key={`${r.rungIndex}:${r.rungBps}`}>
                <td>{r.rungIndex + 1}</td>
                <td>{pct(r.rungBps)}</td>
                <td>{r.buys}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <p>{COPY.counterNote}</p>
      <p className={styles.small}>
        {COPY.readLine(utc(d.readAt), MAX_SIGNATURES, d.signaturesRead, d.programTransactions.total, d.programTransactions.failed)}
        {d.transactionsSkipped > 0 && ` ${COPY.skippedLine(d.transactionsSkipped)}`}
        {d.eventsWithoutOpenInWindow > 0 && ` ${COPY.orphanLine(d.eventsWithoutOpenInWindow)}`}
      </p>
    </>
  );
}

function Recent({ d }: { d: CounterData }) {
  return (
    <Section id="recent" title={COPY.recentHeading}>
      {d.recent.length === 0 ? (
        <p>{COPY.recentEmpty}</p>
      ) : (
        <div className={styles.tableWrap}>
          <table>
            <thead>
              <tr>
                {COPY.recentHeader.map((h) => (
                  <th key={h} scope="col">
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {d.recent.map((r) => (
                <tr key={r.signature}>
                  <td>{r.time === null ? "–" : utc(r.time * 1000)}</td>
                  <td>
                    {r.outcome === "bought" ? COPY.boughtOn((r.rungIndex ?? 0) + 1, pct(r.rungBps ?? 0)) : COPY.notBought}
                  </td>
                  <td>
                    <a className={styles.mono} href={explorerTx(r.signature)}>
                      {r.signature.slice(0, 8)}… ({COPY.explorer})
                    </a>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Section>
  );
}
