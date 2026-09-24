import { Route, Routes, useLocation, useParams } from 'react-router-dom';
import Layout from './components/Layout.tsx';
import { ContentGate } from './components/ContentGate.tsx';
import ErrorBoundary from './components/ErrorBoundary.tsx';
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

/**
 * A drill session freezes its question list when it starts, so every
 * navigation must start a fresh instance. Neither half of the key is enough
 * alone:
 *  - location.key changes on every <Link>/navigate, including "Go again" to
 *    the identical URL (react-router mints a new key even for a replace), but
 *    it is "default" for every location reached by editing the hash by hand;
 *  - pathname+search catches those hand-edited URLs but not "Go again".
 */
function DrillRoute() {
  const location = useLocation();
  return <DrillSession key={`${location.key}|${location.pathname}${location.search}`} />;
}

/** Keyed on the project only, so switching tabs (same project) keeps state. */
function ProjectRoute() {
  const { track, name } = useParams();
  return <ProjectView key={`${track}/${name}`} />;
}

export default function App() {
  return (
    <ErrorBoundary home={false}>
    <ContentGate>
      <Routes>
        <Route element={<Layout />}>
          <Route path="/" element={<Dashboard />} />
          <Route path="/path" element={<Path />} />
          <Route path="/path/:stageId" element={<Path />} />
          <Route path="/drill" element={<Drills />} />
          <Route path="/drill/:deckId" element={<DrillRoute />} />
          <Route path="/library" element={<Library />} />
          <Route path="/project/:track/:name" element={<ProjectRoute />} />
          <Route path="/guides" element={<Guides />} />
          <Route path="/guide/:guideId" element={<DocView kind="guide" />} />
          <Route path="/doc/*" element={<DocView kind="doc" />} />
          <Route path="/progress" element={<ProgressView />} />
          <Route path="/settings" element={<Settings />} />
          <Route path="*" element={<NotFound />} />
        </Route>
      </Routes>
    </ContentGate>
    </ErrorBoundary>
  );
}
