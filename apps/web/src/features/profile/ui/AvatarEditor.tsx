import { useEffect, useRef, useState } from 'react';
import { Button, Dialog, Heading, Modal, ModalOverlay } from 'react-aria-components';
import {
  PROFILE_CONSTRAINTS,
  type ProfileAvatar,
  type UserProfile,
} from '@lostly/contracts/profile';
import { Avatar } from '@/shared/ui/Avatar/Avatar';
import { ApiError } from '@/shared/api/client';
import { removeAvatar, uploadAvatar } from '../api/profile-api';
import styles from './ProfileEditor.module.css';

async function previewFile(file: File) {
  const bitmap = await createImageBitmap(file);
  try {
    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = 256;
    const context = canvas.getContext('2d');
    if (!context) throw new Error('Preview unavailable');
    const side = Math.min(bitmap.width, bitmap.height);
    context.drawImage(
      bitmap,
      (bitmap.width - side) / 2,
      (bitmap.height - side) / 2,
      side,
      side,
      0,
      0,
      256,
      256,
    );
    return canvas.toDataURL('image/png');
  } finally {
    bitmap.close();
  }
}

interface AvatarEditorProps {
  profile: UserProfile;
  avatar: ProfileAvatar | null;
  disabled: boolean;
  onBusy: (busy: boolean) => void;
  onSaved: (profile: UserProfile, message: string) => void;
  onConflict: () => Promise<void>;
}

