import { Suspense, type ReactNode } from "react";

import { COPY } from "@/lib/copy";
import { MAX_SIGNATURES, getCounter, type CounterData } from "@/lib/counter";
import { STATUS, explorerAddress, explorerTx } from "@/lib/status";

import PhoneStage from "./phone-stage";
import "./phone/phone.css";

/** Rows of "Recent buys" on the page; the full list is on Solana Explorer. */
const RECENT_SHOWN = 5;
const PRESS_KIT = "https://solanamobile.com/press";
const NETWORK_LABEL = STATUS.network === "mainnet-beta" ? "mainnet" : STATUS.network;

// Sets the phone's scale (--pz) right after the first screen is parsed, before the first paint, so the phone does not
// jump when the page hydrates. The same function as fitPhone in app/phone-stage.tsx, which keeps it up to date.
const FIT_PHONE = `(function(){function f(){var s=1;if(!matchMedia("(max-width: 600px)").matches){var w=document.querySelector(".hero .wrap");if(w){var t=w.getBoundingClientRect().top+scrollY+parseFloat(getComputedStyle(w).paddingTop);s=Math.max(0.55,Math.min(1,(innerHeight-t-14)/777))}}document.documentElement.style.setProperty("--pz",s.toFixed(3))}f();window.__rungFitPhone=f})();`;

/** Renders the prompt's `*italic*` markup as <em>. */
function Rich({ text }: { text: string }) {
  const parts = text.split("*");
  return (
    <>
      {parts.map((p, i) => (i % 2 === 1 ? <em key={i}>{p}</em> : p))}
    </>
  );
}

/** "(1) *No guessing.* Even if…" → number, title and body, for the sections that open. */
function plus(text: string): { n: string; title: string; body: string } {
  const m = /^\((\d+)\) \*(.+?)\* (.+)$/.exec(text);
  return m ? { n: m[1], title: m[2], body: m[3] } : { n: "", title: text, body: "" };
}

function NetworkPill() {
  return (
    <span className="pill">
      <i />
      {NETWORK_LABEL}
    </span>
  );
}

function Mark() {
  return (
    <svg viewBox="0 0 20 20" aria-hidden="true">
      <path d="M5 2v16M15 2v16" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
      <path d="M5 10h10M5 5.5h10" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" />
      <path d="M5 14.5h10" stroke="#FFC233" strokeWidth="2.6" strokeLinecap="round" />
    </svg>
  );
}

