import styles from "./page.module.css";

const REPO_URL = "https://github.com/PRU-Blockchain/rung";

export default function Home() {
  return (
    <main className={styles.main}>
      <h1 className={styles.title}>Rung</h1>
      <p className={styles.tagline}>
        Stop guessing slippage. Stop feeding sandwich bots.
      </p>
      <p className={styles.status}>
        Work in progress. Nothing here is usable yet: the on-chain program,
        the Android app and the public counter are not deployed.
      </p>
      <a className={styles.link} href={REPO_URL}>
        Source on GitHub
      </a>
    </main>
  );
}
