/**
 * Look at the signed-in screens without a database.
 *
 *   npm run dev  →  http://localhost:5173/?preview=signed-in
 *
 * Development only. The whole module is behind `import.meta.env.DEV`, so it is
 * dropped from a production build entirely — and it never touches the network,
 * so nothing it shows is real. It exists because the signed-in half of the app
 * is otherwise unreviewable until a project has its schema, and "I could not
 * see it" is a poor reason to ship a layout nobody has looked at.
 */
import { useSessionStore } from '../store/session';
import { useFriendsStore } from '../store/friends';
import type { Profile } from './schemas';

const ME: Profile = {
  id: '00000000-0000-4000-8000-000000000001',
  display_name: 'Almas Ansari',
  handle: 'almas_a',
  faculty: 'Engineering and Technology',
  sound_enabled: false,
  created_at: new Date().toISOString(),
};

const OTHERS: readonly Profile[] = [
  { ...ME, id: '00000000-0000-4000-8000-000000000002', display_name: 'Rukhsana Iqbal', handle: 'rukhsana_i', faculty: 'Social Sciences' },
  { ...ME, id: '00000000-0000-4000-8000-000000000003', display_name: 'Imtiaz Sheikh', handle: 'imtiaz_s', faculty: 'Engineering and Technology' },
  { ...ME, id: '00000000-0000-4000-8000-000000000004', display_name: 'Parveen Rahman', handle: 'parveen_r', faculty: 'Humanities and Languages' },
  { ...ME, id: '00000000-0000-4000-8000-000000000005', display_name: 'Yusuf Ali', handle: 'yusuf_ali', faculty: 'Law' },
];

/**
 * True while the dev preview is driving the UI. The live subscription and the
 * friends load must stand down when it is, or they will overwrite the faked
 * state with whatever the real project says about a user id that does not
 * exist there.
 */
export function isDevPreview(): boolean {
  return import.meta.env.DEV && new URLSearchParams(window.location.search).has('preview');
}

export function applyDevPreview(): void {
  if (!import.meta.env.DEV) return;
  const mode = new URLSearchParams(window.location.search).get('preview');
  if (!mode) return;

  useSessionStore.setState({
    ready: true,
    demo: false,
    schemaMissing: false,
    authError: null,
    profile: ME,
    visibility: mode === 'ghost' ? 'ghost' : mode === 'public' ? 'public' : 'friends',
    // Enough of a User for the components that only read `id`.
    user: { id: ME.id, email: 'preview@example.invalid' } as never,
  });

  useFriendsStore.setState({
    loading: false,
    edges: [
      { other: OTHERS[0]!, status: 'accepted', outgoing: true },
      { other: OTHERS[1]!, status: 'accepted', outgoing: false },
      { other: OTHERS[2]!, status: 'pending', outgoing: false },
      { other: OTHERS[3]!, status: 'pending', outgoing: true },
    ],
    blocked: [],
    searchResults: [],
    searching: false,
    error: null,
  });

  console.info('[dev preview] signed-in state faked; nothing here is real data.');
}
