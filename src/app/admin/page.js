import AdminCorrectionsPanel from "./AdminCorrectionsPanel";

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
        <AdminCorrectionsPanel />
      </section>
    </main>
  );
}
