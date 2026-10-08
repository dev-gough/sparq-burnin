import type { Metadata } from "next";
import { ChevronRight } from "lucide-react";
import { SiteHeader } from "@/components/site-header";
import { ChangelogCompare } from "@/components/changelog-compare";
import { groupChangelog, loadChangelog, readPackageVersion, type ChangelogEntry } from "@/lib/changelog";
import { cn } from "@/lib/utils";

export const metadata: Metadata = { title: "Changelog" };

function ReleaseNotes({ entry, compact = false }: { entry: ChangelogEntry; compact?: boolean }) {
  const SectionHeading = compact ? "h4" : "h3";
  return (
    <>
      {entry.summary.map(paragraph => (
        <p key={paragraph} className={cn("mt-2 leading-relaxed text-muted-foreground", compact ? "text-xs" : "text-sm")}>{paragraph}</p>
      ))}
      {entry.sections.map(section => (
        <section key={section.name} className={compact ? "mt-2" : "mt-4"} aria-label={section.name}>
          <SectionHeading className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">{section.name}</SectionHeading>
          <ul className={cn("list-disc pl-5 leading-relaxed", compact ? "mt-1 space-y-1 text-xs" : "mt-2 space-y-1.5 text-sm")}>
            {section.items.map(item => <li key={item}>{item}</li>)}
          </ul>
        </section>
      ))}
      {entry.shots.map(shot => (
        <ChangelogCompare key={`${shot.caption}:${shot.before}`} caption={shot.caption} before={shot.before} after={shot.after} />
      ))}
    </>
  );
}

export default function ChangelogPage() {
  const version = readPackageVersion();
  const groups = groupChangelog(loadChangelog());
  return (
    <div className="ml-0 md:ml-10 flex min-h-dvh flex-col">
      <SiteHeader title="Changelog" />
      <main className="mx-auto w-full max-w-3xl flex-1 px-4 py-6 lg:px-6">
        <p className="text-xs font-medium uppercase tracking-[0.15em] text-muted-foreground">Releases</p>
        <h1 className="mt-1 text-xl font-semibold tracking-tight">Changelog</h1>
        <p className="mt-2 max-w-2xl text-sm leading-relaxed text-muted-foreground">
          What changed in each version. The package is {version}. Work after the latest version stays under Unreleased until master is published to GitHub.
        </p>
        <ol className="mt-8 space-y-8">
          {groups.map(group => group.kind === "release" ? (
            <li key={group.entry.id} className="border-t pt-6">
              <h2 className="font-mono text-base font-semibold tracking-tight">{group.entry.title}</h2>
              <ReleaseNotes entry={group.entry} />
            </li>
          ) : (
            <li key={group.entries[0].id} className="changelog-patches border-t">
              <details className="group">
                <summary className="flex min-h-11 cursor-pointer list-none flex-wrap items-center gap-x-2 gap-y-1 rounded-sm py-2 text-xs text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring [&::-webkit-details-marker]:hidden">
                  <ChevronRight className="size-3.5 shrink-0 transition-transform group-open:rotate-90 motion-reduce:transition-none" aria-hidden />
                  <h2 className="font-medium">{group.family} patches</h2>
                  <span className="font-mono text-[11px]">
                    v{group.entries.at(-1)!.id}{group.entries.length > 1 && `–v${group.entries[0].id}`}
                  </span>
                  {group.date && <time dateTime={group.date} className="ml-auto text-[11px]">{group.date}</time>}
                </summary>
                <ol className="mb-2 space-y-4 border-l pl-4 sm:ml-1">
                  {group.entries.map(entry => (
                    <li key={entry.id} className="changelog-patch-entry">
                      <h3 className="font-mono text-xs font-medium">v{entry.id}</h3>
                      <ReleaseNotes entry={entry} compact />
                    </li>
                  ))}
                </ol>
              </details>
            </li>
          ))}
        </ol>
      </main>
    </div>
  );
}
