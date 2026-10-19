"use client";

export function ScheduleView({ schedule }: { schedule: any }) {
  if (!schedule) return null;
  return (
    <div className="flex flex-col gap-3">
      <div className="text-sm text-slate-400">
        Total minutes and hard material lands early
      </div>
      <div className="grid sm:grid-cols-2 gap-3">
        {schedule.days?.map((d: any) => (
          <div key={d.day} className="border border-slate-800 rounded-xl p-3 flex flex-col gap-2">
            <div className="flex items-center justify-between">
              <span className="font-medium">Day {d.day}</span>
              <span className="text-xs text-slate-400">{d.minutes} min</span>
            </div>
            <p className="text-sm text-slate-300">{d.focus}</p>
            <div className="flex flex-col gap-1">
              {d.question_ids?.map((qid: string, i: number) => (
                <span key={i} className="text-xs px-1.5 py-0.5 rounded bg-slate-800 text-slate-300 w-fit">
                  {qid}
                </span>
              ))}
            </div>
          </div>
        ))}
      </div>
      {schedule.days && (
        <p className="text-sm text-slate-400">
          Total: {schedule.days.reduce((sum: number, d: any) => sum + (d.minutes || 0), 0)} minutes
        </p>
      )}
    </div>
  );
}