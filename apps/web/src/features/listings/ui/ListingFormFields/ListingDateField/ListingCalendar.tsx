import {
  Button,
  Calendar,
  CalendarCell,
  CalendarGrid,
  CalendarGridBody,
  CalendarGridHeader,
  CalendarHeaderCell,
  Heading,
} from 'react-aria-components';

import styles from './ListingDateField.module.css';

function ChevronLeftIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path
        d="M15 18L9 12L15 6"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function ChevronRightIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path
        d="M9 6L15 12L9 18"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

export function ListingCalendar() {
  return (
    <Calendar className={styles.calendar}>
      <header className={styles.calendarHeader}>
        <Button className={styles.navigationButton} slot="previous">
          <ChevronLeftIcon />
        </Button>

        <Heading className={styles.calendarHeading} />

        <Button className={styles.navigationButton} slot="next">
          <ChevronRightIcon />
        </Button>
      </header>

      <CalendarGrid className={styles.calendarGrid} weekdayStyle="short">
        <CalendarGridHeader>
          {(day) => <CalendarHeaderCell className={styles.weekday}>{day}</CalendarHeaderCell>}
        </CalendarGridHeader>

        <CalendarGridBody>
          {(date) => <CalendarCell className={styles.calendarCell} date={date} />}
        </CalendarGridBody>
      </CalendarGrid>
    </Calendar>
  );
}
