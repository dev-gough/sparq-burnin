import type { Metadata } from "next";
import { SiteHeader } from "@/components/site-header";
import { ChangelogCompare } from "@/components/changelog-compare";
import { loadChangelog, readPackageVersion } from "@/lib/changelog";

export const metadata: Metadata = { title: "Changelog" };

export default function ChangelogPage() {
  const version = readPackageVersion();
  const entries = loadChangelog();
  return (
    <div className="ml-10 flex min-h-dvh flex-col">
      <SiteHeader title="Changelog" />
      <main className="mx-auto w-full max-w-3xl flex-1 px-4 py-6 lg:px-6">
        <p className="text-xs font-medium uppercase tracking-[0.15em] text-muted-foreground">Releases</p>
        <h1 className="mt-1 text-xl font-semibold tracking-tight">Changelog</h1>
        <p className="mt-2 max-w-2xl text-sm leading-relaxed text-muted-foreground">
          Notes start with the work in progress. The package is {version}. The next time master is published to GitHub, these notes become the next version and the message on its tag.
        </p>
        <ol className="mt-8 space-y-8">
          {entries.map(entry => (
            <li key={entry.id} className="border-t pt-6">
              <h2 className="font-mono text-base font-semibold tracking-tight">{entry.title}</h2>
              {entry.summary.map(paragraph => (
                <p key={paragraph} className="mt-2 text-sm leading-relaxed text-muted-foreground">{paragraph}</p>
              ))}
              {entry.sections.map(section => (
                <section key={section.name} className="mt-4" aria-label={section.name}>
                  <h3 className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">{section.name}</h3>
                  <ul className="mt-2 list-disc space-y-1.5 pl-5 text-sm leading-relaxed">
                    {section.items.map(item => <li key={item}>{item}</li>)}
                  </ul>
                </section>
              ))}
              {entry.shots.map(shot => (
                <ChangelogCompare key={`${shot.caption}:${shot.before}`} caption={shot.caption} before={shot.before} after={shot.after} />
              ))}
            </li>
          ))}
        </ol>
      </main>
    </div>
  );
}
