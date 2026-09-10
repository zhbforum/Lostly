import { parseDate, type CalendarDate } from '@internationalized/date';
import type { Ref } from 'react';
import {
  Button,
  DateInput,
  DatePicker,
  DateSegment,
  Dialog,
  FieldError,
  Group,
  Label,
  Popover,
  Text,
} from 'react-aria-components';

import fieldStyles from '../ListingField.module.css';
import { ListingCalendar } from './ListingCalendar';
import styles from './ListingDateField.module.css';

interface ListingDateFieldProps {
  id: string;
  name: string;
  label: string;
  hint?: string;
  error: string | null;
  value: string;
  disabled?: boolean;
  focusRef?: Ref<HTMLSpanElement>;
  onChange: (value: string) => void;
}

function parseListingDate(value: string): CalendarDate | null {
  if (!value) {
    return null;
  }

  try {
    return parseDate(value);
  } catch {
    return null;
  }
}

function CalendarIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path
        d="M7 3V6M17 3V6M4 9H20M5 5H19C19.5523 5 20 5.44772 20 6V19C20 19.5523 19.5523 20 19 20H5C4.44772 20 4 19.5523 4 19V6C4 5.44772 4.44772 5 5 5Z"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

export function ListingDateField({
  id,
  name,
  label,
  hint,
  error,
  value,
  disabled = false,
  focusRef,
  onChange,
}: ListingDateFieldProps) {
  const dateValue = parseListingDate(value);

  return (
    <DatePicker
      className={`${fieldStyles.field} ${styles.datePicker}`}
      name={name}
      value={dateValue}
      isDisabled={disabled}
      isInvalid={Boolean(error)}
      onChange={(date) => {
        onChange(date?.toString() ?? '');
      }}
    >
      <Label className={fieldStyles.label}>{label}</Label>

      {hint && (
        <Text className={fieldStyles.hint} slot="description">
          {hint}
        </Text>
      )}

      <Group id={id} className={styles.control}>
        <DateInput className={styles.dateInput}>
          {(segment) => (
            <DateSegment
              ref={segment.type === 'month' ? focusRef : undefined}
              className={styles.segment}
              segment={segment}
            />
          )}
        </DateInput>

        <Button className={styles.calendarButton} aria-label="Choose date">
          <CalendarIcon />
        </Button>
      </Group>

      {error && (
        <FieldError className={fieldStyles.fieldError}>
          <span className={fieldStyles.errorIcon} aria-hidden="true">
            !
          </span>
          {error}
        </FieldError>
      )}

      <Popover className={styles.popover} placement="bottom start" offset={8}>
        <Dialog className={styles.dialog}>
          <ListingCalendar />
        </Dialog>
      </Popover>
    </DatePicker>
  );
}