const sol = (lamports: number) => `${(lamports / 1e9).toFixed(9).replace(/0+$/, "").replace(/\.$/, "")} SOL`;
const pct = (bps: number) => `${(bps / 100).toFixed(2).replace(/\.?0+$/, "")}%`;
const utc = (ms: number) => new Date(ms).toISOString().slice(0, 16).replace("T", " ") + " UTC";
const isVideoFile = (url: string) => /\.(mp4|webm|mov)(\?|#|$)/i.test(url);

export default function Home() {
  const [name, claim] = COPY.title.split(" — ");
  return (
    <>
      <header className="nav">
        <div className="wrap">
          <a className="brand" href="#top" aria-label="Rung">
            <Mark />
            Rung
          </a>
          <NetworkPill />
          <nav className="nav-links" aria-label="Sections">
            <a href="#counter">{COPY.counterHeading}</a>
            <a href="#how">{COPY.howHeading}</a>
            <a href={STATUS.repoUrl} rel="noopener noreferrer">
              {COPY.repository}
            </a>
          </nav>
        </div>
      </header>

      <main id="top">
        <section className="hero">
          <div className="wrap">
            <div className="hero-copy">
              <h1>
                {name} <span>—</span> {claim}
              </h1>
              <p className="lead">{COPY.answer}</p>
              <div className="cta">
                {STATUS.videoUrl && (
                  <a className="btn primary" href="#video">
                    <svg viewBox="0 0 24 24" aria-hidden="true">
                      <path d="M8 5.5v13l10.5-6.5Z" fill="currentColor" />
                    </svg>
                    {COPY.watchVideo}
                  </a>
                )}
                <a className="btn" href={STATUS.repoUrl} rel="noopener noreferrer">
                  <svg
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="1.8"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    aria-hidden="true"
                  >
                    <path d="m8 7-5 5 5 5M16 7l5 5-5 5" />
                  </svg>
                  {COPY.repository}
                </a>
              </div>
              <p className="meta-line">
                <NetworkPill /> {STATUS.audit}
              </p>
            </div>

            <PhoneStage
              label={COPY.replayLabel}
              chips={{ app: COPY.boughtOn(1, "1%"), climb: COPY.boughtOn(2, "2%"), nobuy: COPY.notBought }}
              notes={COPY.replayNotes}
            />
          </div>
        </section>
        <script dangerouslySetInnerHTML={{ __html: FIT_PHONE }} />

        <section className="band" aria-label={COPY.bandLabel}>
          <div className="wrap">
            <ul className="strip">
              {COPY.band.map((b) => (
                <li key={b.big}>
                  <b>{b.big}</b>
                  <span>{b.text}</span>
                  {b.small && <small>{b.small}</small>}
                </li>
              ))}
            </ul>
          </div>
        </section>

        {STATUS.videoUrl && (
          <section className="block" id="video" aria-label={COPY.videoLabel}>
            <div className="wrap">
              <div className="video">
                {isVideoFile(STATUS.videoUrl) ? (
                  <video src={STATUS.videoUrl} controls preload="metadata" playsInline />
                ) : (
                  <iframe src={STATUS.videoUrl} title={COPY.videoLabel} allow="fullscreen; picture-in-picture" allowFullScreen />
                )}
              </div>
            </div>
          </section>
        )}

        <Suspense
          fallback={
            <CounterSection>
              <p className="small">{COPY.counterLoading}</p>
            </CounterSection>
          }
        >
          <Live />
        </Suspense>

        <section className="block" id="how" aria-labelledby="how-h">
          <div className="wrap">
            <h2 id="how-h">{COPY.howHeading}</h2>
            <p className="intro">{COPY.problem}</p>

            <h3>{COPY.plusesHeading}</h3>
            <div className="gets">
              {COPY.pluses.map((text) => {
                const p = plus(text);
                return (
                  <details key={p.n}>
                    <summary>
                      <span>
                        <span className="n">({p.n})</span>
                        {p.title}
                      </span>
                    </summary>
                    <p>{p.body}</p>
                  </details>
                );
              })}
            </div>

            <h3>{COPY.modesHeading}</h3>
            <div className="tablewrap">
              <table className="modes">
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
                          <td key={i} className={i === 3 ? "num" : undefined}>
                            {cell}
                          </td>
                        ),
                      )}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p className="note">
              <Rich text={COPY.modesNote} />
            </p>

            <details className="fold">
              <summary>{COPY.termsHeading}</summary>
              <div className="fold-body terms">
                {COPY.terms.map((t) => (
                  <p key={t}>
                    <Rich text={t} />
                  </p>
                ))}
              </div>
            </details>
            <details className="fold">
              <summary>{COPY.numbersHeading}</summary>
              <div className="fold-body">
                {COPY.numbers.map((t) => (
                  <p key={t}>{t}</p>
                ))}
                <h3>{COPY.sourcesHeading}</h3>
                <ul className="src">
                  {COPY.sources.map((u, i) => {
                    const [label, what] = COPY.sourceNames[i];
                    return (
                      <li key={u}>
                        <a href={u} rel="noopener noreferrer">
                          {label}
                          {what && <span>{what}</span>}
                        </a>
                      </li>
                    );
                  })}
                </ul>
              </div>
            </details>
          </div>
        </section>

        <section className="block" id="try" aria-labelledby="try-h">
          <div className="wrap">
            <h2 id="try-h">{COPY.tryHeading}</h2>
            <p>
              {STATUS.apkUrl ? (
                <>
                  {COPY.apkReady} <a href={STATUS.apkUrl}>{STATUS.apkUrl}</a>
                </>
              ) : (
                COPY.apkNotYet
              )}
            </p>
            <p className="small">{STATUS.devices}</p>
            <p>{COPY.trySource}</p>
            <ul className="links-list">
              <li>
                <a href={STATUS.repoUrl} rel="noopener noreferrer">
                  {STATUS.repoUrl}
                </a>
              </li>
              {COPY.trySections.map((s) => (
                <li key={s.anchor}>
                  <a href={`${STATUS.repoUrl}#${s.anchor}`} rel="noopener noreferrer">
                    README: {s.label}
                  </a>
                </li>
              ))}
            </ul>
          </div>
        </section>
      </main>

      <footer className="foot">
        <div className="wrap">
          <p>
            {COPY.footerOpenSource} · {COPY.footerLicense} {STATUS.license} ·{" "}
            <a href={STATUS.repoUrl} rel="noopener noreferrer">
              {COPY.footerRepo}
            </a>
          </p>
          <p>
            {COPY.footerProgram} ({STATUS.network}):{" "}
            <a className="mono" href={explorerAddress(STATUS.programId)} rel="noopener noreferrer">
              {STATUS.programId}
            </a>
          </p>
          <p>
            {COPY.footerSeeker}{" "}
            <a href={PRESS_KIT} rel="noopener noreferrer">
              {COPY.footerPressKit}
            </a>
          </p>
        </div>
      </footer>
    </>
  );
}

