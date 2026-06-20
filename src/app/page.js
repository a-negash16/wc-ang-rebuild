import { getGroups } from "@/data/league";

export const dynamic = "force-dynamic";

export default async function HomePage() {
  const groups = await getGroups();

  return (
    <main className="page home-page">
      <section className="hero home-hero">
        <span className="eyebrow">WC ANG</span>
        <h1>Choose your group.</h1>
        <p>Open your group page, unlock with your manager PIN, and submit picks before the lock.</p>
      </section>

      <section className="section group-picker" aria-label="Groups">
        {groups.map((group) => (
          <article className={`panel group-card theme-${group.slug}`} key={group.slug}>
            <h2>{group.name}</h2>
            <p>Manager picks, standings, prediction pulse, and recent results.</p>
            <a href={`/${group.slug}`}>Open group</a>
          </article>
        ))}
      </section>
    </main>
  );
}
