import { useEffect } from 'react';
import { Navigate, Route, Routes } from 'react-router-dom';
import MapScreen from './screens/MapScreen';
import { useSessionStore } from './store/session';

export default function App(): JSX.Element {
  const init = useSessionStore((s) => s.init);
  const ready = useSessionStore((s) => s.ready);

  useEffect(() => {
    void init();
  }, [init]);

  if (!ready) {
    return (
      <div className="mm-desk flex h-full w-full items-center justify-center">
        <p className="hand text-lg text-parchment-deep">Unrolling the sheet…</p>
      </div>
    );
  }

  return (
    <Routes>
      {/* The map is the whole point, so it is what the door opens onto. There
          is no gate in front of it and no phrase to guess: signing in is a
          button on the map itself, for the people who want the real thing. */}
      <Route path="/" element={<MapScreen />} />
      <Route path="/map" element={<MapScreen />} />
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
