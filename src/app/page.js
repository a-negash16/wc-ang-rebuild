const groups = ["Squad", "Tikur-Abay", "Dagi-United"];

export default function HomePage() {
  return (
    <main className="page">
      <section className="hero">
        <h1>Three groups, one cleaner prediction engine.</h1>
        <p>
          A parallel rebuild for manager picks, odds-weighted knockout scoring,
          commissioner controls, and explainable leaderboards.
        </p>
      </section>

      <section className="grid" aria-label="Groups">
        {groups.map((group) => (
          <article className="panel" key={group}>
            <span className="metric">0</span>
            <h2>{group}</h2>
            <p>Ready for seeded managers, matches, and prediction deadlines.</p>
          </article>
        ))}
      </section>

      <section className="section">
        <article className="panel">
          <h2>Build Order</h2>
          <div className="flow">
            <div className="step">
              <span>1</span>
              <strong>Rules</strong>
              <p>Tested scoring functions for group, knockout, draft, and futures.</p>
            </div>
            <div className="step">
              <span>2</span>
              <strong>Database</strong>
              <p>Supabase tables for groups, managers, matches, predictions, and audit.</p>
            </div>
            <div className="step">
              <span>3</span>
              <strong>Manager Picks</strong>
              <p>Name plus PIN login, today/tomorrow cards, and pick previews.</p>
            </div>
            <div className="step">
              <span>4</span>
              <strong>Commissioner</strong>
              <p>Results, scoring review, odds imports, and correction history.</p>
            </div>
          </div>
        </article>
      </section>
    </main>
  );
}
