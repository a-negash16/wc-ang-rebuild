import { notFound } from "next/navigation";

const GROUPS = {
  squad: "Squad",
  "tikur-abay": "Tikur-Abay",
  "dagi-united": "Dagi-United",
};

export default function GroupPage({ params }) {
  const groupName = GROUPS[params.group];
  if (!groupName) notFound();

  return (
    <main className="page">
      <section className="hero">
        <h1>{groupName}</h1>
        <p>
          This page will host open prediction cards, manager pick previews,
          deadline-aware pulse reveals, and the group leaderboard.
        </p>
      </section>

      <section className="grid">
        <article className="panel">
          <span className="metric">PIN</span>
          <h2>Manager Unlock</h2>
          <p>Commissioner-managed PINs are verified server-side.</p>
        </article>
        <article className="panel">
          <span className="metric">60m</span>
          <h2>Deadline</h2>
          <p>Picks lock one hour before kickoff by backend enforcement.</p>
        </article>
        <article className="panel">
          <span className="metric">After</span>
          <h2>Pulse Reveal</h2>
          <p>Manager names appear only after each match deadline.</p>
        </article>
      </section>
    </main>
  );
}
