"use client";
import Link from "next/link";
import { Fragment, useEffect, useState, useSyncExternalStore } from "react";
import {
  entrySelection,
  type EntrySelection,
  type PublicTheme,
} from "../../domain/entry";
import { ThemeIcon } from "./ThemeIcon";
import { readEntryReturn, rememberEntry } from "./entry-navigation";
function subscribeColumns(callback: () => void) {
  const media = window.matchMedia("(max-width: 600px)");
  media.addEventListener("change", callback);
  return () => media.removeEventListener("change", callback);
}
const getColumns = () =>
  window.matchMedia("(max-width: 600px)").matches ? 2 : 4;
const serverColumns = () => 4;
export function EntryExplorer({
  themes,
  initialSelection,
  compact = false,
}: {
  themes: PublicTheme[];
  initialSelection: EntrySelection;
  compact?: boolean;
}) {
  const [selection, setSelection] = useState(initialSelection);
  const columns = useSyncExternalStore(
    subscribeColumns,
    getColumns,
    serverColumns,
  );
  const selected = themes.find((t) => t.id === selection.theme);
  const selectedIndex = themes.findIndex((t) => t.id === selection.theme);
  const panelAfter = Math.min(
    themes.length - 1,
    (Math.floor(selectedIndex / columns) + 1) * columns - 1,
  );
  useEffect(() => {
    const sync = () => {
      const url = new URL(window.location.href);
      setSelection(
        entrySelection(
          themes,
          url.searchParams.get("theme") ??
            (compact && url.searchParams.get("closed") !== "1"
              ? (themes[0]?.id ?? null)
              : null),
          url.searchParams.get("group"),
        ),
      );
    };
    const restore = () => {
      const url = new URL(window.location.href);
      const saved = readEntryReturn();
      const requested = url.searchParams.get("return") === "1";
      url.searchParams.delete("return");
      if (requested)
        window.history.replaceState(
          window.history.state,
          "",
          url.pathname + url.search,
        );
      if (saved && saved.path === url.pathname + url.search)
        requestAnimationFrame(() =>
          requestAnimationFrame(() =>
            window.scrollTo({ top: saved.scroll, behavior: "instant" }),
          ),
        );
    };
    // Next.js may restore a cached entrance whose server props predate the
    // local expansion. Read the actual history URL again when it mounts.
    sync();
    restore();
    window.addEventListener("popstate", sync);
    window.addEventListener("pageshow", restore);
    return () => {
      window.removeEventListener("popstate", sync);
      window.removeEventListener("pageshow", restore);
    };
  }, [themes, compact]);
  function change(next: EntrySelection) {
    setSelection(next);
    const url = new URL(window.location.href);
    for (const key of ["theme", "group", "return", "closed"])
      url.searchParams.delete(key);
    if (next.theme) url.searchParams.set("theme", next.theme);
    if (next.group) url.searchParams.set("group", next.group);
    if (compact && !next.theme) url.searchParams.set("closed", "1");
    // Expansion changes the current entrance; back from an article skips no
    // extra expansion history entries and restores this exact URL.
    window.history.replaceState(
      window.history.state,
      "",
      url.pathname + url.search,
    );
  }
  const panel =
    selected && selected.groups.length ? (
      <section
        id={`entry-panel-${selected.id}`}
        className="entry-panel"
        aria-label={`${selected.title}の問い`}
      >
        <div className="entry-panel-heading">
          <h3>{selected.title}</h3>
          <button
            type="button"
            className="entry-close"
            aria-label="テーマの問いを閉じる"
            onClick={() => change({ theme: null, group: null })}
          >
            ×
          </button>
        </div>
        <div className="entry-groups">
          {selected.groups.map((group) => (
            <div className="entry-group" key={group.id}>
              <button
                type="button"
                className="entry-group-button"
                aria-expanded={selection.group === group.id}
                aria-controls={`entry-questions-${group.id}`}
                onClick={() =>
                  change({
                    theme: selected.id,
                    group: selection.group === group.id ? null : group.id,
                  })
                }
              >
                <span>{group.title}</span>
                <span className="entry-chevron" aria-hidden="true">
                  ⌄
                </span>
              </button>
              {selection.group === group.id ? (
                <div
                  id={`entry-questions-${group.id}`}
                  className="entry-questions"
                >
                  {group.questions.map((q) => (
                    <Link
                      key={q.id}
                      href={q.href}
                      prefetch={false}
                      className="entry-question-link"
                      onClick={() => rememberEntry(q.id)}
                    >
                      <span>{q.title}</span>
                      <span aria-hidden="true">→</span>
                    </Link>
                  ))}
                  {group.overview ? (
                    <Link
                      href={group.overview.href}
                      prefetch={false}
                      className="entry-overview"
                      onClick={() => rememberEntry(group.overview!.id)}
                    >
                      この問いの概要を読む <span aria-hidden="true">→</span>
                    </Link>
                  ) : null}
                </div>
              ) : null}
            </div>
          ))}
        </div>
        {!compact ? (
          <Link
            className="entry-theme-more"
            href={`/themes/${selected.slug}`}
            prefetch={false}
          >
            このテーマの人物・概念も探す →
          </Link>
        ) : null}
      </section>
    ) : null;
  return (
    <div className="entry-theme-grid">
      {themes.map((theme, index) => (
        <Fragment key={theme.id}>
          <button
            type="button"
            className="entry-theme-card"
            disabled={!theme.groups.length}
            data-theme-id={theme.id}
            aria-expanded={selection.theme === theme.id}
            aria-controls={`entry-panel-${theme.id}`}
            onClick={() =>
              change({
                theme: selection.theme === theme.id ? null : theme.id,
                group: null,
              })
            }
          >
            <span className="entry-theme-icon">
              <ThemeIcon name={theme.icon} />
            </span>
            <span className="entry-theme-title">{theme.shortLabel}</span>
            <span className="entry-theme-prompt">{theme.prompt}</span>
            {!theme.groups.length ? (
              <span className="entry-preparing">準備中</span>
            ) : (
              <span className="entry-theme-arrow" aria-hidden="true">
                ⌄
              </span>
            )}
          </button>
          {index === panelAfter ? panel : null}
        </Fragment>
      ))}
    </div>
  );
}
