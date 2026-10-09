import { useId, useState } from 'react';
import { Button, Dialog, Heading, Modal, ModalOverlay } from 'react-aria-components';
import { useFormDraft } from '@/shared/model/use-form-draft';
import { CLAIM_CONSTRAINTS, type DecideClaimInput } from '../../model/types';
import styles from './ClaimDecisionControls.module.css';

interface Props {
  claimId: string;
  disabled: boolean;
  isUpdating: boolean;
  error: string | null;
  clearError: () => void;
  onDecision: (id: string, input: DecideClaimInput) => Promise<boolean>;
  onRefresh?: () => void;
}

export function ClaimDecisionControls(props: Props) {
  return <DecisionForm key={props.claimId} {...props} />;
}

function DecisionForm({
  claimId,
  disabled,
  isUpdating,
  error,
  clearError,
  onDecision,
  onRefresh,
}: Props) {
  const fieldId = useId();
  const [action, setAction] = useState<'approved' | 'rejected' | null>(null);
  const [handover, setHandover, discardDraft] = useFormDraft('handover:' + claimId, () => '');
  const [validationError, setValidationError] = useState<string | null>(null);
  function open(next: typeof action) {
    clearError();
    setValidationError(null);
    setAction(next);
  }
  async function confirm(event: React.FormEvent) {
    event.preventDefault();
    if (!action || disabled) return;
    const value = handover.trim();
    if (
      action === 'approved' &&
      (value.length < CLAIM_CONSTRAINTS.handoverDetailsMinLength ||
        value.length > CLAIM_CONSTRAINTS.handoverDetailsMaxLength)
    ) {
      setValidationError('Provide collection instructions between 10 and 1000 characters.');
      return;
    }
    setValidationError(null);
    const input: DecideClaimInput =
      action === 'approved' ? { decision: action, handoverDetails: value } : { decision: action };
    if (await onDecision(claimId, input)) {
      discardDraft();
      setAction(null);
    }
  }
  return (
    <>
      <div className={styles.actions}>
        <Button
          className={`${styles.button} ${styles.primary}`}
          isDisabled={disabled}
          onPress={() => open('approved')}
        >
          Approve claim
        </Button>
        <Button className={styles.button} isDisabled={disabled} onPress={() => open('rejected')}>
          Reject
        </Button>
      </div>
      <ModalOverlay
        className={styles.overlay}
        isOpen={action !== null}
        onOpenChange={(isOpen) => {
          if (!isOpen && !disabled) setAction(null);
        }}
        isKeyboardDismissDisabled={disabled}
      >
        <Modal className={styles.modal}>
          <Dialog className={styles.dialog} aria-busy={isUpdating}>
            <Heading slot="title">
              {action === 'approved' ? 'Approve this claim?' : 'Reject this claim?'}
            </Heading>
            <form onSubmit={confirm} noValidate>
              {action === 'approved' ? (
                <>
                  <label htmlFor={fieldId}>Private collection instructions</label>
                  <p id={fieldId + '-hint'}>
                    Only this claimant will receive these instructions. Explain where and how to
                    collect the item, or provide a contact method you want to share.
                  </p>
                  <textarea
                    id={fieldId}
                    value={handover}
                    disabled={disabled}
                    maxLength={CLAIM_CONSTRAINTS.handoverDetailsMaxLength}
                    aria-invalid={Boolean(validationError)}
                    aria-describedby={
                      fieldId + '-hint' + (validationError ? ' ' + fieldId + '-error' : '')
                    }
                    onChange={(event) => setHandover(event.target.value)}
                  />
                  <p>
                    Approving closes this report and rejects all other pending claims. This decision
                    cannot be undone here.
                  </p>
                </>
              ) : (
                <p>
                  This claim will be closed and its conversation will become read-only. This
                  decision cannot be undone.
                </p>
              )}
              {(validationError || error) && (
                <p id={fieldId + '-error'} role="alert" className={styles.error}>
                  {validationError || error}
                </p>
              )}
              <div className={styles.actions}>
                <Button
                  className={styles.button}
                  autoFocus
                  isDisabled={disabled}
                  onPress={() => setAction(null)}
                >
                  Cancel
                </Button>
                <Button
                  type="submit"
                  className={`${styles.button} ${styles.primary}`}
                  isDisabled={disabled}
                >
                  {isUpdating
                    ? 'Saving…'
                    : action === 'approved'
                      ? 'Confirm approval'
                      : 'Confirm rejection'}
                </Button>
                {error && onRefresh && (
                  <Button
                    className={styles.button}
                    isDisabled={disabled}
                    onPress={() => {
                      setAction(null);
                      onRefresh();
                    }}
                  >
                    Refresh status
                  </Button>
                )}
              </div>
            </form>
          </Dialog>
        </Modal>
      </ModalOverlay>
    </>
  );
}
