export default function AdminPage() {
  return (
    <main className="page">
      <section className="hero">
        <h1>Commissioner Console</h1>
        <p>
          The first admin pass will manage matches, results, odds snapshots,
          prediction corrections, and scoring review.
        </p>
      </section>

      <section className="grid">
        <article className="panel">
          <h2>Matches</h2>
          <p>Set kickoff times, status, scores, winners, and match length.</p>
        </article>
        <article className="panel">
          <h2>Odds</h2>
          <p>Import Odds API snapshots and lock point values for knockout picks.</p>
        </article>
        <article className="panel">
          <h2>Audit</h2>
          <p>Review prediction changes and commissioner corrections.</p>
        </article>
      </section>
    </main>
  );
}
