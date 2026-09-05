/**
 * Settings: who you are, who can see you, and the two ways out.
 *
 * Your handle is editable here on purpose. It is the only way anybody can find
 * you — the friend search matches on handle and nothing else — so leaving it as
 * an unchangeable string generated from your email address would make the whole
 * friends feature depend on a name you never chose.
 */
import { useEffect, useState } from 'react';
import { Drawer } from './Drawer';
import { useSessionStore, type MotionPreference } from '../../store/session';
import { useFriendsStore } from '../../store/friends';
import { displayNameSchema, handleSchema, type VisibilityMode } from '../../lib/schemas';
import { playQuillScratch } from '../../lib/audio';
import { VisibilityControl } from './VisibilityControl';

interface SettingsDrawerProps {
  readonly open: boolean;
  readonly onClose: () => void;
  readonly onVisibilityChange: (value: VisibilityMode) => void;
}

const MOTION_LABELS: Record<MotionPreference, string> = {
  system: 'Follow my device',
  full: 'Always animate',
  reduced: 'Always reduce',
};

const FACULTIES = [
  'Engineering and Technology',
  'Natural Sciences',
  'Humanities and Languages',
  'Social Sciences',
  'Law',
  'Architecture and Ekistics',
  'Education',
  'Fine Arts',
  'Dentistry',
  'Management Studies',
];

