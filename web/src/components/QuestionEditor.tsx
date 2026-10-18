"use client";

import { Question } from "@aiprepkit/core";
import { Button } from "./Button";
import { Textarea } from "./Field";

export function QuestionEditor({
  question,
  onChange,
  onDelete,
  onMoveUp,
  onMoveDown,
  onTogglePin,
  onChangeCategory,
}: {
  question: Question;
  onChange: (q: Question) => void;
  onDelete?: () => void;
  onMoveUp?: () => void;
  onMoveDown?: () => void;
  onTogglePin?: () => void;
  onChangeCategory?: (cat: Question["category"]) => void;
}) {
  return (
    <div className="border border-slate-800 rounded-xl p-3 flex flex-col gap-2">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <div className="flex items-center gap-2 flex-wrap">
          <span className="text-xs text-slate-400">{question.id}</span>
          {question.edited && (
            <span className="text-xs px-1.5 py-0.5 rounded border border-slate-700 text-slate-300">
              Edited
            </span>
          )}
          {question.origin === "user" && (
            <span className="text-xs px-1.5 py-0.5 rounded border border-slate-700 text-slate-300">
              Yours
            </span>
          )}
          {question.pinned && (
            <span className="text-xs px-1.5 py-0.5 rounded border border-indigo-500/40 text-indigo-300">
              Pinned
            </span>
          )}
        </div>
        <div className="flex gap-1 flex-wrap">
          <Button variant="ghost" onClick={onTogglePin} className="px-2 py-1 text-xs">
            {question.pinned ? "Unpin" : "📌 Pin"}
          </Button>
          <Button variant="ghost" onClick={onMoveUp} className="px-2 py-1 text-xs" disabled={!onMoveUp}>
            ↑
          </Button>
          <Button variant="ghost" onClick={onMoveDown} className="px-2 py-1 text-xs" disabled={!onMoveDown}>
            ↓
          </Button>
          <Button variant="danger" onClick={onDelete} className="px-2 py-1 text-xs">
            Delete
          </Button>
        </div>
      </div>
      <Textarea
        label="Prompt"
        value={question.prompt}
        onChange={(e) => onChange({ ...question, prompt: e.target.value, edited: true })}
        className="min-h-[60px]"
      />
      <Textarea
        label="Answer outline"
        value={question.answer_outline}
        onChange={(e) => onChange({ ...question, answer_outline: e.target.value, edited: true })}
        className="min-h-[60px]"
      />
      <div className="flex gap-2 flex-wrap">
        <div className="flex flex-col gap-1">
          <label className="text-xs text-slate-300">Difficulty</label>
          <select
            value={question.difficulty}
            onChange={(e) =>
              onChange({ ...question, difficulty: Number(e.target.value) as 1 | 2 | 3, edited: true })
            }
            className="px-2 py-1 bg-slate-900 border border-slate-800 rounded-xl text-sm"
          >
            <option value={1}>1</option>
            <option value={2}>2</option>
            <option value={3}>3</option>
          </select>
        </div>
        {onChangeCategory && (
          <div className="flex flex-col gap-1">
            <label className="text-xs text-slate-300">Category</label>
            <select
              value={question.category}
              onChange={(e) =>
                onChangeCategory(e.target.value as Question["category"])
              }
              className="px-2 py-1 bg-slate-900 border border-slate-800 rounded-xl text-sm"
            >
              <option value="technical">technical</option>
              <option value="behavioural">behavioural</option>
              <option value="system-design">system-design</option>
              <option value="company-fit">company-fit</option>
            </select>
          </div>
        )}
      </div>
      {question.requirement_ids.length > 0 && (
        <div className="flex gap-1 flex-wrap">
          {question.requirement_ids.map((rid) => (
            <span key={rid} className="text-xs px-1.5 py-0.5 rounded bg-slate-800 text-slate-300">
              {rid}
            </span>
          ))}
        </div>
      )}
    </div>
  );
}