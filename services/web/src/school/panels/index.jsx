import HubPanel from './HubPanel.jsx';
import GatePanel from './GatePanel.jsx';
import ClassPanel from './ClassPanel.jsx';
import ExamPanel from './ExamPanel.jsx';
import OfficePanel from './OfficePanel.jsx';
import HallPanel from './HallPanel.jsx';
import LibraryPanel from './LibraryPanel.jsx';
import StaffPanel from './StaffPanel.jsx';
import WorkshopPanel from './WorkshopPanel.jsx';
import CareersPanel from './CareersPanel.jsx';
import './panels.css';

const PANELS = {
  hub: HubPanel, gate: GatePanel, classroom: ClassPanel, exam: ExamPanel, office: OfficePanel, hall: HallPanel,
  library: LibraryPanel, staff: StaffPanel, workshop: WorkshopPanel, careers: CareersPanel,
};

/**
 * The papers on the table: the real records behind the view on screen.
 * @param {{ view: string, run: object, seen: object, playing: boolean, data: object, status: object, onGo: (view: string) => void }} props
 */
export default function RoomPanel({ view, ...rest }) {
  const Panel = PANELS[view] || HubPanel;
  return <Panel {...rest} />;
}