export function SettingsDrawer({ open, onClose, onVisibilityChange }: SettingsDrawerProps): JSX.Element {
  const {
    profile,
    user,
    visibility,
    soundEnabled,
    motionPreference,
    setSoundEnabled,
    setMotionPreference,
    showLastSeen,
    setShowLastSeen,
    updateProfile,
    signOut,
    deleteAccount,
  } = useSessionStore();
  const friendCount = useFriendsStore((s) => s.edges.filter((e) => e.status === 'accepted').length);

  const [displayName, setDisplayName] = useState('');
  const [handle, setHandle] = useState('');
  const [faculty, setFaculty] = useState('');
  const [fieldError, setFieldError] = useState<{ field: 'name' | 'handle'; message: string } | null>(null);
  const [saved, setSaved] = useState(false);
  const [saving, setSaving] = useState(false);
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    setDisplayName(profile?.display_name ?? '');
    setHandle(profile?.handle ?? '');
    setFaculty(profile?.faculty ?? '');
    setFieldError(null);
  }, [profile, open]);

  const dirty =
    profile !== null &&
    (displayName !== profile.display_name ||
      handle !== profile.handle ||
      (faculty || null) !== (profile.faculty || null));

  const save = async (): Promise<void> => {
    const name = displayNameSchema.safeParse(displayName);
    if (!name.success) {
      setFieldError({ field: 'name', message: name.error.issues[0]?.message ?? 'That name will not do.' });
      return;
    }
    const parsedHandle = handleSchema.safeParse(handle);
    if (!parsedHandle.success) {
      setFieldError({ field: 'handle', message: parsedHandle.error.issues[0]?.message ?? 'That handle will not do.' });
      return;
    }

    setFieldError(null);
    setSaving(true);
    const result = await updateProfile({
      display_name: name.data,
      handle: parsedHandle.data,
      faculty: faculty.trim() || null,
    });
    setSaving(false);

    if (!result.ok) {
      setFieldError({ field: result.message?.includes('handle') ? 'handle' : 'name', message: result.message ?? 'Could not save.' });
      return;
    }
    setSaved(true);
    window.setTimeout(() => setSaved(false), 2400);
  };

  const copyHandle = async (): Promise<void> => {
    if (!profile) return;
    try {
      await navigator.clipboard.writeText(`@${profile.handle}`);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1800);
    } catch {
      /* clipboard refused; the handle is on screen to read anyway */
    }
  };

  return (
    <Drawer open={open} title="Settings" onClose={onClose}>
      <div className="flex flex-col gap-7">
        {user && profile && (
          <>
            {/* --- who can see you ------------------------------------- */}
            <section>
              <h3 className="hand text-lg text-ink">Who can see you</h3>
              <div className="mt-2">
                <VisibilityControl
                  value={visibility}
                  friendCount={friendCount}
                  onChange={onVisibilityChange}
                />
              </div>
            </section>

            {/* --- your handle ----------------------------------------- */}
            <section className="border-t border-ink/20 pt-5">
              <h3 className="hand text-lg text-ink">Your handle</h3>
              <p className="mt-0.5 text-sm text-ink-faded">
                This is the only way people can find you. Share it with friends.
              </p>
              <div className="mt-2 flex gap-2">
                <div className="flex min-w-0 flex-1 items-center rounded-seal border border-ink/40 bg-parchment pl-3">
                  <span aria-hidden="true" className="hand select-none text-lg text-ink-faded">
                    @
                  </span>
                  <label htmlFor="handle" className="sr-only">
                    Your handle
                  </label>
                  <input
                    id="handle"
                    value={handle}
                    onChange={(e) => setHandle(e.target.value.toLowerCase().replace(/[^a-z0-9_]/g, ''))}
                    maxLength={20}
                    autoCapitalize="none"
                    autoCorrect="off"
                    spellCheck={false}
                    aria-invalid={fieldError?.field === 'handle'}
                    aria-describedby={fieldError?.field === 'handle' ? 'handle-error' : 'handle-hint'}
                    className="w-full min-w-0 bg-transparent px-1 py-2.5 text-base text-ink outline-none"
                  />
                </div>
                <button
                  type="button"
                  onClick={() => void copyHandle()}
                  className="brass shrink-0 rounded-seal px-3 py-2.5 text-sm"
                >
                  {copied ? 'Copied' : 'Copy'}
                </button>
              </div>
              {fieldError?.field === 'handle' ? (
                <p id="handle-error" role="alert" className="mt-1 text-sm text-ember">
                  {fieldError.message}
                </p>
              ) : (
                <p id="handle-hint" className="mt-1 text-sm text-ink-faded">
                  3–20 characters: lower-case letters, digits and underscore.
                </p>
              )}
            </section>

            {/* --- name and faculty ------------------------------------ */}
            <section className="flex flex-col gap-4 border-t border-ink/20 pt-5">
              <div>
                <label htmlFor="display-name" className="hand block text-lg text-ink">
                  The name on your banner
                </label>
                <input
                  id="display-name"
                  data-autofocus
                  value={displayName}
                  onChange={(e) => setDisplayName(e.target.value)}
                  maxLength={32}
                  aria-invalid={fieldError?.field === 'name'}
                  aria-describedby={fieldError?.field === 'name' ? 'display-name-error' : undefined}
                  className="mt-1.5 w-full rounded-seal border border-ink/40 bg-parchment px-3 py-2.5 text-base text-ink"
                />
                {fieldError?.field === 'name' && (
                  <p id="display-name-error" role="alert" className="mt-1 text-sm text-ember">
                    {fieldError.message}
                  </p>
                )}
              </div>

              <div>
                <label htmlFor="faculty" className="hand block text-lg text-ink">
                  Faculty
                </label>
                <input
                  id="faculty"
                  list="faculty-options"
                  value={faculty}
                  onChange={(e) => setFaculty(e.target.value)}
                  maxLength={64}
                  placeholder="Engineering and Technology"
                  className="mt-1.5 w-full rounded-seal border border-ink/40 bg-parchment px-3 py-2.5 text-base text-ink placeholder:text-ink-faded/60"
                />
                <datalist id="faculty-options">
                  {FACULTIES.map((f) => (
                    <option key={f} value={f} />
                  ))}
                </datalist>
              </div>

              <div className="flex items-center gap-3">
                <button
                  type="button"
                  onClick={() => void save()}
                  disabled={!dirty || saving}
                  className="brass rounded-seal px-4 py-2.5 text-base"
                >
                  {saving ? 'Saving…' : 'Save changes'}
                </button>
                <span aria-live="polite" className="text-sm text-ink-faded">
                  {saved ? 'Saved.' : dirty ? 'Unsaved changes' : ''}
                </span>
              </div>
            </section>
          </>
        )}

        {/* --- app preferences ---------------------------------------- */}
        <section className="flex flex-col gap-4 border-t border-ink/20 pt-5">
          <div className="flex items-center justify-between gap-3">
            <span className="min-w-0">
              <span className="hand block text-lg text-ink">Sound</span>
              <span className="block text-sm text-ink-faded">
                A quill scratch when your own print lands.
              </span>
            </span>
            <button
              type="button"
              role="switch"
              aria-checked={soundEnabled}
              aria-label="Sound"
              onClick={() => {
                const next = !soundEnabled;
                setSoundEnabled(next);
                if (next) playQuillScratch();
              }}
              className={`brass shrink-0 rounded-seal px-4 py-2.5 text-sm ${soundEnabled ? 'brass--pressed' : ''}`}
            >
              {soundEnabled ? 'On' : 'Off'}
            </button>
          </div>

          <div className="flex items-center justify-between gap-3">
            <span className="min-w-0">
              <span className="hand block text-lg text-ink">Show where friends were last seen</span>
              <span className="block text-sm text-ink-faded">
                Keep a friend on the map for a few minutes after they go quiet, fading, with when
                you last saw them. Someone who chooses ghost disappears at once either way.
              </span>
            </span>
            <button
              type="button"
              role="switch"
              aria-checked={showLastSeen}
              aria-label="Show where friends were last seen"
              onClick={() => setShowLastSeen(!showLastSeen)}
              className={`brass shrink-0 rounded-seal px-4 py-2.5 text-sm ${showLastSeen ? 'brass--pressed' : ''}`}
            >
              {showLastSeen ? 'On' : 'Off'}
            </button>
          </div>

          <div>
            <span className="hand block text-lg text-ink">Motion</span>
            <div
              role="radiogroup"
              aria-label="Motion"
              className="mt-1.5 flex overflow-hidden rounded-seal border border-ink/40"
            >
              {(Object.keys(MOTION_LABELS) as MotionPreference[]).map((preference) => (
                <button
                  key={preference}
                  type="button"
                  role="radio"
                  aria-checked={motionPreference === preference}
                  tabIndex={motionPreference === preference ? 0 : -1}
                  onClick={() => setMotionPreference(preference)}
                  className={`brass flex-1 px-1.5 py-2.5 text-xs sm:text-sm ${motionPreference === preference ? 'brass--pressed' : ''}`}
                >
                  {MOTION_LABELS[preference]}
                </button>
              ))}
            </div>
          </div>
        </section>

        {/* --- the way out --------------------------------------------- */}
        {user && (
          <section className="flex flex-col gap-3 border-t border-ink/20 pt-5">
            <button type="button" onClick={() => void signOut()} className="brass rounded-seal px-4 py-2.5 text-base">
              Sign out
            </button>

            {!confirmingDelete ? (
              <button
                type="button"
                onClick={() => setConfirmingDelete(true)}
                className="brass rounded-seal px-4 py-2.5 text-base text-ember"
              >
                Delete my account
              </button>
            ) : (
              <div className="rounded-seal border border-ember/60 p-3">
                <p className="text-base text-ink">
                  This removes your profile, your friendships, your blocks and any live row — every
                  row on the server that belongs to you. It cannot be undone.
                </p>
                <div className="mt-3 flex flex-wrap gap-2">
                  <button
                    type="button"
                    onClick={() => void deleteAccount()}
                    className="brass rounded-seal px-4 py-2.5 text-base text-ember"
                  >
                    Delete everything
                  </button>
                  <button
                    type="button"
                    onClick={() => setConfirmingDelete(false)}
                    className="brass rounded-seal px-4 py-2.5 text-base"
                  >
                    Keep my account
                  </button>
                </div>
              </div>
            )}
          </section>
        )}
      </div>
    </Drawer>
  );
}
