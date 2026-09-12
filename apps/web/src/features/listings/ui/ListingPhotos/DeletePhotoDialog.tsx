import { Button, Dialog, Heading, Modal, ModalOverlay } from 'react-aria-components';
import styles from './ListingPhotos.module.css';

export function DeletePhotoDialog({
  open,
  pending,
  error,
  onClose,
  onConfirm,
}: {
  open: boolean;
  pending: boolean;
  error: string | null;
  onClose: () => void;
  onConfirm: () => void;
}) {
  return (
    <ModalOverlay
      className={styles.overlay}
      isOpen={open}
      onOpenChange={(isOpen) => {
        if (!isOpen && !pending) onClose();
      }}
      isKeyboardDismissDisabled={pending}
    >
      <Modal className={styles.modal}>
        <Dialog className={styles.dialog} aria-busy={pending}>
          <Heading slot="title" className={styles.heading}>
            Delete this photo?
          </Heading>
          <p className={styles.body}>
            It will be removed from your report. To add it back, you will need to upload it again.
          </p>
          {error && (
            <p role="alert" className={styles.error}>
              {error}
            </p>
          )}
          <div className={styles.actions}>
            <Button className={styles.button} autoFocus isDisabled={pending} onPress={onClose}>
              Keep photo
            </Button>
            <Button
              className={`${styles.button} ${styles.dangerAction}`}
              isDisabled={pending}
              onPress={onConfirm}
            >
              {pending ? 'Deleting…' : 'Delete photo'}
            </Button>
          </div>
        </Dialog>
      </Modal>
    </ModalOverlay>
  );
}
