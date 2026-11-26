import { GraduationCap, Terminal } from 'lucide-react';

const MODES = [
  { id: 'school', label: 'School', icon: GraduationCap },
  { id: 'operator', label: 'Operator', icon: Terminal },
];

/**
 * The two views of the same system. Present in both shells, in the same place.
 * @param {{ mode: 'school'|'operator', onSwitch: () => void }} props
 */
export default function ModeSwitch({ mode, onSwitch }) {
  return (
    <div className="mode-switch" role="group" aria-label="View (press M to switch)">
      {MODES.map(({ id, label, icon: Icon }) => (
        <button key={id} type="button" aria-pressed={mode === id} onClick={() => mode !== id && onSwitch()}>
          <Icon size={14} strokeWidth={2.2} /><span>{label}</span>
        </button>
      ))}
    </div>
  );
}
