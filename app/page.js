import Grid from '@/components/Grid';
import LeftSidebar from '@/components/LeftSidebar';
import RightSidebar from '@/components/RightSidebar';
import Toolbar from '@/components/Toolbar';
import ControlsBar from '@/components/ControlsBar';

export default function Home() {
  return (
    <div className="app">
      <aside className="sidebar left"><LeftSidebar /></aside>
      <main className="stage">
        <Grid />
        <Toolbar />
        <ControlsBar />
      </main>
      <aside className="sidebar right"><RightSidebar /></aside>
    </div>
  );
}
