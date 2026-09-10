import { Route, Routes } from 'react-router-dom';
import Layout from './components/Layout.tsx';
import { ContentGate } from './components/ContentGate.tsx';
import Dashboard from './routes/Dashboard.tsx';
import Path from './routes/Path.tsx';
import Drills from './routes/Drills.tsx';
import DrillSession from './routes/DrillSession.tsx';
import Library from './routes/Library.tsx';
import ProjectView from './routes/ProjectView.tsx';
import Guides from './routes/Guides.tsx';
import DocView from './routes/DocView.tsx';
import ProgressView from './routes/ProgressView.tsx';
import Settings from './routes/Settings.tsx';
import NotFound from './routes/NotFound.tsx';

export default function App() {
  return (
    <ContentGate>
      {(content) => (
        <Routes>
          <Route element={<Layout content={content} />}>
            <Route path="/" element={<Dashboard content={content} />} />
            <Route path="/path" element={<Path content={content} />} />
            <Route path="/path/:stageId" element={<Path content={content} />} />
            <Route path="/drill" element={<Drills content={content} />} />
            <Route path="/drill/:deckId" element={<DrillSession content={content} />} />
            <Route path="/library" element={<Library content={content} />} />
            <Route path="/project/:track/:name" element={<ProjectView content={content} />} />
            <Route path="/guides" element={<Guides content={content} />} />
            <Route path="/guide/:guideId" element={<DocView content={content} kind="guide" />} />
            <Route path="/doc/*" element={<DocView content={content} kind="doc" />} />
            <Route path="/progress" element={<ProgressView content={content} />} />
            <Route path="/settings" element={<Settings content={content} />} />
            <Route path="*" element={<NotFound />} />
          </Route>
        </Routes>
      )}
    </ContentGate>
  );
}