function CounterSection({ children }: { children: ReactNode }) {
  return (
    <section className="block" id="counter" aria-labelledby="counter-h">
      <div className="wrap">
        <h2 id="counter-h">
          {COPY.counterHeading} <NetworkPill />
        </h2>
        {children}
      </div>
    </section>
  );
}

async function Live() {
  const result = await getCounter();
  if (!result.ok) {
    return (
      <CounterSection>
        <p className="warn">
          {COPY.counterUnavailable}. {COPY.lastRead} {result.lastGood ? utc(result.lastGood.readAt) : COPY.neverRead}.
        </p>
        {result.lastGood && <CounterBody d={result.lastGood} />}
      </CounterSection>
    );
  }
  return (
    <CounterSection>
      <CounterBody d={result.data} />
    </CounterSection>
  );
}

function CounterBody({ d }: { d: CounterData }) {
  const L = COPY.labels;
  const more: [string, string][] = [
    [L.openedOnPools, String(d.openedOnPools)],
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
      <div className="tiles">
        <div className="tile">
          <span className="v">{d.opened}</span>
          <span className="k">{L.opened}</span>
        </div>
        <div className="tile">
          <span className="v">{d.filled}</span>
          <span className="k">{L.filled}</span>
        </div>
        <div className="tile">
          <span className="v">{d.notBought}</span>
          <span className="k">{L.notBought}</span>
        </div>
      </div>
      <p className="caveat">
        {COPY.counterNote}
        {STATUS.network === "devnet" && ` ${COPY.counterNoteDevnet}`}
      </p>

      <details className="fold">
        <summary>{COPY.counterMore}</summary>
        <div className="fold-body">
          <dl className="stats">
            {more.map(([k, v]) => (
              <div key={k}>
                <dt>{k}</dt>
                <dd>{v}</dd>
              </div>
            ))}
          </dl>
          <p className="small gap-top">{COPY.doubleBuyDefinition}</p>
          <p className="small">
            {COPY.failedTriesLine(d.failedTries.slippage, d.failedTries.orderFilled, d.failedTries.other)}
          </p>
          <h3>{COPY.rungDistHeading}</h3>
          <div className="tablewrap">
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
              <tbody className="num">
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
          <p className="small gap-top">
            {COPY.readLine(utc(d.readAt), MAX_SIGNATURES, d.signaturesRead, d.programTransactions.total, d.programTransactions.failed)}
            {d.transactionsSkipped > 0 && ` ${COPY.skippedLine(d.transactionsSkipped)}`}
            {d.eventsWithoutOpenInWindow > 0 && ` ${COPY.orphanLine(d.eventsWithoutOpenInWindow)}`}
          </p>
        </div>
      </details>

      <h3>{COPY.recentHeading}</h3>
      {d.recent.length === 0 ? (
        <p>{COPY.recentEmpty}</p>
      ) : (
        <div className="tablewrap">
          <table className="recent">
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
              {d.recent.slice(0, RECENT_SHOWN).map((r) => (
                <tr key={r.signature}>
                  <td>{r.time === null ? "–" : utc(r.time * 1000)}</td>
                  <td>{r.outcome === "bought" ? COPY.boughtOn((r.rungIndex ?? 0) + 1, pct(r.rungBps ?? 0)) : COPY.notBought}</td>
                  <td>
                    <a className="mono" href={explorerTx(r.signature)} rel="noopener noreferrer">
                      {r.signature.slice(0, 8)}… ({COPY.explorer})
                    </a>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <p className="small more-link">
        <a href={explorerAddress(STATUS.programId)} rel="noopener noreferrer">
          {COPY.explorerAll}
        </a>
      </p>
    </>
  );
}