export function AvatarEditor({
  profile,
  avatar,
  disabled,
  onBusy,
  onSaved,
  onConflict,
}: AvatarEditorProps) {
  const input = useRef<HTMLInputElement>(null);
  const changeButton = useRef<HTMLButtonElement>(null);
  const removeButton = useRef<HTMLButtonElement>(null);
  const restoreFocus = useRef<'change' | 'remove' | null>(null);
  const controller = useRef<AbortController | null>(null);
  const selection = useRef(0);
  const [selected, setSelected] = useState<{ file: File; preview: string } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [playing, setPlaying] = useState(false);
  const [confirmRemove, setConfirmRemove] = useState(false);
  const isOpen = Boolean(selected) || confirmRemove;
  useEffect(() => {
    if (isOpen || busy || !restoreFocus.current) return;
    const frame = requestAnimationFrame(() => {
      const target = restoreFocus.current === 'remove' ? removeButton : changeButton;
      (target.current ?? changeButton.current)?.focus();
      restoreFocus.current = null;
    });
    return () => cancelAnimationFrame(frame);
  }, [isOpen, busy]);
  useEffect(
    () => () => {
      controller.current?.abort();
      selection.current++;
    },
    [],
  );

  async function selectFile(file: File) {
    setError(null);
    const supportedType =
      file.type === '' ||
      ['image/jpeg', 'image/png', 'image/webp', 'image/gif'].includes(file.type);
    if (!supportedType || !file.size || file.size > PROFILE_CONSTRAINTS.avatarMaxBytes) {
      setError('Choose a JPG, PNG, WebP or GIF up to 5 MB.');
      return;
    }
    const version = ++selection.current;
    setBusy(true);
    onBusy(true);
    try {
      const preview = await previewFile(file);
      if (version === selection.current) setSelected({ file, preview });
    } catch {
      if (version === selection.current)
        setError('We could not open this image. Try another file.');
    } finally {
      if (version === selection.current) {
        setBusy(false);
        onBusy(false);
      }
    }
  }

  async function commit(remove = false) {
    if (busy) return;
    const request = new AbortController();
    controller.current = request;
    setBusy(true);
    onBusy(true);
    setError(null);
    try {
      const response = remove
        ? await removeAvatar(profile.version, request.signal)
        : await uploadAvatar(selected!.file, profile.version, request.signal);
      if (request.signal.aborted) return;
      onSaved(response.profile, remove ? 'Profile photo removed.' : 'Profile photo updated.');
      restoreFocus.current = 'change';
      setSelected(null);
      setConfirmRemove(false);
      setPlaying(false);
    } catch (cause) {
      if (request.signal.aborted) return;
      if (cause instanceof ApiError && cause.code === 'PROFILE_CHANGED') {
        await onConflict();
        if (!request.signal.aborted)
          setError('Your profile changed elsewhere. Review it, then try again.');
      } else
        setError(
          cause instanceof ApiError &&
            ['INVALID_AVATAR', 'RATE_LIMITED', 'REQUEST_TOO_LARGE'].includes(cause.code)
            ? cause.message
            : 'We could not update your photo. Please try again.',
        );
    } finally {
      if (!request.signal.aborted) {
        setBusy(false);
        onBusy(false);
      }
    }
  }

  function close() {
    if (busy) return;
    restoreFocus.current = confirmRemove ? 'remove' : 'change';
    setSelected(null);
    setConfirmRemove(false);
    setError(null);
  }

  return (
    <section className={styles.photoSection} aria-labelledby="profile-photo-title">
      <div className={styles.photoRow}>
        <Avatar name={profile.displayName} avatar={avatar} size={88} animate={playing} />
        <div className={styles.photoDetails}>
          <h2 id="profile-photo-title">Profile photo</h2>
          <div className={styles.photoActions}>
            <Button
              ref={changeButton}
              className={styles.secondary}
              isDisabled={disabled || busy}
              onPress={() => input.current?.click()}
            >
              {busy && !selected && !confirmRemove
                ? 'Preparing…'
                : avatar
                  ? 'Change photo'
                  : 'Upload photo'}
            </Button>
            {avatar && (
              <Button
                ref={removeButton}
                className={styles.textButton}
                isDisabled={disabled || busy}
                onPress={() => {
                  setError(null);
                  setConfirmRemove(true);
                }}
              >
                Remove
              </Button>
            )}
          </div>
          <p className={styles.hint}>JPG, PNG, WebP or GIF · Up to 5 MB</p>
          {avatar?.animated && (
            <Button
              className={`${styles.textButton} ${styles.animationControl}`}
              aria-pressed={playing}
              onPress={() => setPlaying(!playing)}
            >
              {playing ? 'Pause animation' : 'Play animation'}
            </Button>
          )}
          <input
            ref={input}
            type="file"
            accept="image/jpeg,image/png,image/webp,image/gif"
            hidden
            onChange={(event) => {
              const file = event.target.files?.[0];
              event.target.value = '';
              if (file) void selectFile(file);
            }}
          />
        </div>
      </div>
      {error && !selected && !confirmRemove && (
        <p className={styles.error} role="alert">
          {error}
        </p>
      )}
      <ModalOverlay
        className={styles.overlay}
        isOpen={isOpen}
        onOpenChange={(open) => {
          if (!open) close();
        }}
        isDismissable={!busy}
        isKeyboardDismissDisabled={busy}
      >
        <Modal className={styles.modal}>
          <Dialog className={styles.dialog}>
            <Heading slot="title" className={styles.dialogTitle}>
              {confirmRemove ? 'Remove profile photo?' : 'Update profile photo'}
            </Heading>
            {selected && (
              <img
                className={styles.preview}
                src={selected.preview}
                width="160"
                height="160"
                alt="Preview of your new profile photo"
              />
            )}
            <p className={styles.dialogHint}>
              {confirmRemove
                ? 'Your initials will appear in its place.'
                : 'Your photo will appear in a circle. GIF animation is preserved when you save.'}
            </p>
            {error && (
              <p className={styles.error} role="alert">
                {error}
              </p>
            )}
            <div className={styles.dialogActions}>
              <Button className={styles.secondary} isDisabled={busy} onPress={close}>
                Cancel
              </Button>
              <Button
                className={styles.primary}
                isPending={busy}
                onPress={() => void commit(confirmRemove)}
              >
                {busy ? 'Saving…' : confirmRemove ? 'Remove photo' : 'Save photo'}
              </Button>
            </div>
          </Dialog>
        </Modal>
      </ModalOverlay>
    </section>
  );
}
