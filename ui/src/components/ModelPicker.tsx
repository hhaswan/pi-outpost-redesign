import { useEffect, useId, useRef, useState } from "react";
import type { ModelChoice } from "@pi-outpost/shared";
import { eventHitsNode } from "../util/clickOutside";

interface ModelPickerProps {
  model: string;
  models: ModelChoice[];
  disabled: boolean;
  onSetModel: (provider: string, id: string) => void;
  /** Shown, muted, when no model is chosen (`model` empty). */
  placeholder?: string;
}

/** Searchable model selection; the server remains the source of the current model. */
export function ModelPicker({ model, models, disabled, onSetModel, placeholder }: ModelPickerProps) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);
  const root = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const input = useRef<HTMLInputElement>(null);
  // A press that began inside: the blur it causes on iOS Safari must not close the list.
  const pressingInside = useRef(false);
  const list = useRef<HTMLUListElement>(null);
  const id = useId();
  const search = query.trim().toLowerCase();
  const choices = models.filter((choice) =>
    `${choice.provider}/${choice.id} ${choice.name}`.toLowerCase().includes(search),
  );
  const index = Math.min(active, Math.max(0, choices.length - 1));
  const visible = open && !disabled;

  function close(restoreFocus = false) {
    setOpen(false);
    if (restoreFocus) trigger.current?.focus();
  }

  function show() {
    setQuery("");
    setActive(Math.max(0, models.findIndex((choice) => `${choice.provider}/${choice.id}` === model)));
    setOpen(true);
  }

  function select(choice: ModelChoice) {
    pressingInside.current = false;
    if (disabled) return;
    onSetModel(choice.provider, choice.id);
    close(true);
  }

  useEffect(() => {
    if (disabled) setOpen(false);
  }, [disabled]);

  useEffect(() => {
    if (!visible) return;
    // A touch screen would raise its keyboard over the list; type-to-search stays a tap away.
    if (!window.matchMedia?.("(pointer: coarse)").matches) input.current?.focus();
    function outside(event: PointerEvent) {
      if (root.current && !eventHitsNode(event, root.current)) setOpen(false);
    }
    document.addEventListener("pointerdown", outside);
    return () => document.removeEventListener("pointerdown", outside);
  }, [visible]);

  useEffect(() => {
    if (visible) list.current?.children[index]?.scrollIntoView?.({ block: "nearest" });
  }, [visible, index, query]);

  return (
    <div
      ref={root}
      className="relative w-full min-w-0 max-w-full sm:w-auto sm:max-w-64 max-md:w-auto max-md:flex-1"
      // iOS Safari blurs the search (relatedTarget null) before a tap's click reaches the
      // option, even with pointerdown prevented: a press that began inside keeps it open.
      onPointerDownCapture={() => {
        pressingInside.current = true;
        window.setTimeout(() => { pressingInside.current = false; }, 800);
      }}
      onBlur={(event) => {
        if (pressingInside.current) return;
        if (!event.currentTarget.contains(event.relatedTarget as Node | null)) close();
      }}
      onKeyDown={(event) => {
        if (event.key === "Escape" && visible) {
          event.preventDefault();
          event.stopPropagation();
          close(true);
        }
      }}
    >
      <button
        ref={trigger}
        type="button"
        aria-label="Model"
        title={model}
        aria-haspopup="listbox"
        aria-expanded={visible}
        aria-controls={visible ? `${id}-list` : undefined}
        disabled={disabled}
        onClick={() => visible ? close() : show()}
        onKeyDown={(event) => {
          if (event.key === "ArrowDown" || event.key === "ArrowUp") {
            event.preventDefault();
            show();
          }
        }}
        className="min-h-11 w-full min-w-0 max-w-full truncate rounded-full border border-zinc-300 bg-white px-3 py-1 sm:min-h-7 [@media(pointer:coarse)]:sm:min-h-11 font-mono text-xs text-zinc-700 transition-opacity hover:border-zinc-400 hover:opacity-80 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:ring-offset-2 disabled:opacity-50 dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-300 dark:hover:border-zinc-600 dark:focus-visible:ring-offset-zinc-900"
      >
        {/* On a phone the provider is noise in a narrow chip: show the model id. */}
        {!model ? <span className="text-zinc-400 dark:text-zinc-500">{placeholder ?? "Choose a model…"}</span> : model.includes("/") ? <><span className="max-sm:hidden">{model.slice(0, model.indexOf("/") + 1)}</span>{model.slice(model.indexOf("/") + 1)}</> : model}
      </button>
      {visible && (
        <div className="absolute bottom-full left-0 z-50 mb-2 w-80 max-w-[calc(100vw-2rem)] rounded-2xl border border-zinc-300 bg-white p-2 shadow-lg dark:border-zinc-700 dark:bg-zinc-900">
          <input
            ref={input}
            role="combobox"
            aria-label="Search models"
            aria-autocomplete="list"
            aria-expanded="true"
            aria-controls={`${id}-list`}
            aria-activedescendant={choices.length ? `${id}-option-${index}` : undefined}
            value={query}
            placeholder="Search provider or model…"
            autoComplete="off"
            spellCheck={false}
            onChange={(event) => {
              setQuery(event.target.value);
              setActive(0);
            }}
            onKeyDown={(event) => {
              if (event.key === "ArrowDown" || event.key === "ArrowUp") {
                event.preventDefault();
                if (choices.length) setActive((index + (event.key === "ArrowDown" ? 1 : -1) + choices.length) % choices.length);
              } else if (event.key === "Enter") {
                event.preventDefault();
                if (choices[index]) select(choices[index]);
              }
            }}
            className="min-h-11 w-full min-w-0 rounded-xl border border-zinc-300 bg-transparent px-3 text-sm text-zinc-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 dark:border-zinc-700 dark:text-zinc-100"
          />
          {model && !models.some((choice) => `${choice.provider}/${choice.id}` === model) && (
            <p className="break-words px-2 py-2 text-xs text-zinc-500 dark:text-zinc-400">Current: {model} (not listed)</p>
          )}
          <ul ref={list} id={`${id}-list`} role="listbox" aria-label="Models" className="mt-2 max-h-60 overflow-y-auto">
            {choices.map((choice, choiceIndex) => {
              const key = `${choice.provider}/${choice.id}`;
              return (
                <li
                  key={key}
                  id={`${id}-option-${choiceIndex}`}
                  role="option"
                  aria-selected={key === model}
                  onPointerDown={(event) => event.preventDefault()}
                  onClick={() => select(choice)}
                  className={`flex min-h-11 cursor-pointer items-center break-all rounded-xl px-3 py-2 font-mono text-xs text-zinc-700 hover:bg-zinc-100 dark:text-zinc-200 dark:hover:bg-zinc-800 ${choiceIndex === index ? "bg-zinc-100 outline outline-1 outline-inset outline-blue-500 dark:bg-zinc-800" : ""}`}
                >
                  {key}
                </li>
              );
            })}
          </ul>
          {choices.length === 0 && <p role="status" className="px-3 py-3 text-sm text-zinc-500 dark:text-zinc-400">No models found.</p>}
        </div>
      )}
    </div>
  );
}
