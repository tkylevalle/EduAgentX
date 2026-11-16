import GatePanel from './GatePanel.jsx';
import ClassPanel from './ClassPanel.jsx';
import ExamPanel from './ExamPanel.jsx';
import OfficePanel from './OfficePanel.jsx';
import HallPanel from './HallPanel.jsx';
import './panels.css';

const PANELS = { gate: GatePanel, classroom: ClassPanel, exam: ExamPanel, office: OfficePanel, hall: HallPanel };

/**
 * The panel under the stage: the real records behind the room on screen.
 * @param {{ place: string, run: object, seen: object, playing: boolean, data: object, status: object, onGo: (place: string) => void }} props
 */
export default function PlacePanel({ place, ...rest }) {
  const Panel = PANELS[place] || GatePanel;
  return <Panel {...rest} />;
}
