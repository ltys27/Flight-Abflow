import { Rating } from "ts-fsrs";
import type { Grade } from "../schedule/scheduler";

export function GradeBar({ onGrade, disabled }: { onGrade: (g: Grade) => void; disabled?: boolean }) {
  const items: Array<[Grade, string, string]> = [
    [Rating.Again, "Again", "1"],
    [Rating.Hard, "Hard", "2"],
    [Rating.Good, "Good", "3"],
    [Rating.Easy, "Easy", "4"],
  ];
  return (
    <div className="grade-bar" role="group" aria-label="Grade your recall">
      {items.map(([g, label, key]) => (
        <button key={g} type="button" className={`btn${g === Rating.Good ? " primary" : ""}`} disabled={disabled} onClick={() => onGrade(g)} accessKey={key}>
          {label}
          <small>{key}</small>
        </button>
      ))}
    </div>
  );
}
