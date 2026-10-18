"use client";

import { useState } from "react";
import { Flashcard } from "@aiprepkit/core";
import { Button } from "./Button";
import { Textarea } from "./Field";

export function FlashcardCard({
  card,
  onChange,
  onDelete,
  onTogglePin,
}: {
  card: Flashcard;
  onChange: (c: Flashcard) => void;
  onDelete?: () => void;
  onTogglePin?: () => void;
}) {
  const [flipped, setFlipped] = useState(false);
  const [editing, setEditing] = useState(false);

  return (
    <div className="border border-slate-800 rounded-xl p-3 flex flex-col gap-2">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <div className="flex items-center gap-2 flex-wrap">
          <span className="text-xs text-slate-400">{card.id}</span>
          {card.edited && (
            <span className="text-xs px-1.5 py-0.5 rounded border border-slate-700 text-slate-300">
              Edited
            </span>
          )}
          {card.origin === "user" && (
            <span className="text-xs px-1.5 py-0.5 rounded border border-slate-700 text-slate-300">
              Yours
            </span>
          )}
          {card.pinned && (
            <span className="text-xs px-1.5 py-0.5 rounded border border-indigo-500/40 text-indigo-300">
              Pinned
            </span>
          )}
        </div>
        <div className="flex gap-1 flex-wrap">
          <Button variant="ghost" onClick={onTogglePin} className="px-2 py-1 text-xs">
            {card.pinned ? "Unpin" : "📌 Pin"}
          </Button>
          <Button variant="ghost" onClick={() => setEditing(!editing)} className="px-2 py-1 text-xs">
            {editing ? "Done" : "Edit"}
          </Button>
          <Button variant="ghost" onClick={() => setFlipped(!flipped)} className="px-2 py-1 text-xs">
            Flip
          </Button>
          <Button variant="danger" onClick={onDelete} className="px-2 py-1 text-xs">
            Delete
          </Button>
        </div>
      </div>
      {editing ? (
        <div className="flex flex-col gap-2">
          <Textarea
            label="Front"
            value={card.front}
            onChange={(e) => onChange({ ...card, front: e.target.value, edited: true })}
            className="min-h-[60px]"
          />
          <Textarea
            label="Back"
            value={card.back}
            onChange={(e) => onChange({ ...card, back: e.target.value, edited: true })}
            className="min-h-[60px]"
          />
        </div>
      ) : (
        <div
          className="p-3 border border-slate-800 rounded-xl min-h-[100px] cursor-pointer"
          onClick={() => setFlipped(!flipped)}
          onKeyDown={(e) => {
            if (e.key === "Enter" || e.key === " ") {
              e.preventDefault();
              setFlipped(!flipped);
            }
          }}
          tabIndex={0}
          role="button"
          aria-label="Flip card"
        >
          <p className="text-sm whitespace-pre-wrap">
            {flipped ? card.back : card.front}
          </p>
        </div>
      )}
    </div>
  );
}